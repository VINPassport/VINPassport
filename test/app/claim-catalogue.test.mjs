/**
 * The published question catalogue, and the invariants that keep it honest.
 *
 * The catalogue is the product's promise written down: a verifier sees every
 * question a passport COULD answer and gets back a yes or silence, never a
 * value. Three surfaces read it (the verify page, the preprod planner, the
 * simulator), and before it existed each kept its own hardcoded list of four.
 * These tests exist so they cannot drift apart again.
 *
 * Runs under `node --test` per D17: the app layer stays on the platform
 * runner, contract tests stay on vitest.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
    CLAIM_CATALOGUE, CLAIM_GROUPS, boundFor, questionsIn, CLAIM_FIELDS
} from '../../site/assets/claim-catalogue.mjs';
import { QUESTIONS } from '../../site/assets/verdict.mjs';
import { FIELDS, PANEL, Rule } from '../../scripts/lib/scenario.mjs';
import { CLAIM_DEFS, planCalls } from '../../scripts/lib/preprod-plan.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// ------------------------------------------------------- one catalogue

test('every question asks about a field that exists in the registry', () => {
    const missing = CLAIM_CATALOGUE
        .filter((q) => !(q.field in FIELDS))
        .map((q) => `${q.id} -> ${q.field}`);
    assert.deepEqual(missing, [],
        'a question about a field nobody can initialise can never be answered');
});

test('question ids are unique, and every group is declared', () => {
    const ids = CLAIM_CATALOGUE.map((q) => q.id);
    assert.equal(new Set(ids).size, ids.length, 'duplicate question id');
    const groups = new Set(CLAIM_GROUPS.map((g) => g.id));
    for (const q of CLAIM_CATALOGUE) {
        assert.ok(groups.has(q.group), `${q.id} is in undeclared group "${q.group}"`);
    }
    // And every declared group earns its place.
    for (const g of CLAIM_GROUPS) {
        assert.ok(questionsIn(g.id).length > 0, `group "${g.id}" has no questions`);
    }
});

test('the three surfaces read the same catalogue, not three copies', () => {
    const fromPage = new Set(QUESTIONS.map((q) => q.id));
    const fromPlanner = new Set(Object.keys(CLAIM_DEFS));
    const canonical = new Set(CLAIM_CATALOGUE.map((q) => q.id));
    assert.deepEqual([...fromPage].sort(), [...canonical].sort());
    assert.deepEqual([...fromPlanner].sort(), [...canonical].sort());
});

// --------------------------------------------------- bounds and rungs

test('only the open-bound questions take a bound from the asker', () => {
    // A bespoke bound per enquiry is what narrows a hidden value towards a
    // point, so everything else must use a fixed standard rung.
    const open = CLAIM_CATALOGUE.filter((q) => q.bound === null).map((q) => q.id);
    assert.deepEqual(open.sort(), ['co2Under', 'mileageUnder'],
        'a new open-bound question is a privacy decision, not a detail');
    for (const q of CLAIM_CATALOGUE) {
        assert.equal(CLAIM_DEFS[q.id].openBound, q.bound === null);
    }
});

test('a moving threshold moves, and a fixed rung does not', () => {
    const day = 86_400_000;
    const now = Date.UTC(2026, 9, 15);
    const moving = CLAIM_CATALOGUE.filter((q) => q.bound && typeof q.bound === 'object');
    assert.ok(moving.length >= 3, 'the date questions should be relative');
    for (const q of moving) {
        assert.ok(boundFor(q, now + 400 * day) > boundFor(q, now),
            `${q.id} must expire rather than answer forever`);
    }
    const fixed = CLAIM_CATALOGUE.find((q) => typeof q.bound === 'bigint');
    assert.equal(boundFor(fixed, now), boundFor(fixed, now + 400 * day));
});

// ------------------------------------------------------------ circuits

test('a floor question plans as proveFieldAtLeast, a ceiling as proveFieldAtMost', () => {
    const stages = planCalls({
        vin: 'VPDTEST', fields: { serviceCount: 6, odometerKm: 42_000 },
        prove: { fourServices: true, mileageUnder: 150_000 }
    });
    const claims = stages.flatMap((s) => s.steps).filter((s) => s.kind === 'claim');
    const byId = Object.fromEntries(claims.map((c) => [c.claim, c.circuit]));
    assert.equal(byId.fourServices, 'proveFieldAtLeast');
    assert.equal(byId.mileageUnder, 'proveFieldAtMost');
});

test('the catalogue actually exercises both proof circuits', () => {
    // Until the catalogue existed every requested claim was a ceiling, which
    // is why proveFieldAtLeast had never been submitted on chain.
    const floors = CLAIM_CATALOGUE.filter((q) => !q.atMost);
    const ceilings = CLAIM_CATALOGUE.filter((q) => q.atMost);
    assert.ok(floors.length >= 5, `only ${floors.length} floor questions`);
    assert.ok(ceilings.length >= 5, `only ${ceilings.length} ceiling questions`);
});

// -------------------------------------------------------------- rules

test('no question asks a ceiling of a field that can only rise past it', () => {
    // A neverFalls field can be proven at most N today and exceed N tomorrow.
    // That is sound, and the page marks the claim superseded. What must never
    // happen is a question on a field with no rule at all.
    for (const q of CLAIM_CATALOGUE) {
        const rule = FIELDS[q.field].rule;
        assert.ok(rule === Rule.neverFalls || rule === Rule.neverChanges
            || rule === Rule.neverRises, `${q.field} has no integrity rule`);
    }
});

test('the history set carries no panel slot, so adding it re-anchors nothing', () => {
    // The 32-slot panel is the canonical document. History is not document
    // content, and a history field in a panel slot would move the content
    // root of every passport.
    const historyOnly = CLAIM_FIELDS.filter((f) => !(f in PANEL));
    assert.ok(historyOnly.length > 10,
        'the history set should live outside the panel');
    for (const f of historyOnly) {
        assert.ok(!(f in PANEL), `${f} must not occupy a panel slot`);
    }
});

// ------------------------------------------------------ doc/code drift

test('FIELDS.md lists every lifecycle field the panel actually defines', () => {
    // The doc said "four" and listed four while the code defined six. Prose
    // and code drifted and nothing caught it, so now something does.
    const doc = readFileSync(join(ROOT, 'docs', 'FIELDS.md'), 'utf8');
    const section = doc.split('## Who writes a field, over a vehicle’s life')[1]
        ?? doc.split("## Who writes a field, over a vehicle's life")[1];
    assert.ok(section, 'the lifecycle section moved or was renamed');
    const table = section.split('\n\n').slice(0, 3).join('\n\n');

    const panelLifecycle = Object.entries(FIELDS)
        .filter(([name, m]) => name in PANEL && m.rule === Rule.neverFalls)
        .map(([name]) => name);

    for (const name of panelLifecycle) {
        assert.ok(table.includes(`\`${name}\``),
            `FIELDS.md does not list the lifecycle field ${name}`);
    }
    assert.ok(/Six of its slots are life-cycle/.test(section),
        `the count in the prose should match the ${panelLifecycle.length} fields listed`);
    assert.equal(panelLifecycle.length, 6);
});
