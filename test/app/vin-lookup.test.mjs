/**
 * Looking a vehicle up by VIN, and the thing that has to happen when it is
 * not found.
 *
 * The page used to resolve an unknown identifier to `vins[0]`, so asking for
 * a vehicle the ledger does not hold rendered a different vehicle's verdict,
 * with nothing saying so. That survived only because every entry point was a
 * QR code carrying a key that existed. A box someone types into makes the
 * miss the common case: most VINs typed anywhere will have no passport.
 *
 * Showing a stranger a clean verdict belonging to another car is the single
 * worst thing this product could do, so the absence of that fallback is
 * asserted here as well as the parser's behaviour.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseEntry } from '../../site/assets/vin.mjs';
import { vinHashHex } from '../../site/assets/blake2b.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = join(HERE, '..', '..', 'site');
const GOLF = 'WVWZZZ1JZXW000001';
const GOLF_KEY = '391ce048e0feacde85e7978c2c8320b3763a6c5ed5b2aacc7ca524469bafe357';

test('a VIN becomes the key its passport is stored under', () => {
    const r = parseEntry(GOLF);
    assert.equal(r.key, GOLF_KEY);
    assert.equal(r.vin, GOLF);
    assert.equal(r.error, undefined);
});

test('a VIN as a person actually types it', () => {
    // Lower case, leading and trailing space, the spaces that appear when a
    // VIN is read out in groups, and the dashes someone adds to help.
    for (const typed of [
        '  WVWZZZ1JZXW000001  ',
        'wvwzzz1jzxw000001',
        'WVW ZZZ1 JZXW 000001',
        'wvw-zzz1jzxw-000001',
    ]) {
        assert.equal(parseEntry(typed).key, GOLF_KEY, `${JSON.stringify(typed)} did not resolve`);
    }
});

test('our own identifiers are accepted, in every form we hand out', () => {
    // The hash on its own, as the QR encodes it.
    assert.equal(parseEntry(GOLF_KEY).key, GOLF_KEY);
    assert.equal(parseEntry(GOLF_KEY).vin, null, 'a hash reveals no VIN and must not claim one');
    // The whole link, pasted, which is what people do with a link.
    assert.equal(parseEntry(`https://passport.vin/verify/?v=${GOLF_KEY}`).key, GOLF_KEY);
    assert.equal(parseEntry(`PASSPORT.VIN/VERIFY/?V=${GOLF_KEY.toUpperCase()}`).key, GOLF_KEY);
});

test('a refusal says which character is wrong, not just that it is', () => {
    // I, O and Q are not in the VIN alphabet precisely because they are
    // misread as 1 and 0, so the message names that rather than the rule.
    const io = parseEntry('WVWZZZ1JZXW00000O');
    assert.ok(io.error && /I, O or Q/.test(io.error), io.error);
    assert.equal(io.key, undefined, 'a refused entry must not also produce a key');

    const short = parseEntry('WVWZZZ1');
    assert.ok(short.error && /seventeen characters and this is 7/.test(short.error), short.error);

    const empty = parseEntry('   ');
    assert.ok(empty.error && /Type a VIN first/.test(empty.error), empty.error);

    for (const nothing of [undefined, null, '']) {
        assert.ok(parseEntry(nothing).error, `${nothing} should be refused, not thrown on`);
    }
});

test('two different VINs never produce the same key', () => {
    const seen = new Map();
    for (const vin of [GOLF, 'WAUZZZ8V5KA000002', 'WVWZZZ1JZXW000002', 'WVWZZZ1JZXW000011']) {
        const { key } = parseEntry(vin);
        assert.ok(!seen.has(key), `${vin} collided with ${seen.get(key)}`);
        seen.set(key, vin);
        assert.equal(key, vinHashHex(vin));
    }
});

test('the page cannot answer with a vehicle nobody asked for', () => {
    const js = readFileSync(join(SITE, 'verify', 'verify.js'), 'utf8');

    // The exact expression that caused it. Spelling is checked loosely so a
    // reformat does not let it back in unnoticed.
    assert.ok(!/ledger\.passports\[asked\]\s*\?\s*asked\s*:\s*vins\[0\]/.test(
        js.replace(/missed\s*\?[^;]*/g, '')),
        'an unknown identifier falls back to the first passport again');

    assert.match(js, /const missed = asked && !ledger\.passports\[asked\]/,
        'nothing detects an identifier that was asked for and not found');
    assert.match(js, /notFoundSection\(missed, null\)/,
        'a miss does not render the not-found section');

    // The wording is load-bearing: "no passport" must not read as a verdict.
    assert.match(js, /This is not a verdict on the vehicle/,
        'the not-found section no longer says it is not a verdict');
    assert.match(js, /No passport for this vehicle/, 'the not-found heading is gone');
});

test('the VIN never reaches the address bar, and the page says so', () => {
    const js = readFileSync(join(SITE, 'verify', 'verify.js'), 'utf8');
    // Both navigations carry the key. If either ever carried `vin` the VIN
    // would end up in history, in logs and in anything the page links to.
    for (const m of js.matchAll(/location\.search = ([^;]+);/g)) {
        assert.equal(m[1].trim(), "'?v=' + key", `navigates with ${m[1]}`);
    }
    for (const m of js.matchAll(/history\.replaceState\([^)]*\)/g)) {
        assert.match(m[0], /'\?v=' \+ key/, `rewrites the address with ${m[0]}`);
    }
    assert.match(js, /hashed <b>in this browser<\/b>/,
        'the page no longer tells the reader where their VIN goes');
});
