/**
 * The order of a deploy run: what is printed, built and signed before what.
 *
 *   - the contract address is on screen before anything is sent, so a run
 *     that dies while waiting still names the contract it created;
 *   - a stepped deploy builds and custody-signs each insert just before it
 *     goes out, with a ttl that starts then, so a step queued behind the
 *     deploy and the earlier inserts cannot expire on the way (the plan-time
 *     copies only fit the plan and price the dry run);
 *   - every wait on the wallet is bounded;
 *   - a sponsored deploy opens no wallet and reads the chain through the
 *     NIGHTGATE server, never the public indexer.
 *
 * The deploy needs a wallet and a chain, so these are REPOSITORY ASSERTIONS
 * that read scripts/deploy.mjs. What a rebuilt step signs is held in
 * test/app/deploy-fit.test.mjs.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const s = readFileSync(join(ROOT, 'scripts', 'deploy.mjs'), 'utf8').replace(/\r\n/g, '\n');
const body = (name) => {
    const at = s.indexOf(`async function ${name}(`);
    assert.notEqual(at, -1, `${name} is missing`);
    return s.slice(at, s.indexOf('\n}\n', at));
};

test('REPOSITORY ASSERTION: a single-shot deploy prints its address before it is sent', () => {
    const printed = s.indexOf("log(`\\naddress    ${address}");
    const sent = s.indexOf('await submitTx(providers, { unprovenTx: unproven.private.unprovenTx })');
    assert.ok(printed !== -1 && sent !== -1 && printed < sent);
    assert.match(s, /const address = unproven\.public\.contractAddress;/);
    // What deployContract did after a success, kept: the status check and the stored key.
    assert.match(s, /landed\.status !== SucceedEntirely/);
    assert.match(s, /setSigningKey\(address, unproven\.private\.signingKey\)/);
    assert.ok(!/deployContract\(providers/.test(s), 'the deploy still goes through deployContract, which names no address before it lands');
});

test('REPOSITORY ASSERTION: a stepped deploy builds step 1 with a fresh ttl and prints its address first', () => {
    const b = body('deployInSteps');
    assert.match(b, /const ttl = freshTtl\(\);\n\s*const dep = deployTx\(NETWORK, subsetState\(full, plan\.first\), ttl\);/);
    assert.ok(b.indexOf('log(`\\naddress') < b.indexOf('submitPrepared('));
    assert.match(b, /blockShare\(dep\.tx, params\)\.share > BLOCK_BUDGET/);
});

test('REPOSITORY ASSERTION: each insert is built and signed just before it is sent', () => {
    const b = body('finishSteps');
    const built = b.indexOf('custodyInsertStep(');
    const sent = b.indexOf('submitPrepared({ wallet: ownWallet, sponsor, tx: st.tx, ttl,');
    assert.ok(built !== -1 && sent !== -1 && built < sent);
    assert.ok(b.lastIndexOf('const ttl = freshTtl();', built) !== -1, 'the step ttl is not taken at send time');
    assert.ok(!/planned\.tx/.test(b), 'a plan-time transaction is sent');
    assert.match(b, /blockShare\(st\.tx, params\)\.share > BLOCK_BUDGET/);
});

test('REPOSITORY ASSERTION: no wait on the wallet is open-ended', () => {
    assert.ok(!/waitForSyncedState\(\)/.test(s), 'an unbounded waitForSyncedState is back');
    assert.match(body('ownWallet'), /await w\.synced\(SYNC_MS\);/);
});

test('REPOSITORY ASSERTION: a sponsored deploy opens no wallet and reads through NIGHTGATE', () => {
    // The one place the wallet opens, reached up front only without a sponsor.
    assert.equal(s.split('await openWallet(NETWORK').length, 2);
    assert.match(body('ownWallet'), /w \?\?= await openWallet\(NETWORK, \{ log \}\);/);
    assert.match(s, /if \(!nightgate\) \{\n\s*const state = await \(await ownWallet\(\)\)\.synced\(SYNC_MS\);/);
    assert.match(s, /const reads = chainReads\(NETWORK, \{ config: nightgate \}\);/);
    assert.ok(!/indexerHttpUrl|indexerPublicDataProvider|networkEndpoints\(/.test(s), 'the deploy reads the public indexer directly');
    assert.match(s, /createLedger9UnprovenDeployTxFromVerifierKeys\(/);
});
