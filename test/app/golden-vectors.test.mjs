/**
 * Whatever toolchain built the contract, it must compute what the Ledger 8
 * build computed: the same slots, identities, keys, commitments and ledger
 * contents for the same inputs. The fixture was generated from the Compact
 * 0.31.1 build (runtime 0.16.0) before the move to Ledger 9; see
 * scripts/make-golden-vectors.mjs for what it covers and why.
 *
 * A failure here means receipts and bundles issued under the earlier build
 * would no longer verify. Do not regenerate the fixture to make it pass.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { goldenVectors, FIXTURE } from '../../scripts/make-golden-vectors.mjs';

const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
const current = JSON.parse(JSON.stringify(await goldenVectors()));

test('the fixture was generated from the Ledger 8 build', () => {
    assert.deepEqual(fixture.generatedFrom, { compiler: '0.31.1', language: '0.23.0', runtime: '0.16.0' });
});

test('the contract helper circuits compute what the Ledger 8 build computed', () => {
    assert.deepEqual(current.pure, fixture.pure);
});

test('the off-chain verifier computes what it computed under the Ledger 8 runtime', () => {
    assert.deepEqual(current.offChain, fixture.offChain);
});

for (const name of Object.keys(fixture.ledger)) {
    test(`ledger ${name} holds what the Ledger 8 build wrote`, () => {
        assert.deepEqual(current.ledger[name], fixture.ledger[name]);
    });
}
