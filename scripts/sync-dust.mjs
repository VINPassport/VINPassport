/**
 * Sync the dust wallet on its own, and checkpoint it so the work survives.
 *
 * Dust pays every fee on Midnight, and the dust wallet learns its balance by
 * replaying the indexer's WHOLE dust event stream: a fresh wallet opens the
 * subscription with no cursor and receives every dust event since genesis.
 * On preprod that is over 1.6 million events and roughly 750 MB of hex. The
 * stream is fine - it delivers about 20k events a second - but one transport
 * error anywhere in that hour ends the sync for good, because the SDK builds
 * its subscription client with `shouldRetry: () => false`. All we are told is
 * `Wallet.Sync: [object ErrorEvent]`, and all the progress is gone.
 *
 * So this script does three things the facade does not:
 *
 *   1. It runs the dust wallet ALONE. The shielded and unshielded wallets have
 *      their own streams and their own restore cost, and neither is needed to
 *      find out how much dust we have.
 *   2. It CHECKPOINTS. The serialized snapshot carries an `offset`, and
 *      `restore` resumes the subscription from it, so a cut connection costs
 *      one checkpoint interval rather than the whole sync. Re-run to resume.
 *   3. It raises the batch limits. The defaults (10 events a batch, 4ms
 *      between batches) cap the apply loop at about 2,000 events a second
 *      whatever the machine can do, which is over thirteen minutes of pure
 *      waiting on this stream before a single event is deserialized.
 *
 *   node scripts/sync-dust.mjs                     # resume, or start fresh
 *   DUST_SYNC_FRESH=1 node scripts/sync-dust.mjs   # ignore the checkpoint
 *
 * An offset only means something to the indexer that issued it: event ids are
 * assigned by the indexer, not by the chain. A checkpoint taken against one
 * indexer must NOT be resumed against another, which is why this writes to its
 * own directory rather than reusing the snapshots taken before the preprod
 * indexer moved to Blockfrost.
 *
 * Exit codes: 0 synced, 2 the stream failed, 3 timed out, 4 the apply loop
 * stalled. Every one but 0 is resumable: re-run and it carries on from the
 * last checkpoint, which is what `scripts/sync-dust-until-done.sh` does.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { HDWallet, Roles } from '@midnightntwrk/wallet-sdk-hd';
import { WalletEntrySchema, mergeWalletEntries } from '@midnightntwrk/wallet-sdk-facade';
import { InMemoryTransactionHistoryStorage } from '@midnightntwrk/wallet-sdk-abstractions';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { DustSecretKey, LedgerParameters } from '@midnight-ntwrk/ledger-v8';
import { preprodEndpoints, redacted } from './lib/endpoints.mjs';

const EP = preprodEndpoints();
const NETWORK_ID = process.env.VINPASSPORT_NETWORK_ID ?? 'preprod';
const INDEXER_HTTP = process.env.VINPASSPORT_INDEXER_HTTP ?? EP.indexerHttpUrl;
const INDEXER_WS = process.env.VINPASSPORT_INDEXER_WS ?? EP.indexerWsUrl;

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_DIR = process.env.DUST_SYNC_STATE_DIR ?? join(ROOT, '..', '_local-tracking', 'dust-state');
const BLOB = join(STATE_DIR, 'dust.blob');
const FRESH = process.env.DUST_SYNC_FRESH === '1';

// How often to write the snapshot. Each one hex-encodes the whole dust state,
// which is already megabytes early on, so this is a trade between the work
// risked by a cut connection and the work spent writing.
const CHECKPOINT_MS = Number(process.env.DUST_SYNC_CHECKPOINT_MS ?? 120_000);
const REPORT_MS = Number(process.env.DUST_SYNC_REPORT_MS ?? 15_000);
const DEADLINE_MS = Number(process.env.DUST_SYNC_DEADLINE_MS ?? 3 * 3_600_000);
// Treat the wallet as synced once it is this close to the tip. The stream is
// live, so the tip keeps moving; insisting on exact equality never finishes.
const GAP = BigInt(process.env.DUST_SYNC_GAP ?? 50);

const started = Date.now();
const since = () => `${((Date.now() - started) / 1000).toFixed(0)}s`;
const log = (...a) => console.log(`[${since()}]`, ...a);

/**
 * The SDK discards everything useful about a transport failure: a sync error
 * arrives as `ServerError({ message: String(err) })`, and `String(errorEvent)`
 * is the string `[object ErrorEvent]`. Walk the cause chain and keep whatever
 * own properties survive, so a failure here can actually be acted on.
 */
function describe(e, depth = 0) {
    if (e == null || depth > 4) return String(e);
    const out = {};
    if (e.constructor?.name) out.kind = e.constructor.name;
    for (const k of ['_tag', 'name', 'message', 'code', 'reason', 'type', 'errno', 'syscall']) {
        if (e[k] !== undefined && typeof e[k] !== 'object') out[k] = e[k];
    }
    if (e.error) out.error = describe(e.error, depth + 1);
    if (e.cause) out.cause = describe(e.cause, depth + 1);
    return Object.keys(out).length ? out : String(e);
}

const seedFile = process.env.VINPASSPORT_SEED_FILE;
if (!seedFile) throw new Error('needs VINPASSPORT_SEED_FILE (the file holding VINPASSPORT_SEED_HEX)');
const seedHex = readFileSync(seedFile, 'utf8')
    .split(/\r?\n/).find((l) => l.startsWith('VINPASSPORT_SEED_HEX='))?.slice(21).trim();
if (!seedHex || seedHex.length !== 128) throw new Error('seed file does not hold VINPASSPORT_SEED_HEX=<128 hex>');

const hd = HDWallet.fromSeed(new Uint8Array(Buffer.from(seedHex, 'hex')));
const account = hd.hdWallet.selectAccount(0);
const dustKey = DustSecretKey.fromSeed(account.selectRole(Roles.Dust).deriveKeyAt(0).key);
hd.hdWallet.clear();

mkdirSync(STATE_DIR, { recursive: true });

const configuration = {
    networkId: NETWORK_ID,
    indexerClientConnection: {
        indexerHttpUrl: INDEXER_HTTP,
        indexerWsUrl: INDEXER_WS,
        // Backpressure. The indexer pushes about 20,000 events a second and the
        // wasm apply loop consumes about 1,300, so the in-flight queue fills in
        // well under a second and the client then DISPOSES the subscription and
        // re-opens it from a cursor. The default 10,000 means that happens over
        // a hundred times across this stream, and each one costs far more than
        // it saves. Bigger windows trade memory for far fewer of them.
        bufferSize: Number(process.env.DUST_SYNC_BUFFER ?? 150_000),
        resumeThreshold: Number(process.env.DUST_SYNC_RESUME_AT ?? 75_000)
    },
    txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
    costParameters: { additionalFeeOverhead: 1n, feeBlocksMargin: 5 },
    // Sync.js reads these three. Left at their defaults the apply loop is
    // throttled to roughly 2,000 events a second regardless of the machine,
    // because it waits `spacing` between every batch of `size`.
    batchUpdates: {
        size: Number(process.env.DUST_SYNC_BATCH ?? 1000),
        timeout: Number(process.env.DUST_SYNC_BATCH_TIMEOUT_MS ?? 100),
        spacing: Number(process.env.DUST_SYNC_SPACING_MS ?? 0)
    }
};

const restored = !FRESH && existsSync(BLOB) ? readFileSync(BLOB, 'utf8') : null;
log(`indexer ${redacted(INDEXER_WS)}`);
log(`state   ${STATE_DIR}`);
if (restored) {
    let offset = '(unreadable)';
    try { offset = JSON.parse(restored).offset ?? '(none)'; } catch { /* reported as unreadable */ }
    log(`resume  from checkpoint offset ${offset} (${(statSync(BLOB).size / 1e6).toFixed(1)} MB)`);
} else {
    log('resume  no checkpoint, starting from the first dust event on the chain');
}
log(`batch   ${configuration.batchUpdates.size} every ${configuration.batchUpdates.timeout}ms, ${configuration.batchUpdates.spacing}ms apart`);

const wallet = restored
    ? DustWallet(configuration).restore(restored)
    : DustWallet(configuration).startWithSecretKey(dustKey, LedgerParameters.initialParameters().dust);

let latest = null;
let failure = null;
let ended = false;

const sub = wallet.state.subscribe({
    next: (s) => { latest = s; },
    error: (e) => { failure = e; ended = true; }
});

await wallet.start(dustKey);
log('started; waiting for the first state');

let checkpoints = 0;
let lastCheckpointAt = Date.now();
/** Write the snapshot through a temp file so a kill mid-write cannot truncate it. */
async function checkpoint(why) {
    if (!latest) return;
    const blob = await wallet.serializeState();
    const tmp = BLOB + '.tmp';
    writeFileSync(tmp, blob);
    renameSync(tmp, BLOB);
    checkpoints += 1;
    lastCheckpointAt = Date.now();
    log(`checkpoint ${checkpoints} (${why}) offset ${latest.progress.appliedIndex}, ${(blob.length / 1e6).toFixed(1)} MB`);
}

// Rate is measured over the window between reports rather than from the
// start, so the number reflects what the loop is doing now.
let windowStart = Date.now();
let windowApplied = null;
let stalledAt = -1n;
let stalledSince = Date.now();
const STALL_MS = Number(process.env.DUST_SYNC_STALL_MS ?? 45_000);

const pct = (a, b) => (b > 0n ? `${((Number(a) / Number(b)) * 100).toFixed(2)}%` : '?');

while (!ended) {
    await new Promise((r) => setTimeout(r, REPORT_MS));
    if (!latest) {
        log('no state yet');
        continue;
    }
    const p = latest.progress;
    const applied = p.appliedIndex;
    const tip = p.highestRelevantWalletIndex;

    const elapsed = (Date.now() - windowStart) / 1000;
    const rate = windowApplied == null ? null : Number(applied - windowApplied) / elapsed;
    windowStart = Date.now();
    windowApplied = applied;

    const behind = tip > applied ? tip - applied : 0n;
    const eta = rate && rate > 0 && behind > 0n
        ? `${(Number(behind) / rate / 60).toFixed(1)} min`
        : (behind === 0n ? 'caught up' : 'unknown');
    const heap = (process.memoryUsage().heapUsed / 1e6).toFixed(0);

    log(`applied ${applied} / tip ${tip} (${pct(applied, tip)}), behind ${behind}`
        + `, ${rate == null ? '?' : rate.toFixed(0)}/s, eta ${eta}`
        + `, heap ${heap} MB, connected ${p.isConnected}`);

    // Watchdog. When the subscription is re-opened after a pause the apply loop
    // sometimes stops dead: `isConnected` stays true, no error is raised, and
    // nothing moves until the idle socket eventually errors minutes later. A
    // fresh process resumes from the checkpoint and streams cleanly again, and
    // a resume cursor is something the indexer handles correctly, so the cheap
    // fix is to stop waiting and let the supervisor restart us.
    if (rate === 0 && applied === stalledAt) {
        if (Date.now() - stalledSince >= STALL_MS) {
            await checkpoint('stalled');
            log(`no progress for ${Math.round((Date.now() - stalledSince) / 1000)}s at offset ${applied}; restarting`);
            await wallet.stop().catch(() => { });
            sub.unsubscribe();
            process.exit(4);
        }
    } else {
        stalledAt = applied;
        stalledSince = Date.now();
    }

    if (p.isConnected && p.isCompleteWithin(GAP)) {
        await checkpoint('synced');
        log(`SYNCED. dust balance now ${latest.balance(new Date()).toString?.() ?? JSON.stringify(latest.balance(new Date()), (k, v) => typeof v === 'bigint' ? String(v) : v)}`);
        await wallet.stop().catch(() => { });
        sub.unsubscribe();
        process.exit(0);
    }
    if (Date.now() - lastCheckpointAt >= CHECKPOINT_MS) await checkpoint('interval');
    if (Date.now() - started >= DEADLINE_MS) {
        await checkpoint('deadline');
        log('deadline reached; re-run to resume from the checkpoint');
        await wallet.stop().catch(() => { });
        sub.unsubscribe();
        process.exit(3);
    }
}

// The stream failed. Save what was applied first: that is the whole point of
// the exercise, and the next run starts from it.
console.log(`\n[${since()}] SYNC FAILED`);
console.log(`  String(err)  ${String(failure)}   <- what the wallet would have told us`);
console.log(`  actual       ${JSON.stringify(describe(failure), null, 2)}`);
await checkpoint('after failure').catch((e) => log(`could not checkpoint: ${e.message}`));
if (latest) log(`reached offset ${latest.progress.appliedIndex}; re-run to resume`);
await wallet.stop().catch(() => { });
sub.unsubscribe();
process.exit(2);
