/**
 * The ledger key for a vehicle: what scripts/lib/vin-key.mjs promises.
 *
 * Four things are held here.
 *
 *  1. Conformance. The derivation is RFC 9497 VOPRF, ristretto255-SHA512, and
 *     it is checked against the RFC's own Appendix A.1.2 vectors, copied from
 *     the text at rfc-editor.org. Conformance is what lets any compliant
 *     implementation, on any future host, produce the same ledger keys.
 *  2. Determinism. The output must not depend on the random blind, because the
 *     service evaluates locally today and a browser may evaluate obliviously
 *     later, and both have to land on the same key.
 *  3. No keyless path. Without a key the module throws. It never returns a
 *     derivation of the VIN alone.
 *  4. The rule until the key is wired in: network runs write only fresh,
 *     server-generated demo VINs, never a VIN a caller supplied.
 *
 * Tests marked REPOSITORY ASSERTION read source rather than run it. They are a
 * tripwire for paths that cannot run without a funded wallet, and they are a
 * different kind of evidence from the rest, so they are labelled.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ristretto255_oprf } from '@noble/curves/ed25519.js';
import {
    vinKey, vinKeyHex, vinKeyPair, loadVinKeys, evaluate, normaliseVin, NETWORKS
} from '../../scripts/lib/vin-key.mjs';
import { validateManualIntake, randomDemoVin } from '../../scripts/lib/preprod-runner.mjs';
import { vinHash } from '../../scripts/lib/scenario.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const hex = (u) => Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => Uint8Array.from(s.match(/../g), (b) => parseInt(b, 16));

const SEED_A = new Uint8Array(32).fill(0x11);
const SEED_B = new Uint8Array(32).fill(0x22);
const VIN = 'WAUZZZF47GA067890';

// ---------------------------------------------------------------- 1. RFC 9497

// Appendix A.1.2, ristretto255-SHA512, VOPRF mode.
const RFC = {
    seed: 'a3'.repeat(32),
    keyInfo: '74657374206b6579',          // "test key"
    skSm: 'e6f73f344b79b379f1a0dd37e07ff62e38d9f71345ce62ae3a9bc60b04ccd909',
    pkSm: 'c803e2cc6b05fc15064549b5920659ca4a77b2cca6f04f6b357009335476ad4e',
    vectors: [
        { input: '00',
          output: 'b58cfbe118e0cb94d79b5fd6a6dafb98764dff49c14e1770b566e42402da1a7da4d8527693914139caee5bd03903af43a491351d23b430948dd50cde10d32b3c' },
        { input: '5a'.repeat(17),
          output: '8a9a2f3c7f085b65933594309041fc1898d42d0858e59f90814ae90571a6df60356f4610bf816f27afdd84f47719e480906d27ecd994985890e5f539e7ea74b6' }
    ]
};

test('RFC 9497 A.1.2: key derivation reproduces the published key pair', () => {
    const k = ristretto255_oprf.voprf.deriveKeyPair(unhex(RFC.seed), unhex(RFC.keyInfo));
    assert.equal(hex(k.secretKey), RFC.skSm);
    assert.equal(hex(k.publicKey), RFC.pkSm);
});

test('RFC 9497 A.1.2: the module\'s evaluate reproduces both published outputs', () => {
    const keys = ristretto255_oprf.voprf.deriveKeyPair(unhex(RFC.seed), unhex(RFC.keyInfo));
    for (const [i, tv] of RFC.vectors.entries()) {
        assert.equal(hex(evaluate(unhex(tv.input), keys)), tv.output,
            `Test Vector ${i + 1}: the shipped wiring does not produce the standard output`);
    }
});

// ---------------------------------------------------------------- 2. determinism

test('the ledger key does not depend on the blind', () => {
    const keys = vinKeyPair(SEED_A, 'preprod');
    const seen = new Set(Array.from({ length: 6 }, () => vinKeyHex(VIN, keys)));
    assert.equal(seen.size, 1, 'six evaluations with fresh blinds gave different keys');
});

test('KNOWN ANSWER: the full derivation is pinned', () => {
    // The RFC vectors prove the library. These pin OUR choices on top of it:
    // the key-info string, the normalisation and the truncation to 32 bytes.
    // Any change to those orphans every ledger key ever written, so it has to
    // be a deliberate migration that edits this test, never a side effect.
    // Values computed once from the implementation as first committed.
    assert.equal(vinKeyHex(VIN, vinKeyPair(SEED_A, 'preprod')),
        'd1b35b2aa998aa8461a75d4123cc1f6f5c1244c3f21ced510151cfdcaac60175');
    assert.equal(vinKeyHex(VIN, vinKeyPair(SEED_A, 'mainnet')),
        'eadf3fe744cb92a32a6c4c52cea6afbb443f2f2c4366a8ab9c99086b1a54a47c');
});

test('the ledger key is 32 bytes, the width the contract keys its maps on', () => {
    const k = vinKey(VIN, vinKeyPair(SEED_A, 'preprod'));
    assert.ok(k instanceof Uint8Array);
    assert.equal(k.length, 32);
    assert.match(vinKeyHex(VIN, vinKeyPair(SEED_A, 'preprod')), /^[0-9a-f]{64}$/);
});

test('a VIN as typed and as stored give the same key', () => {
    const keys = vinKeyPair(SEED_A, 'preprod');
    const canonical = vinKeyHex(VIN, keys);
    for (const typed of ['wauzzzf47ga067890', ' WAUZZZ-F47GA 067890 ', 'wauzzz f47ga-067890']) {
        assert.equal(vinKeyHex(typed, keys), canonical, `"${typed}" did not normalise`);
    }
});

test('anything that is not a VIN is refused rather than keyed', () => {
    const keys = vinKeyPair(SEED_A, 'preprod');
    for (const bad of ['WAUZZZF47GA06789', 'WAUZZZF47GA0678901', 'WAUZZZF47GA06789O', '']) {
        assert.throws(() => vinKey(bad, keys), /not a VIN/, `"${bad}" was keyed`);
    }
});

test('each network has its own key, and so does each seed', () => {
    const pre = vinKeyHex(VIN, vinKeyPair(SEED_A, 'preprod'));
    assert.notEqual(vinKeyHex(VIN, vinKeyPair(SEED_A, 'mainnet')), pre,
        'one seed gave the same key on two networks');
    assert.notEqual(vinKeyHex(VIN, vinKeyPair(SEED_B, 'preprod')), pre,
        'two seeds gave the same key');
    assert.deepEqual([...NETWORKS], ['preprod', 'mainnet']);
    assert.throws(() => vinKeyPair(SEED_A, 'devnet'), /unknown network/);
});

// ---------------------------------------------------------------- 3. no keyless path

test('there is no derivation without a key', () => {
    const input = new TextEncoder().encode(VIN);
    assert.throws(() => evaluate(input, undefined), /key pair is required/);
    assert.throws(() => evaluate(input, {}), /key pair is required/);
    assert.throws(() => vinKey(VIN, undefined), /key pair is required/);
});

test('the ledger key is not the plain digest of the VIN', () => {
    const keyed = vinKeyHex(VIN, vinKeyPair(SEED_A, 'preprod'));
    assert.notEqual(keyed, hex(vinHash(VIN)));
});

test('a seed has to be exactly 32 bytes', () => {
    assert.throws(() => vinKeyPair(new Uint8Array(31), 'preprod'), /exactly 32 bytes/);
    assert.throws(() => vinKeyPair('11'.repeat(32), 'preprod'), /exactly 32 bytes/);
});

test('loadVinKeys reads the environment, and a bad value says so without echoing it', () => {
    const name = 'VINPASSPORT_VINKEY_PREPROD';
    const was = process.env[name];
    try {
        process.env[name] = hex(SEED_A);
        assert.equal(hex(loadVinKeys('preprod').publicKey), hex(vinKeyPair(SEED_A, 'preprod').publicKey));

        const bad = 'zz'.repeat(32);
        process.env[name] = bad;
        assert.throws(() => loadVinKeys('preprod'), (e) => {
            assert.match(e.message, /must be 64 hex characters/);
            assert.ok(!e.message.includes(bad), 'the error message echoed the configured value');
            return true;
        });
    } finally {
        if (was === undefined) delete process.env[name]; else process.env[name] = was;
    }
});

test('REPOSITORY ASSERTION: no page under site/ refers to the key module', () => {
    // The key never reaches browser code. vin-key.mjs imports node:fs, so it
    // cannot work in a page anyway; this keeps anyone from trying.
    const hits = [];
    (function walk(dir) {
        for (const name of readdirSync(dir)) {
            const p = join(dir, name);
            if (statSync(p).isDirectory()) { walk(p); continue; }
            if (!['.js', '.mjs', '.html'].includes(extname(p))) continue;
            const src = readFileSync(p, 'utf8');
            if (src.includes('vin-key') || src.includes('vinpassport:vinkey')) hits.push(p);
        }
    })(join(ROOT, 'site'));
    assert.deepEqual(hits, [], `key material referenced from browser code: ${hits.join(', ')}`);
});

// ---------------------------------------------------------------- 4. the interim rule

test('a demo VIN is fresh, server-generated and VIN-shaped', () => {
    const a = randomDemoVin();
    const b = randomDemoVin();
    assert.match(a, /^VPD[A-HJ-NPR-Z0-9]{14}$/);
    assert.notEqual(a, b);
});

test('a manual preprod run never writes the VIN the caller supplied', () => {
    const out = validateManualIntake(
        { vin: VIN, fields: { odometerKm: 1000 }, prove: {} }, null
    );
    assert.notEqual(out.vin, VIN, 'the caller\'s VIN would have been written to the network');
    assert.match(out.vin, /^VPD[A-HJ-NPR-Z0-9]{14}$/);
});

test('REPOSITORY ASSERTION: every VIN the preprod runner builds is a fresh demo VIN', () => {
    // The guided route builds its intake inside a closure that only runs with
    // a funded wallet, so it cannot be executed here. This catches a new path,
    // or an edited one, that sets `vin:` from anything other than
    // randomDemoVin() before it can reach a network.
    const src = readFileSync(join(ROOT, 'scripts/lib/preprod-runner.mjs'), 'utf8');
    const assignments = [...src.matchAll(/^\s*vin:\s*([^,\n]+)/gm)].map((m) => m[1].trim());
    assert.ok(assignments.length >= 2, `expected the manual and guided routes, found ${assignments.length}`);
    for (const rhs of assignments) {
        assert.match(rhs, /^randomDemoVin\(\)/,
            `a network run sets vin from "${rhs}"; it must be randomDemoVin() until vin-key.mjs is wired in`);
    }
});
