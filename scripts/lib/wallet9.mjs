/**
 * The deploy wallet on Wallet SDK 2 (ledger 9), shared by the DUST tool, the
 * deploy script and the runner so the three cannot drift apart.
 *
 *   const w = await openWallet('preview');      // seed from _local-tracking
 *   const state = await w.synced();             // bounded wait
 *   console.log(describe(state));               // NIGHT, UTXOs, DUST
 *   const { walletProvider, midnightProvider } = midnightJsProviders(w, state);
 *   await w.close();
 *
 * What it guarantees:
 *   - the seed is read from a file, never from an argument, and is added to
 *     the log guard before anything connects, so no library can print it;
 *   - mainnet has no default seed location: VINPASSPORT_SEED_FILE must name
 *     one, and a path inside a synced folder is refused;
 *   - only networks this build's ledger serves are accepted (eras.mjs).
 *
 * The facade is started from seeds, which is what lets one wallet follow the
 * chain across a protocol boundary (Wallet SDK 2, WalletFacade.start).
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    WalletFacade, WalletEntrySchema, mergeWalletEntries
} from '@midnightntwrk/wallet-sdk-facade';
import { WalletSeeds } from '@midnightntwrk/wallet-sdk-hd';
import { ShieldedWallet } from '@midnightntwrk/wallet-sdk-shielded';
import { UnshieldedWallet, createKeystore, PublicKey } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { DustWallet } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { InMemoryTransactionHistoryStorage, Token } from '@midnightntwrk/wallet-sdk-abstractions';
import {
    createLedger9MidnightProvider, createLedger9WalletProvider
} from '@midnight-ntwrk/midnight-js-types';
import { networkEndpoints, guardLogs } from './endpoints.mjs';
import { requireBuildableNetwork } from './eras.mjs';
import { credentialPath } from './local-credentials.mjs';
import { installTwoSpendSelection } from './dust-selection.mjs';

const SYNCED_FOLDER = /onedrive|dropbox|icloud|google ?drive/i;

/** Where a network's deploy seed is read from. Mainnet has no default. */
export function seedFileFor(network) {
    const named = process.env.VINPASSPORT_SEED_FILE?.trim();
    if (network === 'mainnet') {
        if (!named) throw new Error('mainnet needs VINPASSPORT_SEED_FILE naming the seed file; there is no default location.');
        if (SYNCED_FOLDER.test(resolve(named))) {
            throw new Error(`refusing ${resolve(named)}: a synced folder copies the mainnet key off this machine.`);
        }
        return resolve(named);
    }
    return resolve(named || credentialPath(`DEPLOY-SEED.${network}.env`));
}

/**
 * Read the master seed. Returns the bytes and registers the hex with the log
 * guard first, so even an exception message carrying it would be redacted.
 */
export function readSeed(network) {
    const file = seedFileFor(network);
    if (!existsSync(file)) {
        throw new Error(`no seed file at ${file}. Create one with: node scripts/make-deploy-seed.mjs --network ${network}`);
    }
    const hex = readFileSync(file, 'utf8').split(/\r?\n/)
        .find((l) => l.startsWith('VINPASSPORT_SEED_HEX='))?.slice('VINPASSPORT_SEED_HEX='.length).trim();
    if (!hex || !/^[0-9a-f]{64}(?:[0-9a-f]{64})?$/i.test(hex)) {
        throw new Error(`${file} does not hold VINPASSPORT_SEED_HEX=<64 or 128 hex>`);
    }
    guardLogs({ alsoRedact: [hex] });
    return { seed: Buffer.from(hex, 'hex'), file };
}

/** The Wallet SDK 2 configuration for a network, from our endpoint table. */
export function walletConfiguration(network) {
    const ep = networkEndpoints(network);
    return {
        networkId: network,
        // feeBlocksMargin: how many blocks of price movement the fee estimate
        // allows for. The SDK default; the fee itself comes from live
        // parameters at balancing time, never from a constant here.
        costParameters: { feeBlocksMargin: 5 },
        relayURL: new URL(ep.nodeWsUrl),
        // Wallet transactions (DUST registration, fee balancing) prove in
        // wasm in this process. Contract circuits prove through
        // scripts/lib/prover9.mjs, also in process.
        provers: { v9: { kind: 'wasm' } },
        indexerClientConnection: { indexerHttpUrl: ep.indexerHttpUrl, indexerWsUrl: ep.indexerWsUrl },
        txHistoryStorage: new InMemoryTransactionHistoryStorage(WalletEntrySchema, mergeWalletEntries)
    };
}

const withTimeout = (promise, ms, what) => Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${what} did not finish within ${Math.round(ms / 1000)} s`)), ms).unref())
]);

/**
 * Open and start the deploy wallet for `network`.
 * Returns the facade plus what signing and the Midnight.js adapters need.
 */
export async function openWallet(network, { log = () => { } } = {}) {
    requireBuildableNetwork(network);
    guardLogs();
    const { seed, file } = readSeed(network);
    const seeds = WalletSeeds.fromMasterSeed(seed);
    seed.fill(0);
    const keystore = createKeystore({ kind: 'schnorr', secret: seeds.unshielded }, network);
    const configuration = walletConfiguration(network);
    // Ledger issue #838: a contract call paid with exactly one DUST spend can
    // be rejected, so fees are paid with two whenever two coins exist.
    // Remove with dust-selection.mjs once the ledger fix ships.
    await installTwoSpendSelection();

    const wallet = await WalletFacade.init({
        configuration,
        shielded: (config) => ShieldedWallet(config).startWithSeed(seeds.shielded),
        unshielded: (config) => UnshieldedWallet(config).startWithPublicKey(PublicKey.fromKeyStore(keystore)),
        dust: (config) => DustWallet(config).startWithSeed(seeds.dust)
    });
    await wallet.start(seeds);
    const address = keystore.getBech32Address().asString();
    log(`wallet ${address} (${network}), seed from ${file}`);

    return {
        network,
        wallet,
        keystore,
        address,
        configuration,
        /** Resolve with the first fully synced state, or fail after `ms`. */
        synced: (ms = 10 * 60_000) => withTimeout(wallet.waitForSyncedState(), ms, 'wallet sync'),
        /** Signs transaction segments with the unshielded key (registration, offers). */
        sign: (data) => keystore.signDataAsync(data),
        close: () => wallet.stop().catch(() => { })
    };
}

/** NIGHT, UTXOs and DUST from a facade state, as plain values. */
export function summarize(state, now = new Date()) {
    const utxos = [...(state.unshielded?.availableCoins ?? [])];
    const night = state.unshielded?.balances?.[Token.night] ?? 0n;
    let dust = 0n;
    try { dust = BigInt(state.dust.balance(now)); } catch { /* no dust state yet */ }
    return {
        address: String(state.unshielded?.address ?? ''),
        night,
        utxos,
        registered: utxos.filter((u) => u?.meta?.registeredForDustGeneration).length,
        dust,
        dustCoins: state.dust?.availableCoins?.length ?? 0,
        protocol: state.activeProtocolVersion
    };
}

/** One line per fact, for a terminal. 1 NIGHT = 10^6 STARs; 1 DUST = 10^15 SPECKs. */
export function describe(state) {
    const s = summarize(state);
    const night = (Number(s.night) / 1e6).toLocaleString('en-GB', { maximumFractionDigits: 6 });
    const dust = (Number(s.dust) / 1e15).toLocaleString('en-GB', { maximumFractionDigits: 6 });
    return [
        `NIGHT   ${night} (${s.night} STAR) in ${s.utxos.length} UTXO(s), ${s.registered} registered for DUST`,
        `DUST    ${dust} (${s.dust} SPECK) in ${s.dustCoins} coin(s)`,
        `protocol ${s.protocol}`
    ].join('\n');
}

/**
 * The Midnight.js 5 wallet and midnight providers over this facade.
 *
 * The facade runs its own copy of the ledger, so transactions cross as bytes
 * (Midnight.js 5 migration guide, step 6). Balancing pays the fee in DUST;
 * signRecipe signs any unshielded offer the balancing added, and is a no-op
 * when there is none. The shielded public keys live on the wallet STATE, not
 * on the wallet handle, so a synced state is required.
 */
export function midnightJsProviders(w, state, { onSubmit = () => { } } = {}) {
    const { wallet } = w;
    const coin = state?.shielded?.coinPublicKey?.toHexString?.();
    const enc = state?.shielded?.encryptionPublicKey?.toHexString?.();
    if (!coin || !enc) throw new Error('midnightJsProviders needs a synced state carrying the shielded public keys');
    const walletProvider = createLedger9WalletProvider({
        async balanceTx(tx, ttl) {
            const handle = wallet.adoptTransaction(tx.serialize(), 'Unbound');
            const recipe = await wallet.balanceUnboundTransaction(handle, {
                ttl: ttl ?? new Date(Date.now() + 30 * 60_000)
            });
            const signed = await wallet.signRecipe(recipe, w.sign);
            const finalized = await wallet.finalizeRecipe(signed);
            return finalized.serialize();
        },
        getCoinPublicKey: () => coin,
        getEncryptionPublicKey: () => enc
    });
    // onSubmit sees each id as soon as the node accepts the transaction, so a
    // run interrupted while waiting for the indexer still has it on screen.
    const midnightProvider = createLedger9MidnightProvider(async (tx) => {
        const id = await wallet.submitTransaction(wallet.adoptTransaction(tx.serialize(), 'Finalized'));
        onSubmit(id);
        return id;
    });
    return { walletProvider, midnightProvider, coinPublicKey: coin, encryptionPublicKey: enc };
}
