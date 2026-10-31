/**
 * Contract tests for `vinpassport`.
 *
 * These run the COMPILED circuits against a local ledger, so an assertion that
 * fires here is the same assertion that would reject the transaction on chain.
 *
 * The suite is organised around one question per circuit, then the three that
 * actually matter for a vehicle passport:
 *
 *   MONOTONICITY  can a holder move a field the way it must never move?
 *   KNOWLEDGE     can someone write a field without knowing its current value?
 *   DISCLOSURE    does any field value ever reach the public ledger?
 *
 * Values are scaled x1000, matching `VALUE_SCALE` in `@odatano/dpp-sdk`, so a
 * a value of 96.4% is 96_400 here exactly as it would be in the field panel.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
    PassportSimulator, Rule, Tier, bytes32, hex, fieldKey, pureCircuits,
    REGISTRAR_SECRET, REGISTRAR_ID, SECOND_SECRET, SECOND_ID, OUTSIDER_SECRET,
    DEALER_SECRET, DEALER_ID, GARAGE_SECRET, GARAGE_ID, AUTHORITY_ID
} from './passport-simulator.mjs';

const VIN_A = bytes32(0x11);
const VIN_B = bytes32(0x22);
const ROOT = bytes32(0xaa);
const ROOT_B = bytes32(0xbb);
// What a registrar HOLDS. The id the chain records is derived from it.
const REGISTRAR = REGISTRAR_SECRET;

// Real field labels: blake2b-256 of the field name, as the SDK derives them.
const ODO = fieldKey('odometerKm');
const ACCIDENTS = fieldKey('accidentCount');
const OWNERS = fieldKey('ownerCount');
const WRITE_OFF = fieldKey('writeOffCategory');
// Every field the panel uses today only rises. This one stands in for a field
// that may only fall; see FIELDS in the simulator for why the contract keeps
// that direction available.
const DECLINING = fieldKey('reservedNumeric0');

const S1 = bytes32(0xd1);
const S2 = bytes32(0xd2);
const S3 = bytes32(0xd3);
const WRONG_SALT = bytes32(0xee);

const PCT = (n) => BigInt(Math.round(n * 1000));

/** A Compact `assert` failure, as the runtime surfaces it. */
const rejects = (message) => new RegExp(`failed assert: ${message}`);

let sim;
beforeEach(() => {
    sim = new PassportSimulator();
});

/** A registered vehicle with the five fields this suite exercises. */
function registered(vin = VIN_A, root = ROOT) {
    sim.registerPassport(vin, root, REGISTRAR);
    sim.initialiseField(vin, ODO, Rule.neverFalls, 12n, S1);
    sim.initialiseField(vin, ACCIDENTS, Rule.neverFalls, 0n, S1);
    sim.initialiseField(vin, OWNERS, Rule.neverFalls, 1n, S1);
    sim.initialiseField(vin, WRITE_OFF, Rule.neverFalls, 0n, S1);
    sim.initialiseField(vin, DECLINING, Rule.neverRises, PCT(100), S1);
}

// ---------------------------------------------------------------- registration

describe('registerPassport', () => {
    it('anchors the content root and the registrar against the VIN hash', () => {
        const l = sim.registerPassport(VIN_A, ROOT, REGISTRAR);

        expect(hex(l.passports.lookup(VIN_A))).toBe(hex(ROOT));
        expect(hex(l.registrar.lookup(VIN_A))).toBe(hex(REGISTRAR_ID));
    });

    it('creates no fields: registration and history are separate acts', () => {
        const l = sim.registerPassport(VIN_A, ROOT, REGISTRAR);

        expect(l.fieldCommitment.isEmpty()).toBe(true);
        expect(l.fieldRule.isEmpty()).toBe(true);
    });

    it('refuses to re-register a VIN, so a passport cannot be overwritten', () => {
        sim.registerPassport(VIN_A, ROOT, REGISTRAR);

        expect(() => sim.registerPassport(VIN_A, ROOT_B, REGISTRAR))
            .toThrow(rejects('passport already registered'));
    });

    it('keeps the first content root after a rejected re-registration', () => {
        sim.registerPassport(VIN_A, ROOT, REGISTRAR);
        try { sim.registerPassport(VIN_A, ROOT_B, REGISTRAR); } catch { /* expected */ }

        expect(hex(sim.ledger.passports.lookup(VIN_A))).toBe(hex(ROOT));
    });
});

// ------------------------------------------------------------- declarations

/** A type-approval declaration: slot 8, Art 6(1). Recycled plastic, 25%. */
const DECLARATION = fieldKey('recycledPlasticPct');

describe('a declaration that may never change', () => {
    beforeEach(() => {
        registered();
        sim.initialiseField(VIN_A, DECLARATION, Rule.neverChanges, PCT(25), S1);
    });

    it('accepts rewriting the identical value, which only re-salts it', () => {
        expect(() => sim.recordField(VIN_A, DECLARATION, PCT(25), S2)).not.toThrow();
    });

    it('REJECTS a quiet upward revision, the direction that flatters', () => {
        expect(() => sim.recordField(VIN_A, DECLARATION, PCT(30), S2))
            .toThrow(rejects('value changed'));
    });

    it('REJECTS a downward revision too, because it is not a lifecycle value', () => {
        expect(() => sim.recordField(VIN_A, DECLARATION, PCT(20), S2))
            .toThrow(rejects('value changed'));
    });

    it('leaves the commitment untouched after a refused revision', () => {
        // The whole ledger, not a counter: a refusal must write nothing at
        // all, and a snapshot says that where a tally only said "no more
        // writes than before".
        const before = JSON.stringify(sim.ledgerValues(), (k, v) =>
            typeof v === 'bigint' ? v.toString() : v);
        try { sim.recordField(VIN_A, DECLARATION, PCT(30), S2); } catch { /* expected */ }

        expect(JSON.stringify(sim.ledgerValues(), (k, v) =>
            typeof v === 'bigint' ? v.toString() : v)).toBe(before);
    });

    /**
     * The claim the regulation actually asks for. Art 6(1) sets 15% recycled
     * plastic from 2032 and 25% from 2036. A verifier needs to know the vehicle
     * clears the threshold; the manufacturer does not want to publish the
     * figure. That is a floor proof, and the value never reaches the ledger.
     */
    it('proves it clears the 2036 threshold without disclosing the figure', () => {
        expect(() => sim.proveFieldAtLeast(VIN_A, DECLARATION, PCT(25))).not.toThrow();
    });

    it('cannot prove a threshold it does not clear', () => {
        expect(() => sim.proveFieldAtLeast(VIN_A, DECLARATION, PCT(26)))
            .toThrow(rejects('value below the claimed bound'));
    });

    it('keeps the declared figure off the ledger', () => {
        sim.proveFieldAtLeast(VIN_A, DECLARATION, PCT(25));
        const { words } = sim.ledgerValues();

        // The bound is public and the figure is not, even though they are equal
        // here: what must be absent is any trace beyond the bound asserted.
        expect(words.filter((w) => w === PCT(25)).length).toBe(1);
    });
});

// ------------------------------------------------------------ document bind

describe('binding to the content root', () => {
    /**
     * The property a verifier actually needs: given the document, confirm a
     * claim is about THAT document and not merely about the vehicle.
     *
     * The check is theirs to run, not ours to assert: recompute the slot from
     * the vehicle, the field and the root they were handed, and compare it with
     * the slot the claim carries. `slotOf` is exported from the contract so the
     * recomputation is the contract's own, not a reimplementation of it.
     */
    it('lets a holder of the document recompute a claim\'s slot', () => {
        registered();
        const l = sim.proveFieldAtMost(VIN_A, ODO, 20n);
        const [, claim] = [...l.claims][0];

        expect(hex(claim.slot)).toBe(hex(pureCircuits.slotOf(VIN_A, ODO, ROOT)));
    });

    it('gives a different slot for a different document, so the check can fail', () => {
        registered();
        const l = sim.proveFieldAtMost(VIN_A, ODO, 20n);
        const [, claim] = [...l.claims][0];

        // Without this the test above would pass for any root at all, and the
        // binding would be decoration.
        expect(hex(claim.slot)).not.toBe(hex(pureCircuits.slotOf(VIN_A, ODO, ROOT_B)));
    });

    it('separates the same field on two vehicles', () => {
        registered(VIN_A, ROOT);
        registered(VIN_B, ROOT_B);

        expect(hex(pureCircuits.slotOf(VIN_A, ODO, ROOT)))
            .not.toBe(hex(pureCircuits.slotOf(VIN_B, ODO, ROOT_B)));
    });

    it('stores one commitment per vehicle for the same field', () => {
        registered(VIN_A, ROOT);
        registered(VIN_B, ROOT_B);
        const l = sim.ledger;

        // Ten commitments, five fields on each of two vehicles, none shared.
        expect(l.fieldCommitment.size()).toBe(10n);
    });
});

// ---------------------------------------------------------------- authority

describe('registrar authority', () => {
    it('records the DERIVED identity, never the secret behind it', () => {
        const l = sim.registerPassport(VIN_A, ROOT, REGISTRAR_SECRET);

        expect(hex(l.registrar.lookup(VIN_A))).toBe(hex(REGISTRAR_ID));
        // The two must differ, or the test above would prove nothing.
        expect(hex(REGISTRAR_ID)).not.toBe(hex(REGISTRAR_SECRET));
    });

    it('refuses a secret that was never put on the deploy list', () => {
        expect(() => sim.registerPassport(VIN_A, ROOT, OUTSIDER_SECRET))
            .toThrow(rejects('not an authorised registrar'));
    });

    it('leaves nothing registered after refusing an outsider', () => {
        try { sim.registerPassport(VIN_A, ROOT, OUTSIDER_SECRET); } catch { /* expected */ }

        expect(sim.ledger.passports.isEmpty()).toBe(true);
        expect(sim.ledger.registrar.isEmpty()).toBe(true);
    });

    it('cannot be widened by any circuit: the deploy list is the whole list', () => {
        const before = sim.ledger.allowedRegistrars.size();
        registered();

        expect(sim.ledger.allowedRegistrars.size()).toBe(before);
        expect(sim.ledger.allowedRegistrars.member(REGISTRAR_ID)).toBe(true);
        expect(sim.ledger.allowedRegistrars.member(SECOND_ID)).toBe(false);
    });

    it('stops another listed registrar creating a field on a vehicle it did not register', () => {
        const two = new PassportSimulator([REGISTRAR_ID, SECOND_ID]);
        two.registerPassport(VIN_A, ROOT, REGISTRAR_SECRET);

        expect(() => two.initialiseField(VIN_A, ODO, Rule.neverFalls, 10n, S1, SECOND_SECRET))
            .toThrow(rejects('not the registrar for this vehicle'));
    });

    it('stops another listed registrar writing history on a vehicle it did not register', () => {
        const two = new PassportSimulator([REGISTRAR_ID, SECOND_ID]);
        two.registerPassport(VIN_A, ROOT, REGISTRAR_SECRET);
        two.initialiseField(VIN_A, ODO, Rule.neverFalls, 10n, S1, REGISTRAR_SECRET);

        expect(() => two.recordField(VIN_A, ODO, 20n, S2, undefined, SECOND_SECRET))
            .toThrow(rejects('not the registrar for this vehicle'));
    });

    it('keeps the field untouched after refusing the wrong registrar', () => {
        const two = new PassportSimulator([REGISTRAR_ID, SECOND_ID]);
        two.registerPassport(VIN_A, ROOT, REGISTRAR_SECRET);
        two.initialiseField(VIN_A, ODO, Rule.neverFalls, 10n, S1, REGISTRAR_SECRET);
        const before = JSON.stringify(two.ledgerValues(), (k, v) =>
            typeof v === 'bigint' ? v.toString() : v);

        try { two.recordField(VIN_A, ODO, 20n, S2, undefined, SECOND_SECRET); } catch { /* expected */ }

        expect(JSON.stringify(two.ledgerValues(), (k, v) =>
            typeof v === 'bigint' ? v.toString() : v)).toBe(before);
    });

    it('still lets ANYONE prove a claim, which is a separate right from writing', () => {
        registered();

        // No registrar secret is involved in a proof: holding the opening is
        // the authorisation, and that is deliberate.
        const l = sim.actAs(OUTSIDER_SECRET).proveFieldAtMost(VIN_A, ODO, 20n);

        expect(l.claims.size()).toBe(1n);
    });

    it('never writes a registrar secret to the ledger', () => {
        registered();
        const { blobs } = sim.ledgerValues();

        expect(blobs).not.toContain(hex(REGISTRAR_SECRET));
        expect(blobs).toContain(hex(REGISTRAR_ID));
    });
});

// ------------------------------------------------------------------- creation

describe('initialiseField', () => {
    it('will not create a field on a vehicle that has no passport', () => {
        expect(() => sim.initialiseField(VIN_A, ODO, Rule.neverFalls, 12n, S1))
            .toThrow(rejects('unknown passport'));
    });

    it('stores a commitment and counts the update', () => {
        sim.registerPassport(VIN_A, ROOT, REGISTRAR);
        const l = sim.initialiseField(VIN_A, ODO, Rule.neverFalls, 12_000n, S1);

        expect(l.fieldCommitment.size()).toBe(1n);
        // The rule and the writer are written with the commitment, and all
        // three are fresh keys, which is what lets initialisations batch.
        expect(l.fieldRule.size()).toBe(1n);
        expect(l.fieldWriter.size()).toBe(1n);
    });

    it('stores a commitment, not the value and not the salt', () => {
        sim.registerPassport(VIN_A, ROOT, REGISTRAR);
        sim.initialiseField(VIN_A, ODO, Rule.neverFalls, 12_000n, S1);

        const { words, blobs } = sim.ledgerValues();
        expect(words).not.toContain(12_000n);
        expect(blobs).not.toContain(hex(S1));
    });

    it('records the rule each field was created under', () => {
        registered();
        const l = sim.ledger;
        const rules = [...l.fieldRule].map(([, rule]) => rule);

        expect(rules.filter((r) => r === Rule.neverFalls)).toHaveLength(4);
        expect(rules.filter((r) => r === Rule.neverRises)).toHaveLength(1);
    });

    it('refuses a second creation, which would silently reset history', () => {
        registered();

        expect(() => sim.initialiseField(VIN_A, ODO, Rule.neverFalls, 5n, S2))
            .toThrow(rejects('field already initialised'));
    });

    it('REFUSES to recreate a field under a friendlier rule', () => {
        // The attack this blocks: create a field under one rule, then recreate
        // it under the friendlier one so the value can move the forbidden way.
        registered();

        expect(() => sim.initialiseField(VIN_A, DECLINING, Rule.neverFalls, PCT(100), S2))
            .toThrow(rejects('field already initialised'));
        expect(sim.ledger.fieldRule.lookup([...sim.ledger.fieldRule].find(
            ([, r]) => r === Rule.neverRises
        )[0])).toBe(Rule.neverRises);
    });

    it('gives two vehicles holding the SAME value different commitments', () => {
        // If salting were broken, an observer could group vehicles by mileage.
        sim.registerPassport(VIN_A, ROOT, REGISTRAR);
        sim.registerPassport(VIN_B, ROOT_B, REGISTRAR);
        sim.initialiseField(VIN_A, ODO, Rule.neverFalls, 12_000n, S1);
        sim.initialiseField(VIN_B, ODO, Rule.neverFalls, 12_000n, S2);

        const commitments = [...sim.ledger.fieldCommitment].map(([, c]) => hex(c));
        expect(new Set(commitments).size).toBe(2);
    });

    it('gives two fields of one vehicle holding the same value different slots', () => {
        registered();
        // accidentCount, writeOffCategory and ownerCount were seeded 0, 0, 1.
        expect(sim.ledger.fieldCommitment.size()).toBe(5n);
    });
});

// ------------------------------------------------------ fields that never fall

describe('recordField: a field that may never fall', () => {
    beforeEach(() => { registered(); });

    it('rejects a write to a vehicle that has no passport', () => {
        expect(() => sim.recordField(VIN_B, ODO, 20_000n, S2))
            .toThrow(rejects('unknown passport'));
    });

    it('rejects a write to a field that was never created', () => {
        expect(() => sim.recordField(VIN_A, fieldKey('serviceCount'), 1n, S2))
            .toThrow(rejects('field not initialised'));
    });

    it('accepts a higher odometer and replaces the commitment', () => {
        const before = [...sim.ledger.fieldCommitment].map(([, c]) => hex(c));
        const l = sim.recordField(VIN_A, ODO, 18_430n, S2);
        const after = [...l.fieldCommitment].map(([, c]) => hex(c));

        expect(after).not.toEqual(before);
    });

    it('accepts an unchanged odometer: a vehicle can sit still', () => {
        expect(() => sim.recordField(VIN_A, ODO, 12n, S2)).not.toThrow();
    });

    it('REJECTS a lowered odometer: the anti-rollback property', () => {
        sim.recordField(VIN_A, ODO, 18_430n, S2);

        expect(() => sim.recordField(VIN_A, ODO, 9_000n, S3))
            .toThrow(rejects('value decreased'));
    });

    it('rejects a rollback by one kilometre, not just an obvious one', () => {
        sim.recordField(VIN_A, ODO, 18_430n, S2);

        expect(() => sim.recordField(VIN_A, ODO, 18_429n, S3))
            .toThrow(rejects('value decreased'));
    });

    it('REJECTS erasing an accident', () => {
        sim.recordField(VIN_A, ACCIDENTS, 1n, S2);

        expect(() => sim.recordField(VIN_A, ACCIDENTS, 0n, S3))
            .toThrow(rejects('value decreased'));
    });

    it('REJECTS clearing a write-off: the title-washing move', () => {
        sim.recordField(VIN_A, WRITE_OFF, 2n, S2);   // category S, structural

        expect(() => sim.recordField(VIN_A, WRITE_OFF, 0n, S3))
            .toThrow(rejects('value decreased'));
    });

    it('REJECTS reducing the keeper count', () => {
        sim.recordField(VIN_A, OWNERS, 3n, S2);

        expect(() => sim.recordField(VIN_A, OWNERS, 1n, S3))
            .toThrow(rejects('value decreased'));
    });

    it('leaves the ledger untouched when a write is rejected', () => {
        const before = [...sim.ledger.fieldCommitment].map(([k, c]) => hex(k) + hex(c));
        try { sim.recordField(VIN_A, ODO, 5n, S2); } catch { /* expected */ }
        const after = sim.ledger;

        expect([...after.fieldCommitment].map(([k, c]) => hex(k) + hex(c))).toEqual(before);
        expect(after.fieldCommitment.size()).toBe(5n);
    });
});

// ------------------------------------------------------ fields that never rise

describe('recordField: a field that may never rise', () => {
    beforeEach(() => { registered(); });

    it('accepts degradation', () => {
        const slot = hex(pureCircuits.slotOf(VIN_A, DECLINING, ROOT));
        const was = hex(sim.ledger.fieldCommitment.lookup(
            pureCircuits.slotOf(VIN_A, DECLINING, ROOT)));
        const l = sim.recordField(VIN_A, DECLINING, PCT(96.4), S2);

        // The commitment moved, which is the only public sign a value did.
        expect(hex(l.fieldCommitment.lookup(
            pureCircuits.slotOf(VIN_A, DECLINING, ROOT)))).not.toBe(was);
        expect(slot).toHaveLength(64);
    });

    it('accepts an unchanged reading', () => {
        expect(() => sim.recordField(VIN_A, DECLINING, PCT(100), S2)).not.toThrow();
    });

    it('REJECTS a value that climbed back up', () => {
        // The mirror of the rollback case. A field created under neverRises has
        // declared that it only ever falls, and the circuit holds it to that
        // for the life of the passport.
        sim.recordField(VIN_A, DECLINING, PCT(96.4), S2);

        expect(() => sim.recordField(VIN_A, DECLINING, PCT(99), S3))
            .toThrow(rejects('value increased'));
    });

    it('rejects an increase of a tenth of a percent', () => {
        sim.recordField(VIN_A, DECLINING, PCT(96.4), S2);

        expect(() => sim.recordField(VIN_A, DECLINING, PCT(96.5), S3))
            .toThrow(rejects('value increased'));
    });

    it('accepts a long declining history', () => {
        const slot = pureCircuits.slotOf(VIN_A, DECLINING, ROOT);
        const first = hex(sim.ledger.fieldCommitment.lookup(slot));
        sim.recordField(VIN_A, DECLINING, PCT(96.4), S2);
        sim.recordField(VIN_A, DECLINING, PCT(94.1), S3);
        const l = sim.recordField(VIN_A, DECLINING, PCT(91.8), bytes32(0xd4));

        // Three accepted steps down, and still exactly one commitment for
        // the field: history is depth, not breadth, on this ledger.
        expect(hex(l.fieldCommitment.lookup(slot))).not.toBe(first);
        expect(l.fieldCommitment.size()).toBe(5n);
    });

    it('applies the opposite rule to another field on the SAME vehicle', () => {
        // The point of storing the rule per field: one vehicle, two directions,
        // and neither field can borrow the other's rule.
        expect(() => sim.recordField(VIN_A, ODO, 5n, S2))
            .toThrow(rejects('value decreased'));
        expect(() => {
            sim.recordField(VIN_A, DECLINING, PCT(96), S2);
            sim.recordField(VIN_A, DECLINING, PCT(97), S3);
        }).toThrow(rejects('value increased'));
    });
});

// ------------------------------------------------------------- knowing the value

describe('recordField: proving you know the current value', () => {
    beforeEach(() => { registered(); });

    it('rejects a caller who does not know the current VALUE', () => {
        expect(() => sim.recordField(VIN_A, ODO, 25_000n, S2, { value: 11n, salt: S1 }))
            .toThrow(rejects('previous value does not open the stored commitment'));
    });

    it('rejects a caller who does not know the current SALT', () => {
        expect(() => sim.recordField(VIN_A, ODO, 25_000n, S2, { value: 12n, salt: WRONG_SALT }))
            .toThrow(rejects('previous value does not open the stored commitment'));
    });

    it('rejects a rollback dressed up with a matching false opening', () => {
        // To get 5 accepted, a seller must first convince the circuit that the
        // stored commitment opens to something no greater than 5. It does not,
        // so this fails on the opening rather than on monotonicity: there is
        // no order of operations that gets a rollback through.
        expect(() => sim.recordField(VIN_A, ODO, 5n, S2, { value: 4n, salt: S1 }))
            .toThrow(rejects('previous value does not open the stored commitment'));
    });

    it('rejects opening one field with another field\'s value', () => {
        // odometer is 12, accidents is 0, both on the same vehicle, both under
        // the same salt. The slots must still be independent.
        expect(() => sim.recordField(VIN_A, ACCIDENTS, 1n, S2, { value: 12n, salt: S1 }))
            .toThrow(rejects('previous value does not open the stored commitment'));
    });

    it('keeps two vehicles isolated', () => {
        registered(VIN_B, ROOT_B);
        const beforeB = [...sim.ledger.fieldCommitment].length;

        sim.recordField(VIN_A, ODO, 18_430n, S2);

        expect([...sim.ledger.fieldCommitment].length).toBe(beforeB);
    });
});

// ------------------------------------------------------------------- thresholds

describe('proveFieldAtMost', () => {
    beforeEach(() => {
        registered();
        sim.recordField(VIN_A, ODO, 120_000n, S2);
    });

    it('rejects a ceiling proof about an unregistered vehicle', () => {
        expect(() => sim.proveFieldAtMost(VIN_B, ODO, 1n))
            .toThrow(rejects('unknown passport'));
    });

    it('rejects a proof about a field that does not exist', () => {
        expect(() => sim.proveFieldAtMost(VIN_A, fieldKey('co2FootprintKgCO2e'), 1n))
            .toThrow(rejects('field not initialised'));
    });

    it('proves the odometer is under a bound', () => {
        expect(() => sim.proveFieldAtMost(VIN_A, ODO, 150_000n)).not.toThrow();
    });

    it('accepts a value exactly on the bound', () => {
        expect(() => sim.proveFieldAtMost(VIN_A, ODO, 120_000n)).not.toThrow();
    });

    it('REJECTS a bound the value exceeds', () => {
        expect(() => sim.proveFieldAtMost(VIN_A, ODO, 100_000n))
            .toThrow(rejects('value above the claimed bound'));
    });

    it('rejects a bound the value exceeds by one', () => {
        expect(() => sim.proveFieldAtMost(VIN_A, ODO, 119_999n))
            .toThrow(rejects('value above the claimed bound'));
    });

    it('proves "never had a reported accident" as a bound of zero', () => {
        expect(() => sim.proveFieldAtMost(VIN_A, ACCIDENTS, 0n)).not.toThrow();
    });

    it('fails that claim once an accident is on record', () => {
        sim.recordField(VIN_A, ACCIDENTS, 1n, S3);

        expect(() => sim.proveFieldAtMost(VIN_A, ACCIDENTS, 0n))
            .toThrow(rejects('value above the claimed bound'));
    });

    it('proves "never written off" as a bound of zero', () => {
        expect(() => sim.proveFieldAtMost(VIN_A, WRITE_OFF, 0n)).not.toThrow();
    });

    it('cannot be satisfied by claiming a flattering value', () => {
        expect(() => sim.proveFieldAtMost(VIN_A, ODO, 100_000n, { value: 50_000n, salt: S2 }))
            .toThrow(rejects('value does not open the stored commitment'));
    });

    it('changes nothing: a query is not an update', () => {
        // A proof inserts a claim, so the ledger does change. What must not
        // change is any FIELD: proving is a separate act from writing.
        const before = [...sim.ledger.fieldCommitment].map(([k, c]) => hex(k) + hex(c));
        sim.proveFieldAtMost(VIN_A, ODO, 150_000n);

        expect([...sim.ledger.fieldCommitment].map(([k, c]) => hex(k) + hex(c))).toEqual(before);
    });

    it('tracks the current value, not the first one', () => {
        expect(() => sim.proveFieldAtMost(VIN_A, ODO, 100n))
            .toThrow(rejects('value above the claimed bound'));
    });
});

describe('proveFieldAtLeast', () => {
    beforeEach(() => {
        registered();
        sim.recordField(VIN_A, DECLINING, PCT(96.4), S2);
    });

    it('proves a value is above a floor', () => {
        expect(() => sim.proveFieldAtLeast(VIN_A, DECLINING, PCT(90))).not.toThrow();
    });

    // The mirror of the same case under proveFieldAtMost. Added because the
    // mutation harness showed this guard could be deleted with the suite still
    // green, which made it the one assertion in the contract that nothing
    // depended on. A floor proved about a field that does not exist would be a
    // claim about nothing.
    it('rejects a floor proof about an unregistered vehicle', () => {
        expect(() => sim.proveFieldAtLeast(VIN_B, DECLINING, 1n))
            .toThrow(rejects('unknown passport'));
    });

    it('rejects a proof about a field that does not exist', () => {
        expect(() => sim.proveFieldAtLeast(VIN_A, fieldKey('co2FootprintKgCO2e'), 1n))
            .toThrow(rejects('field not initialised'));
    });

    it('accepts a value exactly on the floor', () => {
        expect(() => sim.proveFieldAtLeast(VIN_A, DECLINING, PCT(96.4))).not.toThrow();
    });

    it('REJECTS a floor the value falls short of', () => {
        expect(() => sim.proveFieldAtLeast(VIN_A, DECLINING, PCT(98)))
            .toThrow(rejects('value below the claimed bound'));
    });

    it('fails the claim once the value has fallen past it', () => {
        sim.recordField(VIN_A, DECLINING, PCT(88), S3);

        expect(() => sim.proveFieldAtLeast(VIN_A, DECLINING, PCT(90)))
            .toThrow(rejects('value below the claimed bound'));
    });

    it('cannot be satisfied with the right value and the wrong salt', () => {
        expect(() => sim.proveFieldAtLeast(VIN_A, DECLINING, PCT(90), { value: PCT(96.4), salt: WRONG_SALT }))
            .toThrow(rejects('value does not open the stored commitment'));
    });

    it('changes nothing', () => {
        const before = [...sim.ledger.fieldCommitment].map(([k, c]) => hex(k) + hex(c));
        sim.proveFieldAtLeast(VIN_A, DECLINING, PCT(90));

        expect([...sim.ledger.fieldCommitment].map(([k, c]) => hex(k) + hex(c))).toEqual(before);
    });
});

// ------------------------------------------------------ the disclosure claim

describe('claims: what a verifier can read afterwards', () => {
    // A proof circuit that only asserted would leave nothing behind: the
    // transaction's success IS the proof, but nothing would index it by
    // vehicle, so a scan-to-verdict page would have no state to read.

    /** The single claim on the ledger, when exactly one is expected. */
    const onlyClaim = () => {
        const l = sim.ledger;
        expect(l.claims.size()).toBe(1n);
        for (const [, claim] of l.claims) { return claim; }
        throw new Error('unreachable: size() said 1');
    };

    it('records a claim when the proof succeeds', () => {
        registered();
        sim.proveFieldAtMost(VIN_A, WRITE_OFF, 0n);

        const claim = onlyClaim();
        expect(hex(claim.vinHash)).toBe(hex(VIN_A));
        expect(hex(claim.fieldKey)).toBe(hex(WRITE_OFF));
        expect(claim.bound).toBe(0n);
        expect(claim.atMost).toBe(true);
    });

    it('records nothing when the proof fails', () => {
        // The transaction aborts, so the ledger write never happens. A claims
        // ledger that could be written by a failed proof would be worse than
        // no claims ledger at all.
        registered();
        sim.recordField(VIN_A, ACCIDENTS, 2n, S2);

        expect(() => sim.proveFieldAtMost(VIN_A, ACCIDENTS, 0n))
            .toThrow(rejects('value above the claimed bound'));
        expect(sim.ledger.claims.size()).toBe(0n);
    });

    it('binds the claim to the value it was proven against', () => {
        // The commitment in the claim is the version of the field the proof
        // opened. A verifier compares it against the CURRENT commitment for
        // the same slot; equal means live, different means superseded.
        registered();
        sim.proveFieldAtMost(VIN_A, ODO, 300_000n);

        const claim = onlyClaim();
        const l = sim.ledger;
        expect(hex(l.fieldCommitment.lookup(claim.slot))).toBe(hex(claim.commitment));
    });

    it('a later reading leaves the old claim standing but no longer current', () => {
        // This is the property that stops a claim quietly becoming a lie. The
        // odometer passes 300 000; the old "at most 300 000" is still on the
        // ledger, but it no longer describes the current value, and a verifier
        // can see that without being told.
        registered();
        sim.proveFieldAtMost(VIN_A, ODO, 300_000n);
        const claim = onlyClaim();

        sim.recordField(VIN_A, ODO, 310_000n, S2);

        const l = sim.ledger;
        expect(l.claims.size()).toBe(1n);                      // still there
        expect(hex(l.fieldCommitment.lookup(claim.slot)))
            .not.toBe(hex(claim.commitment));                  // no longer current
    });

    it('re-proving the same claim about the same value is idempotent', () => {
        registered();
        sim.proveFieldAtMost(VIN_A, WRITE_OFF, 0n);
        sim.proveFieldAtMost(VIN_A, WRITE_OFF, 0n);

        expect(sim.ledger.claims.size()).toBe(1n);
    });

    it('separates a ceiling from a floor at the same bound', () => {
        // "at most 0" and "at least 0" are different claims about the same
        // field. Domain separation in the claim key is what keeps them apart;
        // without it one would silently overwrite the other.
        registered();
        sim.proveFieldAtMost(VIN_A, ACCIDENTS, 0n);
        sim.proveFieldAtLeast(VIN_A, ACCIDENTS, 0n);

        const l = sim.ledger;
        expect(l.claims.size()).toBe(2n);
        const directions = [];
        for (const [, c] of l.claims) { directions.push(c.atMost); }
        expect(directions.sort()).toEqual([false, true]);
    });

    it('separates two bounds on the same field', () => {
        registered();
        sim.proveFieldAtMost(VIN_A, ODO, 300_000n);
        sim.proveFieldAtMost(VIN_A, ODO, 400_000n);

        expect(sim.ledger.claims.size()).toBe(2n);
    });

    it('published claims narrow the value, which is the cost of recording them', () => {
        // Read from the observer's side, because that is the only side that
        // matters here, and reading public ledger state is not an attack:
        // anyone may do it. Every claim publishes its bound, claims
        // accumulate rather than replace, and nothing limits how many a slot
        // may carry. A reader holding no witness and no salt can therefore
        // intersect the bounds and squeeze the value towards a point.
        //
        // This is not a defect in the circuits: they disclose exactly what
        // they were asked to. It is the price of recording a verdict instead
        // of re-proving it on demand (D19), and the README states it under
        // "What a published claim gives away". The test exists so that
        // statement cannot quietly stop being true, in either direction.
        registered();
        sim.recordField(VIN_A, ODO, 91_500n, S2);

        sim.proveFieldAtLeast(VIN_A, ODO, 90_000n);
        sim.proveFieldAtMost(VIN_A, ODO, 100_000n);

        // Nothing below touches a witness. This is ledger state only.
        let lo = 0n;
        let hi = (1n << 64n) - 1n;
        for (const [, c] of sim.ledger.claims) {
            if (hex(c.fieldKey) !== hex(ODO)) continue;
            if (c.atMost) { if (c.bound < hi) hi = c.bound; }
            else if (c.bound > lo) lo = c.bound;
        }

        expect(lo).toBe(90_000n);
        expect(hi).toBe(100_000n);
        expect(hi - lo).toBe(10_000n);     // a 10,000 wide window, from public data alone
        expect(lo <= 91_500n && 91_500n <= hi).toBe(true);   // and it does contain the reading

        // The reading itself is still absent: narrowed is not the same as
        // disclosed, and the distinction is the whole point of the paragraph.
        const { words } = sim.ledgerValues();
        expect(words).not.toContain(91_500n);
    });

    it('a bound of zero fixes the value exactly, and that is a disclosure', () => {
        // "Never written off" is proveFieldAtMost(.., 0). The field is a
        // Uint<64>, so value <= 0 and value >= 0 leave exactly one
        // possibility. The holder chose to reveal it; the claim did not keep
        // it hidden. Said here because the README used to say the value stays
        // private in every case, and for this shape it does not.
        registered();
        sim.proveFieldAtMost(VIN_A, WRITE_OFF, 0n);

        let fixed = null;
        for (const [, c] of sim.ledger.claims) {
            if (c.atMost && c.bound === 0n) fixed = 0n;   // unsigned: nothing below it
        }
        expect(fixed).toBe(0n);
    });

    it('separates the same claim about two different vehicles', () => {
        registered(VIN_A, ROOT);
        registered(VIN_B, ROOT_B);
        sim.proveFieldAtMost(VIN_A, WRITE_OFF, 0n);
        sim.proveFieldAtMost(VIN_B, WRITE_OFF, 0n);

        const l = sim.ledger;
        expect(l.claims.size()).toBe(2n);
        const vins = [];
        for (const [, c] of l.claims) { vins.push(hex(c.vinHash)); }
        expect(vins.sort()).toEqual([hex(VIN_A), hex(VIN_B)].sort());
    });

    it('records a floor claim from proveFieldAtLeast', () => {
        registered();
        sim.proveFieldAtLeast(VIN_A, DECLINING, PCT(90));

        const claim = onlyClaim();
        expect(hex(claim.fieldKey)).toBe(hex(DECLINING));
        expect(claim.bound).toBe(PCT(90));
        expect(claim.atMost).toBe(false);
    });

    it('carries everything a verifier needs without computing a hash', () => {
        // The scan page is plain JS with no build step, so it cannot run
        // persistentHash to derive a key. Every field it needs to render a
        // verdict has to be readable straight off the claim. See D19.
        registered();
        sim.proveFieldAtMost(VIN_A, WRITE_OFF, 0n);

        const claim = onlyClaim();
        for (const part of ['slot', 'vinHash', 'fieldKey', 'commitment']) {
            expect(claim[part]).toBeInstanceOf(Uint8Array);
            expect(claim[part]).toHaveLength(32);
        }
        expect(typeof claim.bound).toBe('bigint');
        expect(typeof claim.atMost).toBe('boolean');
    });
});

describe('what the public ledger never learns', () => {
    // The claim VINPassport makes to a regulator is that a vehicle's history is
    // attributable without being published. That is one property, and it is
    // worth testing directly rather than inferring it from the API shape.

    const HISTORY = [12n, 18_430n, 99_999n, 250_000n];

    /** How a leaked Uint<64> would plausibly appear as bytes: padded to 8 or 32. */
    const encodings = (value) => [8, 32].map((width) => {
        const out = new Uint8Array(width);
        let v = value;
        for (let i = width - 1; i >= 0 && v > 0n; i--) {
            out[i] = Number(v & 0xffn);
            v >>= 8n;
        }
        return hex(out);
    });

    it('never writes a field value to the ledger, at any point in a history', () => {
        registered();
        const salts = [S2, S3, bytes32(0xd4)];
        for (const [i, value] of HISTORY.slice(1).entries()) {
            sim.recordField(VIN_A, ODO, value, salts[i]);
        }
        sim.recordField(VIN_A, DECLINING, PCT(96.4), bytes32(0xd5));
        sim.proveFieldAtMost(VIN_A, ODO, 300_000n);
        sim.proveFieldAtLeast(VIN_A, DECLINING, PCT(90));

        const { words, blobs } = sim.ledgerValues();
        for (const value of [...HISTORY, PCT(96.4), PCT(100)]) {
            expect(words).not.toContain(value);
            for (const encoded of encodings(value)) {
                expect(blobs).not.toContain(encoded);
            }
        }
    });

    it('never writes a salt to the ledger', () => {
        registered();
        sim.recordField(VIN_A, ODO, 18_430n, S2);

        const { blobs } = sim.ledgerValues();
        for (const salt of [S1, S2]) {
            expect(blobs).not.toContain(hex(salt));
        }
    });

    it('does not reveal WHICH field a slot holds, until a claim names it', () => {
        // The slot key is a domain-separated hash of the VIN and the field
        // label. An observer who does not already know both cannot tell the
        // odometer's slot from the write-off category's.
        registered();
        const { blobs } = sim.ledgerValues();

        for (const label of [ODO, ACCIDENTS, OWNERS, WRITE_OFF, DECLINING]) {
            expect(blobs).not.toContain(hex(label));
        }
    });

    it('a proven claim publishes which field it is about, by design', () => {
        // This is a DISCLOSURE, and it is deliberate: a verdict a verifier
        // cannot read is not a verdict. Proving "never written off" has to say
        // that it is the write-off category being claimed about.
        //
        // What it does NOT publish is the value. That distinction is the whole
        // design, so it is pinned here rather than left to the prose.
        registered();
        sim.proveFieldAtMost(VIN_A, WRITE_OFF, 0n);

        const { words, blobs } = sim.ledgerValues();
        expect(blobs).toContain(hex(WRITE_OFF));   // the field, deliberately
        expect(blobs).toContain(hex(VIN_A));       // already public via passports

        // The other fields stay unnamed: only what was claimed about surfaces.
        for (const label of [ODO, ACCIDENTS, OWNERS, DECLINING]) {
            expect(blobs).not.toContain(hex(label));
        }
        // 0 is both the bound and the value here, so it cannot be used to
        // separate them. A field whose value differs from its bound can.
        sim.proveFieldAtMost(VIN_A, ODO, 300_000n);
        const after = sim.ledgerValues();
        expect(after.words).toContain(300_000n);   // the bound is public
        expect(after.words).not.toContain(12n);    // the reading is not
    });

    it('the collector would actually catch a leak', () => {
        // A privacy test that can only ever pass is not a test. This pins the
        // collector itself: values that ARE on the ledger must be found by the
        // same search the assertions above rely on.
        registered();

        const { words, blobs } = sim.ledgerValues();
        expect(blobs).toContain(hex(ROOT));          // public by design
        expect(blobs).toContain(hex(REGISTRAR_ID));  // public by design

        // The integrity rules are public by design, and with the global
        // counter gone they are now the ONLY numbers a registered vehicle
        // puts on the ledger: one per field and nothing else. So this pins
        // the collector and states the stronger property at the same time.
        expect(words).toContain(BigInt(Rule.neverRises));
        expect(words).toHaveLength(5);

        // And the pairing that matters: the id is published, the secret it
        // came from is not. If the collector ever found the secret, every
        // privacy assertion in this block would be worthless.
        expect(blobs).not.toContain(hex(REGISTRAR_SECRET));
    });

    it('publishes exactly what a verifier needs and nothing else', () => {
        registered();
        const l = sim.ledger;

        expect(hex(l.passports.lookup(VIN_A))).toBe(hex(ROOT));
        expect(hex(l.registrar.lookup(VIN_A))).toBe(hex(REGISTRAR_ID));
        expect(l.fieldCommitment.size()).toBe(5n);
        for (const [, commitment] of l.fieldCommitment) {
            expect(hex(commitment)).toHaveLength(64);
        }
    });

    it('a pristine car and a wreck are indistinguishable on the ledger', () => {
        registered();
        const mine = sim.ledger.fieldCommitment.size();

        const other = new PassportSimulator();
        other.registerPassport(VIN_A, ROOT, REGISTRAR);
        other.initialiseField(VIN_A, ODO, Rule.neverFalls, 999_999n, S1);
        other.initialiseField(VIN_A, ACCIDENTS, Rule.neverFalls, 7n, S1);
        other.initialiseField(VIN_A, OWNERS, Rule.neverFalls, 9n, S1);
        other.initialiseField(VIN_A, WRITE_OFF, Rule.neverFalls, 2n, S1);
        other.initialiseField(VIN_A, DECLINING, Rule.neverRises, PCT(41), S1);

        // A pristine one-owner car and a written-off wreck. Same number of
        // fields, same rules, and no public number that came from a value:
        // with the global counter gone there is not even a tally to compare.
        expect(other.ledger.fieldCommitment.size()).toBe(mine);
        expect(other.ledgerValues().words).toEqual(sim.ledgerValues().words);
    });
});

// ---------------------------------------------------------------- disclosure

describe('selective disclosure: one field, not the panel', () => {
    // A run receipt is the holder's master copy and opens every field. Handing
    // it to a verifier who asked about the mileage hands them the whole
    // vehicle, which contradicts the one sentence this project leads with. A
    // disclosure is the narrow answer, and these tests pin both halves: that
    // it verifies for the field it names, and that it is useless for any
    // other.
    //
    // The disclosure helpers recompute the slot and the commitment in plain
    // JavaScript. That only means anything if the arithmetic matches the
    // compiled circuit exactly, so the first test compares against ledger
    // state the real circuits wrote rather than against another JS value.

    // No plaintext `vin`: the simulator keys passports by a synthetic hash
    // that no real VIN string hashes to, and a disclosure is stronger without
    // one anyway. The VIN round trip is checked on its own below, with a
    // consistent pair.
    const RECEIPT = () => ({
        vinHash: hex(VIN_A),
        contentRoot: hex(ROOT),
        network: 'preprod',
        contractAddress: 'c8dc0aa4',
        fields: {
            odometerKm: [{ writeIndex: 0, value: '12', salt: hex(S1) }],
            accidentCount: [{ writeIndex: 0, value: '0', salt: hex(S1) }]
        }
    });

    it('recomputes the slot and the commitment the circuits actually wrote', async () => {
        const { slotOf, commitmentOf } = await import('../scripts/lib/disclosure.mjs');
        registered();

        const slot = slotOf(hex(VIN_A), hex(ODO), hex(ROOT));
        const stored = sim.ledger.fieldCommitment.lookup(slot);

        // 12n and S1 are what registered() initialised the odometer with.
        expect(hex(commitmentOf(12n, hex(S1)))).toBe(hex(stored));
    });

    it('verifies the field it names, against real ledger state', async () => {
        const { buildDisclosure, verifyDisclosure } = await import('../scripts/lib/disclosure.mjs');
        registered();

        const d = buildDisclosure(RECEIPT(), ['odometerKm']);
        const onChain = (slotHex) => {
            try { return hex(sim.ledger.fieldCommitment.lookup(Uint8Array.from(Buffer.from(slotHex, 'hex')))); }
            catch { return null; }
        };

        const r = verifyDisclosure(d, onChain);
        expect(r.ok).toBe(true);
        expect(r.fields).toHaveLength(1);
        expect(r.fields[0].fieldName).toBe('odometerKm');
    });

    it('carries no seed, and nothing that opens another field', async () => {
        const { buildDisclosure } = await import('../scripts/lib/disclosure.mjs');
        const d = buildDisclosure(RECEIPT(), ['odometerKm']);
        const text = JSON.stringify(d);

        for (const banned of ['runSeed', 'saltRule', 'seed']) {
            expect(Object.keys(d)).not.toContain(banned);
        }
        // The other field's salt and name must be absent entirely: not merely
        // unreferenced, but not present as bytes anywhere in the document.
        expect(d.fields.map((f) => f.fieldName)).toEqual(['odometerKm']);
        expect(text).not.toContain('accidentCount');
        expect(text).not.toContain(hex(ACCIDENTS));
    });

    it('a disclosure for one field cannot open another, even on the same salt', async () => {
        const { buildDisclosure, verifyDisclosure, slotOf } = await import('../scripts/lib/disclosure.mjs');
        registered();

        const d = buildDisclosure(RECEIPT(), ['odometerKm']);
        // Point the one disclosed opening at the accident slot. The commitment
        // is over a different value, so it cannot match, and this is the
        // check that a salt is not a skeleton key.
        d.fields[0].fieldName = 'accidentCount';
        d.fields[0].fieldKey = hex(ACCIDENTS);
        d.fields[0].slot = hex(slotOf(hex(VIN_A), hex(ACCIDENTS), hex(ROOT)));

        const onChain = (slotHex) => {
            try { return hex(sim.ledger.fieldCommitment.lookup(Uint8Array.from(Buffer.from(slotHex, 'hex')))); }
            catch { return null; }
        };
        const r = verifyDisclosure(d, onChain);
        expect(r.ok).toBe(false);
        expect(r.fields[0].why).toMatch(/does not open/);
    });

    it('refuses an altered value, a moved slot and a wrong VIN', async () => {
        const { buildDisclosure, verifyDisclosure } = await import('../scripts/lib/disclosure.mjs');
        registered();
        const onChain = (slotHex) => {
            try { return hex(sim.ledger.fieldCommitment.lookup(Uint8Array.from(Buffer.from(slotHex, 'hex')))); }
            catch { return null; }
        };

        const flattering = buildDisclosure(RECEIPT(), ['odometerKm']);
        flattering.fields[0].value = '11';                       // one kilometre less
        expect(verifyDisclosure(flattering, onChain).ok).toBe(false);

        const moved = buildDisclosure(RECEIPT(), ['odometerKm']);
        moved.fields[0].slot = hex(bytes32(0x77));
        expect(verifyDisclosure(moved, onChain).fields[0].why).toMatch(/slot does not follow/);

        const wrongCar = buildDisclosure(RECEIPT(), ['odometerKm']);
        wrongCar.vin = 'WP0ZZZ99ZTS000000';     // a VIN that does not hash to vinHash
        const r = verifyDisclosure(wrongCar, onChain);
        expect(r.vinMatchesHash).toBe(false);
        expect(r.ok).toBe(false);
    });

    it('checks the VIN round trip when one is included, and omits it on request', async () => {
        const { buildDisclosure, verifyDisclosure, vinHashOf } = await import('../scripts/lib/disclosure.mjs');
        const VIN = 'WP0ZZZ99ZTS392124';

        // A consistent pair: this is the shape a real receipt has.
        const receipt = {
            vin: VIN,
            vinHash: hex(vinHashOf(VIN)),
            contentRoot: hex(ROOT),
            fields: { odometerKm: [{ writeIndex: 0, value: '12', salt: hex(S1) }] }
        };

        const named = buildDisclosure(receipt, ['odometerKm']);
        expect(named.vin).toBe(VIN);
        // No chain lookup here: the VIN round trip is what is under test, and
        // it is checked before anything is fetched.
        expect(verifyDisclosure(named).vinMatchesHash).toBe(true);

        // The stronger form: the document names no vehicle, and the verifier
        // supplies the VIN they read off the car.
        const anonymous = buildDisclosure(receipt, ['odometerKm'], { includeVin: false });
        expect(anonymous.vin).toBeUndefined();
        expect(JSON.stringify(anonymous)).not.toContain(VIN);
        expect(verifyDisclosure(anonymous).vinMatchesHash).toBe(null);
        // Still locates the same slot, so omitting the VIN costs the verifier
        // nothing once they have the car in front of them.
        expect(anonymous.fields[0].slot).toBe(named.fields[0].slot);
    });

    it('defaults to the latest write, because an earlier one no longer matches', async () => {
        const { buildDisclosure, verifyDisclosure } = await import('../scripts/lib/disclosure.mjs');
        registered();
        sim.recordField(VIN_A, ODO, 83_327n, S2);

        const receipt = RECEIPT();
        receipt.fields.odometerKm = [
            { writeIndex: 0, value: '12', salt: hex(S1) },
            { writeIndex: 1, value: '83327', salt: hex(S2) }
        ];
        const onChain = (slotHex) => {
            try { return hex(sim.ledger.fieldCommitment.lookup(Uint8Array.from(Buffer.from(slotHex, 'hex')))); }
            catch { return null; }
        };

        const latest = buildDisclosure(receipt, ['odometerKm']);
        expect(latest.fields[0].writeIndex).toBe(1);
        expect(verifyDisclosure(latest, onChain).ok).toBe(true);

        // Asking for the superseded write is allowed, and it does not verify:
        // the ledger moved on. Better to say so than to quietly hand over an
        // opening that reads as a forgery.
        const stale = buildDisclosure(receipt, ['odometerKm'], { writeIndex: 0 });
        expect(verifyDisclosure(stale, onChain).ok).toBe(false);
    });
});

describe('tiered disclosure: one vehicle, three audiences (D26)', () => {
    // A bundle is a disclosure addressed to one audience. These tests pin the
    // three things that make a tier mean anything: what each tier opens is
    // different, checked against ledger state the real circuits wrote; the
    // builder refuses to go above its tier; and the reader does not take the
    // bundle's word for its tier, it recomputes and reports.

    const PLASTIC = fieldKey('recycledPlasticPct');        // public
    const DISMANTLING = fieldKey('dismantlingTimeMinutes'); // authority

    /** registered(), plus one public and one authority field. */
    function fullVehicle() {
        registered();
        sim.initialiseField(VIN_A, PLASTIC, Rule.neverChanges, PCT(26.5), S2);
        sim.initialiseField(VIN_A, DISMANTLING, Rule.neverChanges, 95n, S3);
    }

    const RECEIPT = () => ({
        vinHash: hex(VIN_A),
        contentRoot: hex(ROOT),
        network: 'preprod',
        contractAddress: 'c8dc0aa4',
        fields: {
            odometerKm: [{ writeIndex: 0, value: '12', salt: hex(S1) }],
            accidentCount: [{ writeIndex: 0, value: '0', salt: hex(S1) }],
            ownerCount: [{ writeIndex: 0, value: '1', salt: hex(S1) }],
            writeOffCategory: [{ writeIndex: 0, value: '0', salt: hex(S1) }],
            recycledPlasticPct: [{ writeIndex: 0, value: String(PCT(26.5)), salt: hex(S2) }],
            dismantlingTimeMinutes: [{ writeIndex: 0, value: '95', salt: hex(S3) }]
        }
    });

    const commitmentAt = (slotHex) => {
        try { return hex(sim.ledger.fieldCommitment.lookup(Uint8Array.from(Buffer.from(slotHex, 'hex')))); }
        catch { return null; }
    };
    const claimAt = (keyHex) => {
        for (const [k, c] of sim.ledger.claims) {
            if (hex(k) !== keyHex) continue;
            return { slot: hex(c.slot), vinHash: hex(c.vinHash), fieldKey: hex(c.fieldKey),
                     commitment: hex(c.commitment), bound: String(c.bound), atMost: c.atMost };
        }
        return null;
    };
    const claimKeys = () => [...sim.ledger.claims].map(([k]) => hex(k));
    const LEDGER = { commitmentAt, claimAt };

    it('opens a different set of fields at each tier, each against real ledger state', async () => {
        const { buildBundle, verifyBundle } = await import('../scripts/lib/disclosure.mjs');
        fullVehicle();
        const opened = (tier) => {
            const r = verifyBundle(buildBundle(RECEIPT(), tier), LEDGER);
            expect(r.ok).toBe(true);
            expect(r.overDisclosed).toEqual([]);
            return [...r.opened].sort();
        };
        expect(opened('public')).toEqual(['recycledPlasticPct']);
        expect(opened('trade')).toEqual(
            ['accidentCount', 'odometerKm', 'ownerCount', 'recycledPlasticPct', 'writeOffCategory']);
        expect(opened('authority')).toEqual(['accidentCount', 'dismantlingTimeMinutes', 'odometerKm',
            'ownerCount', 'recycledPlasticPct', 'writeOffCategory']);
    });

    it('a public bundle carries no value and no salt above public', async () => {
        const { buildBundle } = await import('../scripts/lib/disclosure.mjs');
        const text = JSON.stringify(buildBundle(RECEIPT(), 'public'));
        expect(text).not.toContain(hex(S1));     // every history field's salt
        expect(text).not.toContain(hex(S3));     // the authority field's salt
        for (const name of ['odometerKm', 'accidentCount', 'ownerCount', 'writeOffCategory', 'dismantlingTimeMinutes']) {
            expect(text).not.toContain(name);
        }
    });

    it('the builder refuses a field above the tier', async () => {
        const { buildBundle } = await import('../scripts/lib/disclosure.mjs');
        expect(() => buildBundle(RECEIPT(), 'public', { fields: ['odometerKm'] }))
            .toThrow(/'odometerKm' is a trade field and cannot go in a public bundle/);
        expect(() => buildBundle(RECEIPT(), 'trade', { fields: ['dismantlingTimeMinutes'] }))
            .toThrow(/is a authority field and cannot go in a trade bundle/);
        expect(() => buildBundle(RECEIPT(), 'owner')).toThrow(/unknown tier 'owner'/);
    });

    it('the reader recomputes tiers: a bundle that understates its tier verifies, and is flagged', async () => {
        const { buildBundle, verifyBundle } = await import('../scripts/lib/disclosure.mjs');
        fullVehicle();
        const bundle = { ...buildBundle(RECEIPT(), 'authority'), tier: 'public' };
        const r = verifyBundle(bundle, LEDGER);
        // Every opening is genuine, so it verifies: a holder may give more.
        expect(r.ok).toBe(true);
        // But the reader is told exactly how much more.
        expect([...r.overDisclosed].sort()).toEqual(
            ['accidentCount', 'dismantlingTimeMinutes', 'odometerKm', 'ownerCount', 'writeOffCategory']);
    });

    it('references a claim rather than opening the field, and checks it is current', async () => {
        const { buildBundle, verifyBundle } = await import('../scripts/lib/disclosure.mjs');
        fullVehicle();
        sim.proveFieldAtMost(VIN_A, WRITE_OFF, 0n);

        const bundle = buildBundle(RECEIPT(), 'public', { claims: claimKeys() });
        const r = verifyBundle(bundle, LEDGER);
        expect(r.ok).toBe(true);
        expect(r.claims).toHaveLength(1);
        expect(r.claims[0]).toMatchObject({ fieldName: 'writeOffCategory', bound: '0', atMost: true, current: true });
        // "Never written off" without the field itself ever appearing.
        expect(r.opened).not.toContain('writeOffCategory');
        expect(JSON.stringify(bundle)).not.toContain('writeOffCategory');
    });

    it('a claim proven against an earlier value is superseded and does not verify', async () => {
        const { buildBundle, verifyBundle } = await import('../scripts/lib/disclosure.mjs');
        fullVehicle();
        sim.proveFieldAtMost(VIN_A, ODO, 50n);          // true of 12
        sim.recordField(VIN_A, ODO, 30n, S2);           // the reading moves on
        const r = verifyBundle(buildBundle(RECEIPT(), 'public', { claims: claimKeys() }), LEDGER);
        expect(r.claims[0].current).toBe(false);
        expect(r.claims[0].why).toMatch(/superseded/);
        expect(r.ok).toBe(false);
    });

    it('a claim about another vehicle, or no claim at all, does not verify', async () => {
        const { buildBundle, verifyBundle } = await import('../scripts/lib/disclosure.mjs');
        fullVehicle();
        registered(VIN_B, ROOT_B);
        sim.proveFieldAtMost(VIN_B, WRITE_OFF, 0n);
        const foreign = verifyBundle(buildBundle(RECEIPT(), 'public', { claims: claimKeys() }), LEDGER);
        expect(foreign.claims[0].why).toMatch(/different vehicle/);
        expect(foreign.ok).toBe(false);

        const missing = verifyBundle(buildBundle(RECEIPT(), 'public', { claims: ['ab'.repeat(32)] }), LEDGER);
        expect(missing.claims[0].why).toMatch(/no such claim/);
        expect(missing.ok).toBe(false);
    });

    it('only the committed value verifies; a field outside the policy or an unknown tier fails', async () => {
        const { buildBundle, verifyBundle } = await import('../scripts/lib/disclosure.mjs');
        fullVehicle();
        const flattering = buildBundle(RECEIPT(), 'trade');
        flattering.fields.find((f) => f.fieldName === 'odometerKm').value = '5';
        expect(verifyBundle(flattering, LEDGER).ok).toBe(false);

        const stray = buildBundle(RECEIPT(), 'trade');
        stray.fields.push({ ...stray.fields[0], fieldName: 'reservedNumeric0' });
        const r = verifyBundle(stray, LEDGER);
        expect(r.fields.at(-1).why).toMatch(/not in the tier policy/);
        expect(r.ok).toBe(false);

        const unknown = { ...buildBundle(RECEIPT(), 'trade'), tier: 'owner' };
        expect(verifyBundle(unknown, LEDGER).problems).toContain("unknown tier 'owner'");
    });

    it('the VIN travels only at the authority tier, and is flagged anywhere else', async () => {
        const { buildBundle, verifyBundle, vinHashOf, slotOf, commitmentOf } = await import('../scripts/lib/disclosure.mjs');
        const VIN = 'WP0ZZZ99ZTS392124';
        // A consistent pair, which the simulator's synthetic keys are not, so
        // the ledger here is the commitment computed for that pair.
        const receipt = { ...RECEIPT(), vin: VIN, vinHash: hex(vinHashOf(VIN)) };
        const slot = hex(slotOf(receipt.vinHash, hex(PLASTIC), receipt.contentRoot));
        const ledger = { commitmentAt: (s) => (s === slot ? hex(commitmentOf(PCT(26.5), hex(S2))) : null) };

        expect(buildBundle(receipt, 'trade').vin).toBeUndefined();
        expect(JSON.stringify(buildBundle(receipt, 'trade'))).not.toContain(VIN);

        const authority = buildBundle(receipt, 'authority', { fields: ['recycledPlasticPct'] });
        expect(authority.vin).toBe(VIN);
        expect(verifyBundle(authority, ledger).vinMatchesHash).toBe(true);

        const leaky = { ...buildBundle(receipt, 'public'), vin: VIN };
        expect(verifyBundle(leaky, ledger).overDisclosed).toContain('VIN');
    });

    it('the reader computes the same grant key as the contract', async () => {
        const { grantKeyOf } = await import('../scripts/lib/disclosure.mjs');
        for (const who of [DEALER_ID, AUTHORITY_ID]) {
            expect(grantKeyOf(hex(VIN_A), hex(who))).toBe(hex(pureCircuits.grantKeyOf(VIN_A, who)));
        }
    });

    it('a bundle naming its audience is told whether the ledger granted that tier', async () => {
        const { buildBundle, verifyBundle } = await import('../scripts/lib/disclosure.mjs');
        fullVehicle();
        const grantAt = (k) => {
            const key = Uint8Array.from(Buffer.from(k, 'hex'));
            return sim.ledger.grants.member(key) ? sim.ledger.grants.lookup(key) : null;
        };
        const check = (tier) => verifyBundle(
            buildBundle(RECEIPT(), tier, { audienceId: hex(DEALER_ID) }), { ...LEDGER, grantAt });

        // No grant yet. The values still open their commitments; the reader is told.
        expect(check('trade').ok).toBe(true);
        expect(check('trade').grant).toMatchObject({ held: null, covers: false });

        sim.grantDisclosure(VIN_A, DEALER_ID, Tier.trade, REGISTRAR);
        expect(check('trade').grant).toMatchObject({ held: 'trade', covers: true });
        expect(check('authority').grant).toMatchObject({ held: 'trade', covers: false });

        sim.grantDisclosure(VIN_A, DEALER_ID, Tier.authority, REGISTRAR);
        expect(check('authority').grant.covers).toBe(true);
        expect(check('trade').grant.covers).toBe(true);

        sim.revokeDisclosure(VIN_A, DEALER_ID, REGISTRAR);
        expect(check('trade').grant).toMatchObject({ held: null, covers: false });
        // The public view needs no grant, so it is never looked up.
        expect(check('public').grant).toBe(null);
    });

    it('the builder refuses an audience that is not an identity', async () => {
        const { buildBundle } = await import('../scripts/lib/disclosure.mjs');
        expect(() => buildBundle(RECEIPT(), 'trade', { audienceId: 'a dealer' })).toThrow(/is not an identity/);
    });
});

/**
 * A vehicle outlives the moment it was built.
 *
 * It leaves the factory, sits on a forecourt, is sold, is serviced by someone
 * the manufacturer never named, is sold again. Until the writer work, one
 * identity could write a passport for ever: the registrar that created it.
 * Everything below is about the rest of a car's life, and about the two
 * things that must NOT change when more than one party can write.
 */
describe('a vehicle changes hands', () => {
    const slotOf = (vin, field, root = ROOT) => pureCircuits.slotOf(vin, field, root);
    const wroteIt = (vin, field, root = ROOT) =>
        hex(sim.ledger.fieldWriter.lookup(slotOf(vin, field, root)));

    it('a dealership cannot touch the record until it is let in', () => {
        registered();
        expect(() => sim.recordField(VIN_A, OWNERS, 2n, S2, undefined, DEALER_SECRET))
            .toThrow(rejects('not the registrar for this vehicle, and not authorised to write it'));
        // And it cannot create a field either, which is the other half of
        // writing and was gated by the same line.
        expect(() => sim.initialiseField(VIN_A, DECLINING, Rule.neverRises, 1n, S2, DEALER_SECRET))
            .toThrow(rejects('not the registrar for this vehicle, and not authorised to write it'));
    });

    it('the registrar lets it in, and then it can', () => {
        registered();
        sim.authoriseWriter(VIN_A, DEALER_ID, REGISTRAR);
        expect(sim.ledger.writers.member(pureCircuits.writerKeyOf(VIN_A, DEALER_ID))).toBe(true);

        sim.recordField(VIN_A, OWNERS, 2n, S2, undefined, DEALER_SECRET);
        expect(wroteIt(VIN_A, OWNERS)).toBe(hex(DEALER_ID));
    });

    it('every field says who wrote it, including the ones the registrar wrote', () => {
        registered();
        sim.authoriseWriter(VIN_A, GARAGE_ID, REGISTRAR);
        sim.recordField(VIN_A, ODO, 41_200n, S2, undefined, GARAGE_SECRET);

        expect(wroteIt(VIN_A, ODO)).toBe(hex(GARAGE_ID));
        // Untouched by the garage, so still the registrar that created it.
        expect(wroteIt(VIN_A, ACCIDENTS)).toBe(hex(REGISTRAR_ID));
    });

    it('THE RULE SURVIVES DELEGATION, which is the whole question', () => {
        // If authorising someone to write also let them write anything, this
        // feature would have traded the product's only hard guarantee for
        // convenience. The dealer has permission and the opening, and still
        // cannot make the number smaller.
        registered();
        sim.recordField(VIN_A, ODO, 83_327n, S2);
        sim.authoriseWriter(VIN_A, DEALER_ID, REGISTRAR);

        expect(() => sim.recordField(VIN_A, ODO, 41_000n, S3, undefined, DEALER_SECRET))
            .toThrow(rejects('value decreased'));
        // The ledger did not move.
        expect(wroteIt(VIN_A, ODO)).toBe(hex(REGISTRAR_ID));
    });

    it('permission does not come with knowledge of the value', () => {
        // Authorising is a contract act. Handing over the current value and
        // its salt is a disclosure the registrar makes separately, and until
        // it does, an authorised writer cannot update an existing field.
        registered();
        sim.authoriseWriter(VIN_A, DEALER_ID, REGISTRAR);

        expect(() => sim.recordField(
            VIN_A, ODO, 90_000n, S3, { value: 999n, salt: WRONG_SALT }, DEALER_SECRET
        )).toThrow(rejects('previous value does not open the stored commitment'));
    });

    it('permission is for one vehicle, not for a fleet', () => {
        registered(VIN_A, ROOT);
        registered(VIN_B, ROOT_B);
        sim.authoriseWriter(VIN_A, DEALER_ID, REGISTRAR);

        expect(() => sim.recordField(VIN_B, OWNERS, 2n, S2, undefined, DEALER_SECRET))
            .toThrow(rejects('not the registrar for this vehicle, and not authorised to write it'));
    });

    it('a writer cannot let anyone else in', () => {
        // Two links of accountability, not a chain of unknown length: the
        // registrar answers for who it admitted, and that is the end of it.
        registered();
        sim.authoriseWriter(VIN_A, DEALER_ID, REGISTRAR);

        expect(() => sim.authoriseWriter(VIN_A, GARAGE_ID, DEALER_SECRET))
            .toThrow(rejects('not the registrar for this vehicle'));
    });

    it('only this vehicle\'s registrar may let anyone in', () => {
        registered();
        // On the deploy list, so entitled to register vehicles of its own,
        // and still nothing to do with this one.
        expect(() => sim.authoriseWriter(VIN_A, DEALER_ID, SECOND_SECRET))
            .toThrow(rejects('not the registrar for this vehicle'));
        expect(() => sim.authoriseWriter(VIN_A, DEALER_ID, OUTSIDER_SECRET))
            .toThrow(rejects('not the registrar for this vehicle'));
    });

    it('the registrar is not added to a list it is already above', () => {
        registered();
        expect(() => sim.authoriseWriter(VIN_A, REGISTRAR_ID, REGISTRAR))
            .toThrow(rejects('the registrar already writes this vehicle'));
    });

    it('permission can be taken away', () => {
        registered();
        sim.authoriseWriter(VIN_A, DEALER_ID, REGISTRAR);
        sim.recordField(VIN_A, OWNERS, 2n, S2, undefined, DEALER_SECRET);

        sim.withdrawWriter(VIN_A, DEALER_ID, REGISTRAR);
        expect(sim.ledger.writers.member(pureCircuits.writerKeyOf(VIN_A, DEALER_ID))).toBe(false);
        expect(() => sim.recordField(VIN_A, OWNERS, 3n, S3, undefined, DEALER_SECRET))
            .toThrow(rejects('not the registrar for this vehicle, and not authorised to write it'));
    });

    it('taking it away does not unwrite what was written', () => {
        // The record says who wrote what at the time. Withdrawing an
        // authorisation later cannot make that untrue, and a contract that
        // quietly reassigned the write would be falsifying history.
        registered();
        sim.authoriseWriter(VIN_A, DEALER_ID, REGISTRAR);
        sim.recordField(VIN_A, OWNERS, 2n, S2, undefined, DEALER_SECRET);
        sim.withdrawWriter(VIN_A, DEALER_ID, REGISTRAR);

        expect(wroteIt(VIN_A, OWNERS)).toBe(hex(DEALER_ID));
    });

    it('withdrawing something that was never granted is refused, not ignored', () => {
        registered();
        expect(() => sim.withdrawWriter(VIN_A, DEALER_ID, REGISTRAR))
            .toThrow(rejects('not a writer for this vehicle'));
    });

    it('neither act works on a vehicle that was never registered', () => {
        // Without this the next line is `registrar.lookup` on a key that is
        // not there, which fails for the wrong reason and says so in a
        // language nobody reading the error is speaking.
        expect(() => sim.authoriseWriter(VIN_B, DEALER_ID, REGISTRAR))
            .toThrow(rejects('unknown passport'));
        expect(() => sim.withdrawWriter(VIN_B, DEALER_ID, REGISTRAR))
            .toThrow(rejects('unknown passport'));
    });

    it('only the registrar for this vehicle may take permission away', () => {
        // The mirror of the grant check, and a separate guard: an authority
        // that could withdraw someone else's writers could silently stop a
        // competitor's service history from being written.
        registered();
        sim.authoriseWriter(VIN_A, DEALER_ID, REGISTRAR);

        expect(() => sim.withdrawWriter(VIN_A, DEALER_ID, SECOND_SECRET))
            .toThrow(rejects('not the registrar for this vehicle'));
        expect(() => sim.withdrawWriter(VIN_A, DEALER_ID, DEALER_SECRET))
            .toThrow(rejects('not the registrar for this vehicle'));
        // Still there, so the refusals refused rather than half-applied.
        expect(sim.ledger.writers.member(pureCircuits.writerKeyOf(VIN_A, DEALER_ID))).toBe(true);
    });

    it('neither act publishes a value', () => {
        registered();
        sim.authoriseWriter(VIN_A, DEALER_ID, REGISTRAR);
        sim.recordField(VIN_A, ODO, 83_327n, S2, undefined, DEALER_SECRET);

        const { words, blobs } = sim.ledgerValues();
        expect(words).not.toContain(83_327n);
        expect(blobs).not.toContain(hex(S2));
        // The identity IS public, deliberately, and this records that choice
        // rather than leaving it to be discovered.
        expect(blobs).toContain(hex(DEALER_ID));
    });

    it('the whole life of a car, in the order it happens', () => {
        // Factory: the manufacturer registers the vehicle and writes what it
        // knows at the gate.
        sim.registerPassport(VIN_A, ROOT, REGISTRAR);
        sim.initialiseField(VIN_A, ODO, Rule.neverFalls, 12n, S1);
        sim.initialiseField(VIN_A, OWNERS, Rule.neverFalls, 0n, S1);

        // Dealership: authorised for this vehicle, records the first keeper
        // and the mileage it arrived with.
        sim.authoriseWriter(VIN_A, DEALER_ID, REGISTRAR);
        sim.recordField(VIN_A, OWNERS, 1n, S2, undefined, DEALER_SECRET);
        sim.recordField(VIN_A, ODO, 180n, S2, undefined, DEALER_SECRET);

        // Four years later, a garage the manufacturer never named.
        sim.authoriseWriter(VIN_A, GARAGE_ID, REGISTRAR);
        sim.recordField(VIN_A, ODO, 62_400n, S3, undefined, GARAGE_SECRET);

        // Second sale: the dealership again.
        sim.recordField(VIN_A, OWNERS, 2n, S3, undefined, DEALER_SECRET);

        expect(wroteIt(VIN_A, ODO)).toBe(hex(GARAGE_ID));
        expect(wroteIt(VIN_A, OWNERS)).toBe(hex(DEALER_ID));

        // And after all of that, the buyer's question still answers from the
        // ledger, and the odometer still cannot go backwards for anyone.
        sim.proveFieldAtMost(VIN_A, ODO, 150_000n);
        expect(() => sim.recordField(VIN_A, ODO, 60_000n, S1, undefined, GARAGE_SECRET))
            .toThrow(rejects('value decreased'));
    });
});

// ------------------------------------------- a claim about two hidden fields

describe('disclosure grants: who may see beyond the public view (D26)', () => {
    // The disclosure itself is a bundle handed over off chain. A grant records
    // the entitlement: which identity the registrar gave the trade or the
    // authority view of one vehicle. These pin who may grant, what a grant is
    // not, and that revoking needs something to revoke.

    const held = (vin, who) => {
        const key = pureCircuits.grantKeyOf(vin, who);
        return sim.ledger.grants.member(key) ? sim.ledger.grants.lookup(key) : null;
    };

    it('the registrar grants a dealer the trade view, and the ledger records it', () => {
        registered();
        expect(held(VIN_A, DEALER_ID)).toBe(null);
        sim.grantDisclosure(VIN_A, DEALER_ID, Tier.trade, REGISTRAR);
        expect(held(VIN_A, DEALER_ID)).toBe(Tier.trade);
    });

    it('granting again changes the tier, with no revoke in between', () => {
        registered();
        sim.grantDisclosure(VIN_A, AUTHORITY_ID, Tier.trade, REGISTRAR);
        sim.grantDisclosure(VIN_A, AUTHORITY_ID, Tier.authority, REGISTRAR);
        expect(held(VIN_A, AUTHORITY_ID)).toBe(Tier.authority);
        sim.grantDisclosure(VIN_A, AUTHORITY_ID, Tier.trade, REGISTRAR);
        expect(held(VIN_A, AUTHORITY_ID)).toBe(Tier.trade);
    });

    it('a grant is for one vehicle, not for a fleet', () => {
        registered(VIN_A, ROOT);
        registered(VIN_B, ROOT_B);
        sim.grantDisclosure(VIN_A, DEALER_ID, Tier.authority, REGISTRAR);
        expect(held(VIN_B, DEALER_ID)).toBe(null);
    });

    it("only this vehicle's registrar may grant", () => {
        registered();
        sim.authoriseWriter(VIN_A, DEALER_ID, REGISTRAR);
        // Another registrar on the deploy list, an outsider, and a writer this
        // registrar admitted: none of them answers for who may read.
        for (const secret of [SECOND_SECRET, OUTSIDER_SECRET, DEALER_SECRET]) {
            expect(() => sim.grantDisclosure(VIN_A, GARAGE_ID, Tier.trade, secret))
                .toThrow(rejects('not the registrar for this vehicle'));
        }
        expect(held(VIN_A, GARAGE_ID)).toBe(null);
    });

    it('a vehicle that was never registered can be neither granted nor revoked', () => {
        expect(() => sim.grantDisclosure(VIN_B, DEALER_ID, Tier.trade, REGISTRAR))
            .toThrow(rejects('unknown passport'));
        expect(() => sim.revokeDisclosure(VIN_B, DEALER_ID, REGISTRAR))
            .toThrow(rejects('unknown passport'));
    });

    it('a grant is not permission to write', () => {
        // `writerFor` never reads `grants`. Being allowed to see every value
        // is not being allowed to change one.
        registered();
        sim.grantDisclosure(VIN_A, DEALER_ID, Tier.authority, REGISTRAR);
        expect(() => sim.recordField(VIN_A, OWNERS, 2n, S2, undefined, DEALER_SECRET))
            .toThrow(rejects('not the registrar for this vehicle, and not authorised to write it'));
        expect(sim.ledger.writers.member(pureCircuits.writerKeyOf(VIN_A, DEALER_ID))).toBe(false);
    });

    it('and permission to write is not a grant: the two lists are separate', () => {
        registered();
        sim.authoriseWriter(VIN_A, DEALER_ID, REGISTRAR);
        expect(held(VIN_A, DEALER_ID)).toBe(null);
        sim.grantDisclosure(VIN_A, DEALER_ID, Tier.trade, REGISTRAR);
        sim.withdrawWriter(VIN_A, DEALER_ID, REGISTRAR);
        expect(held(VIN_A, DEALER_ID)).toBe(Tier.trade);
        expect(hex(pureCircuits.grantKeyOf(VIN_A, DEALER_ID)))
            .not.toBe(hex(pureCircuits.writerKeyOf(VIN_A, DEALER_ID)));
    });

    it('revoking removes the grant, and only the registrar may', () => {
        registered();
        sim.grantDisclosure(VIN_A, DEALER_ID, Tier.trade, REGISTRAR);
        expect(() => sim.revokeDisclosure(VIN_A, DEALER_ID, SECOND_SECRET))
            .toThrow(rejects('not the registrar for this vehicle'));
        expect(held(VIN_A, DEALER_ID)).toBe(Tier.trade);
        sim.revokeDisclosure(VIN_A, DEALER_ID, REGISTRAR);
        expect(held(VIN_A, DEALER_ID)).toBe(null);
    });

    it('revoking a grant that does not exist is refused, not quietly accepted', () => {
        registered();
        expect(() => sim.revokeDisclosure(VIN_A, DEALER_ID, REGISTRAR))
            .toThrow(rejects('no grant for this identity on this vehicle'));
        sim.grantDisclosure(VIN_A, DEALER_ID, Tier.trade, REGISTRAR);
        sim.revokeDisclosure(VIN_A, DEALER_ID, REGISTRAR);
        expect(() => sim.revokeDisclosure(VIN_A, DEALER_ID, REGISTRAR))
            .toThrow(rejects('no grant for this identity on this vehicle'));
    });

    it('there is no public tier to grant', () => {
        // The public view needs no grant, and Euro 7 passport data may not be
        // put behind one (2025/1707 Annex V 4.2.3), so the type has no member
        // for it and the runtime refuses anything outside the two it has.
        expect(Object.keys(Tier).filter((k) => Number.isNaN(Number(k)))).toEqual(['trade', 'authority']);
        registered();
        expect(() => sim.grantDisclosure(VIN_A, DEALER_ID, 2, REGISTRAR)).toThrow();
        expect(held(VIN_A, DEALER_ID)).toBe(null);
    });
});

describe('proveFieldAtMostField', () => {
    // The questions a buyer asks that are not a field against a number.
    // "Serviced within the last 15 000 km" is the odometer against the
    // reading taken at the last service; "every recall has been done" is
    // recalls issued against recalls completed. Neither can be put as a
    // public bound, because the thing being compared to is hidden too.
    const SERVICED_AT = fieldKey('lastServiceOdometerKm');
    const ISSUED = fieldKey('recallIssuedCount');
    const COMPLETED = fieldKey('recallCompletedCount');

    beforeEach(() => {
        sim.registerPassport(VIN_A, ROOT, REGISTRAR);
        sim.initialiseField(VIN_A, ODO, Rule.neverFalls, 62_400n, S1);
        sim.initialiseField(VIN_A, SERVICED_AT, Rule.neverFalls, 54_000n, S2);
        sim.initialiseField(VIN_A, ISSUED, Rule.neverFalls, 2n, S1);
        sim.initialiseField(VIN_A, COMPLETED, Rule.neverFalls, 2n, S2);
    });

    it('proves the odometer is within the slack of the last service reading', () => {
        // 62 400 - 54 000 = 8 400, comfortably inside 15 000.
        expect(() => sim.proveFieldAtMostField(VIN_A, ODO, SERVICED_AT, 15_000n))
            .not.toThrow();
        expect(sim.ledger.relClaims.size()).toBe(1n);
    });

    it('refuses when the two values are further apart than the slack', () => {
        expect(() => sim.proveFieldAtMostField(VIN_A, ODO, SERVICED_AT, 5_000n))
            .toThrow(rejects('the two values are further apart than the claimed slack'));
    });

    it('writes nothing at all when it refuses', () => {
        try { sim.proveFieldAtMostField(VIN_A, ODO, SERVICED_AT, 5_000n); } catch { /* expected */ }

        expect(sim.ledger.relClaims.isEmpty()).toBe(true);
    });

    it('proves equality with a slack of zero: every recall has been done', () => {
        expect(() => sim.proveFieldAtMostField(VIN_A, ISSUED, COMPLETED, 0n)).not.toThrow();
        expect(sim.ledger.relClaims.size()).toBe(1n);
    });

    it('a slack of zero refuses once a recall is outstanding', () => {
        sim.recordField(VIN_A, ISSUED, 3n, S3);

        expect(() => sim.proveFieldAtMostField(VIN_A, ISSUED, COMPLETED, 0n))
            .toThrow(rejects('the two values are further apart than the claimed slack'));
    });

    it('needs the opening for BOTH fields, not just the first', () => {
        expect(() => sim.proveFieldAtMostField(
            VIN_A, ODO, SERVICED_AT, 15_000n, undefined, { value: 54_000n, salt: WRONG_SALT }
        )).toThrow(rejects('second value does not open the stored commitment'));
    });

    it('cannot be satisfied by claiming a flattering value for the first field', () => {
        expect(() => sim.proveFieldAtMostField(
            VIN_A, ODO, SERVICED_AT, 1n, { value: 54_001n, salt: S1 }
        )).toThrow(rejects('first value does not open the stored commitment'));
    });

    it('refuses a field compared with itself, which would prove nothing', () => {
        expect(() => sim.proveFieldAtMostField(VIN_A, ODO, ODO, 0n))
            .toThrow(rejects('a field compared with itself proves nothing'));
    });

    // The same case that was missed once already under proveFieldAtLeast, and
    // missed again when this circuit was added: the mutation harness could
    // delete this guard with all 128 tests still green, which made it the one
    // assertion in the contract nothing depended on. A gap between two fields
    // of a vehicle that was never registered is a claim about nothing.
    it('rejects a comparison about an unregistered vehicle', () => {
        expect(() => sim.proveFieldAtMostField(VIN_B, ODO, SERVICED_AT, 15_000n))
            .toThrow(rejects('unknown passport'));
    });

    it('refuses when either field was never initialised', () => {
        const ABSENT = fieldKey('timingBeltReplacedDate');

        expect(() => sim.proveFieldAtMostField(VIN_A, ODO, ABSENT, 99n))
            .toThrow(rejects('second field not initialised'));
        expect(() => sim.proveFieldAtMostField(VIN_A, ABSENT, ODO, 99n))
            .toThrow(rejects('first field not initialised'));
    });

    it('publishes the slack and the commitments, and neither value', () => {
        sim.proveFieldAtMostField(VIN_A, ODO, SERVICED_AT, 15_000n);
        const { words } = sim.ledgerValues();

        expect(words).toContain(15_000n);        // the slack is the claim
        expect(words).not.toContain(62_400n);    // the odometer is not
        expect(words).not.toContain(54_000n);    // nor the service reading
        expect(words).not.toContain(8_400n);     // nor the difference
    });

    it('the claim names both fields so a reader knows what was compared', () => {
        sim.proveFieldAtMostField(VIN_A, ODO, SERVICED_AT, 15_000n);
        const [, claim] = [...sim.ledger.relClaims][0];

        expect(hex(claim.fieldKeyHigh)).toBe(hex(ODO));
        expect(hex(claim.fieldKeyLow)).toBe(hex(SERVICED_AT));
        expect(hex(claim.vinHash)).toBe(hex(VIN_A));
        expect(claim.slack).toBe(15_000n);
    });

    it('goes stale when EITHER value moves, not just the first', () => {
        sim.proveFieldAtMostField(VIN_A, ODO, SERVICED_AT, 15_000n);
        const [, claim] = [...sim.ledger.relClaims][0];
        const slotLow = pureCircuits.slotOf(VIN_A, SERVICED_AT, ROOT);

        // A service happens: the LOW field moves, the high one does not.
        sim.recordField(VIN_A, SERVICED_AT, 61_000n, S3);

        // The claim is still on the ledger, and a reader comparing it against
        // the current commitment can see it no longer describes the record.
        expect(hex(claim.commitmentLow))
            .not.toBe(hex(sim.ledger.fieldCommitment.lookup(slotLow)));
    });

    it('is open to anyone who can open both commitments, like the other proofs', () => {
        // Proving is a separate right from writing: an outsider who was handed
        // both openings can still ask the question.
        sim.actAs(OUTSIDER_SECRET);

        expect(() => sim.proveFieldAtMostField(VIN_A, ODO, SERVICED_AT, 15_000n))
            .not.toThrow();
    });
});
