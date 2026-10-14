/**
 * The working tree can get ahead of the chain, and the chain will not say so
 * politely.
 *
 * A circuit's verifier key is fixed when the contract is deployed. Change the
 * contract and keep the old address, and a call built from the new circuits is
 * rejected by the node with nothing that points at the cause: it reads like a
 * proving failure or a malformed transaction. We did exactly this on
 * 2026-10-14, adding the writer circuits while `deploy/preprod.json` still
 * named the build of the day before.
 *
 * So the deploy record carries the fingerprint of what it deployed, and
 * anything about to spend a fee compares first.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildId, buildFiles, matchesDeployed } from '../../scripts/lib/build-id.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const record = JSON.parse(readFileSync(join(ROOT, 'deploy', 'preprod.json'), 'utf8'));

test('the fingerprint covers the artefacts a node verifies', () => {
    const names = buildFiles().map(([name]) => name);
    assert.ok(names.includes('contract/index.js'), 'the compiled contract is not fingerprinted');

    // Every provable circuit must be in there. A circuit added without its
    // binary reaching this list would change what the chain accepts while the
    // fingerprint stayed still.
    const zkir = names.filter((n) => n.startsWith('zkir/'));
    assert.ok(zkir.length >= 7, `only ${zkir.length} circuit binaries fingerprinted`);
    for (const circuit of ['registerPassport', 'initialiseField', 'recordField',
                           'proveFieldAtMost', 'proveFieldAtLeast',
                           'authoriseWriter', 'withdrawWriter']) {
        assert.ok(zkir.includes(`zkir/${circuit}.bzkir`), `${circuit} is not fingerprinted`);
    }
});

test('it is stable, and short enough to read out', () => {
    const id = buildId();
    assert.match(id, /^[0-9a-f]{16}$/);
    assert.equal(id, buildId(), 'two calls disagreed, so it is not a fingerprint');
});

test('the deploy record says which build is on chain', () => {
    assert.ok(record.buildId, 'deploy/preprod.json carries no buildId, so nothing can be checked');
    assert.match(record.buildId, /^[0-9a-f]{16}$/);
});

test('a mismatch is reported as a mismatch, not as bad luck', () => {
    const wrong = matchesDeployed({ ...record, buildId: '0'.repeat(16) });
    assert.equal(wrong.ok, false);
    assert.match(wrong.reason, /not the one at/);
    // The message has to carry both ids, or the reader cannot tell which way
    // round the drift is.
    assert.match(wrong.reason, new RegExp(buildId()));
    assert.match(wrong.reason, /0{16}/);

    const silent = matchesDeployed({ contractAddress: record.contractAddress });
    assert.equal(silent.ok, false, 'a record with no buildId must not pass');
});

test('this working tree, against the address it names', () => {
    // Not an assertion that they match: they are allowed to differ, and today
    // they do. What is asserted is that the repository KNOWS, so nothing
    // submits in the belief that they agree.
    const r = matchesDeployed(record);
    assert.equal(typeof r.ok, 'boolean');
    if (!r.ok) {
        assert.match(r.reason, /Deploy this contract, or check out the commit|no buildId/);
    }
});
