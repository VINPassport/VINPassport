#!/usr/bin/env node
/**
 * Registrar governance on the deployed contract (DECISIONS D32).
 *
 *   node scripts/govern.mjs --network preview --remove D --as A            dry run
 *   node scripts/govern.mjs --network preview --remove D --as A --submit   A's approval, on chain
 *   node scripts/govern.mjs --network preview --remove D --as B --submit   B's approval carries it out
 *   node scripts/govern.mjs --network preview --add <64 hex> --as A ...    add an identity
 *
 * One call is one registrar's approval of one change. The second distinct
 * registrar to approve the same change in the same epoch carries it out, so a
 * change always takes two transactions proved with two different secrets.
 * That is the point of it: no single registrar can change the set alone.
 *
 * Without --submit the compiled circuit runs here, against the state the
 * public indexer holds now, acting as the registrar named by --as, and prints
 * what the chain would do: refuse (with the contract's own message), count the
 * approval, or carry out the change. No wallet is opened and nothing is sent.
 * With --submit the same dry run goes first, so a call the contract would
 * refuse never costs a fee; then the approval goes to the chain through
 * Midnight.js, the registrar set is read back from the indexer, and the
 * approval is appended to the deploy record's `registrarChanges`, which is how
 * scripts/chain-readback.mjs knows which set to expect.
 *
 * Labels (A, B, ...) are the ones the deploy record pinned. The approving
 * registrar's secret is read from the local registrar file and never printed;
 * identities are public and are printed.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createCircuitContext, ContractState as RuntimeState } from '@midnight-ntwrk/compact-runtime';
import { ContractState } from '@midnightntwrk/ledger-v9';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { Contract, ledger, pureCircuits } from '../contracts/vinpassport/src/managed/vinpassport/contract/index.js';
import { networkEndpoints, guardLogs, assertNoSecrets } from './lib/endpoints.mjs';
import { requireBuildableNetwork } from './lib/eras.mjs';
import { recordPath } from './lib/contract9.mjs';
import { credentialPath } from './lib/local-credentials.mjs';
import { makeWitnessHolder } from './lib/preprod-plan.mjs';
import { openChain, explainFailure } from './lib/runner9.mjs';
import { decodeEvents } from './lib/events.mjs';
import { resolveRegistrar, sameMembers, parseGovernArgs } from './lib/governance.mjs';

const fail = (msg) => { console.error(`\nSTOP: ${msg}`); process.exit(1); };
const hex = (u) => Buffer.from(u).toString('hex');
const bytes = (h) => new Uint8Array(Buffer.from(h, 'hex'));

let opts;
try { opts = parseGovernArgs(process.argv.slice(2)); } catch (e) {
    fail(`${e.message}\nusage: node scripts/govern.mjs --network preview --add|--remove <label or 64 hex> --as <label> [--submit]`);
}
try { requireBuildableNetwork(opts.network); } catch (e) { fail(e.message); }
guardLogs();

const RECORD = recordPath(opts.network);
if (!existsSync(RECORD)) fail(`no deploy record for ${opts.network}`);
const record = JSON.parse(readFileSync(RECORD, 'utf8'));
const pinned = record.registrars ?? [];
if (!pinned.length) fail('the deploy record pins no registrars, so labels cannot be resolved');

let target, approver;
try {
    target = resolveRegistrar(opts.target, pinned);
    approver = resolveRegistrar(opts.as, pinned);
} catch (e) { fail(e.message); }

/** The approving registrar's secret, from the local file; checked against its pinned identity. */
function approverSecret() {
    const file = process.env.VINPASSPORT_REGISTRAR_FILE
        ?? credentialPath(opts.network === 'mainnet' ? 'REGISTRAR-SECRETS.mainnet.env' : 'REGISTRAR-SECRETS.env');
    if (!existsSync(file)) fail(`no registrar secrets at ${file}`);
    const prefix = `VINPASSPORT_REGISTRAR_${approver.label}_SECRET_HEX=`;
    const v = readFileSync(file, 'utf8').split(/\r?\n/).find((l) => l.startsWith(prefix))?.slice(prefix.length).trim();
    if (!/^[0-9a-f]{64}$/.test(v ?? '')) fail(`${prefix}<64 hex> missing or malformed in ${file}`);
    const secret = bytes(v);
    if (hex(pureCircuits.registrarIdOf(secret)) !== approver.id) {
        fail(`the secret for ${approver.label} does not derive the identity the deploy record pinned for it`);
    }
    return secret;
}

async function indexerState() {
    const ep = networkEndpoints(opts.network);
    const pdp = indexerPublicDataProvider({ queryURL: ep.indexerHttpUrl, subscriptionURL: ep.indexerWsUrl });
    const read = await pdp.queryContractState(record.contractAddress);
    if (!read) fail('the indexer has no state for this contract');
    const onChain = read.contractState.deserialize({ v9: ContractState });
    if (!onChain.operation('approveRegistrarChange')) {
        fail('this contract has no approveRegistrarChange circuit on chain: the deployed build predates governance');
    }
    return RuntimeState.deserialize(read.contractState.serialize());
}

const registrarSet = (L) => new Set([...L.allowedRegistrars].map(hex));
const nameOf = (id) => pinned.find((r) => r.id === id)?.label ?? id.slice(0, 16) + '...';
const verb = opts.add ? 'add' : 'remove';

console.log(`contract   ${record.contractAddress} (${opts.network})`);
console.log(`change     ${verb} ${target.label ?? 'a new identity'} (${target.id})`);
console.log(`approver   ${approver.label} (${approver.id})`);

const secret = approverSecret();
const state = await indexerState();
const L0 = ledger(state.data);
const before = registrarSet(L0);
const epoch = L0.registrarEpoch;
const proposal = pureCircuits.proposalKeyOf(opts.add, bytes(target.id), epoch);
const approvalsSoFar = L0.registrarApprovals.member(proposal) ? Number(L0.registrarApprovals.lookup(proposal)) : 0;
console.log(`epoch      ${epoch}; proposal ${hex(proposal)}; approvals so far ${approvalsSoFar}`);
console.log(`registrars ${[...before].map(nameOf).join(', ')}`);

// ---- dry run: the compiled circuit, here, against the indexer's state
const { witnesses, arm } = makeWitnessHolder(secret);
arm('govern', { secret })();
const contract = new Contract(witnesses);
const ctx = createCircuitContext({
    circuitId: 'approveRegistrarChange', contractAddress: record.contractAddress,
    coinPublicKeyOrZswapState: '0'.repeat(64), contractState: state, privateState: {}
});
let predicted;
try {
    const r = await contract.impureCircuits.approveRegistrarChange(ctx, opts.add, bytes(target.id));
    const after = registrarSet(ledger(r.context.callContext.currentQueryContext.state));
    predicted = { carries: !sameMembers(before, after), after, events: decodeEvents(r.context.events ?? []) };
} catch (e) {
    fail(`the contract would refuse this approval: ${e?.message ?? e}`);
}
console.log(predicted.carries
    ? `dry run    this approval carries the change: ${before.size} registrars become ${predicted.after.size} (${[...predicted.after].map(nameOf).join(', ')})`
    : `dry run    the chain would count this approval (${approvalsSoFar + 1} of 2); the set does not change yet`);
for (const e of predicted.events) console.log(`event      ${e.kind}  ${e.subject}`);

if (!opts.submit) {
    console.log('\nnothing sent; re-run with --submit to put this approval on chain');
    process.exit(0);
}

// ---- submit: one approval, one transaction
const chain = await openChain(opts.network, { log: () => { } });
let code = 0;
try {
    const t0 = Date.now();
    chain.holder.armed = null;
    chain.arm(`approveRegistrarChange ${verb} ${target.label ?? target.id}`, { secret })();
    const r = await chain.found.callTx.approveRegistrarChange(opts.add, bytes(target.id));
    const pub = r.public;
    console.log(`\ntx         ${pub.txHash} (id ${pub.txId}) in block ${pub.blockHeight}`);
    console.log(`fee        ${pub.fees?.paidFees ?? '?'} SPECK paid, ${pub.fees?.estimatedFees ?? '?'} estimated; ${Math.round((Date.now() - t0) / 1000)} s`);

    const after = registrarSet(ledger((await indexerState()).data));
    const executed = !sameMembers(before, after);
    console.log(executed
        ? `registrars ${[...after].map(nameOf).join(', ')} (changed)`
        : 'registrars unchanged; the change waits for a second registrar');
    if (executed !== predicted.carries) console.log('NOTE       the outcome differs from the dry run: the state moved between the two');

    const entry = {
        add: opts.add, id: target.id, label: target.label, approver: { label: approver.label, id: approver.id },
        epoch: String(epoch), proposal: hex(proposal), executed,
        txHash: pub.txHash, txId: pub.txId, blockHeight: pub.blockHeight, paidFees: pub.fees?.paidFees ?? null,
        at: new Date().toISOString()
    };
    assertNoSecrets(entry, 'the governance record');
    const fresh = JSON.parse(readFileSync(RECORD, 'utf8'));
    fresh.registrarChanges = [...(fresh.registrarChanges ?? []), entry];
    writeFileSync(RECORD, JSON.stringify(fresh, null, 2) + '\n');
    console.log(`recorded   deploy/${opts.network}.json registrarChanges[${fresh.registrarChanges.length - 1}]`);
} catch (e) {
    console.error(`govern: ${explainFailure(e)}`);
    code = 1;
} finally {
    chain.holder.armed = null;
    await chain.close();
}
process.exit(code);
