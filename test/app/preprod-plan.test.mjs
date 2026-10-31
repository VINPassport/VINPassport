/**
 * The preprod runner's PLANNING and WITNESS-ARMING rules, tested offline.
 *
 * Both rules cost a real transaction to learn and neither is visible in a
 * type signature, so they are pinned here rather than in a comment:
 *
 *  1. Packing. The ledger refuses a call that updates an already-populated
 *     cell when a later intent follows it in the same transaction, so a
 *     cell-updating call must be LAST in its transaction. Only recordField
 *     is one: it overwrites a commitment that already exists.
 *
 *     initialiseField was one too, until the global updateCount Counter was
 *     removed. The counter was a single always-populated cell, so bumping it
 *     closed the transaction and a vehicle carrying sixty fields cost sixty
 *     transactions. Nothing read the number except a display.
 *
 *  2. Arming. nightgate-tx runs per-call `before` hooks only for a BATCH; a
 *     single call is proven with the witnesses exactly as they stand. An
 *     unarmed holder reads as value 0 with a zero salt, and initialiseField
 *     asserts nothing about prior state - so it would prove, land, and write
 *     a commitment nobody can ever open. The holder must refuse to be read
 *     until a hook arms it.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    planCalls, CELL_UPDATING, makeWitnessHolder, MAX_CALLS_PER_TX, MAX_CALLS_PER_RUN, TIER_INDEX, stepLabel
} from '../../scripts/lib/preprod-plan.mjs';
import { Tier } from '../../contracts/vinpassport/src/managed/vinpassport/contract/index.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const kinds = (plan) => plan.map((st) => st.steps.map((s) => s.kind));

test('a cell-updating call is always last in its transaction', () => {
    const plan = planCalls({
        fields: { odometerKm: 10, accidentCount: 0, ownerCount: 1 },
        updates: [{ odometerKm: 20 }],
        prove: { noAccidents: true, mileageUnder: 100 }
    });
    for (const stage of plan) {
        const updating = stage.steps.filter((s) => CELL_UPDATING.has(s.circuit));
        assert.ok(updating.length <= 1, 'at most one cell-updating call per transaction');
        if (updating.length === 1) {
            assert.equal(stage.steps[stage.steps.length - 1], updating[0],
                'the cell-updating call must be the last one in the transaction');
        }
    }
});

test('initialisations batch with the register, and only an update breaks the run', () => {
    const plan = planCalls({
        fields: { odometerKm: 10, accidentCount: 0, ownerCount: 1 },
        updates: [{ odometerKm: 20 }],
        prove: { noAccidents: true, mileageUnder: 100 }
    });
    assert.deepEqual(kinds(plan), [
        // Register, every initialisation AND the update now share one
        // transaction. The update overwrites a commitment so it must come
        // last, and here it already does. This was five transactions before
        // the counter came out.
        ['register', 'init', 'init', 'init', 'update'],
        ['claim', 'claim']      // claims touch no populated cell either
    ]);
});

test('a large field set costs transactions in batches, not one per field', () => {
    // The reason the counter had to go. Sixty fields was sixty transactions;
    // now it is however many MAX_CALLS_PER_TX allows, plus the register.
    // Eleven keeps this well inside MAX_CALLS_PER_RUN whatever that is.
    // That cap is ours, to bound the wall clock, and the chain has no such
    // limit: the point here is the ratio, not the number.
    const fields = {};
    for (let i = 0; i < 11; i++) fields['f' + i] = i;
    const plan = planCalls({ fields, prove: {} });
    const calls = plan.reduce((n, st) => n + st.steps.length, 0);
    assert.equal(calls, 12, 'one register plus eleven initialisations');
    assert.equal(plan.length, 2, 'twelve calls is two transactions, not twelve');
    for (const stage of plan) {
        assert.ok(stage.steps.length <= MAX_CALLS_PER_TX);
    }
});

test('a grant is planned after the passport exists, batches, and carries the contract\'s tier index', () => {
    // Registrar-only and a fresh insert, like authorising a writer, so it may
    // not lead the run and need not close a transaction.
    assert.deepEqual(TIER_INDEX, { trade: Tier.trade, authority: Tier.authority });
    const plan = planCalls({
        fields: { odometerKm: 10 },
        authorise: [{ label: 'dealership', id: new Uint8Array(32) }],
        grants: [{ label: 'dealership', id: new Uint8Array(32), tier: 'trade' }],
        prove: { mileageUnder: 100 }
    });
    const flat = plan.flatMap((st) => st.steps);
    const grant = flat.find((s) => s.kind === 'grant');
    assert.equal(grant.circuit, 'grantDisclosure');
    assert.equal(grant.tierIndex, Tier.trade);
    assert.ok(flat.indexOf(grant) > flat.findIndex((s) => s.kind === 'register'));
    assert.ok(!CELL_UPDATING.has('grantDisclosure'));
    assert.equal(stepLabel(grant), 'grantDisclosure dealership: trade');
});

test('a grant for a tier the contract does not have is refused before anything runs', () => {
    assert.throws(() => planCalls({ fields: {}, grants: [{ label: 'buyer', id: new Uint8Array(32), tier: 'public' }] }),
        /unknown tier "public"/);
});

test('a claims-only intake is a single transaction', () => {
    const plan = planCalls({ fields: {}, prove: { noAccidents: true, neverWrittenOff: true, oneKeeper: true, mileageUnder: 9 } });
    assert.equal(plan.length, 1, 'four claims and a register fit one transaction');
    assert.equal(plan[0].steps.length, 5);
});

test('the witness holder refuses to be read before a call arms it', () => {
    const { witnesses, arm, holder } = makeWitnessHolder();
    const ctx = { privateState: {} };

    assert.throws(() => witnesses.newValue(ctx), /before any call armed it/,
        'an unarmed read must fail loudly rather than return a zero value');

    arm('initialiseField odometerKm', { pending: { value: 42n, salt: new Uint8Array(32).fill(7) } })();
    assert.equal(witnesses.newValue(ctx)[1], 42n);
    assert.equal(witnesses.newSalt(ctx)[1][0], 7);
    assert.equal(holder.armed, 'initialiseField odometerKm');

    holder.armed = null;
    assert.throws(() => witnesses.newSalt(ctx), /before any call armed it/,
        'disarming between transactions must re-arm the guard');
});

/**
 * The intake console keeps its own copy of the run ceiling, because it warns
 * the operator BEFORE the button is pressed and a browser cannot import a
 * Node module from `scripts/`. A copy of a number is a number that drifts,
 * and the failure is quiet in both directions: a console that under-reports
 * lets someone build an intake the server then refuses, and one that
 * over-reports scares them off a run that would have worked.
 *
 * Checked by reading the source rather than importing it, because the file
 * touches the DOM at load.
 */
test('the console and the server agree on the run ceiling', () => {
    const src = readFileSync(join(ROOT, 'site', 'intake', 'intake.js'), 'utf8');
    const m = src.match(/const RUN_CAP = (\d+);/);
    assert.ok(m, 'intake.js no longer declares RUN_CAP; this guard has gone blind');
    assert.equal(Number(m[1]), MAX_CALLS_PER_RUN,
        'the console and the planner disagree about how many calls a run may make');
});
