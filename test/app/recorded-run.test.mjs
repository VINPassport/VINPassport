/**
 * The demo page ships a recording of a real preprod run so it has something
 * to show while no circuit server answers.
 *
 * The rule that file lives under: it publishes only what the preprod chain
 * already publishes. Claims and their bounds are on the ledger and belong
 * here. A field reading is not, because the product is that a reading never
 * leaves the holder, and a page that printed one would be arguing against
 * itself on the one point it exists to make.
 *
 * These tests hold that rule against the file as shipped, so a future
 * regeneration from a fuller receipt cannot quietly widen it.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const FILE = join(HERE, '..', '..', 'site', 'demo', 'recorded-run.json');
const raw = readFileSync(FILE, 'utf8');
const run = JSON.parse(raw);

test('the recording carries no key material from the private half', () => {
    for (const key of ['runSeed', 'saltRule', 'fields', 'panel', 'vin']) {
        assert.equal(run[key], undefined, `${key} must not be published`);
    }
    assert.ok(!/runSeed|saltRule/.test(raw), 'no seed or salt rule anywhere in the file');
    assert.ok(!/"salt"\s*:/.test(raw), 'no salt anywhere in the file');
});

test('no stage label publishes a field reading', () => {
    // The guided runner writes labels for the holder, who may read their own
    // values: "odometerKm -> 83327". The arrow is the tell.
    for (const s of run.stages) {
        assert.ok(!s.label.includes('->'), `stage ${s.stage} still carries a reading: ${s.label}`);
        for (const c of s.calls) assert.ok(!c.includes('->'), `call still carries a reading: ${c}`);
    }
});

test('a claim keeps its bound, because the ledger has it', () => {
    // The opposite failure also matters: stripping the bound would make the
    // page less honest, not more. The ledger carries the bound of every
    // accepted claim, so the recording must too.
    const mileage = run.claims.find((c) => /mileage/i.test(c.label));
    assert.ok(mileage, 'the run proved a mileage claim');
    assert.match(mileage.label, /\d/, 'the bound is part of the claim and stays');
});

test('every stage is checkable by a stranger', () => {
    assert.ok(run.stages.length >= 1, 'at least one transaction');
    for (const s of run.stages) {
        assert.match(s.txHash, /^[0-9a-f]{64}$/, `stage ${s.stage} has a real transaction hash`);
        assert.ok(Number.isInteger(s.blockHeight) && s.blockHeight > 0, `stage ${s.stage} names its block`);
        assert.equal(s.explorer, `https://preprod.midnightexplorer.com/transactions/${s.txHash}`,
            `stage ${s.stage} links to the transaction it names`);
    }
    const heights = run.stages.map((s) => s.blockHeight);
    assert.deepEqual(heights, [...heights].sort((a, b) => a - b), 'stages run forward in time');
});

test('the refused claim is recorded and wrote nothing', () => {
    assert.ok(run.refused.length >= 1, 'the run includes a claim the record could not support');
    const refused = run.claims.filter((c) => /refused/i.test(c.outcome));
    assert.ok(refused.length >= 1, 'the refusal appears in the claim list');
    const proven = run.claims.filter((c) => /proven/i.test(c.outcome));
    assert.ok(proven.length >= 1, 'and at least one claim was proven');
    // A refusal writes no transaction, so no stage may name one. If a refusal
    // ever gained a transaction the page's argument would change, and the
    // page would be making a claim its own evidence contradicts.
    for (const r of run.refused) {
        const step = r.step.replace(/^prove /, '');
        for (const s of run.stages) {
            assert.ok(!s.label.includes(step), `stage ${s.stage} names the refused step: ${s.label}`);
            for (const c of s.calls) assert.ok(!c.includes(step), `a call names the refused step: ${c}`);
        }
    }
});

test('the contract and vin hash are the public identifiers, not the VIN', () => {
    assert.match(run.contractAddress, /^[0-9a-f]{64}$/);
    assert.match(run.vinHash, /^[0-9a-f]{64}$/);
    // A plaintext VIN is 17 characters from a restricted alphabet. The chain
    // never sees one, so neither does this file.
    assert.ok(!/\b[A-HJ-NPR-Z0-9]{17}\b/.test(raw), 'no plaintext VIN in the recording');
});
