/**
 * The ledger a browser keeps for itself, when there is no server to keep it.
 *
 * On the published site the intake console has nowhere to post, so it runs
 * the circuits in the tab and leaves the result here for /verify/ to read.
 * That makes storage a load-bearing part of the product rather than a
 * convenience, and storage is the least reliable thing a browser offers:
 * it throws in private windows, it throws with site data blocked, and it
 * throws on quota. Every one of those has to read as "no local ledger"
 * rather than as an exception, because the visitor who blocks site data is
 * exactly the visitor this project is built for.
 *
 * The other half is that sessionStorage is shared with everything else on
 * the origin and survives a deploy, so what comes back is untrusted input.
 * A snapshot that is not ours must be ignored, and ignored once, not re-read
 * and re-rejected on every page load.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    saveLocalLedger, loadLocalLedger, clearLocalLedger, hasLocalLedger
} from '../../site/assets/local-ledger.mjs';

/** A sessionStorage good enough to test against, and bendable into failing. */
const fakeStorage = ({ failWrites = false, failReads = false } = {}) => {
    const map = new Map();
    return {
        getItem(k) { if (failReads) throw new DOMException('denied'); return map.get(k) ?? null; },
        setItem(k, v) { if (failWrites) throw new DOMException('quota'); map.set(k, v); },
        removeItem(k) { map.delete(k); },
        get size() { return map.size; },
        raw: map
    };
};

/** The shape exportLedger produces, trimmed to what the guard checks. */
const ledger = (extra = {}) => ({
    passports: { aa: 'bb' },
    registrar: { aa: 'cc' },
    fieldCommitment: { dd: 'ee' },
    fieldRule: { dd: 0 },
    fieldWriter: { dd: 'cc' },
    claims: [],
    relClaims: [],
    ...extra
});

test('a saved ledger comes back', () => {
    const storage = fakeStorage();
    assert.equal(saveLocalLedger(ledger(), { vehicles: [{ vinHash: 'aa', title: 'Added' }], storage }), true);
    const got = loadLocalLedger({ storage });
    assert.deepEqual(got.ledger.passports, { aa: 'bb' });
    assert.deepEqual(got.vehicles, [{ vinHash: 'aa', title: 'Added' }]);
    assert.ok(Date.parse(got.savedAt), 'savedAt must be a real timestamp');
});

test('nothing stored reads as nothing, not as an error', () => {
    assert.equal(loadLocalLedger({ storage: fakeStorage() }), null);
    assert.equal(hasLocalLedger({ storage: fakeStorage() }), false);
});

test('storage that refuses to be read degrades to no ledger', () => {
    // A private window, or site data blocked. The page must still render.
    assert.equal(loadLocalLedger({ storage: fakeStorage({ failReads: true }) }), null);
});

test('storage that refuses to be written says so, and does not pretend', () => {
    // Quota, or storage disabled between load and now. The caller has to be
    // able to tell the visitor, because a silent false success means they
    // press register, see it work, and find nothing on the next page.
    assert.equal(saveLocalLedger(ledger(), { storage: fakeStorage({ failWrites: true }) }), false);
});

test('no storage at all is a null result, never a throw', () => {
    // Injected null stands in for an environment with no sessionStorage.
    assert.equal(saveLocalLedger(ledger(), { storage: null }), false,
        'with no storage the save has to report failure');
});

test('someone else at this origin using our key is ignored', () => {
    const storage = fakeStorage();
    storage.setItem('vinpassport:ledger:v1', JSON.stringify({ ledger: { hello: 'world' } }));
    assert.equal(loadLocalLedger({ storage }), null);
});

test('an unusable entry is dropped, not re-read on every page load', () => {
    const storage = fakeStorage();
    storage.setItem('vinpassport:ledger:v1', 'not json at all');
    assert.equal(loadLocalLedger({ storage }), null);
    // Unparseable input is left alone: it is not ours to delete, and it
    // costs one failed JSON.parse. A snapshot that IS shaped like a stored
    // entry but holds the wrong thing is ours, and is cleared.
    storage.setItem('vinpassport:ledger:v1', JSON.stringify({ ledger: { passports: 'not an object' } }));
    assert.equal(loadLocalLedger({ storage }), null);
    assert.equal(storage.raw.has('vinpassport:ledger:v1'), false,
        'a snapshot we recognise as unusable must be removed, or every load pays for it again');
});

test('an empty ledger is a real answer, not a missing one', () => {
    // A vehicle can be registered with no fields yet. That is a legitimate
    // snapshot and must survive the shape check.
    const storage = fakeStorage();
    saveLocalLedger(ledger({ passports: {}, fieldCommitment: {} }), { storage });
    assert.ok(loadLocalLedger({ storage }), 'an empty ledger was mistaken for a corrupt one');
});

test('clearing means the next page falls back to the demo export', () => {
    const storage = fakeStorage();
    saveLocalLedger(ledger(), { storage });
    assert.equal(hasLocalLedger({ storage }), true);
    clearLocalLedger({ storage });
    assert.equal(loadLocalLedger({ storage }), null);
});

test('the key carries a version, so a shape change cannot be misread', () => {
    const storage = fakeStorage();
    saveLocalLedger(ledger(), { storage });
    assert.deepEqual([...storage.raw.keys()], ['vinpassport:ledger:v1']);
});
