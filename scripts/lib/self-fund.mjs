/**
 * Pay a transaction's fee from our own DUST and submit it.
 *
 * This is the path the demo engine already runs for every call it makes
 * ([D24](../../docs/DECISIONS.md#settled)): the transaction is built, proven
 * and signed by us, the fee is balanced out of dust this wallet generates from
 * NIGHT it holds, and the result goes straight to the public preprod node. No
 * sponsor, no gateway, no credential. The only thing that leaves the process is
 * a finished transaction.
 *
 * It is extracted here because a contract DEPLOY needs exactly the same
 * treatment as a call, and `@odatano/nightgate-tx` only builds deploys in the
 * sponsorable, fee-unpaid form. Building one and then paying for it ourselves
 * turns a sponsored deploy into a self-funded one without changing what gets
 * deployed.
 *
 * The dust wallet is restored from a snapshot rather than synced from scratch:
 * a fresh dust wallet replays every dust event on the chain, which on preprod
 * is over 1.6 million. `scripts/sync-dust.mjs` produces that snapshot and
 * `scripts/sync-dust-until-done.sh` keeps it going until it reaches the tip.
 *
 * ONE RULE ABOUT THE OUTPUT OF THIS SCRIPT. The Polkadot API writes its own
 * connection messages, and those name the node URL in full. The indexer
 * credential travels in that URL as a query parameter, so a run log is a
 * credential-bearing file: write it outside the repository, and redact it
 * before it is pasted anywhere. Our own logging redacts (see
 * `redacted()` in ./endpoints.mjs); the library's does not, and cannot be
 * configured to.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { HDWallet, Roles } from '@midnightntwrk/wallet-sdk-hd';
import { WalletFacade, WalletEntrySchema, mergeWalletEntries } from '@midnightntwrk/wallet-sdk-facade';
import { InMemoryTransactionHistoryStorage } from '@midnightntwrk/wallet-sdk-abstractions';
import { ShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import { UnshieldedWallet, createKeystore, PublicKey } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { makeWasmProvingService } from '@midnightntwrk/wallet-sdk-capabilities';
import { ZswapSecretKeys, DustSecretKey, Transaction } from '@midnight-ntwrk/ledger-v8';
import { preprodEndpoints } from './endpoints.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const DEFAULT_DUST_STATE = join(HERE, '..', '..', '..', '_local-tracking', 'dust-state');

/**
 * The tag sets the ledger writes into a serialized transaction. A bound build
 * carries `pedersen-schnorr` and reads as `binding`; an unbound one carries
 * `embedded-fr` and reads as `pre-binding`. Both are tried because the caller
 * should not have to know which form it was handed.
 */
const TAG_SETS = [
    ['signature', 'proof', 'binding'],
    ['signature', 'proof', 'pre-binding']
];

/** Read a serialized transaction without the caller having to say which form it is. */
export function readTransaction(bytes) {
    for (const tags of TAG_SETS) {
        try {
            const tx = Transaction.deserialize(...tags, bytes);
            if (tx) return { tx, tags };
        } catch { /* try the next form */ }
    }
    throw new Error('could not deserialize the transaction as either a bound or an unbound form');
}

/**
 * Balance `finalizedTxB64` with our dust and, when `submit` is true, send it.
 *
 * Returns `{ contractAddress, txHash, dustBefore, dustAfter }`. With
 * `submit: false` nothing is sent and `txHash` is null, which is the mode to
 * use to prove the whole path works before spending anything.
 */
export async function payFromOwnDust({
    finalizedTxB64,
    seedHex,
    submit = false,
    dustStateDir = process.env.DUST_SYNC_STATE_DIR ?? DEFAULT_DUST_STATE,
    settleMs = Number(process.env.SELF_FUND_SETTLE_MS ?? 60_000),
    log = console.log
} = {}) {
    if (!finalizedTxB64) throw new Error('needs the finalized (bound) transaction as base64');
    if (!seedHex || seedHex.length !== 128) throw new Error('needs a 128-hex seed');

    const EP = preprodEndpoints();
    const NETWORK_ID = process.env.VINPASSPORT_NETWORK_ID ?? 'preprod';

    const dustBlobPath = join(dustStateDir, 'dust.blob');
    if (!existsSync(dustBlobPath)) {
        throw new Error(`no dust snapshot at ${dustBlobPath}. Run scripts/sync-dust-until-done.sh first; `
            + 'a dust wallet synced from scratch replays every dust event on the chain.');
    }
    const dustBlob = readFileSync(dustBlobPath, 'utf8');
    let snapshotOffset = '(unknown)';
    try { snapshotOffset = JSON.parse(dustBlob).offset ?? '(none)'; } catch { /* reported as unknown */ }

    const hd = HDWallet.fromSeed(new Uint8Array(Buffer.from(seedHex, 'hex')));
    const account = hd.hdWallet.selectAccount(0);
    const roleSeed = (r) => account.selectRole(r).deriveKeyAt(0).key;
    const zswapKeys = ZswapSecretKeys.fromSeed(roleSeed(Roles.Zswap));
    const dustKey = DustSecretKey.fromSeed(roleSeed(Roles.Dust));
    const keystore = createKeystore(roleSeed(Roles.NightExternal), NETWORK_ID);
    hd.hdWallet.clear();

    const configuration = {
        networkId: NETWORK_ID,
        provingServerUrl: new URL(process.env.VINPASSPORT_PROVING_SERVER ?? 'http://127.0.0.1:6300'),
        relayURL: new URL(EP.nodeWsUrl),
        indexerClientConnection: {
            indexerHttpUrl: EP.indexerHttpUrl,
            indexerWsUrl: EP.indexerWsUrl,
            // See scripts/sync-dust.mjs: at the SDK defaults the apply loop can
            // stop dead after the first backpressure pause, with the connection
            // still reported as live and nothing thrown.
            bufferSize: Number(process.env.DUST_SYNC_BUFFER ?? 150_000),
            resumeThreshold: Number(process.env.DUST_SYNC_RESUME_AT ?? 75_000)
        },
        batchUpdates: {
            size: Number(process.env.DUST_SYNC_BATCH ?? 1000),
            timeout: Number(process.env.DUST_SYNC_BATCH_TIMEOUT_MS ?? 100),
            spacing: Number(process.env.DUST_SYNC_SPACING_MS ?? 0)
        },
        txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries),
        costParameters: { additionalFeeOverhead: 1n, feeBlocksMargin: 5 }
    };

    log(`dust snapshot  ${dustBlobPath} (offset ${snapshotOffset})`);

    const facade = await WalletFacade.init({
        configuration,
        provingService: () => makeWasmProvingService(),
        // Only the dust wallet is restored. The shielded wallet is not carrying
        // anything here: the fee is paid in dust and nothing shielded is spent.
        shielded: () => ShieldedWallet(configuration).startWithSecretKeys(zswapKeys),
        unshielded: () => UnshieldedWallet(configuration).startWithPublicKey(PublicKey.fromKeyStore(keystore)),
        dust: () => DustWallet(configuration).restore(dustBlob)
    });

    try {
        await facade.start(zswapKeys, dustKey);

        // Balances live on the emitted state, not on the wallet handles:
        // `facade.dust.balance` is undefined and reading it reports a confident
        // zero for a funded wallet. Same trap as scripts/register-dust.mjs.
        let latest = null;
        const sub = facade.state().subscribe({ next: (v) => { latest = v; }, error: () => { } });
        const now = () => new Date();
        const dustOf = (s) => (typeof s?.dust?.balance === 'function' ? BigInt(s.dust.balance(now())) : null);

        const deadline = Date.now() + settleMs;
        while (Date.now() < deadline) {
            if (latest && dustOf(latest) != null && dustOf(latest) > 0n) break;
            await new Promise((r) => setTimeout(r, 500));
        }
        if (!latest) throw new Error('the wallet emitted no state, so its dust cannot be read');

        const dustBefore = dustOf(latest);
        log(`dust available ${dustBefore}`);
        if (!dustBefore || dustBefore === 0n) {
            throw new Error('the wallet reports no dust. If the snapshot is behind the tip, finish the sync first.');
        }

        const bytes = Uint8Array.from(Buffer.from(finalizedTxB64, 'base64'));
        const { tx, tags } = readTransaction(bytes);
        log(`transaction    ${bytes.length} bytes, read as (${tags.join(', ')})`);

        log('balancing the fee from our own dust...');
        const recipe = await facade.balanceFinalizedTransaction(
            tx,
            { shieldedSecretKeys: zswapKeys, dustSecretKey: dustKey },
            { ttl: new Date(Date.now() + 30 * 60_000), tokenKindsToBalance: ['dust'] }
        );
        const finalized = await facade.finalizeRecipe(recipe);
        log('fee paid and the transaction finalized');

        if (!submit) {
            sub.unsubscribe();
            return { txHash: null, dustBefore, dustAfter: dustOf(latest), submitted: false };
        }

        // The same send the demo engine uses: it fails at once when the node
        // hangs up rather than waiting out the timeout, and says why.
        const { ApiPromise, HttpProvider } = await import('@polkadot/api');
        const { submitExtrinsic } = await import('@odatano/nightgate-tx/txbuilder');
        const api = await ApiPromise.create({ provider: new HttpProvider(EP.nodeHttpUrl), noInitWarn: true });
        let extrinsicHex;
        try {
            extrinsicHex = api.tx.midnight
                .sendMnTransaction('0x' + Buffer.from(finalized.serialize()).toString('hex')).toHex();
        } finally { await api.disconnect().catch(() => { }); }

        log('submitting to the public preprod node...');
        const txHash = await submitExtrinsic(extrinsicHex, { nodeUrl: EP.nodeWsUrl, timeoutMs: 120_000 });

        sub.unsubscribe();
        return { txHash, dustBefore, dustAfter: dustOf(latest), submitted: true };
    } finally {
        await facade.stop().catch(() => { });
    }
}
