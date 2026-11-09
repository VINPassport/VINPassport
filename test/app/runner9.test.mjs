/**
 * The ledger 9 runner's wiring, with the chain replaced by a recorder: the
 * guided run plans one call per transaction, every call is armed before
 * Midnight.js would run its witnesses, each call carries the value pair the
 * receipt says it wrote, the delegated write acts as the dealership, the
 * refusal is reported and not submitted, and the receipt keeps the shape
 * chain-readback.mjs reads. No wallet, no network.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { executeRun, guidedIntake, explainFailure } from '../../scripts/lib/runner9.mjs';
import { makeWitnessHolder } from '../../scripts/lib/preprod-plan.mjs';
import { pureCircuits } from '../../contracts/vinpassport/src/managed/vinpassport/contract/index.js';

process.env.VINPASSPORT_VINKEY_PREVIEW = '11'.repeat(32);

const hex = (b) => Buffer.from(b).toString('hex');
const registrar = { secret: new Uint8Array(randomBytes(32)), id: null };
const dealerSecret = new Uint8Array(randomBytes(32));

async function identities() {
    // Identities are derived from secrets by the contract's own pure circuit.
    registrar.id = pureCircuits.registrarIdOf(new Uint8Array(registrar.secret));
}

function fakeChain(dealer, { failAt = new Map() } = {}) {
    const { holder, witnesses, arm } = makeWitnessHolder(registrar.secret);
    const calls = [];
    let height = 100;
    let attempt = 0;
    const callTx = new Proxy({}, {
        get: (_, circuitId) => async (...args) => {
            // `failAt` maps an attempt number to the error that attempt throws,
            // before anything is recorded, as a failed balance would.
            attempt += 1;
            if (failAt.has(attempt)) throw failAt.get(attempt);
            // What Midnight.js does first: run the circuit, which reads the witnesses.
            const ctx = { privateState: undefined };
            const read = (w) => witnesses[w](ctx)[1];
            calls.push({
                circuitId, args, armed: holder.armed,
                pending: { value: read('newValue'), salt: hex(read('newSalt')) },
                prev: { value: read('previousValue'), salt: hex(read('previousSalt')) },
                secret: hex(read('registrarSecret'))
            });
            height += 1;
            return { public: { txId: `id${height}`, txHash: `${height}`.padStart(64, '0'), blockHeight: height, fees: { paidFees: '1000', estimatedFees: '1100' } } };
        }
    });
    return {
        calls,
        chain: {
            network: 'preview', record: { contractAddress: 'ab'.repeat(32), ledger: 'v9' },
            registrar, dealer, holder, arm, found: { callTx },
            w: { wallet: { waitForSyncedState: async () => ({ unshielded: { availableCoins: [], balances: {} }, dust: { balance: () => 5n, availableCoins: [] } }) } }
        }
    };
}

test('the guided run: one call per transaction, each armed, values matching the receipt', async () => {
    await identities();
    const dealer = { label: 'dealership', secret: dealerSecret, id: pureCircuits.registrarIdOf(dealerSecret) };
    const { chain, calls } = fakeChain(dealer);
    const receipt = await executeRun(chain, { ...guidedIntake(dealer), kind: 'guided' }, { save: false });

    assert.equal(receipt.onChain.length, calls.length, 'one transaction per call');
    assert.ok(receipt.onChain.every((c) => c.calls.length === 1));
    assert.equal(calls[0].circuitId, 'registerPassport', 'the passport is registered first');
    assert.ok(calls.every((c, i) => c.armed === receipt.onChain[i].calls[0]), 'every call armed with its own label before its witnesses ran');

    // initialiseField commits write 0 of its field; recordField opens write n-1 and commits write n.
    const fieldNames = Object.keys(receipt.fields);
    for (const c of calls.filter((x) => x.circuitId === 'initialiseField')) {
        const name = fieldNames.find((n) => receipt.fields[n][0].salt === c.pending.salt);
        assert.ok(name, 'an initialisation commits a value the receipt records');
        assert.equal(String(c.pending.value), receipt.fields[name][0].value);
    }
    const update = calls.find((x) => x.circuitId === 'recordField');
    assert.ok(update, 'the guided run records an update');
    const updated = fieldNames.find((n) => receipt.fields[n].length > 1);
    assert.equal(update.prev.salt, receipt.fields[updated][0].salt, 'the update opens the previous write');
    assert.equal(update.pending.salt, receipt.fields[updated][1].salt, 'and commits the next one');
    assert.equal(update.secret, hex(dealerSecret), 'the delegated update acts as the dealership');

    const others = calls.filter((x) => x.circuitId !== 'recordField');
    assert.ok(others.every((c) => c.secret === hex(registrar.secret)), 'every other call acts as the registrar');

    // Claims open the latest write of their field.
    for (const c of calls.filter((x) => x.circuitId.startsWith('proveField'))) {
        assert.ok(fieldNames.some((n) => receipt.fields[n].at(-1).salt === c.prev.salt), `${c.circuitId} opens a latest write`);
    }
    assert.ok(calls.some((c) => c.circuitId === 'proveFieldAtLeast'), 'a floor claim runs');
    assert.ok(calls.some((c) => c.circuitId === 'proveFieldAtMostField'), 'a two-field claim runs');
});

test('the refusal is reported, never submitted, and the receipt keeps the readback shape', async () => {
    await identities();
    const dealer = { label: 'dealership', secret: dealerSecret, id: pureCircuits.registrarIdOf(dealerSecret) };
    const { chain, calls } = fakeChain(dealer);
    const receipt = await executeRun(chain, { ...guidedIntake(dealer), kind: 'guided' }, { save: false });
    assert.ok(receipt.refused.some((r) => r.step.startsWith('prove oneKeeper')), 'oneKeeper is refused in-circuit');
    assert.ok(!receipt.onChain.some((c) => c.label.startsWith('prove oneKeeper')), 'and not submitted');
    assert.equal(receipt.claims.find((c) => c.claim === 'oneKeeper').outcome, 'refused in-circuit - nothing written');
    assert.ok(receipt.onChain.some((c) => /grantDisclosure dealership: trade/.test(c.label)), 'readback finds the grant by its label');
    for (const k of ['network', 'contractAddress', 'vin', 'vinHash', 'vinHashScheme', 'registrar', 'contentRoot', 'fields', 'onChain']) {
        assert.ok(k in receipt, `receipt has ${k}`);
    }
    assert.match(receipt.vin, /^VPD/, 'a demo VIN');
    assert.equal(calls.length, receipt.onChain.length);
});

test('a dry run plans and submits nothing', async () => {
    await identities();
    const { chain, calls } = fakeChain(null);
    const out = await executeRun(chain, { ...guidedIntake(null), kind: 'guided' }, { submit: false, save: false });
    assert.ok(out.stages.length > 5);
    assert.equal(calls.length, 0);
});

test('failures are explained in words a person can act on', () => {
    assert.match(explainFailure(new Error('Transaction rejected: OutsideTimeToDismiss')), /#838.*--split/);
    assert.match(explainFailure(new Error('Insufficient Funds: could not balance dust')), /not enough DUST/);
    assert.match(explainFailure(Object.assign(new Error('boom'), { code: 'MIDNIGHT_JS_X' })), /\[MIDNIGHT_JS_X\]/);
    // The provider's reason travels on `cause`; without it a refusal names nothing.
    const wrapped = new Error('balanceTx rejected the transaction', { cause: new Error('SubmissionError', { cause: new Error('1010: Invalid Transaction') }) });
    assert.match(explainFailure(wrapped), /cause: SubmissionError <- 1010: Invalid Transaction/);
});

const balanceFailure = () => Object.assign(new Error('balanceTx rejected the transaction'), { code: 'MIDNIGHT_JS_C_PROVIDER_FAILED' });

test('a run that stops keeps a receipt holding exactly what landed', async () => {
    await identities();
    const dealer = { label: 'dealership', secret: dealerSecret, id: pureCircuits.registrarIdOf(dealerSecret) };
    // Attempt 10 fails with something a retry cannot fix.
    const { chain, calls } = fakeChain(dealer, { failAt: new Map([[10, new Error('node refused it')]]) });
    const err = await executeRun(chain, { ...guidedIntake(dealer), kind: 'guided' }, { save: false }).then(() => null, (e) => e);
    assert.ok(err, 'the run fails');
    assert.equal(calls.length, 9, 'nothing after the failure is sent, and the failure is not retried');
    const r = err.partial.receipt;
    assert.ok(r, 'a receipt exists for the partial run');
    assert.equal(r.incomplete, true);
    assert.equal(r.stoppedAt.call, 10);
    assert.equal(r.onChain.length, 9);
    // Every write the receipt holds is one a landed call committed, and every landed commitment is in it.
    const committed = calls.filter((c) => c.circuitId === 'initialiseField' || c.circuitId === 'recordField').map((c) => c.pending.salt);
    const held = Object.values(r.fields).flat().map((w) => w.salt);
    assert.deepEqual([...held].sort(), [...committed].sort());
    assert.ok(r.claims.every((c) => c.outcome !== 'proven on-chain'), 'no claim is reported proven before its call landed');
});

test('a failed balance is retried once after a re-sync; a second one stops the run', async () => {
    await identities();
    const once = fakeChain(null, { failAt: new Map([[3, balanceFailure()]]) });
    const ok = await executeRun(once.chain, { ...guidedIntake(null), kind: 'guided' }, { save: false });
    assert.equal(ok.onChain.length, once.calls.length, 'the retried call landed once, and the run finished');

    const twice = fakeChain(null, { failAt: new Map([[3, balanceFailure()], [4, balanceFailure()]]) });
    const err = await executeRun(twice.chain, { ...guidedIntake(null), kind: 'guided' }, { save: false }).then(() => null, (e) => e);
    assert.match(err.message, /call 3 .*balanceTx/);
    assert.equal(err.partial.receipt.onChain.length, 2);
});
