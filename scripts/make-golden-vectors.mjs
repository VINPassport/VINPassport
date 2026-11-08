#!/usr/bin/env node
/**
 * Golden vectors: what the compiled contract computes, frozen so that a build
 * from another Compact toolchain can be held to it.
 *
 * WHY. A receipt, a disclosure bundle and the browser verifier all recompute
 * values the contract wrote: slots, registrar identities, writer and grant
 * keys, field commitments, claim keys. If a new toolchain or runtime changed
 * any of them, every receipt issued under the old build would stop verifying,
 * and nothing in the contract's own tests would notice, because those tests
 * only compare the build with itself.
 *
 * WHAT. Three groups, all from deterministic inputs:
 *
 *   pure      the contract's exported helper circuits (slotOf, registrarIdOf,
 *             writerKeyOf, grantKeyOf) on fixed inputs
 *   offChain  the same values recomputed by scripts/lib/disclosure.mjs, the
 *             code the browser verifier runs, plus field commitments
 *   ledger    every ledger collection after a scripted run of the contract:
 *             two registrars, a passport, all five fields, a later write, a
 *             writer, a grant and one claim of each kind
 *
 * The committed file was generated from the Ledger 8 build (Compact 0.31.1,
 * runtime 0.16.0, tag ledger8-preprod). test/app/golden-vectors.test.mjs
 * regenerates the vectors from whatever build is checked out and requires an
 * exact match.
 *
 * Usage:
 *   node scripts/make-golden-vectors.mjs           print the vectors
 *   node scripts/make-golden-vectors.mjs --write   overwrite the fixture
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    PassportSimulator, Rule, Tier, pureCircuits, hex, bytes32, fieldKey, FIELDS,
    REGISTRAR_SECRET, REGISTRAR_ID, SECOND_ID, DEALER_ID, AUTHORITY_ID
} from '../test/passport-simulator.mjs';
import { slotOf, grantKeyOf, commitmentOf, vinHashOf, fieldKeyOf } from './lib/disclosure.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURE = join(ROOT, 'test', 'fixtures', 'golden-vectors.json');

/** A 32-byte input that differs in every byte, so no two inputs collide by accident. */
const seq = (seed) => Uint8Array.from({ length: 32 }, (_, i) => (i * 7 + seed) & 0xff);

/** Canonical JSON for ledger values: bytes as hex, bigints as decimal strings. */
function canon(value) {
    if (value instanceof Uint8Array) return hex(value);
    if (typeof value === 'bigint') return value.toString();
    if (Array.isArray(value)) return value.map(canon);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canon(value[k])]));
    }
    return value;
}

/** A ledger Map or Set as sorted entries, so iteration order cannot matter. */
function collection(c) {
    const rows = [...c].map((row) => canon(row));
    return rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

export async function goldenVectors() {
    const pure = [];
    for (let i = 0; i < 8; i++) {
        const [a, b, c] = [seq(3 * i + 1), seq(3 * i + 2), seq(3 * i + 3)];
        pure.push({
            slotOf: hex(pureCircuits.slotOf(a, b, c)),
            registrarIdOf: hex(pureCircuits.registrarIdOf(a)),
            writerKeyOf: hex(pureCircuits.writerKeyOf(a, b)),
            grantKeyOf: hex(pureCircuits.grantKeyOf(a, b))
        });
    }

    // disclosure.mjs takes and returns hex, as receipts and bundles carry it.
    const vinHash = hex(vinHashOf('WVWZZZ1KZAW000001'));
    const root = hex(seq(200));
    const offChain = {
        vinHash,
        fields: Object.keys(FIELDS).map((name, i) => ({
            name,
            fieldKey: hex(fieldKeyOf(name)),
            slot: hex(slotOf(vinHash, hex(fieldKeyOf(name)), root)),
            commitment: hex(commitmentOf(BigInt(1000 * (i + 1)), hex(seq(100 + i))))
        })),
        commitmentEdges: [0n, 1n, 18446744073709551615n].map((v) => hex(commitmentOf(v, hex(seq(9))))),
        grantKey: grantKeyOf(vinHash, hex(seq(77)))
    };

    const sim = await PassportSimulator.create([REGISTRAR_ID, SECOND_ID]);
    const v = bytes32(0x11);
    const contentRoot = bytes32(0x99);
    const names = Object.keys(FIELDS);
    await sim.registerPassport(v, contentRoot, REGISTRAR_SECRET);
    for (const [i, name] of names.entries()) {
        const start = FIELDS[name] === Rule.neverRises ? 900n : BigInt(10 * (i + 1));
        await sim.initialiseField(v, fieldKey(name), FIELDS[name], start, bytes32(0x21 + i), REGISTRAR_SECRET);
    }
    await sim.recordField(v, fieldKey('odometerKm'), 54321n, bytes32(0x31), undefined, REGISTRAR_SECRET);
    await sim.authoriseWriter(v, DEALER_ID, REGISTRAR_SECRET);
    await sim.grantDisclosure(v, AUTHORITY_ID, Tier.authority, REGISTRAR_SECRET);
    await sim.proveFieldAtMost(v, fieldKey('odometerKm'), 60000n);
    await sim.proveFieldAtLeast(v, fieldKey('odometerKm'), 50000n);
    await sim.proveFieldAtMostField(v, fieldKey('accidentCount'), fieldKey('odometerKm'), 0n);

    const l = sim.ledger;
    const ledger = {};
    for (const name of [
        'passports', 'registrar', 'fieldCommitment', 'fieldRule', 'claims', 'relClaims',
        'allowedRegistrars', 'writers', 'fieldWriter', 'grants'
    ]) ledger[name] = collection(l[name]);

    return { pure, offChain, ledger };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    const info = JSON.parse(readFileSync(join(ROOT,
        'contracts/vinpassport/src/managed/vinpassport/compiler/contract-info.json'), 'utf8'));
    const out = {
        generatedFrom: {
            compiler: info['compiler-version'],
            language: info['language-version'],
            runtime: info['runtime-version']
        },
        ...(await goldenVectors())
    };
    const text = JSON.stringify(out, null, 2) + '\n';
    if (process.argv.includes('--write')) {
        writeFileSync(FIXTURE, text);
        console.log(`wrote ${FIXTURE}`);
    } else {
        process.stdout.write(text);
    }
}
