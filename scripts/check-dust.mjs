/**
 * Can this wallet pay a fee right now?
 *
 * A self-funded deploy spends several minutes proving before it ever touches
 * dust, so a dust problem costs a full run to discover and another to retest.
 * This asks the same question the deploy asks, in the same way, against the
 * same wallet, without building or proving anything.
 *
 * Two things have to be true, and only one of them is about money:
 *
 *   1. There is dust. The restored snapshot answers that immediately.
 *   2. The wallet is CAUGHT UP. A dust proof is built against the state the
 *      wallet has applied and the node checks it against its own tip, so a
 *      wallet sitting on an old snapshot produces a proof the node refuses
 *      with `1010 Invalid Transaction | "Custom error: 170"`. ODATANO's
 *      `classifyNodeReject` maps that to `stale-dust-proof`.
 *
 * A wallet that has not connected yet reports `tip 0, connected false`, and
 * every gap check against a tip of zero passes. That is a real trap and it is
 * why `waitForTip` demands a live stream before it measures anything.
 *
 * Usage:
 *   node scripts/check-dust.mjs            (waits up to 5 minutes for the tip)
 *   SELF_FUND_CATCHUP_MS=60000 node scripts/check-dust.mjs
 *
 * Exit codes: 0 ready to pay, 1 not ready (the reason is printed).
 *
 * ONE RULE ABOUT THE OUTPUT. The Polkadot API and the indexer client write
 * their own connection messages and those name the node URL in full, with the
 * indexer credential in it as a query parameter. Write this script's output
 * outside the repository and redact it before pasting it anywhere.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { openFacade, waitForTip } from './lib/self-fund.mjs';

const seed = process.env.VINPASSPORT_SEED_HEX ?? '';
if (seed.length !== 128) {
    console.error('VINPASSPORT_SEED_HEX must be 128 hex characters. Set it in the shell; '
        + 'never write it to a file in this repo.');
    process.exit(1);
}

const catchUpMs = Number(process.env.SELF_FUND_CATCHUP_MS ?? 5 * 60_000);
const catchUpGap = BigInt(process.env.SELF_FUND_CATCHUP_GAP ?? 0);
const settleMs = Number(process.env.SELF_FUND_SETTLE_MS ?? 60_000);

const started = Date.now();
const since = () => `${((Date.now() - started) / 1000).toFixed(0)}s`;
const log = (...a) => console.log(`[${since()}]`, ...a);

const { facade, zswapKeys, dustKey, snapshotOffset } = await openFacade({ seedHex: seed, log });
log(`snapshot offset ${snapshotOffset}`);

let code = 1;
try {
    await facade.start(zswapKeys, dustKey);

    // The balance lives on the emitted state, not on the wallet handle:
    // `facade.dust.balance` is undefined and reads as a confident zero.
    let latest = null;
    const sub = facade.state().subscribe({ next: (v) => { latest = v; }, error: () => { } });
    const dustOf = (s) => (typeof s?.dust?.balance === 'function' ? BigInt(s.dust.balance(new Date())) : null);

    const deadline = Date.now() + settleMs;
    while (Date.now() < deadline && !dustOf(latest)) await new Promise((r) => setTimeout(r, 500));

    if (!latest) throw new Error('the wallet emitted no state, so its dust cannot be read');
    log(`dust in the snapshot ${dustOf(latest)}`);

    const p = await waitForTip(() => latest?.dust?.progress, { log, gap: catchUpGap, timeoutMs: catchUpMs });
    const balance = dustOf(latest);

    log(`applied ${p.appliedIndex} / tip ${p.highestRelevantWalletIndex}, connected ${p.isConnected}`);
    log(`dust available ${balance}`);

    if (!balance || balance === 0n) {
        console.error('\nNOT READY: the wallet is caught up but holds no dust.');
    } else {
        console.log('\nREADY: there is dust and the wallet is at the tip. A fee balanced now '
            + 'carries a proof the node will accept.');
        code = 0;
    }
    sub.unsubscribe();
} catch (e) {
    console.error(`\nNOT READY: ${e.message}`);
} finally {
    await facade.stop().catch(() => { });
}

process.exit(code);
