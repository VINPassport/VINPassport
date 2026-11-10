/**
 * The passport code a person types, such as VP-G724-782P (a demo key).
 *
 * The QR code on a vehicle carries the full 64-character vehicle key, so a
 * scan never depends on this. The short code exists for the other case: a
 * listing, a phone call, a code read off a sticker and typed in by hand.
 *
 *   shape    "VP-" and eight characters in two groups of four, in Crockford
 *            base32: digits and letters, but never I, L, O or U, so no
 *            character reads as another.
 *   content  the first seven characters are the first 35 bits of the vehicle
 *            key; the eighth is a check character (Luhn mod 32). Any single
 *            mistyped character is caught before a lookup, and so is every
 *            swap of two neighbours except 0 with Z.
 *   lookup   vehicle keys are public on the ledger, so a code is resolved
 *            against them in the browser: no lookup table, no server, and
 *            nothing revealed that the ledger does not already show.
 *
 * The one rule that matters, the same as vin.mjs: a code that matches no
 * passport, or more than one, never opens a verdict. Showing a stranger the
 * answers for a different car is the worst thing this product could do.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/** Crockford's base32 alphabet. */
export const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const N = ALPHABET.length; // 32
const DATA_CHARS = 7; // 35 bits of the key
const KEY_RE = /^[0-9a-f]{64}$/;

/** The canonical printed form. */
export const CODE_RE = /^VP-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/** Luhn mod N over code-point values, right to left; `startFactor` 2 to make a check, 1 to verify. */
function luhnSum(values, startFactor) {
    let factor = startFactor;
    let sum = 0;
    for (let i = values.length - 1; i >= 0; i -= 1) {
        let addend = factor * values[i];
        factor = factor === 2 ? 1 : 2;
        addend = Math.floor(addend / N) + (addend % N);
        sum += addend;
    }
    return sum % N;
}

const checkValue = (values) => (N - luhnSum(values, 2)) % N;

/** The seven data characters for a vehicle key: its first 35 bits. */
export function dataCharsOf(keyHex) {
    const key = String(keyHex ?? '').toLowerCase();
    if (!KEY_RE.test(key)) throw new Error('a vehicle key is 64 hexadecimal characters');
    let bits = BigInt('0x' + key.slice(0, 10)) >> 5n; // 40 bits, keep the top 35
    let out = '';
    for (let i = 0; i < DATA_CHARS; i += 1) {
        out = ALPHABET[Number(bits & 31n)] + out;
        bits >>= 5n;
    }
    return out;
}

/** The printed passport code for a vehicle key. */
export function passportCode(keyHex) {
    const data = dataCharsOf(keyHex);
    const check = ALPHABET[checkValue([...data].map((c) => ALPHABET.indexOf(c)))];
    const all = data + check;
    return `VP-${all.slice(0, 4)}-${all.slice(4)}`;
}

/**
 * What someone typed, read as a passport code.
 *
 * Forgiving where people are predictably sloppy (case, spaces, dashes, the
 * prefix, O for 0, I or L for 1) and strict where it matters: the length and
 * the check character.
 *
 * @param {string} typed
 * @returns {{code: string, data: string} | {error: string}}
 */
export function parseCode(typed) {
    let entry = String(typed ?? '').trim().toUpperCase().replace(/[\s\-_.]/g, '');
    if (!entry) {
        return { error: 'Type the passport code first. It starts with VP and has eight characters after it, printed under the QR code.' };
    }
    if (entry.startsWith('VP')) entry = entry.slice(2);
    entry = entry.replace(/O/g, '0').replace(/[IL]/g, '1');

    const stray = [...entry].find((c) => !ALPHABET.includes(c));
    if (stray) {
        return { error: `A passport code never contains ${stray}. It uses digits and the letters A to Z without I, L, O and U.` };
    }
    if (entry.length !== DATA_CHARS + 1) {
        return { error: `A passport code has eight characters after VP, and that has ${entry.length}.` };
    }
    const values = [...entry].map((c) => ALPHABET.indexOf(c));
    if (luhnSum(values, 1) !== 0) {
        return { error: 'One character of that code is mistyped: it does not add up. Check it against the code on the vehicle or the listing.' };
    }
    return { code: `VP-${entry.slice(0, 4)}-${entry.slice(4)}`, data: entry.slice(0, DATA_CHARS) };
}

/**
 * A parsed code against the vehicle keys a ledger holds.
 *
 * @param {{data: string}} parsed  a successful parseCode result
 * @param {Iterable<string>} keys  the ledger's vehicle keys (64-hex)
 * @returns {{key: string} | {none: true} | {ambiguous: string[]}}
 */
export function resolveCode(parsed, keys) {
    const hits = [];
    for (const key of keys) {
        if (KEY_RE.test(String(key).toLowerCase()) && dataCharsOf(key) === parsed.data) hits.push(String(key).toLowerCase());
    }
    if (hits.length === 1) return { key: hits[0] };
    if (hits.length === 0) return { none: true };
    return { ambiguous: hits };
}
