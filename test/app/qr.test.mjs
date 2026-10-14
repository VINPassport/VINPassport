/**
 * The QR encoder, checked against frozen output from an independent
 * implementation.
 *
 * This matters more than most tests here. A QR code that does not scan is
 * worse than no QR code: the buyer standing next to the car gets nothing and
 * concludes the passport is broken. There is no barcode decoder available in
 * the browser this project drives, so the check is a module-for-module
 * comparison against reference output, frozen into test/fixtures so the
 * repository verifies itself without taking a dependency.
 *
 * Masks are forced in the bulk cases. Mask choice is a readability heuristic
 * and does not decide whether a symbol decodes; the two implementations read
 * one clause of it differently, which is written up at `penalty` in qr.mjs.
 * The cases that leave the mask to the encoder are the deep links the product
 * actually encodes, which is where agreement is worth having.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { encode, versionFor, toSvg } from '../../site/assets/qr.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REF = JSON.parse(readFileSync(join(HERE, '..', 'fixtures', 'qr-reference.json'), 'utf8'));

/** Unpack a base64 bit-packed matrix back into rows of 0 and 1. */
function unpack(bits, size) {
    const bytes = Buffer.from(bits, 'base64');
    const m = Array.from({ length: size }, () => new Array(size).fill(0));
    for (let i = 0; i < size * size; i++) {
        m[Math.floor(i / size)][i % size] = (bytes[i >> 3] >> (7 - (i & 7))) & 1;
    }
    return m;
}

const compare = (mine, theirs, label) => {
    assert.equal(mine.length, theirs.length, `${label}: wrong size`);
    let diff = 0;
    for (let r = 0; r < mine.length; r++) {
        for (let c = 0; c < mine.length; c++) if (mine[r][c] !== theirs[r][c]) diff++;
    }
    assert.equal(diff, 0, `${label}: ${diff} modules differ from the reference`);
};

test('every version and mask matches the reference, module for module', () => {
    assert.ok(REF.forced.length >= 80, 'the fixture should cover 10 versions by 8 masks');
    for (const c of REF.forced) {
        compare(encode(c.text, c.version, c.mask), unpack(c.bits, c.size),
            `v${c.version} mask ${c.mask}`);
    }
});

test('the links the product encodes match the reference, mask and all', () => {
    assert.ok(REF.auto.length >= 3, 'the fixture should carry the real deep links');
    for (const c of REF.auto) {
        assert.match(c.text, /^https:\/\/passport\.vin\/verify\/\?v=[0-9a-f]{64}$/,
            'the auto cases should be real passport links');
        assert.equal(versionFor(c.text), c.version, `${c.text}: wrong version chosen`);
        compare(encode(c.text), unpack(c.bits, c.size), c.text);
    }
});

test('a passport deep link fits well inside the supported range', () => {
    // 64 hex characters of VIN hash on the longest plausible origin. If this
    // ever needs a version above 10 the encoder throws rather than emitting
    // something wrong, so the headroom is worth asserting.
    const link = `https://passport.vin/verify/?v=${'f'.repeat(64)}`;
    const v = versionFor(link);
    assert.ok(v <= 7, `a passport link needs version ${v}, leaving little headroom`);
    const m = encode(link);
    assert.equal(m.length, v * 4 + 17);
});

test('the encoder refuses what it cannot encode rather than guessing', () => {
    assert.throws(() => versionFor('z'.repeat(400)), /more than this encoder handles/);
    assert.throws(() => encode('short', 99), /unsupported version/);
});

test('the fixed patterns are where a scanner looks for them', () => {
    const m = encode('https://passport.vin/verify/?v=' + 'a'.repeat(64));
    const n = m.length;
    // Three finders, each a 7x7 ring with a 3x3 core.
    for (const [r0, c0] of [[0, 0], [0, n - 7], [n - 7, 0]]) {
        assert.equal(m[r0][c0], 1, 'finder corner');
        assert.equal(m[r0 + 1][c0 + 1], 0, 'finder inner ring');
        assert.equal(m[r0 + 3][c0 + 3], 1, 'finder core');
    }
    // The timing patterns alternate, starting dark.
    for (let i = 8; i < n - 8; i++) {
        assert.equal(m[6][i], i % 2 === 0 ? 1 : 0, `horizontal timing at ${i}`);
        assert.equal(m[i][6], i % 2 === 0 ? 1 : 0, `vertical timing at ${i}`);
    }
    assert.equal(m[n - 8][8], 1, 'the always-dark module');
});

test('the svg carries a quiet zone and nothing executable', () => {
    const svg = toSvg('https://passport.vin/verify/?v=' + 'b'.repeat(64), { scale: 4, quiet: 4 });
    const m = encode('https://passport.vin/verify/?v=' + 'b'.repeat(64));
    const side = (m.length + 8) * 4;
    assert.ok(svg.includes(`width="${side}"`), 'the quiet zone is part of the drawing');
    assert.ok(svg.startsWith('<svg'), 'an svg element');
    // It gets inlined into pages, so it must be inert.
    assert.ok(!/<script|onload=|href=/i.test(svg), 'the svg should carry no script or link');
});
