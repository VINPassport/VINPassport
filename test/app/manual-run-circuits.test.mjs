/**
 * The manual route, put through the REAL circuits end to end - everything the
 * preprod run does except prove, pay and submit.
 *
 * manual-intake.test.mjs pins the validator: that `authorise`, `by` and
 * `withdraw` survive the HTTP boundary as identities rather than labels. That
 * is necessary and it is not enough. A payload can validate cleanly and still
 * plan into calls the contract refuses, or into calls it accepts while
 * recording the wrong identity against the field - which is the failure that
 * matters, because a passport whose service history is stamped with the
 * manufacturer instead of the dealership is wrong in exactly the way the
 * delegation feature exists to prevent, and nothing on the page would say so.
 *
 * So this walks the whole pipeline the runner walks:
 *
 *     console payload -> validateManualIntake -> planCalls -> dryRunStages
 *
 * with dryRunStages being the runner's own loop, not a copy of it, against the
 * compiled contract. What is left untested here is the ZK proof, the fee and
 * the node, because those cost real money on preprod.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateManualIntake } from '../../scripts/lib/preprod-runner.mjs';
import { dryRunStages } from '../../scripts/lib/preprod-dryrun.mjs';
import { planCalls } from '../../scripts/lib/preprod-plan.mjs';
import { PassportSimulator, K, vinHash, contentRoot, hex } from '../../scripts/lib/scenario.mjs';
import {
    REGISTRAR_SECRET, REGISTRAR_ID, DEALER_SECRET, DEALER_ID, GARAGE_ID
} from '../passport-simulator.mjs';
import { pureCircuits } from '../../contracts/vinpassport/src/managed/vinpassport/contract/index.js';

/** The dealership the runner holds, shaped as createRunner shapes it. */
const DEALER = { label: 'dealership', id: DEALER_ID, secret: DEALER_SECRET };

/** What the console posts: labels, not identities, and `by` on the round. */
const consolePayload = () => ({
    vin: 'VPDTEST0000000001',
    registrar: 'passport.vin-demo',
    fields: { odometerKm: 40_000, accidentCount: 0, serviceCount: 6, lastServiceOdometerKm: 40_000 },
    authorise: ['dealership'],
    withdraw: ['dealership'],
    updates: [{ odometerKm: 48_000, by: 'dealership' }],
    prove: { noAccidents: true, mileageUnder: 150_000 }
});

/** Run an intake exactly as the runner's simulate stage does. */
function dryRun(intake, { dealer = DEALER } = {}) {
    const sim = new PassportSimulator([REGISTRAR_ID]);
    sim.actAs(REGISTRAR_SECRET);
    const vinBytes = vinHash(intake.vin);
    // Deterministic salts: the run's own salts are random, and nothing here
    // depends on which they are.
    const saltOf = (name, seq) => vinHash(`${intake.vin}:${name}:${seq}`);
    const croot = contentRoot(intake.vin, intake.fields ?? {}, intake.panel ?? {}, (l) => vinHash(l));
    const out = dryRunStages(planCalls(intake), {
        sim, registrarSecret: REGISTRAR_SECRET, dealer, vinBytes, croot, saltOf
    });
    return { ...out, sim, vinBytes, croot };
}

const kinds = (stages) => stages.flatMap((s) => s.steps)
    .map((s) => (s.by ? `${s.kind}:by ${s.by}` : s.kind));

test('the console payload plans and survives the compiled circuits', () => {
    const intake = validateManualIntake(consolePayload(), DEALER);
    const { refused, stages } = dryRun(intake);
    assert.deepEqual(refused, [],
        'a step the chain would accept was refused in the dry run, so the manual route cannot complete');
    assert.ok(stages.length, 'nothing survived the dry run');
});

test('the delegated update is recorded against the DEALERSHIP, not the registrar', () => {
    const intake = validateManualIntake(consolePayload(), DEALER);
    const { sim, vinBytes, croot } = dryRun(intake);
    const slot = pureCircuits.slotOf(vinBytes, K.odometerKm, croot);
    assert.equal(hex(sim.ledger.fieldWriter.lookup(slot)), hex(DEALER_ID),
        'the odometer was written by the registrar: the run looks delegated and is not');
    // A field the dealership never touched still belongs to the registrar, so
    // the assertion above is about this write and not about the whole vehicle.
    const untouched = pureCircuits.slotOf(vinBytes, K.accidentCount, croot);
    assert.equal(hex(sim.ledger.fieldWriter.lookup(untouched)), hex(REGISTRAR_ID));
});

test('withdrawing ends the grant and does not rewrite what was already written', () => {
    const intake = validateManualIntake(consolePayload(), DEALER);
    const { sim, vinBytes, croot } = dryRun(intake);
    assert.equal(sim.ledger.writers.member(pureCircuits.writerKeyOf(vinBytes, DEALER_ID)), false,
        'the writer kept the pen after the run asked for it back');
    assert.equal(
        hex(sim.ledger.fieldWriter.lookup(pureCircuits.slotOf(vinBytes, K.odometerKm, croot))),
        hex(DEALER_ID),
        'withdrawal erased who wrote the field, which would let a grant be denied afterwards');
});

test('an update by a writer that was never authorised is refused in-circuit', () => {
    // The rule: authority is enforced in the circuit, not only at the edge.
    // The validator refuses this payload first, so the console can never send
    // it; addressing the dry run directly is what makes the test mean
    // something. Without it, the tests above only show that a permitted write
    // is permitted, which needs no authority rule at all.
    const intake = validateManualIntake(consolePayload(), DEALER);
    const ungranted = { ...intake, authorise: [], withdraw: [] };
    const { refused } = dryRun(ungranted);
    assert.equal(refused.length, 1,
        `expected exactly the delegated update to be refused, got ${JSON.stringify(refused)}`);
    assert.match(refused[0].step, /^update 1: odometerKm/);
});

test('a writer the vehicle authorised cannot be swapped for another at write time', () => {
    // Authorise the garage, write as the dealership. Both are real identities
    // and one of them is authorised; the circuit must still refuse, because
    // the authorisation names a party and not a role.
    const intake = validateManualIntake(consolePayload(), DEALER);
    const swapped = {
        ...intake,
        authorise: [{ label: 'service garage', id: GARAGE_ID }],
        withdraw: []
    };
    const { refused } = dryRun(swapped);
    assert.equal(refused.length, 1,
        `expected the dealership's write to be refused, got ${JSON.stringify(refused)}`);
});

test('guided and manual plan to the same calls in the same order', () => {
    // The guided run builds identities itself; the manual one gets labels over
    // HTTP and must arrive at the same place. Two code paths, one plan.
    const manual = validateManualIntake(consolePayload(), DEALER);
    const guided = {
        ...consolePayload(),
        authorise: [{ label: DEALER.label, id: DEALER.id }],
        withdraw: [{ label: DEALER.label, id: DEALER.id }]
    };
    assert.deepEqual(kinds(planCalls(manual)), kinds(planCalls(guided)),
        'the two routes plan different calls, so testing one says nothing about the other');
    assert.deepEqual(kinds(planCalls(manual)).filter((k) => k.includes('by ')), ['update:by dealership']);
});

test('with no dealership configured the manual route refuses rather than dropping the grant', () => {
    assert.throws(() => validateManualIntake(consolePayload(), null), /no writer identity is configured/);
    // ...and the undelegated form of the same vehicle still runs clean, so the
    // refusal above is about delegation and not about the payload.
    const { authorise, withdraw, updates, ...rest } = consolePayload();
    const plain = validateManualIntake({ ...rest, updates: [{ odometerKm: 48_000 }] }, null);
    const { refused } = dryRun(plain, { dealer: null });
    assert.deepEqual(refused, []);
});
