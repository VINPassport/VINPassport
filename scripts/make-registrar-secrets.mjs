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
 * Four registrars, because the constructor pins exactly four and the list can
 * never be added to afterwards:
 *
 *   A  the demo registrar, which registers vehicles
 *   B  a second listed authority that registers nothing. It exists so that
 *      "only the registrar that registered a vehicle may write its history"
 *      can be shown as a refusal on the live contract, rather than only in
 *      the test suite
 *   C  a third authority, so the allowlist is demonstrably a set of four
 *      distinct members rather than one id repeated to fill the vector
 *   D  a fourth, held unused. A slot filled with a duplicate is a slot spent
 *      for good
 *
 * THIS SCRIPT ONLY ADDS. A secret already in the file is never regenerated,
 * only re-derived and checked against the id recorded beside it, because
 * replacing one would strand every vehicle it has already registered: the
 * authority to write a vehicle's history IS the secret and nothing else.
 *
 * Output goes OUTSIDE the repository, beside the deploy seed. That directory
 * is not merely gitignored, it is above the repository root, so git cannot see
 * it. Nothing secret is ever printed: the script reports identities and a
 * short fingerprint, so a transcript or a shared terminal never carries one.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { writeFileSync, readFileSync, existsSync, mkdirSync, renameSync, copyFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pureCircuits } from '../contracts/vinpassport/src/managed/vinpassport/contract/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, '..', '_local-tracking');
const OUT = join(OUT_DIR, 'REGISTRAR-SECRETS.env');

const LABELS = ['A', 'B', 'C', 'D'];
const ROLE = {
    A: 'the demo registrar, which registers vehicles',
    B: 'listed, registers nothing, so a refusal is demonstrable on chain',
    C: 'a third distinct authority',
    D: 'a fourth, held unused'
};

const hex = (u8) => Buffer.from(u8).toString('hex');
const unhex = (s) => new Uint8Array(Buffer.from(s, 'hex'));
const fail = (m) => { console.error(m); process.exit(1); };

/** Read whatever is already on disk. Absent is fine; malformed is not. */
function readExisting() {
    if (!existsSync(OUT)) return {};
    const text = readFileSync(OUT, 'utf8');
    const found = {};
    for (const label of LABELS) {
        const secret = text.match(new RegExp(`^VINPASSPORT_REGISTRAR_${label}_SECRET_HEX=([0-9a-f]{64})$`, 'm'));
        const id = text.match(new RegExp(`^VINPASSPORT_REGISTRAR_${label}_ID_HEX=([0-9a-f]{64})$`, 'm'));
        if (secret && !id) fail(`registrar ${label} has a secret but no id in ${OUT}`);
        if (id && !secret) fail(`registrar ${label} has an id but no secret in ${OUT}`);
        if (secret && id) found[label] = { secret: unhex(secret[1]), id: unhex(id[1]) };
    }
    return found;
}

const existing = readExisting();
const registrars = [];
const added = [];

for (const label of LABELS) {
    if (existing[label]) {
        // Re-derive rather than trust the file. A mismatch means either the
        // file was edited or `registrarIdOf` changed under us, and pinning a
        // stale id at deploy would lock out the holder of the secret.
        const derived = pureCircuits.registrarIdOf(existing[label].secret);
        if (hex(derived) !== hex(existing[label].id)) {
            fail(`registrar ${label}: the id in ${OUT} is not what registrarIdOf derives from its secret.\n`
                + `  recorded ${hex(existing[label].id)}\n  derived  ${hex(derived)}\n`
                + 'Resolve this before deploying: the deploy pins the recorded value.');
        }
        registrars.push({ label, ...existing[label], isNew: false });
    } else {
        const secret = new Uint8Array(randomBytes(32));
        registrars.push({ label, secret, id: pureCircuits.registrarIdOf(secret), isNew: true });
        added.push(label);
    }
}

// Four slots are worth four authorities. A collision here would silently
// shrink the set, since the ledger holds them in a Set.
const ids = new Set(registrars.map((r) => hex(r.id)));
if (ids.size !== LABELS.length) fail('two registrars derived the same identity; rerun');

if (!added.length) {
    console.log(`all ${LABELS.length} registrars already present in ${OUT}; nothing to do`);
    console.log('every recorded id re-derives from its secret');
    for (const r of registrars) console.log(`  registrar ${r.label}  id ${hex(r.id)}`);
    process.exit(0);
}

const lines = [
    '# VINPassport registrar authority secrets.',
    '#',
    `# Last extended ${new Date().toISOString()} by scripts/make-registrar-secrets.mjs`,
    '#',
    '# Whoever holds a SECRET can register vehicles as that registrar, and can write',
    '# the history of every vehicle it registered. Treat each one as you would the',
    '# deploy seed beside it. The ID is public: it is what the ledger records.',
    '#',
    ...LABELS.map((l) => `# ${l}: ${ROLE[l]}.`),
    '#',
    '# The deploy pins exactly these four. Nothing can add to the list afterwards.',
    ''
];
for (const r of registrars) {
    lines.push(`VINPASSPORT_REGISTRAR_${r.label}_SECRET_HEX=${hex(r.secret)}`);
    lines.push(`VINPASSPORT_REGISTRAR_${r.label}_ID_HEX=${hex(r.id)}`);
    lines.push('');
}

mkdirSync(OUT_DIR, { recursive: true });
if (existsSync(OUT)) copyFileSync(OUT, `${OUT}.bak`);
// temp then rename, so an interrupted write cannot leave a half file where
// the only copy of a secret used to be
const tmp = `${OUT}.tmp`;
writeFileSync(tmp, lines.join('\n'), { encoding: 'utf8', mode: 0o600 });
renameSync(tmp, OUT);

console.log(`added registrar${added.length > 1 ? 's' : ''} ${added.join(', ')} to ${OUT}`);
if (existsSync(`${OUT}.bak`)) console.log(`previous file kept at ${OUT}.bak`);
console.log('');
console.log('These identities are public and go on the deploy list:');
for (const r of registrars) {
    console.log(`  registrar ${r.label}  id ${hex(r.id)}${r.isNew ? '   (new)' : ''}`);
    console.log(`              secret fingerprint ${hex(r.secret).slice(0, 8)}... (not shown, not logged)`);
}
console.log('');
console.log('The deploy pins exactly these four. Nothing can add to the list afterwards.');
