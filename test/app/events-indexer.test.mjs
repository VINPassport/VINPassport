/**
 * Events as the public indexer serves them (scripts/lib/events.mjs), offline.
 *
 * The readback decodes events from the indexer's `MiscContractEvent` (name and
 * payload as hex), the tests decode them from the runtime's log. The two must
 * agree on every event the compiled contract emits, and every writing circuit
 * must name the kind a reader expects for its transaction.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    PassportSimulator, REGISTRAR_SECRET, REGISTRAR_ID, SECOND_ID, DEALER_ID, Rule, Tier, bytes32, fieldKey
} from '../passport-simulator.mjs';
import { decodeEvent, decodeIndexerEvent, CIRCUIT_KIND, VEHICLE_KINDS } from '../../scripts/lib/events.mjs';

const hex = (b) => Buffer.from(b).toString('hex');
// The same fixtures as test/passport.test.mjs.
const VIN_A = bytes32(0x11);
const ROOT = bytes32(0xaa);
const REGISTRAR = REGISTRAR_SECRET;
const ODO = fieldKey('odometerKm');
const OWNERS = fieldKey('ownerCount');
const S1 = bytes32(0xd1);
const S2 = bytes32(0xd2);
/** What the indexer serves for a runtime event: the subject as `name`, the rest as `payload`. */
const asIndexer = (raw, contractAddress) => ({ name: hex(raw.subarray(0, 32)), payload: hex(raw.subarray(32)), contractAddress });

test('the indexer form and the runtime form decode to the same event, for every event a run emits', async () => {
    const sim = await PassportSimulator.create([REGISTRAR_ID, SECOND_ID]);
    await sim.registerPassport(VIN_A, ROOT, REGISTRAR);
    await sim.initialiseField(VIN_A, ODO, Rule.neverFalls, 12n, S1);
    await sim.initialiseField(VIN_A, OWNERS, Rule.neverFalls, 1n, S1);
    await sim.recordField(VIN_A, ODO, 20n, S2);
    await sim.authoriseWriter(VIN_A, DEALER_ID, REGISTRAR);
    await sim.grantDisclosure(VIN_A, DEALER_ID, Tier.trade, REGISTRAR);
    await sim.proveFieldAtMost(VIN_A, ODO, 150_000n);
    const raws = sim.ctx.events;
    assert.ok(raws.length >= 7);
    for (const ev of raws) {
        const runtime = decodeEvent(ev);
        const indexer = decodeIndexerEvent(asIndexer(ev.data.content.value[0], 'ab'.repeat(32)));
        assert.ok(runtime && indexer);
        assert.equal(indexer.kind, runtime.kind);
        assert.equal(indexer.subject, runtime.subject);
    }
});

test('anything that is not a VINPassport event decodes to nothing', () => {
    const other = new Uint8Array(64);
    other.set(new TextEncoder().encode('someone.else.v1'), 32);
    assert.equal(decodeIndexerEvent({ name: hex(other.subarray(0, 32)), payload: hex(other.subarray(32)) }), null);
    assert.equal(decodeIndexerEvent({ name: 'zz', payload: '00' }), null, 'not hex');
    assert.equal(decodeIndexerEvent({ name: '00'.repeat(31), payload: '00' }), null, 'a name is 32 bytes');
    assert.equal(decodeIndexerEvent(null), null);
});

test('every vehicle kind has exactly one circuit that announces it', () => {
    const kinds = Object.values(CIRCUIT_KIND);
    assert.equal(new Set(kinds).size, kinds.length);
    assert.deepEqual([...kinds].sort(), [...VEHICLE_KINDS].sort());
});
