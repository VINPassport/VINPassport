/**
 * The era table says what this tree builds and where it can deploy it. It
 * must agree with what the compiler actually produced and with what
 * package.json installs, or a run would pass the early check and fail later
 * with an EraMismatchError after a wallet sync and a proof.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BUILD, NETWORK_LEDGER, BUILDABLE, requireBuildableNetwork } from '../../scripts/lib/eras.mjs';
import { NETWORKS } from '../../scripts/lib/endpoints.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const info = read('contracts/vinpassport/src/managed/vinpassport/compiler/contract-info.json');
const pkg = read('package.json');

test('BUILD is what the compiler produced', () => {
    assert.equal(info['compiler-version'], BUILD.compiler);
    assert.equal(info['language-version'], BUILD.language);
    assert.equal(info['runtime-version'], BUILD.runtime);
});

test('the compile script pins the compiler, so a routine rebuild cannot change the verifier keys', () => {
    // compactc 0.36 changes every verifier key on recompile of an older
    // build; the default toolchain on a machine is not something to rely on.
    assert.match(pkg.scripts.compile, new RegExp(`^compact compile \\+${BUILD.compiler.replaceAll('.', '\\.')} `));
});

test('package.json installs the runtime and SDK versions BUILD names', () => {
    assert.equal(pkg.dependencies['@midnight-ntwrk/compact-runtime'], BUILD.runtime);
    assert.equal(pkg.dependencies['@midnight-ntwrk/midnight-js-contracts'], BUILD.midnightJs);
    // Wallet SDK 2.0.0 is facade 5.0.0 (wallet SDK 2.0.0 release notes).
    assert.equal(pkg.dependencies['@midnightntwrk/wallet-sdk-facade'], '5.0.0');
    assert.equal(pkg.dependencies['@odatano/nightgate-tx'], undefined,
        'nightgate-tx is ledger 8 only; it stays at the ledger8-preprod tag');
});

test('every known network has a ledger, and only ledger 9 networks are buildable', () => {
    assert.deepEqual(Object.keys(NETWORK_LEDGER).sort(), [...NETWORKS].sort());
    assert.deepEqual([...BUILDABLE], ['preview', 'mainnet']);
    assert.equal(requireBuildableNetwork('preview'), 'preview');
    assert.equal(requireBuildableNetwork('mainnet'), 'mainnet');
});

test('preprod is refused with a sentence that says where the ledger 8 tooling went', () => {
    assert.throws(() => requireBuildableNetwork('preprod'), (e) =>
        /preprod runs ledger 8/.test(e.message) && /ledger8-preprod/.test(e.message));
    assert.throws(() => requireBuildableNetwork('testnet'), /unknown network/);
});

test('the listing demo is built by the same pinned compiler', () => {
    // It calls VINPassport across contracts, so the two builds must come from
    // one toolchain: a callee is checked against the verifier keys on chain.
    assert.match(pkg.scripts['compile:listing'], new RegExp(`^compact compile \\+${BUILD.compiler.replaceAll('.', '\\.')} `));
    const listingInfo = JSON.parse(readFileSync(join(ROOT, 'contracts', 'listing', 'src', 'managed', 'listing', 'compiler', 'contract-info.json'), 'utf8'));
    assert.equal(listingInfo['compiler-version'], BUILD.compiler);
    assert.equal(listingInfo['runtime-version'], BUILD.runtime);
});
