/**
 * The browser's BLAKE2b has to agree with the project's, exactly, for ever.
 *
 * `site/assets/blake2b.mjs` turns a typed VIN into the key a passport is
 * stored under. `scripts/lib/disclosure.mjs` does the same job everywhere
 * else, from @noble/hashes. If the two ever disagree by one bit, a lookup
 * finds nothing and the page says "no passport for this vehicle" about a
 * vehicle that has one. That failure is indistinguishable, from the outside,
 * from a car with no record, which is the one answer this product must never
 * get wrong.
 *
 * So: both implementations, same inputs, byte for byte. Plus the two demo
 * vehicles, whose hashes are fixed on a public ledger and in the committed
 * demo state, so this also catches the day someone changes the derivation.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { blake2b as noble } from '@noble/hashes/blake2';
import { blake2b, hex, vinHashHex } from '../../site/assets/blake2b.mjs';

const utf8 = (s) => new TextEncoder().encode(s);
const ref = (bytes, len = 32) => hex(noble(bytes, { dkLen: len }));

test('agrees with @noble/hashes on the empty input', () => {
    assert.equal(hex(blake2b(utf8(''))), ref(utf8('')));
});

test('agrees across every boundary a 128-byte block creates', () => {
    // 127, 128 and 129 are where a block-based hash goes wrong: the last block
    // is special, an exactly-full message still needs one, and the counter is
    // the total length rather than a multiple of the block size.
    for (const n of [1, 63, 64, 111, 127, 128, 129, 191, 255, 256, 257, 1000]) {
        const bytes = new Uint8Array(n).map((_, i) => (i * 37 + 11) & 0xff);
        assert.equal(hex(blake2b(bytes)), ref(bytes), `length ${n} disagrees`);
    }
});

test('agrees on two hundred random inputs', () => {
    let seed = 0x2b7e1516;
    const rand = () => {
        // xorshift, so a failure is reproducible from the seed above.
        seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
        return (seed >>> 0) / 0x100000000;
    };
    for (let i = 0; i < 200; i++) {
        const bytes = new Uint8Array(Math.floor(rand() * 300)).map(() => Math.floor(rand() * 256));
        assert.equal(hex(blake2b(bytes)), ref(bytes), `random input ${i} disagrees`);
    }
});

test('agrees at every output length the module allows', () => {
    const bytes = utf8('WVWZZZ1JZXW000001');
    for (const len of [1, 16, 20, 31, 32, 33, 48, 64]) {
        assert.equal(hex(blake2b(bytes, len)), ref(bytes, len), `output length ${len} disagrees`);
    }
    assert.throws(() => blake2b(bytes, 0), RangeError);
    assert.throws(() => blake2b(bytes, 65), RangeError);
    assert.throws(() => blake2b('not bytes'), TypeError);
});

test('the two demo VINs still key the two passports on the ledger', async () => {
    // Read from the committed state rather than restated here: if the demo is
    // regenerated under different VINs, this should fail rather than pass
    // against a constant nobody updated.
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, join } = await import('node:path');
    const here = dirname(fileURLToPath(import.meta.url));
    const ledger = JSON.parse(
        readFileSync(join(here, '..', '..', 'site', 'verify', 'demo-data.json'), 'utf8'));
    const keys = Object.keys(ledger.passports);

    for (const vin of ['WVWZZZ1JZXW000001', 'WAUZZZ8V5KA000002']) {
        const h = vinHashHex(vin);
        assert.ok(keys.includes(h),
            `${vin} hashes to ${h.slice(0, 16)}..., which is not a passport on the demo ledger`);
    }
    // And a VIN that was never registered must not accidentally land on one.
    assert.ok(!keys.includes(vinHashHex('WVWZZZ1JZXW000002')),
        'an unregistered VIN collided with a passport');
});
