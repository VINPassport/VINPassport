/**
 * Generate a network's vin key seed, the secret every ledger key on that
 * network is derived under (scripts/lib/vin-key.mjs).
 *
 *   node scripts/make-vin-key.mjs preprod
 *   node scripts/make-vin-key.mjs mainnet
 *
 * THIS SCRIPT ONLY ADDS. A seed already in the file is never regenerated:
 * every vehicle written under it is found by the key it derives, so replacing
 * it would orphan them all. To rotate, write a new network version on purpose;
 * do not delete a line.
 *
 * Output goes OUTSIDE the repository, beside the deploy seed and the registrar
 * secrets, in `_local-tracking/VINKEY.env`, which is above the repository root
 * so git cannot see it. Nothing secret is ever printed: the script reports the
 * network's PUBLIC key, which a browser will one day use to check an online
 * evaluator, and nothing else.
 *
 * A mainnet seed made here is a development arrangement. The mainnet seed
 * belongs in proper custody, with a written recovery path, because losing it
 * loses the way to find every mainnet vehicle by its VIN.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { NETWORKS, vinKeyPair, loadVinKeys } from './lib/vin-key.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, '..', '_local-tracking');
const OUT = join(OUT_DIR, 'VINKEY.env');
const fail = (m) => { console.error(m); process.exit(1); };
const hex = (u8) => Buffer.from(u8).toString('hex');

const network = process.argv[2];
if (!NETWORKS.includes(network)) fail(`usage: node scripts/make-vin-key.mjs <${NETWORKS.join('|')}>`);

const name = `VINPASSPORT_VINKEY_${network.toUpperCase()}`;
const present = existsSync(OUT) && readFileSync(OUT, 'utf8').split(/\r?\n/).some((l) => l.startsWith(`${name}=`));

if (present) {
    // Re-derive through the module that will use it, so a malformed line is
    // caught here and not at the first write.
    const keys = loadVinKeys(network);
    console.log(`${network}: a vin key is already in ${OUT}; nothing changed.`);
    console.log(`public key ${hex(keys.publicKey)}`);
    process.exit(0);
}

if (process.env[name]) fail(`${name} is set in the environment; unset it first so the file is the one source.`);

mkdirSync(OUT_DIR, { recursive: true });
const seed = new Uint8Array(randomBytes(32));
const keys = vinKeyPair(seed, network);
appendFileSync(OUT, `${name}=${hex(seed)}\n`, { mode: 0o600 });
seed.fill(0);

// Read it back through the loader, the same path a run will take.
if (hex(loadVinKeys(network).publicKey) !== hex(keys.publicKey)) fail('the key read back is not the key written');
console.log(`${network}: vin key written to ${OUT}`);
console.log(`public key ${hex(keys.publicKey)}`);
