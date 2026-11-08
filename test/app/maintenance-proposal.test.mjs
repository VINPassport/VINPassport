/**
 * Committee proposals (scripts/lib/maintenance9.mjs), offline.
 *
 * The properties that matter: a member signs exactly what the proposal says,
 * any edit after signing kills every signature, only committee members can
 * sign, the threshold is enforced, and a proposal is dead once the chain's
 * counter moves. Nothing here touches a chain.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Intent, Transaction, sampleSigningKey, signatureVerifyingKey } from '@midnightntwrk/ledger-v9';
import {
    makeProposal, insertVerifierKey, removeVerifierKey, replaceAuthority, validateProposal, buildUpdate,
    fingerprint, describe, signProposal, checkSignatures, signedUpdate
} from '../../scripts/lib/maintenance9.mjs';
import { BUILD_DIR } from '../../scripts/lib/contract9.mjs';

const members = [sampleSigningKey('schnorr'), sampleSigningKey('schnorr'), sampleSigningKey('ecdsa')];
const authority = { committee: members.map(signatureVerifyingKey), threshold: 2, counter: 1n };
const address = randomBytes(32).toString('hex');
// A real ledger 9 verifier key from the committed build, so the ledger's own
// parser accepts it.
const vk = readFileSync(join(BUILD_DIR, 'keys', 'registerPassport.verifier'));

const proposal = (updates = [insertVerifierKey('passportOf', vk)]) =>
    makeProposal({ network: 'preview', contractAddress: address, authority, updates, title: 'test' });

test('a proposal rebuilds the same update every time, and its fingerprint covers the key bytes', () => {
    const p = proposal();
    assert.deepEqual(buildUpdate(p).dataToSign, buildUpdate(structuredClone(p)).dataToSign);
    assert.equal(p.dataToSignSha256, fingerprint(p));
    assert.ok(buildUpdate(p).dataToSign.length > vk.length, 'the key is inside what is signed');
    assert.match(describe(p), /insert verifier key {2}passportOf \(v4\)/);
});

test('two of three sign, schnorr and ecdsa alike, and the update carries both signatures', () => {
    let p = signProposal(proposal(), members[0], 'one');
    p = signProposal(p, members[2], 'three');
    const { valid, enough } = checkSignatures(p);
    assert.equal(valid.length, 2);
    assert.ok(enough);
    const update = signedUpdate(p, authority);
    assert.deepEqual(update.signatures.map(([i]) => i), [0n, 2n]);
    const tx = Transaction.fromParts('preview', undefined, undefined,
        Intent.new(new Date(Date.now() + 30 * 60_000)).addMaintenanceUpdate(update));
    const bytes = tx.serialize();
    assert.deepEqual(Transaction.deserialize('signature', 'pre-proof', 'pre-binding', bytes).serialize(), bytes);
});

test('one signature is not enough', () => {
    const p = signProposal(proposal(), members[1]);
    assert.equal(checkSignatures(p).enough, false);
    assert.throws(() => signedUpdate(p, authority), /1 valid signature\(s\), 2 needed/);
});

test('signing twice as the same member still counts once', () => {
    let p = signProposal(proposal(), members[0]);
    p = signProposal(p, members[0]);
    assert.equal(p.signatures.length, 1);
    p = { ...p, signatures: [...p.signatures, { ...p.signatures[0] }] };
    const r = checkSignatures(p);
    assert.equal(r.valid.length, 1);
    assert.match(r.invalid[0].why, /same member/);
});

test('a key outside the committee cannot sign', () => {
    assert.throws(() => signProposal(proposal(), sampleSigningKey('schnorr')), /not a member/);
});

test('editing the key after signing kills every signature', () => {
    let p = signProposal(signProposal(proposal(), members[0]), members[1]);
    const other = readFileSync(join(BUILD_DIR, 'keys', 'recordField.verifier'));
    const swapped = insertVerifierKey('passportOf', other);
    p = { ...p, updates: [swapped] };
    const r = checkSignatures(p);
    assert.equal(r.valid.length, 0);
    assert.equal(r.invalid.length, 2);
    assert.throws(() => signedUpdate(p, authority), /0 valid signature/);
});

test('a key whose bytes do not match its stated hash is refused before anything is signed', () => {
    const u = insertVerifierKey('passportOf', vk);
    assert.throws(() => proposal([{ ...u, vkSha256: '00'.repeat(32) }]), /do not match vkSha256/, 'not even proposed');
    const edited = { ...proposal(), updates: [{ ...u, vkSha256: '00'.repeat(32) }] };
    assert.throws(() => validateProposal(edited), /do not match vkSha256/, 'nor signed or submitted after an edit');
    assert.throws(() => signProposal(edited, members[0]), /do not match vkSha256/);
});

test('once the chain counter moves, the proposal is dead', () => {
    const p = signProposal(signProposal(proposal(), members[0]), members[1]);
    assert.throws(() => signedUpdate(p, { ...authority, counter: 2n }), /counter is 2, the proposal was made against 1/);
    const moved = { ...p, counter: '2' };
    assert.equal(checkSignatures(moved).valid.length, 0, 'a counter edit invalidates the signatures too');
});

test('a different committee on chain is refused', () => {
    const p = signProposal(signProposal(proposal(), members[0]), members[1]);
    const otherCommittee = { ...authority, committee: [authority.committee[0], authority.committee[1], signatureVerifyingKey(sampleSigningKey())] };
    assert.throws(() => signedUpdate(p, otherCommittee), /committee is not the one/);
});

test('a replacement authority takes the next counter', () => {
    const next = [sampleSigningKey(), sampleSigningKey(), sampleSigningKey()].map(signatureVerifyingKey);
    const p = proposal([replaceAuthority(next, 2)]);
    const u = buildUpdate(p);
    assert.equal(u.updates[0].authority.counter, 2n);
    assert.equal(u.updates[0].authority.threshold, 2);
});

test('removals build, and duplicate circuit instructions are refused', () => {
    assert.doesNotThrow(() => buildUpdate(proposal([removeVerifierKey('passportOf')])));
    assert.throws(() => validateProposal(proposal([insertVerifierKey('passportOf', vk), insertVerifierKey('passportOf', vk)])), /appears twice/);
});
