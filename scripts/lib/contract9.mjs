/**
 * The VINPassport contract and its Midnight.js 5 providers, shared by the
 * deploy script, the maintenance tool and the runner.
 *
 *   const w = await openWallet(network);
 *   const state = await w.synced();
 *   const providers = await contractProviders(w, state);
 *   const compiled = compiledContract(witnesses);
 *
 * Artifacts are verified against the compiler's integrity manifest
 * (`verify: 'require'`), and once a contract is deployed its record pins the
 * manifest's own hash, so a later run cannot silently use another build.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { CompiledContract, hashVerifierKey } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-js';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { validatePassword } from '@midnight-ntwrk/midnight-js-utils';
import { SigningKey } from '@midnight-ntwrk/platform-js';
import { sampleSigningKey, signatureVerifyingKey } from '@midnightntwrk/ledger-v9';
import { Contract, pureCircuits } from '../../contracts/vinpassport/src/managed/vinpassport/contract/index.js';
import { networkEndpoints, guardLogs } from './endpoints.mjs';
import { credentialPath, LOCAL_DIR } from './local-credentials.mjs';
import { midnightJsProviders } from './wallet9.mjs';
import { inProcessProofProvider } from './prover9.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const BUILD_DIR = join(ROOT, 'contracts', 'vinpassport', 'src', 'managed', 'vinpassport');
export const MANIFEST = join(BUILD_DIR, 'compiler', 'contract-manifest.json');
export const recordPath = (network) => join(ROOT, 'deploy', `${network}.json`);
const SYNCED_FOLDER = /onedrive|dropbox|icloud|google ?drive/i;

/** Circuits with proving keys: every exported circuit that is not pure. */
export const PROVABLE = Object.freeze([...readFileSync(join(ROOT, 'contracts', 'vinpassport', 'src', 'vinpassport.compact'), 'utf8')
    .matchAll(/^export\s+circuit\s+(\w+)/gm)].map((m) => m[1]).filter((c) => !(c in pureCircuits)));

export const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** The build's facts a deploy record pins. */
export function buildFacts() {
    if (!existsSync(MANIFEST)) throw new Error(`no integrity manifest at ${MANIFEST}: rebuild with \`npm run compile\``);
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    const verifierKeys = {};
    for (const c of PROVABLE) {
        const path = join(BUILD_DIR, 'keys', `${c}.verifier`);
        if (!existsSync(path) || !existsSync(join(BUILD_DIR, 'keys', `${c}.prover`))) {
            throw new Error(`missing keys for ${c}. Keys are gitignored: run \`npm run compile\` in WSL first.`);
        }
        verifierKeys[c] = String(hashVerifierKey(new Uint8Array(readFileSync(path))));
    }
    return {
        compiler: manifest['compiler-version'],
        language: manifest['language-version'],
        runtime: manifest['runtime-version'],
        manifestSha256: sha256File(MANIFEST),
        verifierKeys
    };
}

/** A witness set that fails loudly, for transactions that must never consult a witness (the deploy). */
export const refusingWitnesses = () => Object.fromEntries(
    ['newValue', 'previousValue', 'previousSalt', 'newSalt', 'otherValue', 'otherSalt', 'registrarSecret']
        .map((n) => [n, () => { throw new Error(`witness ${n}() was invoked where none may be`); }]));

/** The contract bound to a witness set and to the build directory. */
export function compiledContract(witnesses) {
    return CompiledContract.make('vinpassport', Contract).pipe(
        CompiledContract.withWitnesses(witnesses),
        CompiledContract.withCompiledFileAssets(BUILD_DIR)
    );
}

// ------------------------------------------------------------ local secrets

/** A file of NAME=value lines, created once (never overwritten), mode 0600. */
function keyFile(path, name, make, note) {
    if (!existsSync(path)) {
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, `# ${note}\n${name}=${make()}\n`, { mode: 0o600, flag: 'wx' });
    }
    const v = readFileSync(path, 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${name}=`))?.slice(name.length + 1).trim();
    if (!v) throw new Error(`${path} does not hold ${name}=`);
    guardLogs({ alsoRedact: [v] });
    return v;
}

/**
 * The custody signing key: the contract's maintenance authority from deploy
 * until it is handed to the committee (DECISIONS D28). Mainnet has no default
 * location and refuses a synced folder.
 */
export function custodyKey(network, { create = false } = {}) {
    let path = process.env.VINPASSPORT_CUSTODY_KEY_FILE?.trim();
    if (network === 'mainnet') {
        if (!path) throw new Error('mainnet needs VINPASSPORT_CUSTODY_KEY_FILE; there is no default location.');
        if (SYNCED_FOLDER.test(resolve(path))) throw new Error(`refusing ${resolve(path)}: a synced folder copies the key off this machine.`);
    }
    path = resolve(path || credentialPath(`CUSTODY-KEY.${network}.env`));
    if (!create && !existsSync(path)) throw new Error(`no custody key at ${path}`);
    const hex = keyFile(path, 'VINPASSPORT_CUSTODY_KEY_HEX', () => sampleSigningKey('schnorr').value,
        `Maintenance custody key for ${network} (schnorr). Never print it, never commit it.`);
    const key = SigningKey.make(hex, 'schnorr');
    return { key, verifyingKey: signatureVerifyingKey({ tag: 'schnorr', value: hex }), path };
}

/** The password that encrypts the private state store, generated once to the store's policy. */
function statePassword(network) {
    const make = () => {
        for (;;) {
            const p = randomBytes(24).toString('base64url') + 'Aa1!';
            try { validatePassword(p); return p; } catch { /* rare: a run or sequence; draw again */ }
        }
    };
    return keyFile(credentialPath(`STATE-PASSWORD.${network}.env`), 'VINPASSPORT_STATE_PASSWORD', make,
        `Encrypts the Midnight.js private state store for ${network}. Losing it loses the stored copy of the custody key.`);
}

/** All seven Midnight.js providers for this contract on `network`. */
export async function contractProviders(w, state, { log = () => { } } = {}) {
    const network = w.network;
    const ep = networkEndpoints(network);
    const { walletProvider, midnightProvider, coinPublicKey } = midnightJsProviders(w, state, {
        onSubmit: (id) => log(`  submitted, transaction id ${id}`)
    });
    const record = existsSync(recordPath(network)) ? JSON.parse(readFileSync(recordPath(network), 'utf8')) : null;
    const password = statePassword(network);
    const storeDir = join(LOCAL_DIR, 'state', network);
    mkdirSync(storeDir, { recursive: true });

    return {
        publicDataProvider: indexerPublicDataProvider({ queryURL: ep.indexerHttpUrl, subscriptionURL: ep.indexerWsUrl }),
        zkConfigProvider: new NodeZkConfigProvider(BUILD_DIR, {
            verify: 'require',
            ...(record?.build?.manifestSha256 ? { expectedManifestHash: record.build.manifestSha256 } : {})
        }),
        proofProvider: inProcessProofProvider(BUILD_DIR, { log }),
        privateStateProvider: levelPrivateStateProvider({
            midnightDbName: join(storeDir, 'midnight-level-db'),
            privateStoragePasswordProvider: () => password,
            accountId: coinPublicKey
        }),
        walletProvider,
        midnightProvider,
        config: { networkId: network, ttlSeconds: 30 * 60 }
    };
}
