/**
 * Fitting a deploy into a block (scripts/lib/deploy-fit.mjs), offline.
 *
 * On 9 November 2026 Preview refused the 18-circuit deploy as larger than a
 * block allows (error 1010). These tests hold the plan that replaced it
 * to its promises, against Preview's real ledger parameters (a public fixture)
 * and the real verifier keys of the build on disk: every circuit lands in
 * exactly one transaction, no transaction exceeds the budget, the writing
 * circuits deploy first, and each insert is signed by the key the authority
 * names, against the counter the previous step leaves.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createConstructorContext, ContractMaintenanceAuthority } from '@midnight-ntwrk/compact-runtime';
import { ContractState, LedgerParameters, sampleSigningKey, signatureVerifyingKey } from '@midnightntwrk/ledger-v9';
import { Contract } from '../../contracts/vinpassport/src/managed/vinpassport/contract/index.js';
import { BUILD_DIR, PROVABLE, refusingWitnesses } from '../../scripts/lib/contract9.mjs';
import { BLOCK_BUDGET, READ_CIRCUITS, deployOrder, planDeploy, custodyInserts, blockShare, deployTx, subsetState } from '../../scripts/lib/deploy-fit.mjs';
import { checkSignatures } from '../../scripts/lib/maintenance9.mjs';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/ledger-parameters.preview.json', import.meta.url), 'utf8'));
const params = LedgerParameters.deserialize(Buffer.from(fixture.hex, 'hex'));
const ttl = new Date(Date.now() + 30 * 60_000);
const keyHex = sampleSigningKey('schnorr').value;
const custody = { key: { tag: 'schnorr', value: keyHex }, verifyingKey: signatureVerifyingKey({ tag: 'schnorr', value: keyHex }) };

/** The deploy's initial state with every verifier key set, as Midnight.js builds it. */
async function fullState() {
    const slots = [1, 2, 3, 4].map((n) => new Uint8Array(32).fill(n));
    const init = await new Contract(refusingWitnesses()).initialState(createConstructorContext({}, '0'.repeat(64)), slots);
    const s = init.currentContractState;
    for (const c of PROVABLE) {
        const op = s.operation(c);
        op.verifierKey = new Uint8Array(readFileSync(join(BUILD_DIR, 'keys', `${c}.verifier`)));
        s.setOperation(c, op);
    }
    s.maintenanceAuthority = new ContractMaintenanceAuthority([custody.verifyingKey], 1, 0n);
    return ContractState.deserialize(s.serialize());
}

test('the whole build does not fit one deploy under the budget, which is why the plan exists', async () => {
    const full = await fullState();
    const whole = blockShare(deployTx('preview', subsetState(full, PROVABLE), ttl).tx, params);
    assert.ok(whole.share > BLOCK_BUDGET, `all ${PROVABLE.length} circuits use ${whole.share}`);
});

test('every circuit lands in exactly one transaction, writes first, none over the budget', async () => {
    const full = await fullState();
    const plan = planDeploy(full, PROVABLE, params, { network: 'preview', ttl });
    assert.ok(plan.share <= BLOCK_BUDGET);
    assert.ok(plan.rest.length > 0);
    assert.deepEqual([...plan.first, ...plan.rest], deployOrder(PROVABLE));
    assert.ok(plan.first.every((c) => !READ_CIRCUITS.includes(c)), 'the deploy carries writing circuits only');
    assert.ok(plan.first.includes('registerPassport') && plan.first.includes('approveRegistrarChange'));

    const steps = custodyInserts({
        network: 'preview', contractAddress: 'ab'.repeat(32), circuits: plan.rest,
        keysDir: join(BUILD_DIR, 'keys'), custody, counter: 0n, params, ttl
    });
    assert.deepEqual(steps.flatMap((st) => st.circuits), plan.rest);
    steps.forEach((st, i) => {
        assert.ok(st.share <= BLOCK_BUDGET);
        assert.equal(st.counter, BigInt(i), 'each step is valid against the counter the previous one leaves');
        const sig = checkSignatures(st.proposal);
        assert.equal(sig.valid.length, 1);
        assert.equal(sig.invalid.length, 0);
        assert.equal(st.proposal.authority.threshold, 1);
    });
});

test('a key nobody holds cannot sign the inserts', async () => {
    const full = await fullState();
    const plan = planDeploy(full, PROVABLE, params, { network: 'preview', ttl });
    const strangerHex = sampleSigningKey('schnorr').value;
    const stranger = { key: { tag: 'schnorr', value: strangerHex }, verifyingKey: custody.verifyingKey };
    assert.throws(() => custodyInserts({
        network: 'preview', contractAddress: 'ab'.repeat(32), circuits: plan.rest,
        keysDir: join(BUILD_DIR, 'keys'), custody: stranger, counter: 0n, params, ttl
    }), /not a member of the authority/);
});

test('a build that fits deploys in one transaction', async () => {
    const full = await fullState();
    const small = PROVABLE.filter((c) => !READ_CIRCUITS.includes(c)).slice(0, 4);
    const plan = planDeploy(full, small, params, { network: 'preview', ttl });
    assert.deepEqual(plan.rest, []);
    assert.deepEqual(plan.first, small);
});
