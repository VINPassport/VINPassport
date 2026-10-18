/**
 * The preprod manual route must honour delegation, because the console sends it.
 *
 * The intake console offers a dealership, posts `authorise: ['dealership']`
 * and stamps the update `by: 'dealership'`. It submits that same payload to
 * one of two places depending on the server it is talking to:
 *
 *   local engine   POST /api/intake        handleIntake, which honours both
 *   preprod        POST /api/demo/intake   validateManualIntake, which did not
 *
 * The preprod half never read `authorise`, so it was dropped, and `by` fell
 * through the field loop and threw `unknown field "by" in updates`. One form,
 * two behaviours, and the silent half produced a run that LOOKS delegated and
 * is not: the fields are written by the registrar, the writer circuits never
 * run, and nothing says so. The local route refuses an unknown writer by name
 * for exactly that reason; this one now does too.
 *
 * The runner holds a single preprod writer, registrar C, and only when its
 * secrets are configured. The console offers a service garage as well, which
 * has no preprod identity, so that case has to say so rather than quietly
 * register an undelegated vehicle.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateManualIntake } from '../../scripts/lib/preprod-runner.mjs';

/** The shape createRunner builds from registrar C. Values are never used here. */
const DEALER = { label: 'dealership', id: new Uint8Array(32), secret: new Uint8Array(32) };
const base = { fields: { odometerKm: 1000 }, prove: {} };
const labels = (list) => (list ?? []).map((w) => w.label);

test('an authorised writer survives validation, as an identity not a label', () => {
    const out = validateManualIntake(
        { ...base, authorise: ['dealership'], updates: [{ odometerKm: 2000, by: 'dealership' }] },
        DEALER
    );
    assert.deepEqual(labels(out.authorise), ['dealership'],
        'authorise was dropped: the run would look delegated and would not be');
    assert.equal(out.updates[0].by, 'dealership',
        '`by` was lost, so the update would be written by the registrar instead');
    assert.equal(out.updates[0].odometerKm, 2000, 'the update itself must still come through');
});

test('withdraw comes through too, so one run can show the whole delegation life cycle', () => {
    const out = validateManualIntake(
        { ...base, authorise: ['dealership'], withdraw: ['dealership'], updates: [{ odometerKm: 2000, by: 'dealership' }] },
        DEALER
    );
    assert.deepEqual(labels(out.withdraw), ['dealership']);
});

test('`by` is a writer, not a field, and must not be range-checked as one', () => {
    // The original failure: `by` hit the `name in FIELDS` guard and threw,
    // so selecting a dealership in the console broke submission outright.
    assert.doesNotThrow(() => validateManualIntake(
        { ...base, authorise: ['dealership'], updates: [{ odometerKm: 2000, by: 'dealership' }] },
        DEALER
    ));
    assert.throws(
        () => validateManualIntake({ ...base, updates: [{ odometerKm: 2000, nonsense: 1 }] }, DEALER),
        /unknown field "nonsense"/,
        'a genuinely unknown field must still be refused'
    );
});

test('a writer that was never authorised cannot write an update', () => {
    assert.throws(
        () => validateManualIntake({ ...base, updates: [{ odometerKm: 2000, by: 'dealership' }] }, DEALER),
        /never authorised/,
        'the ledger would refuse this later and less clearly; refuse it here'
    );
});

test('a label this runner has no identity for is refused, never ignored', () => {
    // The console offers a service garage. Preprod holds only registrar C.
    assert.throws(
        () => validateManualIntake({ ...base, authorise: ['service garage'] }, DEALER),
        /no preprod identity for "service garage"/
    );
});

test('with no registrar C configured, asking to delegate says so', () => {
    assert.throws(
        () => validateManualIntake({ ...base, authorise: ['dealership'] }, null),
        /no writer identity is configured/,
        'silently running without delegation is the failure this whole file is about'
    );
});

test('an intake that delegates nothing is unchanged', () => {
    const out = validateManualIntake({ ...base, updates: [{ odometerKm: 2000 }] }, DEALER);
    assert.equal(out.authorise, undefined, 'no empty key when nothing was asked for');
    assert.equal(out.withdraw, undefined);
    assert.deepEqual(out.updates, [{ odometerKm: 2000 }]);
});

test('an update carrying only `by` is not a round', () => {
    // `by` alone writes nothing, and a round with no field would plan a call
    // that has nothing to do.
    const out = validateManualIntake(
        { ...base, authorise: ['dealership'], updates: [{ by: 'dealership' }] },
        DEALER
    );
    assert.equal(out.updates.length, 0);
});
