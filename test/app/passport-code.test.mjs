/**
 * The typed passport code: its shape, its check character, and the rule that
 * a code which matches no passport, or more than one, never opens a verdict.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALPHABET, CODE_RE, dataCharsOf, passportCode, parseCode, resolveCode } from '../../site/assets/passport-code.mjs';
import { vinHashHex } from '../../site/assets/blake2b.mjs';

// Real-shaped keys: the demo derives vehicle keys this way.
const KEYS = ['WVWZZZ1KZAW000001', 'WBA8E1C50JA000002', 'VF1RFB00X61000003'].map(vinHashHex);

test('a code has the printed shape and comes from the key alone', () => {
    for (const key of KEYS) {
        const code = passportCode(key);
        assert.match(code, CODE_RE);
        assert.equal(passportCode(key.toUpperCase()), code, 'case of the key does not matter');
        assert.equal(code.replace(/-/g, '').slice(2, 9), dataCharsOf(key));
    }
});

test('the seven data characters are the first 35 bits of the key', () => {
    const key = 'f'.repeat(64);
    assert.equal(dataCharsOf(key), 'ZZZZZZZ');
    assert.equal(dataCharsOf('0'.repeat(64)), '0000000');
    // 0x0800000000 >> 5 = 2^30, the top data bit is the 35th bit of the key
    assert.equal(dataCharsOf('08' + '0'.repeat(62)), '1000000');
    assert.throws(() => dataCharsOf('xyz'), /64 hexadecimal/);
});

test('every printed code parses back to itself', () => {
    for (const key of KEYS) {
        const code = passportCode(key);
        const parsed = parseCode(code);
        assert.equal(parsed.error, undefined, parsed.error);
        assert.equal(parsed.code, code);
        assert.equal(parsed.data, dataCharsOf(key));
    }
});

test('the forgiving parts: case, spaces, dashes, the prefix, O for 0, I and L for 1', () => {
    const code = passportCode(KEYS[0]);
    const bare = code.slice(3).replace('-', '');
    const variants = [
        code.toLowerCase(),
        ` ${code} `,
        bare,
        bare.replace(/(.{4})/, '$1 '),
        'vp ' + bare,
        code.replace(/0/g, 'O'),
        code.replace(/1/g, 'l'),
        code.replace(/1/g, 'I')
    ];
    for (const v of variants) assert.equal(parseCode(v).code, code, `read "${v}"`);
});

test('every single mistyped character is caught before any lookup', () => {
    for (const key of KEYS) {
        const chars = passportCode(key).slice(3).replace('-', '');
        for (let i = 0; i < chars.length; i += 1) {
            for (const c of ALPHABET) {
                if (c === chars[i]) continue;
                const typo = chars.slice(0, i) + c + chars.slice(i + 1);
                assert.ok(parseCode(typo).error, `${typo} (position ${i}) must not parse`);
            }
        }
    }
});

test('swapping two neighbours is caught, except 0 with Z, as Luhn mod 32 implies', () => {
    // Exhaustive over every pair of distinct values, in a code where they sit side by side.
    let missed = [];
    for (const a of ALPHABET) {
        for (const b of ALPHABET) {
            if (a === b) continue;
            const data = `${a}${b}00000`;
            const code = passportCode(keyWithData(data));
            assert.equal(code.slice(3, 5), `${a}${b}`, 'test setup: the key spells the data');
            const chars = code.slice(3).replace('-', '');
            const swapped = chars[1] + chars[0] + chars.slice(2);
            if (!parseCode(swapped).error) missed.push(`${a}${b}`);
        }
    }
    missed = missed.sort();
    assert.deepEqual(missed, ['0Z', 'Z0']);
});

/** A key whose first 35 bits spell `data` (seven base32 characters). */
function keyWithData(data) {
    const bits = [...data].reduce((n, c) => (n << 5n) | BigInt(ALPHABET.indexOf(c)), 0n) << 5n;
    return bits.toString(16).padStart(10, '0') + '0'.repeat(54);
}

test('wrong length, stray characters and an empty box get plain answers', () => {
    assert.match(parseCode('').error, /Type the passport code first/);
    assert.match(parseCode('VP-123').error, /eight characters after VP/);
    assert.match(parseCode('VP-1234-56789').error, /eight characters after VP/);
    assert.match(parseCode('VP-12U4-5678').error, /never contains U/);
});

test('a code resolves to its passport, to nothing, or to a refusal when shared', () => {
    const parsed = parseCode(passportCode(KEYS[1]));
    assert.deepEqual(resolveCode(parsed, KEYS), { key: KEYS[1] });

    const elsewhere = parseCode(passportCode('ab'.repeat(32)));
    assert.deepEqual(resolveCode(elsewhere, KEYS), { none: true });

    // Two keys that share their first 35 bits share a code: refuse, open neither.
    const twin = KEYS[1].slice(0, 9) + (KEYS[1][9] === '0' ? '1' : '0') + KEYS[1].slice(10);
    assert.equal(dataCharsOf(twin), dataCharsOf(KEYS[1]), 'test setup: the twin shares the code');
    const shared = resolveCode(parsed, [...KEYS, twin]);
    assert.deepEqual(shared.ambiguous?.sort(), [KEYS[1], twin].sort());
    assert.equal(shared.key, undefined);
});
