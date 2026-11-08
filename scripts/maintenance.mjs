#!/usr/bin/env node
/**
 * The contract's maintenance authority on ledger 9 (DECISIONS D28).
 *
 *   node scripts/maintenance.mjs status   --network preview              read only
 *   node scripts/maintenance.mjs handover --network preview              dry run
 *   node scripts/maintenance.mjs handover --network preview --submit     custody key -> committee
 *
 * The authority decides who may insert or replace verifier keys, which is
 * what lets the contract take a new toolchain's keys in place instead of a
 * redeploy that would start an empty ledger. Midnight.js deploys with one key
 * at threshold 1 and can only ever replace it with another single key, so the
 * handover to the committee is built here with the ledger's own types:
 *
 *   MaintenanceUpdate(address, [ReplaceAuthority(Authority(committee, 2, counter + 1))], counter)
 *
 * signed by the custody key (the sole member, index 0) and carried in an
 * otherwise empty intent whose fee the deploy wallet pays in DUST. The new
 * authority's counter is the current one plus one, and the update is valid
 * against the current one, which is how Midnight.js's own single-key
 * replacement builds it (compact-js executable, createMaintenanceAuthority).
 *
 * Afterwards every update needs two of the three members' signatures. The
 * tool for collecting them (propose, sign, submit) is the Phase 3.1
 * rehearsal; the ledger takes them as MaintenanceUpdate.addSignature(index, signature).
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    ContractState, ContractMaintenanceAuthority, Intent, MaintenanceUpdate, ReplaceAuthority, Transaction, signData
} from '@midnightntwrk/ledger-v9';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { networkEndpoints, guardLogs } from './lib/endpoints.mjs';
import { requireBuildableNetwork } from './lib/eras.mjs';
import { openWallet, describe } from './lib/wallet9.mjs';
import { custodyKey, recordPath } from './lib/contract9.mjs';

const arg = (flag) => {
    const i = process.argv.indexOf(flag);
    return i === -1 ? undefined : process.argv[i + 1];
};
const log = (...a) => console.log(...a);
const fail = (msg) => { console.error(`\nSTOP: ${msg}`); process.exit(1); };

const command = process.argv[2];
const network = arg('--network');
if (!['status', 'handover'].includes(command) || !network) {
    fail('usage: node scripts/maintenance.mjs status|handover --network preview|mainnet [--submit]');
}
try { requireBuildableNetwork(network); } catch (e) { fail(e.message); }
guardLogs();
const SUBMIT = process.argv.includes('--submit');
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RECORD = recordPath(network);
const COMMITTEE = join(ROOT, 'deploy', `committee.${network}.json`);
if (!existsSync(RECORD)) fail(`no deploy record at ${RECORD}: deploy first (scripts/deploy.mjs).`);
const record = JSON.parse(readFileSync(RECORD, 'utf8'));
const address = record.contractAddress;

const ep = networkEndpoints(network);
const pdp = indexerPublicDataProvider({ queryURL: ep.indexerHttpUrl, subscriptionURL: ep.indexerWsUrl });

/** The authority the chain holds now. */
async function onChainAuthority() {
    const read = await pdp.queryContractState(address);
    if (!read) throw new Error(`the indexer has no contract at ${address}`);
    const state = read.contractState.deserialize({ v9: ContractState });
    const a = state.maintenanceAuthority;
    return { committee: a.committee.map((k) => ({ tag: k.tag, value: k.value })), threshold: a.threshold, counter: a.counter };
}

const short = (vk) => `${vk.tag} ${vk.value.slice(0, 16)}...`;
const show = (a) => [
    `threshold ${a.threshold} of ${a.committee.length}, counter ${a.counter}`,
    ...a.committee.map((k, i) => `  [${i}] ${short(k)}`)
].join('\n');

const current = await onChainAuthority();
log(`contract  ${address} (${network})`);
log(`authority ${show(current)}`);

if (command === 'status') {
    const recorded = record.authority?.committee?.map((k) => k.value) ?? [];
    const same = recorded.length === current.committee.length && recorded.every((v, i) => v === current.committee[i].value)
        && record.authority?.threshold === current.threshold;
    log(same ? 'record    matches the chain' : 'record    DIFFERS from the chain: update deploy record before relying on it');
    process.exit(same ? 0 : 1);
}

// ------------------------------------------------------------------ handover
const custody = custodyKey(network);
if (current.threshold !== 1 || current.committee.length !== 1 || current.committee[0].value !== custody.verifyingKey.value) {
    fail('the chain\'s authority is not the custody key alone, so it has already been handed over (or the custody key file is not the one this contract was deployed with).');
}
if (!existsSync(COMMITTEE)) fail(`no committee list at ${COMMITTEE}. Create members with scripts/make-committee-key.mjs.`);
const list = JSON.parse(readFileSync(COMMITTEE, 'utf8'));
const vks = list.members.map((m) => m.verifyingKey);
if (vks.length < 2 || list.threshold < 2 || list.threshold > vks.length) {
    fail(`${COMMITTEE} lists ${vks.length} member(s) at threshold ${list.threshold}; D28 asks for at least 2 of 3.`);
}
if (new Set(vks.map((k) => k.value)).size !== vks.length) fail('the committee lists the same key twice.');
if (vks.some((k) => k.value === custody.verifyingKey.value)) fail('the custody key is listed as a committee member; it is meant to retire.');

const next = new ContractMaintenanceAuthority(vks, list.threshold, current.counter + 1n);
log(`\nhandover  to ${show({ committee: vks, threshold: list.threshold, counter: current.counter + 1n })}`);
log(SUBMIT ? 'mode      SUBMIT: signs with the custody key and submits' : 'mode      dry run: builds and signs, submits nothing');

const unsigned = new MaintenanceUpdate(address, [new ReplaceAuthority(next)], current.counter);
const update = unsigned.addSignature(0n, signData(custody.key, unsigned.dataToSign));
const ttl = new Date(Date.now() + 30 * 60_000);
const tx = Transaction.fromParts(network, undefined, undefined, Intent.new(ttl).addMaintenanceUpdate(update));

const w = await openWallet(network, { log });
let code = 0;
try {
    const state = await w.synced();
    log(describe(state));
    const handle = w.wallet.adoptTransaction(tx.serialize(), 'Unproven');
    if (!SUBMIT) {
        let fee, scope = 'with balancing';
        try { fee = await w.wallet.estimateTransactionFee(handle); } catch {
            fee = await w.wallet.calculateTransactionFee(handle);
            scope = 'update only; balancing adds a little';
        }
        log(`\nestimated fee ${fee} SPECK (${scope}). Dry run complete; re-run with --submit.`);
    } else {
        const recipe = await w.wallet.balanceUnprovenTransaction(handle, { ttl });
        const signed = await w.wallet.signRecipe(recipe, w.sign);
        const finalized = await w.wallet.finalizeRecipe(signed);
        const id = await w.wallet.submitTransaction(finalized);
        log(`\nsubmitted, transaction id ${id}`);
        log('waiting for the indexer to show the new authority...');
        let seen = null;
        for (let i = 0; i < 50 && !seen; i++) {
            await new Promise((r) => setTimeout(r, 6000));
            const a = await onChainAuthority().catch(() => null);
            if (a && a.counter === current.counter + 1n) seen = a;
        }
        if (!seen) throw new Error(`not visible after 5 minutes; check transaction ${id}, then run status`);
        log(`authority ${show(seen)}`);
        record.authority = {
            holder: 'committee',
            threshold: seen.threshold,
            counter: Number(seen.counter),
            committee: seen.committee,
            members: list.members.map((m) => m.name),
            handoverTxId: id,
            handedOverAt: new Date().toISOString(),
            note: 'Committee per DECISIONS D28. The custody key no longer has any power over this contract.'
        };
        writeFileSync(RECORD, JSON.stringify(record, null, 2) + '\n');
        log(`recorded  ${RECORD}`);
    }
} catch (e) {
    console.error(`\nmaintenance: ${e?.message ?? e}`);
    code = 1;
} finally {
    await w.close();
}
process.exit(code);
