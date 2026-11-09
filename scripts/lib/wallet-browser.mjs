/**
 * A visitor's own wallet calls the deployed contract (build plan 2.6).
 *
 * The page finds Midnight wallets that speak DApp Connector API 4 (1AM, Lace),
 * connects to the one the visitor picks, and submits a call that the WALLET
 * balances, signs, pays for in the visitor's DUST, and submits. Nothing here
 * holds a key, a seed or a credential, and no server of ours is involved: the
 * page talks to the wallet, the wallet to the chain, and the page reads the
 * public indexer.
 *
 * Proving: when the wallet offers `getProvingProvider`, the wallet proves (1AM
 * does, in the tab or through its own service); the page hands it the circuit's
 * keys and ZKIR on request. A wallet without it is pointed at the proof server
 * its configuration names, which for Lace is a local one.
 *
 * First slice: one read circuit, `isRegistered`. Its prover key is 224 KB and
 * is served with the site (site/zk/vinpassport/, copied from the build by
 * scripts/build-wallet-engine.mjs, which also checks it). The writing
 * circuits' keys are 22 to 90 MB each and are not served yet.
 *
 * Bundled for the browser into site/assets/wallet-engine/ by
 * scripts/build-wallet-engine.mjs; scripts/check-wallet-path.mjs runs this same
 * module in Node against the live indexer with a stand-in wallet, read only.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import './browser-globals.mjs';   // first: Buffer, before Midnight.js loads
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-js';
import { CostModel } from '@midnight-ntwrk/midnight-js-protocol/v9';
import { submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import {
    dappConnectorNetwork, dappConnectorProofProvider, dappConnectorWalletProviders
} from '@midnight-ntwrk/midnight-js-dapp-connector-proof-provider';
import { Contract } from '../../contracts/vinpassport/src/managed/vinpassport/contract/index.js';

/** The circuits whose keys the site serves, so the only ones a visitor can call from here. */
export const OFFERED = Object.freeze(['isRegistered']);

const WITNESSES = ['newValue', 'previousValue', 'previousSalt', 'newSalt', 'otherValue', 'otherSalt', 'registrarSecret'];
/** The offered circuits take no witness; one that asked would fail loudly here, not prove a zero. */
const refusingWitnesses = () => Object.fromEntries(
    WITNESSES.map((n) => [n, () => { throw new Error(`witness ${n}() was asked for, and a visitor's call never supplies one`); }]));

const hexBytes = (s) => {
    const h = String(s ?? '').replace(/^0x/, '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(h)) throw new Error('a vehicle key is 64 hex characters');
    return Uint8Array.from(h.match(/../g), (x) => parseInt(x, 16));
};

// One definition, served to the page as written and bundled here.
export { listWallets, waitForWallets } from '../../site/assets/wallet-detect.mjs';

/** Ask the wallet to connect on `networkId`; refuse a wallet that reports another network. */
export async function connectWallet(entry, networkId) {
    const api = await entry.wallet.connect(networkId);
    const config = await api.getConfiguration();
    if (config?.networkId && config.networkId !== networkId) {
        throw new Error(`the wallet is on ${config.networkId}; this page calls the contract on ${networkId}`);
    }
    const status = typeof api.getConnectionStatus === 'function' ? await api.getConnectionStatus() : null;
    return { api, config, status, provesItself: typeof api.getProvingProvider === 'function' };
}

/**
 * Midnight.js 5 providers that route everything a transaction needs through
 * the wallet. `zkBase` is where the site serves the circuit artifacts; every
 * artifact is checked against the compiler manifest whose hash the deploy
 * record pins. `overrides` exists for the Node pre-flight.
 */
export async function walletProviders(api, { networkId, zkBase, expectedManifestHash, fetchFunc, overrides = {} }) {
    const network = await dappConnectorNetwork(api);
    // Always a wrapper: FetchZkConfigProvider calls its fetch as a method of
    // itself, and a browser's native fetch refuses any `this` but the window
    // ("Illegal invocation"). Node's fetch does not care, which is why only a
    // real browser showed it (probed in Brave, 9 Nov 2026).
    const boundFetch = fetchFunc ?? ((input, init) => globalThis.fetch(input, init));
    const zkConfigProvider = overrides.zkConfigProvider ?? new FetchZkConfigProvider(zkBase, {
        verify: 'require', expectedManifestHash, fetchFunc: (input, init) => boundFetch(input, init)
    });
    let proofProvider;
    if (typeof api.getProvingProvider === 'function') {
        proofProvider = await dappConnectorProofProvider(api, zkConfigProvider, CostModel.initialCostModel());
    } else {
        const config = await api.getConfiguration();
        proofProvider = httpClientProofProvider(config.proverServerUri ?? 'http://localhost:6300', zkConfigProvider);
    }
    const { walletProvider, midnightProvider } = await dappConnectorWalletProviders(api);
    return {
        publicDataProvider: overrides.publicDataProvider ?? indexerPublicDataProvider(network.indexer),
        zkConfigProvider,
        proofProvider,
        walletProvider,
        midnightProvider,
        config: { networkId, ttlSeconds: 30 * 60 }
    };
}

/**
 * One call, paid and submitted by the wallet. Returns the answer the chain
 * accepted and where to find the transaction.
 */
export async function askOnChain(providers, { contractAddress, circuitId, vehicleKey }) {
    if (!OFFERED.includes(circuitId)) throw new Error(`${circuitId} is not offered from this page`);
    const compiledContract = CompiledContract.make('vinpassport', Contract).pipe(
        CompiledContract.withWitnesses(refusingWitnesses())
    );
    const r = await submitCallTx(providers, { compiledContract, contractAddress, circuitId, args: [hexBytes(vehicleKey)] });
    return {
        answer: r.private?.result,
        txHash: r.public.txHash,
        txId: r.public.txId,
        blockHeight: r.public.blockHeight,
        fees: r.public.fees ?? null
    };
}
