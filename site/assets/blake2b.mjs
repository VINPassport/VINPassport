/**
 * BLAKE2b-256, in the browser, with no dependencies.
 *
 * A passport is keyed by `blake2b-256(VIN)`, so looking one up by VIN means
 * computing that hash. The alternative is sending the VIN to a server to be
 * hashed, and there is no server: the site is static, and a VIN typed into a
 * verification page is the one piece of information the person reading it may
 * not want to hand over. So it is computed here and the VIN never leaves the
 * tab.
 *
 * WebCrypto cannot do this. `SubtleCrypto.digest` offers SHA-1 and the SHA-2
 * family and nothing else, and BLAKE2 is not in the Web Crypto algorithm
 * registry. Hence this file.
 *
 * Written against RFC 7693. BigInt rather than 32-bit halves: the message is a
 * seventeen character VIN, so this runs once per lookup and clarity is worth
 * more than speed. `test/app/blake2b.test.mjs` checks it against the
 * implementation the rest of the project uses, over the empty string, every
 * length that straddles a block boundary, and two hundred random inputs.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

const MASK = (1n << 64n) - 1n;

/** RFC 7693 section 2.6: the first 64 bits of the fractional parts of the
 *  square roots of the first eight primes. */
const IV = [
    0x6a09e667f3bcc908n, 0xbb67ae8584caa73bn, 0x3c6ef372fe94f82bn, 0xa54ff53a5f1d36f1n,
    0x510e527fade682d1n, 0x9b05688c2b3e6c1fn, 0x1f83d9abfb41bd6bn, 0x5be0cd19137e2179n,
];

/** The message word schedule, ten permutations of 0..15, rounds 11 and 12
 *  repeating the first two (RFC 7693 section 2.7). */
const SIGMA = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
    [11, 8, 12, 0, 5, 2, 15, 13, 10, 14, 3, 6, 7, 1, 9, 4],
    [7, 9, 3, 1, 13, 12, 11, 14, 2, 6, 5, 10, 4, 0, 15, 8],
    [9, 0, 5, 7, 2, 4, 10, 15, 14, 1, 11, 12, 6, 8, 3, 13],
    [2, 12, 6, 10, 0, 11, 8, 3, 4, 13, 7, 5, 15, 14, 1, 9],
    [12, 5, 1, 15, 14, 13, 4, 10, 0, 7, 6, 3, 9, 2, 8, 11],
    [13, 11, 7, 14, 12, 1, 3, 9, 5, 0, 15, 4, 8, 6, 2, 10],
    [6, 15, 14, 9, 11, 3, 0, 8, 12, 2, 13, 7, 1, 4, 10, 5],
    [10, 2, 8, 4, 7, 6, 1, 5, 15, 11, 9, 14, 3, 12, 13, 0],
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
    [14, 10, 4, 8, 9, 15, 13, 6, 1, 12, 0, 2, 11, 7, 5, 3],
];

const rotr = (x, n) => ((x >> n) | (x << (64n - n))) & MASK;

/** The G mixing function, RFC 7693 section 3.1. */
function mix(v, a, b, c, d, x, y) {
    v[a] = (v[a] + v[b] + x) & MASK;
    v[d] = rotr(v[d] ^ v[a], 32n);
    v[c] = (v[c] + v[d]) & MASK;
    v[b] = rotr(v[b] ^ v[c], 24n);
    v[a] = (v[a] + v[b] + y) & MASK;
    v[d] = rotr(v[d] ^ v[a], 16n);
    v[c] = (v[c] + v[d]) & MASK;
    v[b] = rotr(v[b] ^ v[c], 63n);
}

/** Compress one 128-byte block. `t` is the byte count INCLUDING this block. */
function compress(h, block, t, last) {
    const v = [...h, ...IV];
    v[12] ^= t & MASK;
    v[13] ^= (t >> 64n) & MASK;
    if (last) v[14] ^= MASK;

    // The block as sixteen little-endian 64-bit words.
    const m = [];
    for (let i = 0; i < 16; i++) {
        let w = 0n;
        for (let j = 7; j >= 0; j--) w = (w << 8n) | BigInt(block[i * 8 + j]);
        m.push(w);
    }

    for (let r = 0; r < 12; r++) {
        const s = SIGMA[r];
        mix(v, 0, 4, 8, 12, m[s[0]], m[s[1]]);
        mix(v, 1, 5, 9, 13, m[s[2]], m[s[3]]);
        mix(v, 2, 6, 10, 14, m[s[4]], m[s[5]]);
        mix(v, 3, 7, 11, 15, m[s[6]], m[s[7]]);
        mix(v, 0, 5, 10, 15, m[s[8]], m[s[9]]);
        mix(v, 1, 6, 11, 12, m[s[10]], m[s[11]]);
        mix(v, 2, 7, 8, 13, m[s[12]], m[s[13]]);
        mix(v, 3, 4, 9, 14, m[s[14]], m[s[15]]);
    }

    for (let i = 0; i < 8; i++) h[i] ^= v[i] ^ v[i + 8];
}

/**
 * @param {Uint8Array} input
 * @param {number} outLen bytes, 1 to 64. 32 for the VIN key.
 * @returns {Uint8Array}
 */
export function blake2b(input, outLen = 32) {
    if (!(input instanceof Uint8Array)) throw new TypeError('blake2b takes bytes');
    if (!Number.isInteger(outLen) || outLen < 1 || outLen > 64) {
        throw new RangeError('blake2b output must be 1 to 64 bytes');
    }

    const h = [...IV];
    // Parameter block, unkeyed: digest length in the low byte, fanout and
    // depth both 1.
    h[0] ^= 0x01010000n ^ BigInt(outLen);

    // Every block but the last is compressed with `last` false. An empty
    // message is one zero block with a byte count of zero, which is why the
    // loop below cannot simply be driven off the input length.
    const full = Math.max(0, Math.ceil(input.length / 128) - 1);
    for (let i = 0; i < full; i++) {
        compress(h, input.subarray(i * 128, i * 128 + 128), BigInt((i + 1) * 128), false);
    }
    const tail = new Uint8Array(128);
    tail.set(input.subarray(full * 128));
    compress(h, tail, BigInt(input.length), true);

    const out = new Uint8Array(outLen);
    for (let i = 0; i < outLen; i++) {
        out[i] = Number((h[i >> 3] >> BigInt((i & 7) * 8)) & 0xffn);
    }
    return out;
}

export const hex = (bytes) =>
    [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

/**
 * The passport's public address. `vinHashOf` in `scripts/lib/disclosure.mjs`
 * is the same function on the other side of the project, and the test holds
 * the two to each other.
 */
export const vinHashHex = (vin) =>
    hex(blake2b(new TextEncoder().encode(String(vin)), 32));
