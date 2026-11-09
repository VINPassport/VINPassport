#!/usr/bin/env node
/**
 * Pre-flight for the wallet page (build plan 2.6), read only:
 *
 *   npm run check:wallet-path
 *
 * Runs the page's own module (scripts/lib/wallet-browser.mjs) in Node against
 * the live Preview indexer, with a stand-in wallet that speaks DApp Connector
 * API 4. The stand-in proves with zkir-v3 from the key material the page hands
 * it (as 1AM's in-tab prover would), and stops at balancing: it captures the
 * transaction the page asks it to pay for, and sends nothing. The check is
 * that this transaction is a proven call to the deployed contract's circuit,
 * built from the artifacts the site serves (site/zk/, read from disk here as
 * if fetched) and checked against the manifest the deploy record pins.
 *
 * What it cannot check is a real wallet extension: that is a visitor in a
 * browser with 1AM or Lace, on /wallet/.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import * as zkir from '@midnightntwrk/zkir-v3';
import { WasmProver } from '@midnightntwrk/wallet-sdk-prover-client/effect';
import { parseContractKeyLocation } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-js';
import { Transaction, sampleCoinPublicKey, sampleEncryptionPublicKey } from '@midnightntwrk/ledger-v9';
import { networkEndpoints, guardLogs } from './lib/endpoints.mjs';
import { listWallets, connectWallet, walletProviders, askOnChain } from './lib/wallet-browser.mjs';

guardLogs();
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fail = (m) => { console.error(`\nSTOP: ${m}`); process.exit(1); };
const config = JSON.parse(readFileSync(join(ROOT, 'site', 'wallet', 'config.json'), 'utf8'));
const ZK_BASE = 'https://passport.vin/zk/vinpassport';

// The site's artifacts, served from disk as the browser would fetch them.
const fetchFunc = async (url) => {
    const u = String(url);
    if (!u.startsWith(ZK_BASE + '/')) return new Response('not here', { status: 404 });
    const file = join(ROOT, 'site', 'zk', 'vinpassport', ...u.slice(ZK_BASE.length + 1).split('/'));
    if (!existsSync(file)) return new Response('not found', { status: 404 });
    const type = file.endsWith('.json') ? 'application/json' : 'application/octet-stream';
    return new Response(readFileSync(file), { status: 200, headers: { 'content-type': type } });
};

const STOP = 'stand-in wallet: balancing stops here, nothing is submitted';
const seen = { proverAsked: [], tx: null, submitted: false };
const ep = networkEndpoints(config.network);
const api = {
    getConfiguration: async () => ({ indexerUri: ep.indexerHttpUrl, indexerWsUri: ep.indexerWsUrl, substrateNodeUri: ep.nodeWsUrl, networkId: config.network }),
    getConnectionStatus: async () => ({ status: 'connected', networkId: config.network }),
    getShieldedAddresses: async () => ({ shieldedAddress: '', shieldedCoinPublicKey: sampleCoinPublicKey(), shieldedEncryptionPublicKey: sampleEncryptionPublicKey() }),
    // What a wallet does with the page's key material: it adapts the connector's
    // three getters to its prover's own lookup, and takes Midnight's public
    // parameters (and any key that is not the contract's) from upstream.
    getProvingProvider: async (keyMaterial) => {
        const upstream = WasmProver.makeV9KeyMaterialProvider();
        return zkir.provingProvider({
            async lookupKey(location) {
                if (!parseContractKeyLocation(location)) return upstream.lookupKey(location);
                seen.proverAsked.push(location);
                return {
                    proverKey: await keyMaterial.getProverKey(location),
                    verifierKey: await keyMaterial.getVerifierKey(location),
                    ir: await keyMaterial.getZKIR(location)
                };
            },
            getParams: (k) => upstream.getParams(k)
        });
    },
    balanceUnsealedTransaction: async (hex) => { seen.tx = hex; throw new Error(STOP); },
    submitTransaction: async () => { seen.submitted = true; throw new Error('the stand-in never submits'); }
};
const page = { midnight: { 'stand-in': { name: 'stand-in wallet', apiVersion: '4.1.0', connect: async () => api } } };

console.log(`contract  ${config.contractAddress} (${config.network})`);
const wallets = listWallets(page);
if (wallets.length !== 1) fail('the page did not find the stand-in wallet');
const conn = await connectWallet(wallets[0], config.network);
console.log(`wallet    ${wallets[0].name}, proves itself: ${conn.provesItself}`);
const providers = await walletProviders(conn.api, { networkId: config.network, zkBase: ZK_BASE, expectedManifestHash: config.manifestSha256, fetchFunc });

const t0 = Date.now();
let reason = null;
try {
    await askOnChain(providers, { contractAddress: config.contractAddress, circuitId: 'isRegistered', vehicleKey: config.sampleVehicleKey });
} catch (e) {
    let c = e;
    for (let d = 0; c && d < 6; d += 1, c = c.cause) if (String(c.message).includes(STOP)) reason = 'stopped at balancing';
    if (!reason) fail(`the call failed before reaching the wallet: ${e?.message ?? e}${e?.cause ? ` (cause: ${e.cause.message ?? e.cause})` : ''}`);
}
console.log(`built     in ${Math.round((Date.now() - t0) / 1000)} s; ${reason}; submitted: ${seen.submitted}`);
if (!seen.tx) fail('the wallet was never asked to balance a transaction');
if (seen.submitted) fail('the stand-in was asked to submit');

const bytes = Buffer.from(String(seen.tx).replace(/^0x/, ''), 'hex');
const tx = Transaction.deserialize('signature', 'proof', 'pre-binding', bytes);
const text = tx.toString(true);
const checks = [
    ['the wallet proved the call, with keys and ZKIR the page served', seen.proverAsked.length > 0],
    ['the transaction it was asked to pay for is proven (it deserializes at the proven stage)', bytes.length > 0],
    ['it calls the deployed contract', text.includes(config.contractAddress)],
    ['it calls isRegistered', text.includes('isRegistered')]
];
for (const [label, ok] of checks) console.log(`${ok ? 'yes' : 'NO '}  ${label}`);
console.log(`          ${bytes.length} bytes handed to the wallet`);
const ok = checks.every(([, v]) => v);
console.log(ok ? '\nWALLET PATH OK (nothing was submitted)' : '\nWALLET PATH FOUND A PROBLEM');
await new Promise((r) => setTimeout(r, 250));   // let sockets close (see chain-readback.mjs)
process.exit(ok ? 0 : 1);
