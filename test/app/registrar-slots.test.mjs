/**
 * The registrar allowlist is the one input to the deploy that cannot be
 * corrected afterwards.
 *
 * `allowedRegistrars` is written in the contract's constructor and nowhere
 * else: no circuit adds to it, so whatever four identities go in at deploy are
 * the only registrars that contract will ever recognise. The grant allows a
 * fixed number of deploys and the last one is in hand, so "we will fix it in
 * the next deploy" is not available.
 *
 * Two failures are worth catching here rather than on chain. A malformed id
 * fails loudly and is easy. A DUPLICATE does not: the ledger keeps the
 * allowlist in a Set, so pinning the same id twice is accepted, costs nothing
 * visible, and permanently reduces how many authorities the contract can ever
 * have. That is the one these tests exist for.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
    readRegistrarSlots, REGISTRAR_LABELS, REGISTRAR_ROLES
} from '../../scripts/lib/registrar-slots.mjs';

const dir = mkdtempSync(join(tmpdir(), 'vinpassport-regs-'));
const id = (n) => String(n).repeat(2).padEnd(64, '0').slice(0, 64);

/** Write an env file holding the given label -> id mapping. */
function fixture(name, ids, { eol = '\n' } = {}) {
    const path = join(dir, name);
    const lines = ['# fixture'];
    for (const [label, hex] of Object.entries(ids)) {
        lines.push(`VINPASSPORT_REGISTRAR_${label}_SECRET_HEX=${'f'.repeat(64)}`);
        lines.push(`VINPASSPORT_REGISTRAR_${label}_ID_HEX=${hex}`);
    }
    writeFileSync(path, lines.join(eol) + eol, 'utf8');
    return path;
}

const FOUR = { A: id(1), B: id(2), C: id(3), D: id(4) };

test('four distinct identities read back in slot order', () => {
    const { regs, slots } = readRegistrarSlots(fixture('ok.env', FOUR));

    assert.deepEqual(regs.map((r) => r.label), ['A', 'B', 'C', 'D']);
    assert.deepEqual(regs.map((r) => r.hex), [id(1), id(2), id(3), id(4)]);
    assert.equal(slots.length, 4, 'the constructor takes exactly four');
    for (const s of slots) {
        assert.ok(s instanceof Uint8Array);
        assert.equal(s.length, 32, 'each slot is Bytes<32>');
    }
});

/**
 * The important one. A duplicate is silently absorbed by the Set on chain, so
 * nothing downstream would complain: the deploy would succeed and the contract
 * would quietly have three authorities where it was meant to have four.
 */
test('a repeated identity is refused, because the Set would absorb it', () => {
    const path = fixture('dupe.env', { ...FOUR, D: id(2) });
    assert.throws(() => readRegistrarSlots(path), (e) => {
        assert.match(e.message, /share an identity/);
        assert.match(e.message, /3 of 4/, 'it should say how much the list actually shrank to');
        return true;
    });
});

test('every slot repeated is refused too, not just one', () => {
    const path = fixture('all-same.env', { A: id(7), B: id(7), C: id(7), D: id(7) });
    assert.throws(() => readRegistrarSlots(path), /1 of 4/);
});

test('a malformed or truncated id is refused', () => {
    // 'AB'.repeat(32) is 64 valid hex characters in the wrong case: the ids
    // are compared as strings elsewhere, so accepting both cases would let the
    // same identity be pinned twice without looking like a duplicate.
    for (const bad of ['', 'deadbeef', 'Z'.repeat(64), 'AB'.repeat(32)]) {
        const path = fixture(`bad-${bad.length}-${bad.slice(0, 2)}.env`, { ...FOUR, C: bad });
        assert.throws(() => readRegistrarSlots(path), /missing or malformed/,
            `"${bad.slice(0, 12)}" should not be accepted as an identity`);
    }
});

test('a missing label is refused, rather than quietly pinning three', () => {
    const { D, ...three } = FOUR;
    assert.throws(() => readRegistrarSlots(fixture('three.env', three)),
        /REGISTRAR_D_ID_HEX.*missing/);
});

test('a missing file says what to run', () => {
    assert.throws(() => readRegistrarSlots(join(dir, 'nope.env')),
        /make-registrar-secrets/);
});

test('CRLF is read the same as LF, since the file is edited on Windows', () => {
    const { regs } = readRegistrarSlots(fixture('crlf.env', FOUR, { eol: '\r\n' }));
    assert.deepEqual(regs.map((r) => r.hex), [id(1), id(2), id(3), id(4)]);
});

test('every pinned label has a stated role, so none is pinned without a reason', () => {
    for (const label of REGISTRAR_LABELS) {
        assert.ok(REGISTRAR_ROLES[label]?.length > 0,
            `registrar ${label} is pinned for the contract's lifetime with no role recorded`);
    }
});

/**
 * Not a style check. The constructor's parameter is `Vector<4, Bytes<32>>`, so
 * the label list and the contract have to agree on four; if one grows without
 * the other, the deploy fails at the last possible moment.
 */
test('the label list matches the arity the constructor takes', () => {
    assert.equal(REGISTRAR_LABELS.length, 4, 'constructor(registrars: Vector<4, Bytes<32>>)');
});
