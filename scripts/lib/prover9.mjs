/**
 * In-process proving for ledger 9: no proof server, no Docker.
 *
 * Our circuits compile to ZKIR v3 (compactc 0.36.0), which
 * `@midnightntwrk/zkir-v3` proves in wasm. It needs two kinds of material:
 *   - per circuit: prover key, verifier key and IR, from our own build;
 *   - public parameters for each circuit size k, from Midnight's key host,
 *     fetched and hash-checked by the wallet SDK's key material provider.
 * Wallet-side locations (DUST spends and the like) fall through to that
 * provider too.
 *
 * Midnight.js names a contract circuit's key as
 * `contract:<address>/<circuit>?vk=<sha256 of the verifier key>`. The hash is
 * checked against the key on disk before proving, so a stale build cannot be
 * proven against a contract that holds other keys: the proof would be
 * refused on chain anyway, after a minute of proving and a fee.
 *
 * A cross-contract call proves the caller's circuit and every callee's in one
 * transaction, each from its own build, so the provider can take several
 * build directories. A key is chosen by circuit name AND verifier key hash,
 * so two contracts with a circuit of the same name cannot be confused.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import * as zkir from '@midnightntwrk/zkir-v3';
import { WasmProver } from '@midnightntwrk/wallet-sdk-prover-client/effect';
import { createLedger9ProofProvider } from '@midnight-ntwrk/midnight-js-types';
import { parseContractKeyLocation } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-js';

/** A KeyMaterialProvider over one or more compiled contract directories plus Midnight's parameters. */
export function keyMaterial(buildDirs, { log = () => { } } = {}) {
    const dirs = [buildDirs].flat();
    const upstream = WasmProver.makeV9KeyMaterialProvider();
    const cache = new Map();
    const load = (dir, circuit) => {
        const id = `${dir}|${circuit}`;
        if (cache.has(id)) return cache.get(id);
        const prover = join(dir, 'keys', `${circuit}.prover`);
        if (!existsSync(prover)) return undefined;
        const km = {
            proverKey: new Uint8Array(readFileSync(prover)),
            verifierKey: new Uint8Array(readFileSync(join(dir, 'keys', `${circuit}.verifier`))),
            ir: new Uint8Array(readFileSync(join(dir, 'zkir', `${circuit}.bzkir`)))
        };
        cache.set(id, km);
        return km;
    };
    const vkHashOf = (km) => createHash('sha256').update(km.verifierKey).digest('hex');
    return {
        async lookupKey(location) {
            const parsed = parseContractKeyLocation(location);
            if (parsed) {
                const found = dirs.map((d) => load(d, parsed.circuitId)).filter(Boolean);
                if (!found.length) throw new Error(`no keys for circuit ${parsed.circuitId} in ${dirs.join(', ')}`);
                const km = found.find((k) => vkHashOf(k) === parsed.verifierKeyHash);
                if (!km) {
                    throw new Error(`verifier key for ${parsed.circuitId} does not match the one asked for `
                        + `(build ${found.map((k) => vkHashOf(k).slice(0, 12)).join('/')}, asked ${parsed.verifierKeyHash.slice(0, 12)}). `
                        + 'The build on disk is not the build this contract holds.');
                }
                return km;
            }
            for (const d of dirs) {
                const km = load(d, location);
                if (km) return km;
            }
            return upstream.lookupKey(location);
        },
        async getParams(k) {
            const t = Date.now();
            const p = await upstream.getParams(k);
            log(`  public parameters k=${k}: ${(p.length / 1e6).toFixed(1)} MB in ${Date.now() - t} ms`);
            return p;
        }
    };
}

/** The Midnight.js 5 proof provider, proving in this process, from one or more build directories. */
export function inProcessProofProvider(buildDirs, opts) {
    return createLedger9ProofProvider(zkir.provingProvider(keyMaterial(buildDirs, opts)));
}
