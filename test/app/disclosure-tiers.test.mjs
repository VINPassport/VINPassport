/**
 * The disclosure tier policy: what scripts/lib/tiers.mjs promises (D26).
 *
 * A tier only bounds a bundle if every field has one, nobody can slip a field
 * in unassigned, and the copy the browser reads says the same thing as the
 * copy the builder enforces. The bundles themselves are tested against ledger
 * state the real circuits wrote, in test/passport.test.mjs ("tiered
 * disclosure"); this file holds the policy they rest on.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIERS, POLICY_VERSION, FIELD_TIERS, tierOf, allows, vinAllowed } from '../../scripts/lib/tiers.mjs';
import { FIELDS } from '../../scripts/lib/scenario.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('every registry field has exactly one tier, and the policy names no other field', () => {
    const registry = Object.keys(FIELDS).sort();
    const policy = Object.keys(FIELD_TIERS).sort();
    assert.deepEqual(policy, registry, 'the tier policy and the field registry disagree');
    for (const name of registry) assert.ok(TIERS.includes(tierOf(name)), `${name} has no valid tier`);
});

test('a field nobody assigned is refused, never defaulted', () => {
    assert.throws(() => tierOf('reservedNumeric0'), /no disclosure tier for field 'reservedNumeric0'/);
    assert.throws(() => allows('owner', 'public'), /unknown tier 'owner'/);
});

test('tiers nest: each audience sees everything the one below it sees', () => {
    assert.deepEqual(TIERS, ['public', 'trade', 'authority']);
    for (const [i, tier] of TIERS.entries()) {
        for (const [j, fieldTier] of TIERS.entries()) {
            assert.equal(allows(tier, fieldTier), j <= i, `${tier} vs ${fieldTier}`);
        }
    }
    assert.deepEqual(TIERS.filter(vinAllowed), ['authority'], 'the VIN travels only at authority');
});

test('the regulatory declarations and the specification are public', () => {
    // EVP data may not be gated behind anything beyond the VIN (Reg (EU)
    // 2025/1707, Annex V 4.2.3), and the declarations and the specification
    // are what a type approval already publishes. Gating them would put the
    // passport on the wrong side of the law it is built for.
    for (const name of ['co2FootprintKgCO2e', 'recycledPlasticPct', 'recyclabilityPct', 'firstRegistrationDate',
                        'makeCode', 'modelCode', 'modelYear', 'enginePowerKw']) {
        assert.equal(tierOf(name), 'public', `${name} must be public`);
    }
});

test('the history is trade, and records an authority is the source of stay at authority', () => {
    for (const name of ['odometerKm', 'accidentCount', 'ownerCount', 'writeOffCategory', 'floodDamageCount']) {
        assert.equal(tierOf(name), 'trade', `${name} must be trade`);
    }
    for (const name of ['stolenRecordCount', 'recoveredRecordCount', 'scrapCertificateDate', 'dismantlingTimeMinutes']) {
        assert.equal(tierOf(name), 'authority', `${name} must be authority`);
    }
});

test('the vocabulary the browser reads carries the same tier as the policy', () => {
    const vocabulary = JSON.parse(readFileSync(join(ROOT, 'site', 'verify', 'fields.json'), 'utf8'));
    const entries = Object.values(vocabulary.fields);
    assert.equal(entries.length, Object.keys(FIELD_TIERS).length);
    for (const e of entries) {
        assert.equal(e.tier, FIELD_TIERS[e.name], `fields.json says ${e.name} is ${e.tier}; the policy says ${FIELD_TIERS[e.name]}`);
    }
    assert.match(POLICY_VERSION, /^vinpassport-tiers\/v\d+$/);
});
