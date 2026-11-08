/**
 * The committee handover transaction, built offline exactly as
 * scripts/maintenance.mjs builds it: the ledger accepts the shape, the
 * custody signature verifies over the update's own data, and the
 * transaction round-trips through bytes, which is how it crosses into the
 * wallet. Nothing touches a chain.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import {
    ContractMaintenanceAuthority, Intent, MaintenanceUpdate, ReplaceAuthority, Transaction,
    sampleSigningKey, signatureVerifyingKey, signData, verifySignature
} from '@midnightntwrk/ledger-v9';

const address = randomBytes(32).toString('hex');
const custody = sampleSigningKey('schnorr');
const members = [sampleSigningKey('schnorr'), sampleSigningKey('schnorr'), sampleSigningKey('ecdsa')];
const vks = members.map(signatureVerifyingKey);

function handover(counter) {
    const next = new ContractMaintenanceAuthority(vks, 2, counter + 1n);
    const unsigned = new MaintenanceUpdate(address, [new ReplaceAuthority(next)], counter);
    return { next, unsigned, signed: unsigned.addSignature(0n, signData(custody, unsigned.dataToSign)) };
}

test('the new authority is 2 of 3 with the counter one past the current one', () => {
    const { next } = handover(0n);
    assert.equal(next.threshold, 2);
    assert.equal(next.counter, 1n);
    assert.deepEqual(next.committee.map((k) => k.value), vks.map((k) => k.value));
});

test('Schnorr and ECDSA members sit in one committee', () => {
    assert.deepEqual(handover(0n).next.committee.map((k) => k.tag), ['schnorr', 'schnorr', 'ecdsa']);
});

test('the custody signature verifies over the update data, and only for the custody key', () => {
    const { unsigned } = handover(0n);
    const sig = signData(custody, unsigned.dataToSign);
    assert.ok(verifySignature(signatureVerifyingKey(custody), unsigned.dataToSign, sig));
    assert.ok(!verifySignature(vks[0], unsigned.dataToSign, sig));
});

test('the data to sign changes with the counter, so a signed update cannot be replayed later', () => {
    assert.notDeepEqual(handover(0n).unsigned.dataToSign, handover(1n).unsigned.dataToSign);
});

test('the update rides in an intent and the transaction round-trips through bytes', () => {
    const { signed } = handover(0n);
    const tx = Transaction.fromParts('preview', undefined, undefined,
        Intent.new(new Date(Date.now() + 30 * 60_000)).addMaintenanceUpdate(signed));
    const bytes = tx.serialize();
    assert.ok(bytes.length > 0);
    const back = Transaction.deserialize('signature', 'pre-proof', 'pre-binding', bytes);
    assert.deepEqual(back.serialize(), bytes);
});
