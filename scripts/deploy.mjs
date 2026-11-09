#!/usr/bin/env node
/**
 * Deploy VINPassport on ledger 9 (Preview, later mainnet) with Midnight.js 5.
 *
 *   node scripts/deploy.mjs --network preview             dry run: build the deploy, estimate
 *                                                         its fee from live parameters, submit nothing
 *   node scripts/deploy.mjs --network preview --submit    deploy, paying the fee from our own DUST
 *   ... --submit --redeploy                               replace an existing record (archived, not lost)
 *
 * What a deploy fixes for the contract's lifetime, printed before anything is
 * built so it can be read first:
 *   - the initial registrar allowlist (constructor argument; afterwards it changes
 *     only when two current registrars approve, `scripts/govern.mjs`, D32);
 *   - the verifier keys of this build (pinned in the record by hash, with the
 *     integrity manifest's own hash);
 *   - the maintenance authority: the custody key, at threshold 1, until
 *     `scripts/maintenance.mjs handover` replaces it with the 2-of-3 committee
 *     (DECISIONS D28). Midnight.js registers a single key at deploy; the
 *     ledger accepts a committee only through a later ReplaceAuthority.
 *
 * Proving is in this process (zkir-v3), the fee is paid in DUST by the deploy
 * wallet (`scripts/dust.mjs` registers its NIGHT), and nothing here needs a
 * sponsor or a credential: Preview's endpoints are open.
 *
 * The ledger 8 deploy (`deploy-preprod.mjs`, sponsored through nightgate-tx)
 * is at the git tag ledger8-preprod.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { deployContract, createLedger9UnprovenDeployTx } from '@midnight-ntwrk/midnight-js-contracts';
import { BUILD } from './lib/eras.mjs';
import { networkEndpoints } from './lib/endpoints.mjs';
import { openWallet, describe, summarize } from './lib/wallet9.mjs';
import {
    buildFacts, compiledContract, refusingWitnesses, contractProviders, custodyKey, recordPath, PROVABLE
} from './lib/contract9.mjs';
import { buildId } from './lib/build-id.mjs';
import { readRegistrarSlots, REGISTRAR_ROLES } from './lib/registrar-slots.mjs';
import { loadVinKeys } from './lib/vin-key.mjs';
import { credentialPath } from './lib/local-credentials.mjs';
import { ContractState as LedgerContractState } from '@midnightntwrk/ledger-v9';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import {
    BLOCK_BUDGET, liveLedgerParameters, planDeploy, subsetState, deployTx, custodyInserts, submitLedgerTx, waitForTransaction,
    deployOrder
} from './lib/deploy-fit.mjs';
import { fingerprint } from './lib/maintenance9.mjs';
import { BUILD_DIR } from './lib/contract9.mjs';

const arg = (flag) => {
    const i = process.argv.indexOf(flag);
    return i === -1 ? undefined : process.argv[i + 1];
};
const log = (...a) => console.log(...a);
const fail = (msg) => { console.error(`\nSTOP: ${msg}`); process.exit(1); };

const NETWORK = arg('--network');
if (!NETWORK) fail('name the network: --network preview | mainnet');
const SUBMIT = process.argv.includes('--submit');
const REDEPLOY = process.argv.includes('--redeploy');
const RESUME = arg('--resume');
const RECORD = recordPath(NETWORK);

// ---------------------------------------------------------------- preflight
// Everything that can refuse without a wallet refuses before one is opened.
let facts;
try { facts = buildFacts(); } catch (e) { fail(e.message); }
if (facts.compiler !== BUILD.compiler || facts.runtime !== BUILD.runtime) {
    fail(`the build on disk is compiler ${facts.compiler} / runtime ${facts.runtime}; this branch expects ${BUILD.compiler} / ${BUILD.runtime}.`);
}
if (existsSync(RECORD) && SUBMIT && !REDEPLOY) {
    fail(`${RECORD} exists: a contract is already deployed on ${NETWORK}. A redeploy starts an EMPTY ledger. `
        + 'Pass --redeploy as well if that is intended; the old record is archived, not lost.');
}
if (NETWORK === 'mainnet' && SUBMIT) {
    // A public ledger cannot unpublish: the first write must already be keyed.
    try { loadVinKeys('mainnet'); } catch (e) { fail(`mainnet needs its vin key before a contract exists. ${e.message}`); }
}
const secrets = credentialPath(NETWORK === 'mainnet' ? 'REGISTRAR-SECRETS.mainnet.env' : 'REGISTRAR-SECRETS.env');
let regs, slots;
try { ({ regs, slots } = readRegistrarSlots(secrets)); } catch (e) { fail(e.message); }
let custody;
try { custody = custodyKey(NETWORK, { create: SUBMIT || NETWORK !== 'mainnet' }); } catch (e) { fail(e.message); }

log(`network    ${NETWORK} (${networkEndpoints(NETWORK).nodeWsUrl})`);
log(`build      compactc ${facts.compiler}, runtime ${facts.runtime}, build id ${buildId()}, manifest ${facts.manifestSha256.slice(0, 16)}`);
log(`circuits   ${PROVABLE.length} with keys: ${PROVABLE.join(', ')}`);
for (const r of regs) log(`registrar  ${r.label} ${r.hex}  (${REGISTRAR_ROLES[r.label]})`);
log('           afterwards it changes only when two of them approve (scripts/govern.mjs, D32)');
log(`authority  custody key ${custody.verifyingKey.value.slice(0, 16)}... (threshold 1) until handed to the committee`);
log(`mode       ${SUBMIT ? 'SUBMIT: deploys and pays the fee in DUST' : 'dry run: builds and estimates, submits nothing'}\n`);

// ---------------------------------------------------------------- wallet
const w = await openWallet(NETWORK, { log });
let code = 0;
try {
    const state = await w.synced();
    log(describe(state));
    // A deploy pins the build on disk, the one it is about to record. Left to
    // its default, contractProviders expects the manifest of the build the
    // EXISTING record names, which a --redeploy of a new build can never match.
    // Midnight.js still checks every artifact against this manifest.
    const providers = await contractProviders(w, state, { log, expectedManifestHash: facts.manifestSha256 });
    const compiled = compiledContract(refusingWitnesses());
    const s = summarize(state);

    // Every deploy is fitted to the live block limits before anything is sent
    // (scripts/lib/deploy-fit.mjs). One that does not fit goes in two steps:
    // the contract with the circuits that fit, then the rest inserted by the
    // custody key, which holds the authority until the handover anyway.
    const { height, params } = await liveLedgerParameters(NETWORK);
    if (RESUME) {
        if (!/^[0-9a-f]{64}$/.test(RESUME)) throw new Error('--resume takes the 64-hex address of the contract to finish');
        await resumeSteps(w, RESUME, params, new Date(Date.now() + 30 * 60_000));
    } else {
    const unproven = await createLedger9UnprovenDeployTx(providers, {
        compiledContract: compiled, args: [slots], signingKey: custody.key
    });
    const full = LedgerContractState.deserialize(unproven.public.initialContractState.serialize());
    const ttl = new Date(Date.now() + 30 * 60_000);
    const plan = planDeploy(full, PROVABLE, params, { network: NETWORK, ttl });
    const pct = (x) => `${(x * 100).toFixed(1)}%`;
    log(`\nblock fit  limits at block ${height}; all ${PROVABLE.length} circuits in one deploy use ${pct(plan.wholeShare)} of a block before the fee (budget ${pct(BLOCK_BUDGET)})`);
    let split = null;
    if (plan.rest.length) {
        const dep = deployTx(NETWORK, subsetState(full, plan.first), ttl);
        const counter0 = full.maintenanceAuthority.counter;
        const steps = custodyInserts({
            network: NETWORK, contractAddress: dep.deploy.address, circuits: plan.rest,
            keysDir: join(BUILD_DIR, 'keys'), custody, counter: counter0, params, ttl
        });
        split = { dep: { ...dep, ttl }, steps, counter0 };
        log(`step 1     the deploy carries ${plan.first.length} circuits (${pct(plan.share)}): ${plan.first.join(', ')}`);
        for (const [i, st] of steps.entries()) {
            log(`step ${i + 2}     the custody key inserts ${st.circuits.length} (${pct(st.share)}, counter ${st.counter}): ${st.circuits.join(', ')}`);
        }
    }

    if (!SUBMIT && split) {
        let total = 0n;
        const txs = [['deploy', split.dep.tx], ...split.steps.map((st, i) => [`insert ${i + 1}`, st.tx])];
        for (const [label, tx] of txs) {
            const handle = w.wallet.adoptTransaction(tx.serialize(), 'Unproven');
            let fee;
            try { fee = await w.wallet.estimateTransactionFee(handle); } catch { fee = await w.wallet.calculateTransactionFee(handle); }
            total += BigInt(fee);
            log(`estimated fee ${label.padEnd(9)} ${fee} SPECK (${(Number(fee) / 1e15).toFixed(6)} DUST)`);
        }
        log(`estimated total     ${total} SPECK (${(Number(total) / 1e15).toFixed(6)} DUST); DUST available ${s.dust} SPECK`);
        log(s.dust < total ? '\nNot enough DUST yet.' : `\nDry run complete: ${txs.length} transactions, enough DUST. Re-run with --submit to deploy.`);
        if (s.dust < total) code = 2;
    } else if (SUBMIT && split) {
        await deployInSteps(w, split, plan);
    } else if (!SUBMIT) {
        const bytes = unproven.private.unprovenTx.serialize();
        const handle = w.wallet.adoptTransaction(bytes, 'Unproven');
        // The full estimate simulates the balancing transaction, which needs
        // DUST to spend; without any, report the deploy's own fee and say so.
        let fee, scope = 'deploy plus balancing';
        try { fee = await w.wallet.estimateTransactionFee(handle); } catch {
            fee = await w.wallet.calculateTransactionFee(handle);
            scope = 'deploy only; balancing adds a little';
        }
        log(`\ndeploy transaction  ${bytes.length} bytes unproven`);
        log(`example address     ${unproven.public.contractAddress} (a real deploy gets its own)`);
        log(`estimated fee       ${fee} SPECK (${(Number(fee) / 1e15).toFixed(6)} DUST), ${scope}, live parameters`);
        log(`DUST available      ${s.dust} SPECK`);
        if (s.dust < fee) {
            log('\nNot enough DUST yet. Register the NIGHT and let it generate:');
            log(`  node scripts/dust.mjs --network ${NETWORK} --register`);
            code = 2;
        } else {
            log('\nDry run complete: enough DUST. Re-run with --submit to deploy.');
        }
    } else {
        log('\nbuilding, balancing and submitting the deploy...');
        const t0 = Date.now();
        const deployed = await deployContract(providers, {
            compiledContract: compiled, args: [slots], signingKey: custody.key
        });
        const pub = deployed.deployTxData.public;
        log(`\nDEPLOYED   ${pub.contractAddress}`);
        log(`tx hash    ${pub.txHash}  block ${pub.blockHeight}`);
        log(`fees       paid ${pub.fees?.paidFees ?? '?'} SPECK (estimated ${pub.fees?.estimatedFees ?? '?'})`);
        log(`took       ${Math.round((Date.now() - t0) / 1000)} s`);
        writeRecord({
            network: NETWORK,
            contract: 'vinpassport',
            contractAddress: pub.contractAddress,
            txHash: pub.txHash,
            txId: pub.txId,
            blockHeight: pub.blockHeight,
            deployedAt: new Date(pub.blockTimestamp ?? Date.now()).toISOString(),
            fees: pub.fees ?? null,
            ledger: BUILD.ledger,
            buildId: buildId(),
            build: facts,
            registrars: regs.map((r) => ({ label: r.label, id: r.hex })),
            authority: {
                holder: 'custody',
                threshold: 1,
                counter: 0,
                committee: [custody.verifyingKey],
                note: 'Custody key until `scripts/maintenance.mjs handover` replaces it with the committee (DECISIONS D28).'
            },
            note: 'Public record of the deployment. Address, hashes and verifying keys are public by definition. '
                + 'build.manifestSha256 pins the compiler integrity manifest; build.verifierKeys are the SHA-256 '
                + 'hashes of the verifier keys this address holds.'
        });
        log(`recorded   ${RECORD}`);
    }
    }
} catch (e) {
    console.error(`\ndeploy: ${e?.message ?? e}`);
    if (e?.code) console.error(`code: ${e.code}`);
    // The node's own reason is on `cause`. Midnight.js redacts it of anything
    // that could carry transaction or witness material, so it is safe to print,
    // and without it a refusal names no reason at all.
    for (let c = e?.cause, depth = 1; c && depth <= 5; c = c.cause, depth += 1) {
        console.error(`cause ${depth}: ${c?.message ?? c}${c?.code ? ` [${c.code}]` : ''}`);
    }
    code = 1;
} finally {
    await w.close();
}
process.exit(code);

function writeRecord(record) {
    mkdirSync(dirname(RECORD), { recursive: true });
    if (existsSync(RECORD)) {
        const archived = join(dirname(RECORD), `${NETWORK}-superseded-${Date.now()}.json`);
        renameSync(RECORD, archived);
        log(`archived the previous record to ${archived}`);
    }
    writeFileSync(RECORD, JSON.stringify(record, null, 2) + '\n');
}

/** Rewrite the record this run created, without archiving it. */
function updateRecord(record) {
    writeFileSync(RECORD, JSON.stringify(record, null, 2) + '\n');
}

/** The contract's state as the indexer holds it now, or null before it is indexed. */
async function chainContract(address) {
    const ep = networkEndpoints(NETWORK);
    const pdp = indexerPublicDataProvider({ queryURL: ep.indexerHttpUrl, subscriptionURL: ep.indexerWsUrl });
    const read = await pdp.queryContractState(address).catch(() => null);
    return read ? read.contractState.deserialize({ v9: LedgerContractState }) : null;
}

/** Poll until `test(state)` holds, for at most five minutes. */
async function untilChain(address, test, what) {
    for (let i = 0; i < 50; i++) {
        const st = await chainContract(address);
        if (st && test(st)) return st;
        await new Promise((r) => setTimeout(r, 6000));
    }
    throw new Error(`${what}: not visible on the indexer after five minutes`);
}

// Function declarations, not consts: the main block above runs before any
// const below it is initialised (it cost a crash between the deploy and its
// record on 9 November 2026; `--resume` exists because of it).
function pick(o, keys) { return Object.fromEntries(keys.map((k) => [k, o[k]])); }
function isoOf(ts) { return new Date(ts == null ? Date.now() : (/^\d+$/.test(String(ts)) ? Number(ts) : ts)).toISOString(); }

/**
 * A deploy too large for one block: the contract with the circuits that fit,
 * then each insert step signed by the custody key. The record is written after
 * the deploy and rewritten after every step, so a run stopped halfway leaves a
 * record that says exactly what the chain holds (`pendingInserts`).
 */
async function deployInSteps(w, { dep, steps, counter0 }, plan) {
    const address = dep.deploy.address;
    log(`\nstep 1: submitting the deploy (${plan.first.length} circuits)...`);
    const t0 = Date.now();
    const id = await submitLedgerTx(w, dep.tx, dep.ttl);
    log(`  submitted, transaction id ${id}`);
    const d = await waitForTransaction(NETWORK, id);
    if (d.status && d.status !== 'SUCCESS') throw new Error(`the deploy landed with status ${d.status}`);
    d.txId = d.actionTxId(address);
    await untilChain(address, () => true, 'the deployed contract');
    log(`\nDEPLOYED   ${address}`);
    log(`tx hash    ${d.txHash}  block ${d.blockHeight}`);
    log(`fees       paid ${d.fees?.paidFees ?? '?'} SPECK (estimated ${d.fees?.estimatedFees ?? '?'}); ${Math.round((Date.now() - t0) / 1000)} s`);
    await finishSteps(w, { address, d, plan, steps, counter0, ttl: dep.ttl });
}

/**
 * Pick up a stepped deploy whose record was not written: the contract is on
 * chain with some of this build's circuits, under the custody key alone.
 * Everything is checked against the chain before anything is sent.
 */
async function resumeSteps(w, address, params, ttl) {
    const chain = await chainContract(address);
    if (!chain) throw new Error(`the indexer has no contract at ${address}`);
    const a = chain.maintenanceAuthority;
    if (a.threshold !== 1 || a.committee.length !== 1 || a.committee[0].value !== custody.verifyingKey.value) {
        throw new Error('that contract\'s authority is not this custody key alone; it is not a deploy this tool can resume');
    }
    const onChain = chain.operations().map((o) => (typeof o === 'string' ? o : Buffer.from(o).toString('hex')));
    const foreign = onChain.filter((c) => !PROVABLE.includes(c));
    if (foreign.length) throw new Error(`the contract carries circuits this build does not: ${foreign.join(', ')}`);
    for (const c of onChain) {
        if (!Buffer.from(chain.operation(c).verifierKey).equals(readFileSync(join(BUILD_DIR, 'keys', `${c}.verifier`)))) {
            throw new Error(`${c}: the verifier key on chain is not this build's`);
        }
    }
    const order = deployOrder(PROVABLE);
    const plan = { first: order.filter((c) => onChain.includes(c)), rest: order.filter((c) => !onChain.includes(c)) };
    const steps = plan.rest.length ? custodyInserts({
        network: NETWORK, contractAddress: address, circuits: plan.rest,
        keysDir: join(BUILD_DIR, 'keys'), custody, counter: a.counter, params, ttl
    }) : [];
    log(`\nresume     ${address}: ${plan.first.length} circuits on chain, every key matches this build; authority is the custody key, counter ${a.counter}`);
    for (const [i, st] of steps.entries()) log(`step ${i + 2}     the custody key inserts ${st.circuits.length}: ${st.circuits.join(', ')}`);
    if (!SUBMIT) { log('\nDry run: nothing sent. Re-run with --submit to finish.'); return; }

    // The deploy transaction, from the indexer.
    const ep = networkEndpoints(NETWORK);
    const q = `{ contractAction(address: "${address}") { __typename ... on ContractDeploy { transaction { hash block { height timestamp } `
        + 'contractActions { address } ... on RegularTransaction { identifiers fees { estimatedFees paidFees } transactionResult { status } } } } } }';
    const res = await fetch(ep.indexerHttpUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: q }) });
    const act = (await res.json())?.data?.contractAction;
    if (act?.__typename !== 'ContractDeploy') {
        throw new Error(`the contract's latest action is ${act?.__typename ?? 'unknown'}, not its deploy; resume expects nothing after the deploy`);
    }
    const t = act.transaction;
    const d = {
        // The id at the index of this contract's action, as Midnight.js correlates it.
        txId: t.identifiers?.[(t.contractActions ?? []).findIndex((x) => x.address === address)] ?? null, txHash: t.hash, blockHeight: t.block.height,
        blockTimestamp: t.block.timestamp, status: t.transactionResult?.status ?? null,
        fees: t.fees ? { estimatedFees: String(t.fees.estimatedFees), paidFees: String(t.fees.paidFees) } : null
    };
    await finishSteps(w, { address, d, plan, steps, counter0: a.counter, ttl });
}

/** Write the record for a deploy that landed, then run its insert steps. */
async function finishSteps(w, { address, d, plan, steps, counter0, ttl }) {
    const facts = buildFacts();
    let t0;
    const record = {
        network: NETWORK,
        contract: 'vinpassport',
        contractAddress: address,
        txHash: d.txHash,
        txId: d.txId,
        blockHeight: d.blockHeight,
        deployedAt: isoOf(d.blockTimestamp),
        fees: d.fees,
        ledger: BUILD.ledger,
        buildId: buildId(),
        build: { ...facts, verifierKeys: pick(facts.verifierKeys, plan.first) },
        pendingInserts: plan.rest,
        deployedInSteps: {
            why: `all ${PROVABLE.length} verifier keys in one deploy exceed the block's bytes-written budget once the fee is added (scripts/lib/deploy-fit.mjs)`,
            deployed: plan.first,
            insertedAfter: plan.rest
        },
        registrars: regs.map((r) => ({ label: r.label, id: r.hex })),
        authority: {
            holder: 'custody',
            threshold: 1,
            counter: Number(counter0),
            committee: [custody.verifyingKey],
            note: 'Custody key until `scripts/maintenance.mjs handover` replaces it with the committee (DECISIONS D28).'
        },
        note: 'Public record of the deployment. Address, hashes and verifying keys are public by definition. '
            + 'build.manifestSha256 pins the compiler integrity manifest; build.verifierKeys are the SHA-256 '
            + 'hashes of the verifier keys this address holds.'
    };
    writeRecord(record);
    log(`recorded   ${RECORD} (${plan.rest.length} circuits still to insert)`);

    const auditDir = join(dirname(RECORD), 'maintenance', NETWORK, address.slice(0, 16));
    for (const [i, st] of steps.entries()) {
        await w.wallet.waitForSyncedState();
        const before = await untilChain(address, () => true, 'the contract');
        if (before.maintenanceAuthority.counter !== st.counter) {
            throw new Error(`the authority counter is ${before.maintenanceAuthority.counter}, step ${i + 2} was signed for ${st.counter}`);
        }
        log(`\nstep ${i + 2}: the custody key inserts ${st.circuits.join(', ')}...`);
        t0 = Date.now();
        const iid = await submitLedgerTx(w, st.tx, ttl);
        log(`  submitted, transaction id ${iid}`);
        const r = await waitForTransaction(NETWORK, iid);
        if (r.status && r.status !== 'SUCCESS') throw new Error(`step ${i + 2} landed with status ${r.status}`);
        const after = await untilChain(address, (s2) => s2.maintenanceAuthority.counter === st.counter + 1n, `step ${i + 2}`);
        for (const c of st.circuits) {
            const onChain = after.operation(c)?.verifierKey;
            if (!onChain || !Buffer.from(onChain).equals(readFileSync(join(BUILD_DIR, 'keys', `${c}.verifier`)))) {
                throw new Error(`${c}: the verifier key on chain is missing or differs from the build`);
            }
        }
        log(`  block ${r.blockHeight}, fee ${r.fees?.paidFees ?? '?'} SPECK, ${Math.round((Date.now() - t0) / 1000)} s; every inserted key on chain matches the build`);
        const executed = { txId: iid, txHash: r.txHash, blockHeight: r.blockHeight, fees: r.fees, at: new Date().toISOString(), newCounter: Number(st.counter) + 1 };
        mkdirSync(auditDir, { recursive: true });
        writeFileSync(join(auditDir, `counter-${st.counter}.json`), JSON.stringify({ ...st.proposal, executed }, null, 2) + '\n');
        record.build.verifierKeys = { ...record.build.verifierKeys, ...pick(facts.verifierKeys, st.circuits) };
        record.pendingInserts = record.pendingInserts.filter((c) => !st.circuits.includes(c));
        record.authority.counter = Number(st.counter) + 1;
        record.maintenance = [...(record.maintenance ?? []), {
            counter: Number(st.counter), ...executed, fingerprint: fingerprint(st.proposal), signedBy: ['custody'],
            updates: st.proposal.updates.map(({ op, circuit, version, vkSha256 }) => ({ op, circuit, version, vkSha256 }))
        }];
        if (!record.pendingInserts.length) {
            delete record.pendingInserts;
            record.build = facts;
        }
        updateRecord(record);
        log(`recorded   ${RECORD}`);
    }
    log(`\nall ${PROVABLE.length} circuits on chain at ${address}; audit trail in ${auditDir}`);
}
