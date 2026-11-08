/**
 * The ledger 9 chain runner: a real intake against the deployed contract on
 * Preview (later mainnet), on Midnight.js 5, one call per transaction.
 *
 * Per run: plan the intake into calls, dry-run them through the compiled
 * circuits so a refusal is reported instead of submitted, then for each call
 * arm the witnesses, and let Midnight.js run the circuit, prove it in this
 * process (zkir-v3), balance the fee in DUST with at least two spends (ledger
 * issue #838), submit, and wait for the block. The receipt holds the values
 * and salts, the private half of the passport, and never leaves this machine
 * except to its holder.
 *
 * Replaces the ledger 8 runner (preprod-runner.mjs, nightgate-tx batches,
 * extrinsic submission, its own reject classifier), which stays at the git
 * tag ledger8-preprod. What changed and why:
 *   - one call per transaction: batching saved 0.3% at best (measured
 *     14 Oct), and a single call is what Midnight.js 5 submits natively;
 *   - Midnight.js's coded errors replace our classifier of node messages;
 *   - waits are bounded per call, never open-ended;
 *   - the witness holder still refuses an unarmed read: Midnight.js runs
 *     witnesses inside the call, and an unarmed read would commit a zero.
 *
 * Demo policy (locked design): every run uses a fresh random VPD-prefixed
 * VIN, from intake-rules.mjs, so a run never squats a real vehicle.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { blake2b } from '@noble/hashes/blake2';
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { PassportSimulator, hex, FIELDS, K, contentRoot } from './scenario.mjs';
import { CLAIM_DEFS, claimLabel, planCalls, makeStage, stepLabel, makeWitnessHolder } from './preprod-plan.mjs';
import { dryRunStages } from './preprod-dryrun.mjs';
import { publicEndpoints, assertNoSecrets } from './endpoints.mjs';
import { loadVinKeys, vinKey, VINKEY_SCHEME } from './vin-key.mjs';
import { credentialPath, LOCAL_DIR } from './local-credentials.mjs';
import { openWallet, summarize } from './wallet9.mjs';
import { buildFacts, compiledContract, contractProviders, recordPath } from './contract9.mjs';
import { guidedIntake, validateManualIntake, randomDemoVin } from './intake-rules.mjs';

export { guidedIntake, validateManualIntake, randomDemoVin };

const CALL_TIMEOUT_MS = 10 * 60_000;   // prove ~15-35 s, balance, submit, block, indexer
const b2b = (d) => blake2b(d, { dkLen: 32 });
const utf8 = (s) => new TextEncoder().encode(s);
const zero32 = () => new Uint8Array(32);

const withTimeout = (promise, ms, what) => {
    let t;
    return Promise.race([
        promise.finally(() => clearTimeout(t)),
        new Promise((_, reject) => { t = setTimeout(() => reject(new Error(`${what} did not finish within ${Math.round(ms / 60_000)} min`)), ms); })
    ]);
};

/** Registrar A (the demo registrar) and, when configured, C (the dealership). */
export function readRegistrars(network) {
    const file = process.env.VINPASSPORT_REGISTRAR_FILE
        ?? credentialPath(network === 'mainnet' ? 'REGISTRAR-SECRETS.mainnet.env' : 'REGISTRAR-SECRETS.env');
    if (!existsSync(file)) throw new Error(`no registrar secrets at ${file}`);
    const lines = readFileSync(file, 'utf8').split(/\r?\n/);
    const read = (key, who) => {
        const prefix = `VINPASSPORT_REGISTRAR_${who}_${key}_HEX=`;
        const v = lines.find((l) => l.startsWith(prefix))?.slice(prefix.length).trim();
        if (!/^[0-9a-f]{64}$/.test(v ?? '')) throw new Error(`${prefix}<64 hex> missing or malformed in ${file}`);
        return Uint8Array.from(Buffer.from(v, 'hex'));
    };
    const registrar = { secret: read('SECRET', 'A'), id: read('ID', 'A') };
    let dealer = null;
    try { dealer = { label: 'dealership', secret: read('SECRET', 'C'), id: read('ID', 'C') }; } catch { /* no delegation */ }
    return { registrar, dealer };
}

/**
 * Words a person can act on, for a failed call. Midnight.js 5 errors carry a
 * `code`; node refusals arrive inside the message.
 */
export function explainFailure(e) {
    const msg = String(e?.message ?? e);
    const code = e?.code ? ` [${e.code}]` : '';
    if (/OutsideTimeToDismiss/i.test(msg)) {
        return `the node refused the fee as OutsideTimeToDismiss${code}: ledger issue #838, a fee paid with exactly one `
            + 'DUST spend. The wallet needs two DUST coins: run `node scripts/dust.mjs --network <n> --split 3`, then register.';
    }
    if (/insufficient\s*funds|could not balance dust|InsufficientDust/i.test(msg)) {
        return `not enough DUST for the fee${code}. DUST regenerates from registered NIGHT; check with scripts/dust.mjs.`;
    }
    if (/verifier key/i.test(msg) && /mismatch|differ/i.test(msg)) {
        return `the build on disk is not the build this contract holds${code}: ${msg}`;
    }
    return `${msg}${code}`;
}

/**
 * Connect to the deployed contract: wallet synced, providers built, artifacts
 * checked against the deploy record, witnesses held for arming.
 */
export async function openChain(network, { log = () => { } } = {}) {
    const path = recordPath(network);
    if (!existsSync(path)) throw new Error(`no deploy record at ${path}: deploy first (scripts/deploy.mjs)`);
    const record = JSON.parse(readFileSync(path, 'utf8'));
    const facts = buildFacts();
    if (record.build?.manifestSha256 && record.build.manifestSha256 !== facts.manifestSha256) {
        throw new Error('the build on disk is not the deployed build (integrity manifest differs from the deploy record)');
    }
    for (const [c, h] of Object.entries(record.build?.verifierKeys ?? {})) {
        if (facts.verifierKeys[c] !== h) throw new Error(`verifier key for ${c} differs from the one deployed`);
    }
    const { registrar, dealer } = readRegistrars(network);
    const w = await openWallet(network, { log });
    try {
        const state = await w.synced();
        const providers = await contractProviders(w, state, { log });
        const { holder, witnesses, arm } = makeWitnessHolder(registrar.secret);
        const found = await findDeployedContract(providers, {
            contractAddress: record.contractAddress, compiledContract: compiledContract(witnesses)
        });
        return { network, record, w, providers, found, holder, arm, registrar, dealer, close: () => w.close() };
    } catch (e) {
        await w.close();
        throw e;
    }
}

/**
 * One run. With `submit: false` it stops after the dry run and returns the
 * plan, so the shape of a run can be checked without spending DUST.
 * `onStep(step)` sees every step as it starts and ends; `save: false` keeps the
 * receipt in memory only (tests).
 */
export async function executeRun(chain, intake, { log = () => { }, onStep = () => { }, submit = true, save = true } = {}) {
    const { network, registrar, dealer, arm, holder } = chain;
    const runSeed = randomBytes(32);
    const saltFn = (label) => b2b(Uint8Array.from([...runSeed, ...utf8(label)]));
    const vin = intake.vin;
    // The ledger key is derived under this network's vin key, never a plain
    // hash of the VIN, and there is no fallback (scripts/lib/vin-key.mjs).
    const vinBytes = vinKey(vin, loadVinKeys(network));
    const croot = contentRoot(vin, intake.fields ?? {}, intake.panel ?? {}, saltFn, hex(vinBytes));
    const writes = {};
    const saltOf = (name, seq) => saltFn(`:salt:${name}:${seq}`);

    // One call per transaction.
    let stages = planCalls(intake).flatMap((st) => st.steps.map((s) => makeStage([s])));

    const sim = await PassportSimulator.create([registrar.id]);
    sim.actAs(registrar.secret);
    const dry = await dryRunStages(stages, {
        sim, registrarSecret: registrar.secret, dealer, vinBytes, croot, saltOf, writes
    });
    stages = dry.stages;
    const refused = dry.refused;
    log(`dry run: ${stages.length} call(s) provable, ${refused.length} refused in-circuit (reported, never submitted)`);
    for (const r of refused) log(`  refused: ${r.step}${r.reason ? ` (${r.reason})` : ''}`);
    if (!submit) return { vin, stages: stages.map((s) => s.label), refused };
    if (!stages.length) throw new Error('nothing survived the dry run');

    const writeAt = (name, i) => writes[name]?.[i] ?? { value: 0n, salt: zero32() };
    const zeros = { pending: { value: 0n, salt: zero32() }, prev: { value: 0n, salt: zero32() } };
    const toCall = (s) => {
        const label = stepLabel(s);
        if (s.kind === 'register') {
            return { circuitId: 'registerPassport', args: [vinBytes, croot], before: arm(label, zeros) };
        }
        if (s.kind === 'authorise' || s.kind === 'withdraw') {
            return {
                circuitId: s.kind === 'authorise' ? 'authoriseWriter' : 'withdrawWriter',
                args: [vinBytes, s.writerId], before: arm(label, zeros)
            };
        }
        if (s.kind === 'grant') {
            return { circuitId: 'grantDisclosure', args: [vinBytes, s.granteeId, s.tierIndex], before: arm(label, zeros) };
        }
        if (s.kind === 'init') {
            return {
                circuitId: 'initialiseField', args: [vinBytes, K[s.name], FIELDS[s.name].rule],
                before: arm(label, { pending: { ...writeAt(s.name, 0) }, prev: zeros.prev })
            };
        }
        if (s.kind === 'update') {
            return {
                circuitId: 'recordField', args: [vinBytes, K[s.name]],
                before: arm(label, {
                    pending: { ...writeAt(s.name, s.writeIndex) }, prev: { ...writeAt(s.name, s.writeIndex - 1) },
                    secret: s.by === dealer?.label ? dealer.secret : undefined
                })
            };
        }
        const opened = writeAt(s.name, s.writeIndex);
        if (s.circuit === 'proveFieldAtMostField') {
            return {
                circuitId: 'proveFieldAtMostField', args: [vinBytes, K[s.name], K[s.against], s.bound],
                before: arm(label, { pending: zeros.pending, prev: { ...opened }, other: { ...writeAt(s.against, s.writeIndexAgainst) } })
            };
        }
        return {
            circuitId: s.circuit === 'proveFieldAtLeast' ? 'proveFieldAtLeast' : 'proveFieldAtMost',
            args: [vinBytes, K[s.name], s.bound],
            before: arm(label, { pending: zeros.pending, prev: { ...opened } })
        };
    };

    const onChain = [];
    let n = 0;
    for (const stage of stages) {
        n += 1;
        const s = stage.steps[0];
        const call = toCall(s);
        const step = { id: `call:${n}`, label: stage.label, circuit: call.circuitId, status: 'running', startedAt: new Date().toISOString() };
        onStep(step);
        const t0 = Date.now();
        const dustBefore = summarize(await chain.w.wallet.waitForSyncedState()).dust;
        try {
            holder.armed = null;
            call.before();
            const r = await withTimeout(chain.found.callTx[call.circuitId](...call.args), CALL_TIMEOUT_MS, call.circuitId);
            const pub = r.public;
            const entry = {
                stage: n, label: stage.label, calls: [stepLabel(s)], circuit: call.circuitId,
                txId: pub.txId, txHash: pub.txHash, blockHeight: pub.blockHeight,
                fees: pub.fees ?? null, dustBefore: String(dustBefore), ms: Date.now() - t0
            };
            onChain.push(entry);
            Object.assign(step, { status: 'done', ms: entry.ms, detail: `tx ${pub.txHash} in block ${pub.blockHeight}` });
            onStep(step);
            log(`  ${n}/${stages.length} ${stage.label}: block ${pub.blockHeight}, fee ${pub.fees?.paidFees ?? '?'}, ${Math.round(entry.ms / 1000)} s`);
        } catch (e) {
            Object.assign(step, { status: 'failed', ms: Date.now() - t0, detail: explainFailure(e) });
            onStep(step);
            const err = new Error(`call ${n} (${stage.label}) failed: ${explainFailure(e)}`);
            err.partial = { vin, onChain };
            throw err;
        } finally {
            holder.armed = null;
        }
    }

    const ep = publicEndpoints(network);
    const receipt = {
        title: `VINPassport ${network} receipt`,
        note: 'This file is the passport: the values and salts below never touched the chain. '
            + 'The chain holds only commitments; anyone can check the transactions listed here, '
            + 'and only the holder of this file can open them. To answer ONE question without '
            + 'handing over the rest, emit a disclosure: node scripts/disclose.mjs <this file> <field>',
        network, ledger: chain.record.ledger ?? 'v9', contractAddress: chain.record.contractAddress,
        kind: intake.kind ?? 'run', finishedAt: new Date().toISOString(),
        vin, vinHash: hex(vinBytes), vinHashScheme: VINKEY_SCHEME,
        registrar: { name: intake.registrar, id: hex(registrar.id) },
        contentRoot: hex(croot),
        fields: Object.fromEntries(Object.entries(writes).map(([name, ws]) => [name,
            ws.map((w, i) => ({ writeIndex: i, value: w.value.toString(), salt: hex(w.salt) }))])),
        panel: intake.panel ?? {},
        claims: (intake.prove ? Object.entries(CLAIM_DEFS) : []).flatMap(([claim, def]) => {
            const wanted = intake.prove?.[claim];
            if (!wanted) return [];
            const wasRefused = refused.some((r) => r.step.startsWith(`prove ${claim}`));
            return [{ claim, label: claimLabel(def, wanted, FIELDS[def.field]?.kind), outcome: wasRefused ? 'refused in-circuit - nothing written' : 'proven on-chain' }];
        }),
        refused,
        onChain,
        verify: {
            how: 'Ask the public indexer for this contract: the transactions above are its calls.',
            curl: `curl -s -X POST ${ep.indexerHttpUrl} -H 'Content-Type: application/json' -d '{"query":"{ contractAction(address: \\"${chain.record.contractAddress}\\") { __typename transaction { hash block { height } } } }"}'`
        }
    };
    assertNoSecrets(receipt, 'the receipt');
    if (save) receipt.savedTo = saveReceipt(network, receipt);
    return receipt;
}

/** Atomically, under _local-tracking/receipts/<network>/, never inside the repository. */
function saveReceipt(network, receipt) {
    const dir = join(LOCAL_DIR, 'receipts', network);
    mkdirSync(dir, { recursive: true });
    const out = join(dir, `${receipt.finishedAt.replace(/[:.]/g, '-')}.${receipt.vin}.json`);
    writeFileSync(out + '.tmp', JSON.stringify(receipt, null, 2), { mode: 0o600 });
    renameSync(out + '.tmp', out);
    return out;
}

/**
 * The app server's interface (scripts/app-server.mjs, /api/demo/*): one run
 * at a time, a cap per UTC day, jobs the page polls.
 */
export async function createRunner({ log = console.log, network = process.env.VINPASSPORT_NETWORK_ID ?? 'preview' } = {}) {
    const capacity = Number(process.env.VINPASSPORT_DEMO_CAP ?? 20);
    const chain = await openChain(network, { log });
    // The latest wallet state, for the page's funds line.
    let latest = null;
    chain.w.wallet.state().subscribe({ next: (st) => { latest = st; }, error: () => { } });
    const funds = () => {
        if (!latest) return null;
        const f = summarize(latest);
        return { dust: f.dust.toString(), night: f.night.toString(), dustCoins: f.dustCoins };
    };
    const jobs = new Map();
    const queue = [];
    let busy = false;
    let day = null, used = 0;
    const today = () => new Date().toISOString().slice(0, 10);
    const take = () => {
        if (day !== today()) { day = today(); used = 0; }
        if (used >= capacity) throw Object.assign(new Error(`the daily cap of ${capacity} runs is reached`), { status: 429 });
        used += 1;
    };
    const pump = async () => {
        if (busy || !queue.length) return;
        busy = true;
        const job = queue.shift();
        job.status = 'running';
        try {
            job.receipt = await executeRun(chain, job.intake, {
                log,
                onStep: (s) => {
                    const i = job.steps.findIndex((x) => x.id === s.id);
                    if (i === -1) job.steps.push({ ...s }); else job.steps[i] = { ...s };
                }
            });
            job.status = 'done';
        } catch (e) {
            job.status = 'failed';
            job.error = String(e?.message ?? e);
            log(`run ${job.id} failed: ${job.error}`);
        } finally {
            delete job.intake;
            busy = false;
            pump();
        }
    };
    const enqueue = (kind, intake) => {
        take();
        const job = { id: randomUUID(), kind, network, status: 'queued', steps: [], receipt: null, intake: { ...intake, kind } };
        jobs.set(job.id, job);
        queue.push(job);
        pump();
        return job;
    };
    return {
        status() {
            if (day !== today()) { day = today(); used = 0; }
            return {
                enabled: true, network, contractAddress: chain.record.contractAddress,
                ready: true, walletRunning: true, warming: false, error: null,
                capacity, used, remaining: Math.max(0, capacity - used),
                resetsAtUtc: new Date(Date.parse(today()) + 86_400_000).toISOString(),
                queueLength: queue.length + (busy ? 1 : 0),
                funds: funds()
            };
        },
        runGuided() { return enqueue('guided', guidedIntake(chain.dealer)); },
        runManual(body) { return enqueue('manual', validateManualIntake(body, chain.dealer)); },
        job(id) { return jobs.get(id) ?? null; },
        close: () => chain.close()
    };
}
