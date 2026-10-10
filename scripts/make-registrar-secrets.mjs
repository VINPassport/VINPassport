/**
 * Generate the registrar authority secrets and derive their public identities.
 *
 *   node scripts/make-registrar-secrets.mjs
 *
 * A registrar's SECRET is what it holds; its ID is what the chain records. The
 * id is derived here with the contract's own `registrarIdOf`, never
 * reimplemented, so the value written to `allowedRegistrars` at deploy is the
 * same value the circuit will compute at call time.
 *
 * Two registrars, deliberately:
 *
 *   A  the demo registrar, which registers vehicles
 *   B  a second listed authority that registers nothing. It exists so that
 *      "only the registrar that registered a vehicle may write its history"
 *      can be shown as a refusal on the live contract, rather than only in
 *      the test suite.
 *
 * Output goes OUTSIDE the repository, beside the deploy seed. That directory
 * is not merely gitignored, it is above the repository root, so git cannot see
 * it. Nothing here is ever printed: the script reports identities and a short
 * fingerprint, so a transcript or a shared terminal never carries a secret.
 *
 * Refuses to overwrite. Losing these means the vehicles already registered by
 * A can never have their history written again, because authority to write is
 * the secret and nothing else.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pureCircuits } from '../contracts/vinpassport/src/managed/vinpassport/contract/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, '..', '_local-tracking');
const OUT = join(OUT_DIR, 'REGISTRAR-SECRETS.env');

const hex = (u8) => Buffer.from(u8).toString('hex');

if (existsSync(OUT)) {
    console.error(`refusing to overwrite ${OUT}`);
    console.error('These secrets ARE the authority to write vehicle history. If you genuinely');
    console.error('want new ones, move the existing file aside yourself first.');
    process.exit(1);
}

const make = (label) => {
    const secret = new Uint8Array(randomBytes(32));
    const id = pureCircuits.registrarIdOf(secret);
    return { label, secret, id };
};

const a = make('A');
const b = make('B');

const lines = [
    '# VINPassport registrar authority secrets.',
    '#',
    `# Generated ${new Date().toISOString()} by scripts/make-registrar-secrets.mjs`,
    '#',
    '# Whoever holds a SECRET can register vehicles as that registrar, and can write',
    '# the history of every vehicle it registered. Treat each one as you would the',
    '# deploy seed beside it. The ID is public: it is what the ledger records.',
    '#',
    '# A: the demo registrar.',
    '# B: a second listed authority that registers nothing, so that a refusal is',
    '#    demonstrable on the live contract.',
    '',
    `VINPASSPORT_REGISTRAR_A_SECRET_HEX=${hex(a.secret)}`,
    `VINPASSPORT_REGISTRAR_A_ID_HEX=${hex(a.id)}`,
    '',
    `VINPASSPORT_REGISTRAR_B_SECRET_HEX=${hex(b.secret)}`,
    `VINPASSPORT_REGISTRAR_B_ID_HEX=${hex(b.id)}`,
    ''
];

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT, lines.join('\n'), { encoding: 'utf8', mode: 0o600 });

console.log(`wrote ${OUT}`);
console.log('');
console.log('These identities are public and go on the deploy list:');
for (const r of [a, b]) {
    console.log(`  registrar ${r.label}  id ${hex(r.id)}`);
    console.log(`              secret fingerprint ${hex(r.secret).slice(0, 8)}... (not shown, not logged)`);
}
console.log('');
console.log('The deploy pins exactly these two. Nothing can add to the list afterwards.');
