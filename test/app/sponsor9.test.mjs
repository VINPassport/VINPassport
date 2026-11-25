/**
 * The NIGHTGATE sponsor's configuration, and which failures let the own
 * wallet pay instead (DECISIONS D37).
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { NightgateApiError, NightgateJobError } from '@odatano/nightgate-tx';
import { nightgateConfig, failureOutcome, preparedAction } from '../../scripts/lib/sponsor9.mjs';

const none = join(tmpdir(), 'vinpassport-no-such-nightgate.env');

test('no server and no token means no sponsor, and every call is self-paid', () => {
    assert.equal(nightgateConfig('preprod', { env: {}, file: none }), null);
});

test('a server needs its token and a token its server', () => {
    assert.throws(() => nightgateConfig('preprod', { env: { VINPASSPORT_NIGHTGATE_URL: 'https://ng.example' }, file: none }), /go together/);
    assert.throws(() => nightgateConfig('preprod', { env: { VINPASSPORT_NIGHTGATE_TOKEN: 'ngat_x' }, file: none }), /go together/);
});

test('the token is sent the way its kind is sent, and the server must be https', () => {
    const agent = nightgateConfig('preprod', { env: { VINPASSPORT_NIGHTGATE_URL: 'https://ng.example/', VINPASSPORT_NIGHTGATE_TOKEN: 'ngat_abc' }, file: none });
    assert.deepEqual(agent, { baseUrl: 'https://ng.example', agentToken: 'ngat_abc' });
    const gateway = nightgateConfig('preprod', { env: { VINPASSPORT_NIGHTGATE_URL: 'https://ng.example', VINPASSPORT_NIGHTGATE_TOKEN: 'oda_abc' }, file: none });
    assert.deepEqual(gateway, { baseUrl: 'https://ng.example', token: 'oda_abc' });
    assert.throws(() => nightgateConfig('preprod', { env: { VINPASSPORT_NIGHTGATE_URL: 'http://ng.example', VINPASSPORT_NIGHTGATE_TOKEN: 'ngat_abc' }, file: none }), /must be https/);
    assert.ok(nightgateConfig('preview', { env: { VINPASSPORT_NIGHTGATE_URL: 'http://127.0.0.1:4004', VINPASSPORT_NIGHTGATE_TOKEN: 'ngat_abc' }, file: none }));
});

test('a deploy step or an update is handed over as its one action, and nothing else is', async () => {
    const ledger = await import('@midnightntwrk/ledger-v9');
    const ttl = new Date(Date.now() + 600_000);
    const key = ledger.sampleSigningKey();
    const authority = new ledger.ContractMaintenanceAuthority([ledger.signatureVerifyingKey(key)], 1, 1n);
    const update = new ledger.MaintenanceUpdate(ledger.sampleContractAddress(), [new ledger.ReplaceAuthority(authority)], 0n);
    const tx = (intent) => ledger.Transaction.fromParts('preview', undefined, undefined, intent);
    const one = preparedAction(tx(ledger.Intent.new(ttl).addMaintenanceUpdate(update)));
    assert.equal(one.kind, 'update');
    assert.ok(one.action instanceof ledger.MaintenanceUpdate);
    const deploy = new ledger.ContractDeploy(new ledger.ContractState());
    assert.equal(preparedAction(tx(ledger.Intent.new(ttl).addDeploy(deploy))).kind, 'deploy');
    assert.throws(() => preparedAction(tx(ledger.Intent.new(ttl).addDeploy(deploy).addMaintenanceUpdate(update))), /carries one action, this one 2/);
});

test('the own wallet pays only when the sponsored call cannot have changed the contract', () => {
    const api = (status) => Object.assign(Object.create(NightgateApiError.prototype), { status, message: 'refused' });
    assert.equal(failureOutcome(Object.assign(new Error('indexer down'), { stage: 'build' })), 'not-applied');
    assert.equal(failureOutcome(api(403)), 'not-applied');
    assert.equal(failureOutcome(api(503)), 'not-applied');
    assert.equal(failureOutcome(new NightgateJobError({ jobId: 'j', status: 'failed' })), 'not-applied');

    // The same key named a job that is already there: it may be landing.
    assert.equal(failureOutcome(api(409)), 'unknown');
    assert.equal(failureOutcome(new NightgateJobError({ jobId: 'j', status: 'reconciliation_required' })), 'unknown');
    assert.equal(failureOutcome(new Error('socket hang up')), 'unknown');
});
