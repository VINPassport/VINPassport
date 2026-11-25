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
 *     On mainnet the key is made first with `scripts/make-custody-key.mjs`;
 *     this script never creates one there.
 *
 * The contract address is printed before anything is sent. A stepped deploy
 * builds and custody-signs each step just before sending it, so no step waits
 * behind the others with a ttl that runs out.
 *
 * With a NIGHTGATE sponsor configured (`scripts/lib/sponsor9.mjs`, D37) the
 * sponsor pays every step, every chain read goes to that server, and the
 * deploy wallet opens only when the sponsor did not take a step. Without one
 * the deploy wallet pays in DUST (`scripts/dust.mjs` registers its NIGHT) and
 * the public indexer answers.
 *
 * The ledger 8 deploy (`deploy-preprod.mjs`, sponsored through nightgate-tx)
 * is at the git tag ledger8-preprod.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync, copyFileSync, mkdirSync, constants } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { submitTx, createLedger9UnprovenDeployTx, createLedger9UnprovenDeployTxFromVerifierKeys } from '@midnight-ntwrk/midnight-js-contracts';
import { SucceedEntirely } from '@midnight-ntwrk/midnight-js-types';
import { BUILD, requireBuildableNetwork } from './lib/eras.mjs';
import { publicEndpoints, guardLogs } from './lib/endpoints.mjs';
import { openWallet, describe, summarize } from './lib/wallet9.mjs';
import {
    buildFacts, compiledContract, refusingWitnesses, contractProviders, zkConfigProvider, custodyKey, recordPath, PROVABLE
} from './lib/contract9.mjs';
import { buildId } from './lib/build-id.mjs';
import { readRegistrarSlots, REGISTRAR_ROLES } from './lib/registrar-slots.mjs';
import { loadVinKeys } from './lib/vin-key.mjs';
import { registrarFile } from './lib/local-credentials.mjs';
import { writeJsonAtomic, takeSeedLock } from './lib/files.mjs';
import { ContractState as LedgerContractState, ZswapSecretKeys } from '@midnightntwrk/ledger-v9';
import {
    BLOCK_BUDGET, planDeploy, subsetState, deployTx, custodyInserts, custodyInsertStep, blockShare,
    submitPrepared, deployOrder
} from './lib/deploy-fit.mjs';
import { fingerprint } from './lib/maintenance9.mjs';
import { openSponsor, nightgateConfig } from './lib/sponsor9.mjs';
import { chainReads } from './lib/chain-read9.mjs';
import { BUILD_DIR } from './lib/contract9.mjs';

const arg = (flag) => {
    const i = process.argv.indexOf(flag);
    return i === -1 ? undefined : process.argv[i + 1];
};
const log = (...a) => console.log(...a);
const fail = (msg) => { console.error(`\nSTOP: ${msg}`); process.exit(1); };

const NETWORK = arg('--network');
if (!NETWORK) fail('name the network: --network preview | mainnet');
// The name builds file paths below, so it is checked before anything uses it.
try { requireBuildableNetwork(NETWORK); } catch (e) { fail(e.message); }
guardLogs();
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
// Mainnet has no default location for either file (registrarFile, custodyKey).
let regs, slots;
try { ({ regs, slots } = readRegistrarSlots(registrarFile(NETWORK))); } catch (e) { fail(e.message); }
// Never created on mainnet: scripts/make-custody-key.mjs makes it on purpose,
// so a mistyped VINPASSPORT_CUSTODY_KEY_FILE fails instead of minting a new authority.
let custody;
try { custody = custodyKey(NETWORK, { create: NETWORK !== 'mainnet' }); } catch (e) { fail(e.message); }
const freshTtl = () => new Date(Date.now() + 30 * 60_000);
const SYNC_MS = 10 * 60_000;

log(`network    ${NETWORK} (${publicEndpoints(NETWORK).nodeWsUrl})`);
log(`build      compactc ${facts.compiler}, runtime ${facts.runtime}, build id ${buildId()}, manifest ${facts.manifestSha256.slice(0, 16)}`);
log(`circuits   ${PROVABLE.length} with keys: ${PROVABLE.join(', ')}`);
for (const r of regs) log(`registrar  ${r.label} ${r.hex}  (${REGISTRAR_ROLES[r.label]})`);
log('           afterwards it changes only when two of them approve (scripts/govern.mjs, D32)');
log(`authority  custody key ${custody.verifyingKey.value.slice(0, 16)}... (threshold 1) until handed to the committee`);
// The NIGHTGATE sponsor, when configured, pays the deploy and its steps and answers every chain read (D37).
let nightgate;
try { nightgate = nightgateConfig(NETWORK); } catch (e) { fail(e.message); }
const reads = chainReads(NETWORK, { config: nightgate });
log(`mode       ${SUBMIT ? `SUBMIT: deploys, the fee paid ${nightgate ? 'by the NIGHTGATE sponsor' : 'in DUST'}` : 'dry run: builds and estimates, submits nothing'}`);
log(`reads      ${reads.source}\n`);

// ---------------------------------------------------------------- wallet
// One process per seed: a second one would spend the same DUST (scripts/lib/files.mjs).
try { takeSeedLock(NETWORK); } catch (e) { fail(e.message); }
let w = null;
let sponsor = null;
let code = 0;
try {
    // A deploy pins the build on disk, the one it is about to record. Left to
    // its default, the zk config expects the manifest of the build the
    // EXISTING record names, which a --redeploy of a new build can never match.
    // Midnight.js still checks every artifact against this manifest.
    let providers = null;
    let s = null;
    if (!nightgate) {
        const state = await (await ownWallet()).synced(SYNC_MS);
        log(describe(state));
        providers = await contractProviders(w, state, { log, expectedManifestHash: facts.manifestSha256 });
        s = summarize(state);
    }
    const compiled = compiledContract(refusingWitnesses());

    // Every deploy is fitted to the live block limits before anything is sent
    // (scripts/lib/deploy-fit.mjs). One that does not fit goes in two steps:
    // the contract with the circuits that fit, then the rest inserted by the
    // custody key, which holds the authority until the handover anyway.
    const { height, params } = await reads.ledgerParameters();
    if (RESUME) {
        if (!/^[0-9a-f]{64}$/.test(RESUME)) throw new Error('--resume takes the 64-hex address of the contract to finish');
        await resumeSteps(RESUME, params);
    } else {
    const options = { compiledContract: compiled, args: [slots], signingKey: custody.key };
    const unproven = providers ? await createLedger9UnprovenDeployTx(providers, options) : await sponsoredDeployTx(options);
    const full = LedgerContractState.deserialize(unproven.public.initialContractState.serialize());
    // Plan-time transactions fit the plan and price the dry run. A submit
    // builds and signs each one again just before it is sent (deployInSteps).
    const ttl = freshTtl();
    const plan = planDeploy(full, PROVABLE, params, { network: NETWORK, ttl });
    const pct = (x) => `${(x * 100).toFixed(1)}%`;
    log(`\nblock fit  limits at block ${height}; all ${PROVABLE.length} circuits in one deploy use ${pct(plan.wholeShare)} of a block before the fee (budget ${pct(BLOCK_BUDGET)})`);
    // The sponsor takes a deploy only as a prepared transaction, so a sponsored
    // deploy goes through the steps even when it has no insert to follow.
    let split = null;
    if (plan.rest.length || nightgate) {
        const dep = deployTx(NETWORK, subsetState(full, plan.first), ttl);
        const counter0 = full.maintenanceAuthority.counter;
        const steps = plan.rest.length ? custodyInserts({
            network: NETWORK, contractAddress: dep.deploy.address, circuits: plan.rest,
            keysDir: join(BUILD_DIR, 'keys'), custody, counter: counter0, params, ttl
        }) : [];
        split = { full, dep, steps, counter0, params };
        log(`step 1     the deploy carries ${plan.first.length} circuits (${pct(plan.share)}): ${plan.first.join(', ')}`);
        for (const [i, st] of steps.entries()) {
            log(`step ${i + 2}     the custody key inserts ${st.circuits.length} (${pct(st.share)}, counter ${st.counter}): ${st.circuits.join(', ')}`);
        }
    }

    if (!SUBMIT && nightgate) {
        log(`\nDry run complete: ${1 + split.steps.length} transactions, each paid by the NIGHTGATE sponsor. Re-run with --submit to deploy.`);
    } else if (!SUBMIT && split) {
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
        await deployInSteps(split, plan);
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
        // The address is known once the deploy is built. It is printed before
        // anything is sent, so a run that dies while waiting still names it.
        const address = unproven.public.contractAddress;
        log(`\naddress    ${address} (this deploy's own; keep it if the run is interrupted)`);
        log('proving, balancing and submitting the deploy...');
        const t0 = Date.now();
        // What deployContract does, split so the address above is the one sent:
        // submit the built deploy, require success, then store its signing key.
        const landed = await submitTx(providers, { unprovenTx: unproven.private.unprovenTx });
        if (landed.status !== SucceedEntirely) {
            throw new Error(`the deploy of ${address} landed with status ${landed.status} (transaction ${landed.txId})`);
        }
        await providers.privateStateProvider.setSigningKey(address, unproven.private.signingKey);
        const pub = { ...landed, ...unproven.public };
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
    if (sponsor) log(`sponsor    ${await reads.sponsorUsage()}`);
    await sponsor?.close();
    await w?.close();
}
process.exit(code);

/** The deploy wallet, opened on first use and synced before every use. */
async function ownWallet() {
    w ??= await openWallet(NETWORK, { log });
    await w.synced(SYNC_MS);
    return w;
}

/**
 * The deploy transaction without a wallet. The constructor makes no coins, so
 * the coin keys only have to be well formed, and the sponsor pays the fee.
 */
function sponsoredDeployTx(options) {
    const keys = ZswapSecretKeys.fromSeed(randomBytes(32));
    return createLedger9UnprovenDeployTxFromVerifierKeys(
        zkConfigProvider(NETWORK, { expectedManifestHash: facts.manifestSha256 }),
        keys.coinPublicKey, options, keys.encryptionPublicKey, { networkId: NETWORK, ttlSeconds: 30 * 60 }
    );
}

function writeRecord(record) {
    mkdirSync(dirname(RECORD), { recursive: true });
    if (existsSync(RECORD)) {
        const archived = join(dirname(RECORD), `${NETWORK}-superseded-${Date.now()}.json`);
        // A copy, then the atomic replace: there is never a moment without a record.
        copyFileSync(RECORD, archived, constants.COPYFILE_EXCL);
        log(`archived the previous record to ${archived}`);
    }
    writeJsonAtomic(RECORD, record);
}

/** Rewrite the record this run created, without archiving it. */
function updateRecord(record) {
    writeJsonAtomic(RECORD, record);
}

/** The contract's state as the chain reads see it now, or null before it is indexed. */
async function chainContract(address) {
    return (await reads.contractState(address).catch(() => null))?.state ?? null;
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
async function deployInSteps({ full, steps, counter0, params }, plan) {
    // Built again here, with a ttl that starts now; the plan's copy only priced it.
    const ttl = freshTtl();
    const dep = deployTx(NETWORK, subsetState(full, plan.first), ttl);
    if (blockShare(dep.tx, params).share > BLOCK_BUDGET) throw new Error('the deploy no longer fits the block budget it was planned for');
    const address = dep.deploy.address;
    log(`\naddress    ${address} (this deploy's own; keep it: --resume ${address} finishes an interrupted run)`);
    log(`step 1: submitting the deploy (${plan.first.length} circuits)...`);
    const t0 = Date.now();
    sponsor ??= await openSponsor(NETWORK, { log, config: nightgate });
    const id = await submitPrepared({ wallet: ownWallet, sponsor, tx: dep.tx, ttl, idempotencyKey: `vinpassport:deploy:${address}`, log });
    log(`  submitted, transaction id ${id}`);
    const landed = await reads.waitForTransaction(id);
    if (landed.status && landed.status !== 'SUCCESS') throw new Error(`the deploy landed with status ${landed.status}`);
    await untilChain(address, () => true, 'the deployed contract');
    const deployed = await reads.deployOf(address);
    const d = { ...landed, ...deployed, txId: deployed.txId ?? id };
    log(`\nDEPLOYED   ${address}`);
    log(`tx hash    ${d.txHash}  block ${d.blockHeight}`);
    log(`fees       paid ${d.fees?.paidFees ?? '?'} SPECK (estimated ${d.fees?.estimatedFees ?? '?'}); ${Math.round((Date.now() - t0) / 1000)} s`);
    await finishSteps({ address, d, plan, steps, counter0, params });
}

/**
 * Pick up a stepped deploy whose record was not written: the contract is on
 * chain with some of this build's circuits, under the custody key alone.
 * Everything is checked against the chain before anything is sent.
 */
async function resumeSteps(address, params) {
    const ttl = freshTtl();
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

    const d = await reads.deployOf(address);
    await finishSteps({ address, d, plan, steps, counter0: a.counter, params });
}

/**
 * Write the record for a deploy that landed, then run its insert steps. Each
 * step is built and signed just before it is sent, from the plan's circuits
 * and counter, so its ttl starts when it goes out.
 */
async function finishSteps({ address, d, plan, steps, counter0, params }) {
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
        ...(plan.rest.length ? {
            build: { ...facts, verifierKeys: pick(facts.verifierKeys, plan.first) },
            pendingInserts: plan.rest,
            deployedInSteps: {
                why: `all ${PROVABLE.length} verifier keys in one deploy exceed the block's bytes-written budget once the fee is added (scripts/lib/deploy-fit.mjs)`,
                deployed: plan.first,
                insertedAfter: plan.rest
            }
        } : { build: facts }),
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
    for (const [i, planned] of steps.entries()) {
        const before = await untilChain(address, () => true, 'the contract');
        if (before.maintenanceAuthority.counter !== planned.counter) {
            throw new Error(`the authority counter is ${before.maintenanceAuthority.counter}, step ${i + 2} was planned for ${planned.counter}`);
        }
        const ttl = freshTtl();
        const st = {
            ...planned,
            ...custodyInsertStep({
                network: NETWORK, contractAddress: address, circuits: planned.circuits,
                keysDir: join(BUILD_DIR, 'keys'), custody, counter: planned.counter, ttl
            })
        };
        if (blockShare(st.tx, params).share > BLOCK_BUDGET) throw new Error(`step ${i + 2} no longer fits the block budget it was planned for`);
        log(`\nstep ${i + 2}: the custody key inserts ${st.circuits.join(', ')}...`);
        t0 = Date.now();
        sponsor ??= await openSponsor(NETWORK, { log, config: nightgate });
        const iid = await submitPrepared({ wallet: ownWallet, sponsor, tx: st.tx, ttl, idempotencyKey: `vinpassport:insert:${address}:${st.counter}`, log });
        log(`  submitted, transaction id ${iid}`);
        const r = await reads.waitForTransaction(iid);
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
        writeJsonAtomic(join(auditDir, `counter-${st.counter}.json`), { ...st.proposal, executed });
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
