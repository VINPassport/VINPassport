/**
 * Registrar governance bookkeeping (scripts/lib/governance.mjs), offline.
 *
 * What matters: the set a reader expects from the deploy record is the set the
 * contract actually holds after the same approvals, a mistyped governance call
 * stops instead of doing something else, and a label resolves to the identity
 * the record pinned. The contract side runs the compiled circuits, so the
 * bookkeeping is checked against the real rule rather than a copy of it.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    PassportSimulator, REGISTRAR_SECRET, REGISTRAR_ID, SECOND_SECRET, SECOND_ID,
    DEALER_ID, GARAGE_SECRET, GARAGE_ID, hex
} from '../passport-simulator.mjs';
import { resolveRegistrar, expectedRegistrars, sameMembers, parseGovernArgs } from '../../scripts/lib/governance.mjs';

const pinned = [
    { label: 'A', id: hex(REGISTRAR_ID) },
    { label: 'B', id: hex(SECOND_ID) },
    { label: 'C', id: hex(DEALER_ID) },
    { label: 'D', id: hex(GARAGE_ID) }
];
const onChain = (sim) => new Set([...sim.ledger.allowedRegistrars].map(hex));

test('the expected set follows the contract through a removal and an addition', async () => {
    const sim = await PassportSimulator.create(pinned.map((r) => Buffer.from(r.id, 'hex')));
    const changes = [];
    const approve = async (add, id, secret) => {
        const before = onChain(sim);
        await sim.approveRegistrarChange(add, Buffer.from(id, 'hex'), secret);
        const after = onChain(sim);
        changes.push({ add, id, executed: !sameMembers(before, after) });
    };

    // Remove D: A's approval counts, B's carries it out.
    await approve(false, pinned[3].id, REGISTRAR_SECRET);
    assert.ok(sameMembers(expectedRegistrars(pinned, changes), onChain(sim)), 'one approval changes nothing');
    assert.equal(changes.at(-1).executed, false);
    await approve(false, pinned[3].id, SECOND_SECRET);
    assert.equal(changes.at(-1).executed, true);
    assert.ok(sameMembers(expectedRegistrars(pinned, changes), onChain(sim)));
    assert.equal(onChain(sim).size, 3);

    // Add D back: the removed registrar's own secret no longer counts, two others do.
    await assert.rejects(sim.approveRegistrarChange(true, Buffer.from(pinned[3].id, 'hex'), GARAGE_SECRET), /not an authorised registrar/);
    await approve(true, pinned[3].id, SECOND_SECRET);
    await approve(true, pinned[3].id, REGISTRAR_SECRET);
    assert.ok(sameMembers(expectedRegistrars(pinned, changes), onChain(sim)));
    assert.equal(onChain(sim).size, 4);
});

test('an approval that did not carry its change leaves the expected set alone', () => {
    const changes = [{ add: false, id: pinned[3].id, executed: false }];
    assert.ok(sameMembers(expectedRegistrars(pinned, changes), new Set(pinned.map((r) => r.id))));
    assert.ok(sameMembers(expectedRegistrars(pinned), new Set(pinned.map((r) => r.id))), 'no changes recorded');
});

test('a label resolves to the identity the record pinned; a new identity is allowed by hex', () => {
    assert.deepEqual(resolveRegistrar('d', pinned), { label: 'D', id: pinned[3].id });
    const fresh = 'ab'.repeat(32);
    assert.deepEqual(resolveRegistrar(fresh, pinned), { label: null, id: fresh });
    assert.deepEqual(resolveRegistrar('0x' + pinned[1].id.toUpperCase(), pinned), { label: 'B', id: pinned[1].id });
    assert.throws(() => resolveRegistrar('E', pinned), /no registrar labelled E/);
    assert.throws(() => resolveRegistrar('abc', pinned), /neither a registrar label nor 64 hex/);
});

test('a governance call is refused when its arguments are anything but exact', () => {
    assert.deepEqual(parseGovernArgs(['--network', 'preview', '--remove', 'D', '--as', 'a']),
        { network: 'preview', add: false, target: 'D', as: 'A', submit: false });
    assert.equal(parseGovernArgs(['--network', 'preview', '--add', 'ab'.repeat(32), '--as', 'B', '--submit']).submit, true);
    assert.throws(() => parseGovernArgs(['--network', 'preview', '--remove', 'D']), /--as names/);
    assert.throws(() => parseGovernArgs(['--network', 'preview', '--as', 'A']), /--add <who> or --remove <who>/);
    assert.throws(() => parseGovernArgs(['--network', 'preview', '--add', 'D', '--remove', 'C', '--as', 'A']), /one change per call/);
    assert.throws(() => parseGovernArgs(['--network', 'preview', '--remove', 'D', '--as', 'A', '--sumbit']), /unknown argument --sumbit/);
    assert.throws(() => parseGovernArgs(['--remove', 'D', '--as', 'A']), /--network is required/);
    assert.throws(() => parseGovernArgs(['--network', '--remove', 'D', '--as', 'A']), /--network needs a value/);
});
