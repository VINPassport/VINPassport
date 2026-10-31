/**
 * The ledger key for a vehicle, derived under a network key held by the service.
 *
 * RULE. A vehicle identifier that is written to a network is derived with this
 * module, under that network's key. There is no fallback: without the key this
 * module throws rather than returning anything at all.
 *
 * WHY AN OPRF. The derivation is an RFC 9497 VOPRF over ristretto255-SHA512,
 * not a plain keyed hash, for one reason: a browser can later obtain the same
 * key OBLIVIOUSLY from an online evaluator, without that evaluator ever seeing
 * the VIN, and without the service handing out its key. Today the service
 * evaluates locally with the key; tomorrow a browser can run blind, ask, and
 * finalize. RFC 9497 makes the output independent of the blind, so both routes
 * produce the same ledger key and adding the evaluator later migrates nothing.
 *
 * WHY THE VERIFIABLE MODE. RFC 9497 puts the mode into the context string, so
 * OPRF and VOPRF outputs differ. VOPRF lets a browser check that an evaluator
 * used the published key and not some other one, which is the property an
 * online evaluator needs. Choosing it now avoids a second migration later.
 *
 * WHY THIS LIBRARY. `@noble/curves` `ristretto255_oprf`, pinned exactly. It is
 * held to the RFC's own test vectors (Appendix A.1.2) by
 * test/app/vin-key.test.mjs, so any compliant implementation, on any host,
 * produces the same keys from the same key material.
 *
 * KEY MATERIAL. A 32-byte seed per network, read from the environment or from
 * `_local-tracking/VINKEY.env`, which sits above the repository root, the same
 * way the indexer credential is read (scripts/lib/endpoints.mjs). It never
 * enters the repository and never reaches browser code: this module imports
 * node:fs and is not part of any browser bundle, and a test checks that no
 * page under site/ refers to it.
 *
 * OUTPUT. The first 32 bytes of the 64-byte RFC 9497 output, because the
 * contract keys its maps on Bytes<32>. Truncating a PRF output is still a PRF,
 * and truncation is the simplest step for another implementation to repeat.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ristretto255_oprf } from '@noble/curves/ed25519.js';

const voprf = ristretto255_oprf.voprf;

const HERE = dirname(fileURLToPath(import.meta.url));
const KEY_FILE = join(HERE, '..', '..', '..', '_local-tracking', 'VINKEY.env');

/** Networks this module will derive for. Each has its own, unrelated key. */
export const NETWORKS = Object.freeze(['preprod', 'mainnet']);

/** ISO 3779: seventeen characters, and I, O and Q are not among them. */
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;

const envName = (network) => `VINPASSPORT_VINKEY_${network.toUpperCase()}`;

/**
 * The same normalisation the verify page applies to what a visitor types
 * (site/assets/vin.mjs parseEntry), so a typed VIN and a stored one agree.
 */
export function normaliseVin(vin) {
    const v = String(vin ?? '').trim().toUpperCase().replace(/[\s-]/g, '');
    if (!VIN_RE.test(v)) {
        throw new Error(`not a VIN: expected 17 characters from the ISO 3779 alphabet, got ${v.length}`);
    }
    return v;
}

/** The key-derivation context: one network, one version. */
const keyInfo = (network) => {
    if (!NETWORKS.includes(network)) throw new Error(`unknown network "${network}"`);
    return new TextEncoder().encode(`vinpassport:vinkey:${network}:v1`);
};

/**
 * A network's key pair from its 32-byte seed, via RFC 9497 DeriveKeyPair.
 * Exported so tests can use fixed seeds; production code calls loadVinKeys.
 */
export function vinKeyPair(seed, network) {
    if (!(seed instanceof Uint8Array) || seed.length !== 32) {
        throw new Error('a vin key seed is exactly 32 bytes');
    }
    return { network, ...voprf.deriveKeyPair(seed, keyInfo(network)) };
}

/** Read a network's seed from the environment, then from the local file. */
function readSeedHex(network) {
    const name = envName(network);
    const fromEnv = process.env[name]?.trim();
    if (fromEnv) return fromEnv;
    if (existsSync(KEY_FILE)) {
        const line = readFileSync(KEY_FILE, 'utf8')
            .split(/\r?\n/)
            .find((l) => l.startsWith(`${name}=`));
        const value = line?.slice(name.length + 1).trim();
        if (value) return value;
    }
    return null;
}

/**
 * The service's key pair for `network`. Throws when no key is configured, and
 * the message never contains key material.
 */
export function loadVinKeys(network) {
    const hexSeed = readSeedHex(network);
    if (!hexSeed) {
        throw new Error(
            `no vin key for ${network}: set ${envName(network)} or add it to `
            + '_local-tracking/VINKEY.env (32 bytes as 64 hex characters). '
            + 'There is deliberately no fallback derivation.');
    }
    if (!/^[0-9a-fA-F]{64}$/.test(hexSeed)) {
        throw new Error(`${envName(network)} must be 64 hex characters`);
    }
    const seed = Uint8Array.from(hexSeed.match(/../g), (b) => parseInt(b, 16));
    return vinKeyPair(seed, network);
}

/**
 * The full RFC 9497 VOPRF exchange, run locally by the key holder: blind,
 * evaluate, finalize, with the proof verified in finalize. Returns the 64-byte
 * protocol output.
 */
export function evaluate(input, keys) {
    if (!keys?.secretKey || !keys?.publicKey) {
        throw new Error('a vin key pair is required; there is no keyless derivation');
    }
    const b = voprf.blind(input);
    const e = voprf.blindEvaluate(keys.secretKey, keys.publicKey, b.blinded);
    return voprf.finalize(input, b.blind, e.evaluated, b.blinded, keys.publicKey, e.proof);
}

/** The ledger key for `vin` under `keys`: Bytes<32>, ready for the contract. */
export function vinKey(vin, keys) {
    const input = new TextEncoder().encode(normaliseVin(vin));
    return evaluate(input, keys).slice(0, 32);
}

/** The same, as lowercase hex, which is how links and the verify page carry it. */
export const vinKeyHex = (vin, keys) =>
    Array.from(vinKey(vin, keys), (b) => b.toString(16).padStart(2, '0')).join('');
