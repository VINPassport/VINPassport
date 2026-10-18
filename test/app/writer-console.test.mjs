/**
 * Handing the pen to a dealership, from the console.
 *
 * Two things are asserted here, and they are different kinds of thing.
 *
 * The first is behaviour: an authorised writer can write the vehicle, the
 * ledger records WHICH identity wrote each field, and the integrity rule
 * still applies to them. Delegation hands over the pen, never the right to
 * break the rule, and that is the whole question the writer list raises.
 *
 * The second is a boundary. The console runs in a browser that anyone can
 * open. A writer's secret is what proves its identity in-circuit, so a page
 * that handled one would be handing it to every viewer. The page therefore
 * sends a LABEL and the server resolves it against identities it holds. That
 * is invisible in behaviour and would survive any amount of testing, so it is
 * asserted against the source directly.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolveWriters } from '../../scripts/lib/intake-engine.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
    PassportSimulator, applyIntake, exportLedger, saltStream, hex,
    DEMO_WRITERS, CONSOLE_REGISTRAR_SECRET
} from '../../scripts/lib/scenario.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

const run = (extra) => {
    const sim = new PassportSimulator();
    const salt = saltStream();
    const result = applyIntake(sim, {
        vin: 'WVWZZZ1JZXW000099',
        registrar: 'demo-authority',
        registrarSecret: CONSOLE_REGISTRAR_SECRET,
        fields: { odometerKm: 20_000 },
        prove: {},
        ...extra
    }, salt);
    return { result, ledger: exportLedger(sim, 'test') };
};

test('an authorised dealership can write the vehicle, and the ledger says it was them', () => {
    const { result, ledger } = run({
        writers: [DEMO_WRITERS.dealership],
        updates: [{ odometerKm: 35_000, by: 'dealership' }]
    });

    assert.ok(result.applied.some((s) => s.includes('authoriseWriter dealership')),
        `authoriseWriter was not applied: ${JSON.stringify(result.refused)}`);
    assert.ok(result.applied.some((s) => s.includes('by dealership')),
        `the delegated update was not applied: ${JSON.stringify(result.refused)}`);

    const writerIds = new Set(Object.values(ledger.fieldWriter));
    assert.ok(writerIds.has(hex(DEMO_WRITERS.dealership.id)),
        'no field on the ledger records the dealership as its writer');
});

test('the rule survives delegation: an authorised writer still cannot lower the odometer', () => {
    const { result } = run({
        writers: [DEMO_WRITERS.dealership],
        updates: [{ odometerKm: 35_000, by: 'dealership' }, { odometerKm: 100, by: 'dealership' }]
    });
    const lowering = result.refused.find((r) => r.step.includes('100'));
    assert.ok(lowering, 'lowering the odometer was not refused');
    assert.match(lowering.reason, /decreased/,
        `refused for the wrong reason: ${lowering.reason}`);
});

test('a writer that was never authorised is refused', () => {
    const { result } = run({ updates: [{ odometerKm: 35_000, by: 'dealership' }] });
    assert.ok(result.refused.some((r) => /unknown writer/.test(r.reason)),
        `an unauthorised writer was not refused: ${JSON.stringify(result)}`);
});

test('the console sends a name, never a secret', () => {
    const page = readFileSync(join(ROOT, 'site', 'intake', 'intake.js'), 'utf8');
    assert.ok(!/secret/i.test(page.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '')),
        'the intake page handles something called a secret');
    assert.match(page, /authorise: \[\.\.\.authorised\]/,
        'the page does not send the authorised writers as labels');

});

test('a label nobody holds is refused, and refused the same way everywhere', () => {
    // This used to read the server's source for the two refusal messages,
    // which passed for the wrong reason: it proved the strings existed, not
    // that anything acted on them, and it broke the moment the rule moved to
    // the module the browser console shares. Call the rule instead.
    assert.throws(() => resolveWriters({ authorise: ['a dealership nobody holds'] }),
        /unknown writer/,
        'an unknown label is ignored rather than refused, so a run would look delegated and would not be');
    assert.throws(() => resolveWriters({ updates: [{ odometerKm: 1, by: 'dealership' }] }),
        /was never authorised/,
        'a party that was never granted the pen can write a field');
    // The grant itself still has to work, or the two refusals above would be
    // satisfied by a function that refuses everything.
    assert.deepEqual(
        resolveWriters({ authorise: ['dealership'], updates: [{ odometerKm: 1, by: 'dealership' }] })
            .map((w) => w.label),
        ['dealership']);
});
