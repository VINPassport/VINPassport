/**
 * Registering a vehicle without a server, and folding it into what the
 * browser already had.
 *
 * The merge is the part worth testing hard. A tab can register more than one
 * vehicle, and each registration runs on a simulator that knows only about
 * itself, so a merge that replaces instead of folding would silently erase
 * the previous one - and erase the demo vehicles with it, leaving a visitor
 * with a scan page holding one car and no sign anything had gone.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    registerLocally, mergeLedgers, resolveWriters, requireIntakeFields
} from '../../scripts/lib/intake-engine.mjs';

const intake = (over = {}) => ({
    vin: 'VPDENGINETEST0001',
    registrar: 'test',
    fields: { odometerKm: 40_000, accidentCount: 0, serviceCount: 4 },
    prove: { noAccidents: true },
    ...over
});

test('a registration comes back as a ledger, not just a verdict', () => {
    const out = registerLocally(intake());
    assert.ok(out.applied.includes('registerPassport'));
    assert.deepEqual(out.refused, [], `refused: ${JSON.stringify(out.refused)}`);
    assert.ok(out.ledger.passports[out.vinHex], 'the vehicle is not in the ledger it returned');
    assert.ok(Object.keys(out.ledger.fieldCommitment).length >= 3);
});

test('the ledger it returns holds this vehicle and nothing else', () => {
    // The simulator is deliberately fresh: rebuilding the demo vehicles to
    // throw them away cost about 200 ms, and the caller merges anyway.
    const out = registerLocally(intake());
    assert.deepEqual(Object.keys(out.ledger.passports), [out.vinHex]);
});

test('what the console gets back carries no salt', () => {
    // applyIntake can keep every write's opening, for the demo export's sample
    // bundles. The console forwards its result into the page, so that must
    // stay off here: a salt opens its commitment, and it is the holder's.
    const out = registerLocally(intake());
    assert.equal('openings' in out, false);
    assert.doesNotMatch(JSON.stringify(out), /"salt"/);
});

test('delegation survives the serverless path', () => {
    const out = registerLocally(intake({
        authorise: ['dealership'],
        updates: [{ odometerKm: 48_000, by: 'dealership' }]
    }));
    assert.deepEqual(out.refused, [], `refused: ${JSON.stringify(out.refused)}`);
    const writers = new Set(Object.values(out.ledger.fieldWriter));
    assert.equal(writers.size, 2,
        'every field has the same writer, so the delegated update was written by the registrar');
});

test('a refusal is a result, not a thrown error', () => {
    // An odometer that falls breaks the ratchet. The registration still
    // happens; the update does not, and the page has to be able to say so.
    const out = registerLocally(intake({ updates: [{ odometerKm: 10 }] }));
    assert.ok(out.applied.includes('registerPassport'));
    assert.equal(out.refused.length, 1, JSON.stringify(out.refused));
    assert.match(out.refused[0].reason, /decreased/);
});

test('an intake missing its basics is refused before any circuit runs', () => {
    assert.throws(() => requireIntakeFields({ registrar: 'x', fields: {} }), /missing "vin"/);
    assert.throws(() => registerLocally({ vin: 'X', fields: {} }), /missing "registrar"/);
});

// ---------------------------------------------------------------- merging

const led = (over = {}) => ({
    source: 'base',
    passports: { aa: 'r1' }, registrar: { aa: 'reg' },
    fieldCommitment: { s1: 'c1' }, fieldRule: { s1: 0 }, fieldWriter: { s1: 'reg' },
    writers: ['w1'], claims: [{ key: 'k1' }], relClaims: [],
    ...over
});

test('a second vehicle joins the first instead of replacing it', () => {
    const merged = mergeLedgers(led(), led({
        source: 'added', passports: { bb: 'r2' }, registrar: { bb: 'reg' },
        fieldCommitment: { s2: 'c2' }, fieldRule: { s2: 0 }, fieldWriter: { s2: 'reg' },
        writers: ['w2'], claims: [{ key: 'k2' }]
    }));
    assert.deepEqual(Object.keys(merged.passports).sort(), ['aa', 'bb']);
    assert.deepEqual(Object.keys(merged.fieldCommitment).sort(), ['s1', 's2']);
    assert.deepEqual(merged.writers.sort(), ['w1', 'w2']);
    assert.deepEqual(merged.claims.map((c) => c.key).sort(), ['k1', 'k2']);
});

test('registering the same vehicle twice keeps the newer write', () => {
    // Keys are hashes of (vehicle, field), so a repeat means the same vehicle
    // came round again and the later state is the right answer.
    const merged = mergeLedgers(led(), led({ fieldCommitment: { s1: 'NEWER' } }));
    assert.equal(merged.fieldCommitment.s1, 'NEWER');
    assert.equal(Object.keys(merged.fieldCommitment).length, 1);
});

test('re-proving a claim does not accumulate copies of it', () => {
    // Idempotent on chain: the same key written twice. It must look
    // idempotent here, or the proof explorer counts one claim as two.
    const merged = mergeLedgers(led(), led({ claims: [{ key: 'k1', bound: '9' }] }));
    assert.equal(merged.claims.length, 1);
    assert.equal(merged.claims[0].bound, '9');
});

test('merging onto nothing is the same as the thing being merged', () => {
    // The first registration in a tab has no base to fold into.
    const add = led({ source: 'added' });
    const merged = mergeLedgers(undefined, add);
    assert.deepEqual(merged.passports, add.passports);
    assert.deepEqual(merged.claims, add.claims);
    assert.equal(merged.source, 'added');
});

test('the merged record stops claiming it came from where the base did', () => {
    const merged = mergeLedgers(led({ source: 'the committed demo export' }), led({ source: 'this browser' }));
    assert.equal(merged.source, 'this browser',
        'a record that now holds a locally added vehicle still says it was exported at build time');
});

test('a claim with no key is dropped rather than duplicated endlessly', () => {
    // Nothing should produce one, but a keyless entry merged repeatedly
    // would grow without bound, which is worse than losing it.
    const merged = mergeLedgers(led({ claims: [{ bound: '1' }] }), led({ claims: [{ bound: '1' }] }));
    assert.deepEqual(merged.claims, [], 'a keyless claim survived the merge and will accumulate');
});

test('a real registration merges onto a real one', () => {
    // The unit tests above use hand-made shapes; this proves the real export
    // shape survives the same path.
    const first = registerLocally(intake({ vin: 'VPDENGINETEST0001' }));
    const second = registerLocally(intake({ vin: 'VPDENGINETEST0002' }));
    const merged = mergeLedgers(first.ledger, second.ledger);
    assert.ok(merged.passports[first.vinHex], 'the first vehicle was lost');
    assert.ok(merged.passports[second.vinHex], 'the second vehicle never arrived');
    assert.equal(
        Object.keys(merged.fieldCommitment).length,
        Object.keys(first.ledger.fieldCommitment).length + Object.keys(second.ledger.fieldCommitment).length,
        'two vehicles collided on a field slot, which the domain separation is supposed to prevent');
});
