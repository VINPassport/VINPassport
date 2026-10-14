/**
 * Shared scenario machinery for everything that builds ledger state off-chain:
 * the demo export and the intake runner. One module, so the two cannot drift.
 * a vehicle added through the console is built by exactly the code that built
 * the demo vehicles.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { PassportSimulator, Rule, fieldKey, bytes32, hex } from '../../test/passport-simulator.mjs';
import { buildTree, padToWidth } from '@odatano/dpp-sdk/merkle';
import { blake2b } from '@noble/hashes/blake2';
import { randomBytes } from 'node:crypto';

export { PassportSimulator, Rule, fieldKey, bytes32, hex };

// ---------------------------------------------------------------- vocabulary

/** The panel fields the surfaces know how to render. */
/**
 * The live, rule-bearing fields: panel slots 0 to 16, in slot order.
 *
 * Each rule follows from what the field IS, which is the only defensible way to
 * choose one, since the rule is fixed at creation and cannot be revised.
 *
 *   neverFalls    lifecycle values that accumulate. Mileage, accidents,
 *                 keepers, services, write-off category, and the inspection
 *                 date, which moves forward. Backdating any of these is the
 *                 fraud the rule exists to refuse.
 *
 *   neverChanges  type-approval declarations. Recycled content, the CO2
 *                 figure, the 3R percentages and dismantling time are facts
 *                 about a design, not events in a vehicle's life. They would
 *                 be wrong as `neverFalls`, which would permit a recycled
 *                 content claim to drift upward, the direction that flatters.
 *                 Revising one means re-anchoring the document, which moves
 *                 every slot with the content root.
 *
 * Provisions, per docs/FIELDS.md: slots 8 and 9 serve Art 6(1) and 6(2) of
 * Regulation (EU) 2026/1738, slots 7, 12 and 16 serve Art 13, slots 13 to 15
 * are inherited from Directive 2005/64/EC, and slots 10 and 11 are held for
 * delegated acts that have not set a target yet.
 *
 * Slots 17 to 21 stay reserved. Slot 17 `batteryStateOfHealthPct` is
 * deliberately NOT here: the battery passport is authoritative for the battery
 * and a mirror would diverge. Settled 2026-08-27, see docs/FIELDS.md.
 */
export const FIELDS = {
    // slots 0-4: the lifecycle counters
    odometerKm:                { label: 'Mileage',              kind: 'km',       rule: Rule.neverFalls },
    accidentCount:             { label: 'Reported accidents',   kind: 'count',    rule: Rule.neverFalls },
    ownerCount:                { label: 'Keepers',              kind: 'count',    rule: Rule.neverFalls },
    serviceCount:              { label: 'Services recorded',    kind: 'count',    rule: Rule.neverFalls },
    writeOffCategory:          { label: 'Write-off category',   kind: 'category', rule: Rule.neverFalls },
    // slots 5-6: identity dates, in epoch days
    firstRegistrationDate:     { label: 'First registered',     kind: 'date',     rule: Rule.neverChanges },
    lastInspectionDate:        { label: 'Last inspection',      kind: 'date',     rule: Rule.neverFalls },
    // slots 7-16: the regulatory declarations
    co2FootprintKgCO2e:        { label: 'CO2 footprint',        kind: 'kg',       rule: Rule.neverChanges },
    recycledPlasticPct:        { label: 'Recycled plastic',     kind: 'pct',      rule: Rule.neverChanges },
    recycledPlasticFromELVPct: { label: 'Recycled plastic, ELV', kind: 'pct',     rule: Rule.neverChanges },
    recycledSteelPct:          { label: 'Recycled steel',       kind: 'pct',      rule: Rule.neverChanges },
    recycledAluminiumPct:      { label: 'Recycled aluminium',   kind: 'pct',      rule: Rule.neverChanges },
    criticalRawMaterialPct:    { label: 'Critical raw material', kind: 'pct',     rule: Rule.neverChanges },
    reusabilityPct:            { label: 'Reusability',          kind: 'pct',      rule: Rule.neverChanges },
    recyclabilityPct:          { label: 'Recyclability',        kind: 'pct',      rule: Rule.neverChanges },
    recoverabilityPct:         { label: 'Recoverability',       kind: 'pct',      rule: Rule.neverChanges },
    dismantlingTimeMinutes:    { label: 'Dismantling time',     kind: 'minutes',  rule: Rule.neverChanges }
};

export const K = Object.fromEntries(Object.keys(FIELDS).map((n) => [n, fieldKey(n)]));

/** A vehicle is addressed by the hash of its VIN, never the VIN itself. */
export const vinHash = (vin) => fieldKey(vin);

/**
 * The full 32-slot panel, exactly as docs/FIELDS.md lays it out. Slots 0-4
 * are the live rule-bearing fields; 5-16 numeric declarations; 22-29 strings;
 * 17-21 and 30-31 reserved. The regulation-facing majority of the passport -
 * vehicle category, fuel type (EV / hybrid / diesel / petrol), emissions
 * class, the battery passport link, the Art 29 recycled-content declarations
 * - lives HERE, anchored under the content root, not in the live fields.
 */
export const PANEL = {
    odometerKm: [0, 'num'], accidentCount: [1, 'num'], ownerCount: [2, 'num'],
    serviceCount: [3, 'num'], writeOffCategory: [4, 'num'],
    firstRegistrationDate: [5, 'num'], lastInspectionDate: [6, 'num'],
    co2FootprintKgCO2e: [7, 'num'], recycledPlasticPct: [8, 'num'],
    recycledPlasticFromELVPct: [9, 'num'], recycledSteelPct: [10, 'num'],
    recycledAluminiumPct: [11, 'num'], criticalRawMaterialPct: [12, 'num'],
    reusabilityPct: [13, 'num'], recyclabilityPct: [14, 'num'],
    recoverabilityPct: [15, 'num'], dismantlingTimeMinutes: [16, 'num'],
    vinHash: [22, 'str'], vehicleCategory: [23, 'str'],
    euTypeApprovalNumber: [24, 'str'], manufacturerBPN: [25, 'str'],
    fuelType: [26, 'str'], batteryChemistry: [27, 'str'],
    emissionsClass: [28, 'str'], batteryPassportId: [29, 'str'],
    passportOrigin: [30, 'str']   // 'new' | 'retrofit' - provisional, see FIELDS.md
};

const VALUE_SCALE = 1000;   // matches @odatano/dpp-sdk VALUE_SCALE
const b2b = (data) => blake2b(data, { dkLen: 32 });
const utf8 = (s) => new TextEncoder().encode(s);

// The secret that makes the salted commitments hiding. persistentCommit only
// conceals a value if its salt is unguessable, so every salt in this module -
// both the per-field commitment salts and the content-root leaf salts - is
// derived from 32 bytes of real entropy, generated per run and NEVER committed
// or exported. Reproducibility, when wanted, comes from setting the SEED, not
// from a public formula: the seed is the secret, the formula is not.
// (Old behaviour derived salts from a counter mod 251 and from the VIN, both
// public - which made the demo commitments brute-force invertible. See D23.)
//
// The override is VALIDATED, and the reason is not pedantry. `Buffer.from(s,
// 'hex')` does not reject a malformed string, it truncates at the first
// invalid pair and returns what it got: "not-a-seed" yields ZERO bytes, "abc"
// yields one. A zero-byte seed makes `saltFrom(label)` equal to
// `blake2b(label)`, and the labels are public and predictable, so every
// commitment becomes openable by anyone who guesses the value. That is
// precisely the D23 weakness this seed exists to close, reachable by a typo
// in an environment variable and silent when it happened. Every other piece
// of key material here is already checked this way; this one was the
// exception.
const SEED_OVERRIDE = process.env.VINPASSPORT_SALT_SEED?.trim();
if (SEED_OVERRIDE !== undefined && SEED_OVERRIDE !== '' && !/^[0-9a-fA-F]{64}$/.test(SEED_OVERRIDE)) {
    throw new Error(
        'VINPASSPORT_SALT_SEED must be exactly 64 hex characters (32 bytes). '
        + `Got ${SEED_OVERRIDE.length} character(s). Unset it to generate a fresh random seed; `
        + 'a malformed value would silently weaken every commitment rather than fail.'
    );
}
const SALT_SEED = SEED_OVERRIDE
    ? Uint8Array.from(Buffer.from(SEED_OVERRIDE, 'hex'))
    : randomBytes(32);
const saltFrom = (label) => b2b(Uint8Array.from([...SALT_SEED, ...utf8(label)]));
const nodeHash = (l, r) => b2b(Uint8Array.from([...l, ...r]));

/**
 * The content root: the real depth-5 tree over the 32-slot panel, built with
 * @odatano/dpp-sdk's own machinery.
 *
 * Leaf rule (vinpassport:leaf:v0): blake2b( tag || slotSalt || fieldKey ||
 * valueDigest ), where numerics digest their x1000-scaled decimal and strings
 * their exact bytes. EVERY slot is salted, occupied or not, so an observer of
 * two roots cannot tell which slots are filled - absence is as private as
 * presence (FIELDS.md: "absent leaves are still salted and still anchored").
 *
 * Leaf salts come from the secret SALT_SEED (see above), so the anchored root
 * does not leak its values to anyone who merely knows the VIN. Losing the seed
 * makes the root permanently unprovable - BUILD-SCOPE carries that risk by name.
 */
export const contentRoot = (vin, fields, panel = {}, saltFn = saltFrom) => {
    const values = { ...panel, ...fields, vinHash: hex(vinHash(vin)) };
    const leaves = [];
    for (let slot = 0; slot < 32; slot++) {
        const name = Object.keys(PANEL).find((n) => PANEL[n][0] === slot);
        const slotSalt = saltFn(`:leafsalt:v0:${vin}:${slot}`);
        let valueDigest = b2b(utf8(''));                       // absent / reserved
        if (name && values[name] !== undefined && values[name] !== '') {
            const kind = PANEL[name][1];
            valueDigest = kind === 'num'
                ? b2b(utf8(String(BigInt(Math.round(Number(values[name]) * VALUE_SCALE)))))
                : b2b(utf8(String(values[name])));
        }
        leaves.push(b2b(Uint8Array.from([
            ...utf8('vinpassport:leaf:v0'), ...slotSalt,
            ...(name ? fieldKey(name) : new Uint8Array(32)), ...valueDigest
        ])));
    }
    const tree = buildTree(padToWidth(leaves, 32, () => b2b(utf8('vinpassport:pad'))), nodeHash);
    return Uint8Array.from(Buffer.from(tree.rootHex, 'hex'));
};

// A registrar is no longer named into existence. Its identity is derived in
// circuit from a secret it holds, and checked against the list pinned at
// deploy, so there is nothing here to compute from a label. The label survives
// only as something to display. See `scripts/make-registrar-secrets.mjs`.

// ---------------------------------------------------------------- salts

/** Salt stream for per-field commitments: each salt is 32 bytes derived from
 *  the secret SALT_SEED, so a published commitment does not disclose its value.
 *  Reproducible only to a holder of the same seed (set VINPASSPORT_SALT_SEED). */
export const saltStream = () => {
    let n = 0;
    return () => saltFrom(`:salt:${++n}`);
};

// ---------------------------------------------------------------- intake

/**
 * Apply one intake: a vehicle's registration, history and requested claims.
 * to a simulator, through the real compiled circuits.
 *
 * Refusals are results, not crashes: an update that breaks a field's rule or
 * a claim the state cannot support is REFUSED IN-CIRCUIT, reported as such,
 * and the run continues. The intake runner's honesty mirrors the chain's: a
 * refused claim writes nothing, so it can never appear proven.
 *
 * Returns { vinHex, applied: [..], refused: [{step, reason}] }.
 */
export function applyIntake(sim, intake, salt) {
    const vin = vinHash(intake.vin);
    const vinHex = hex(vin);
    const applied = [];
    const refused = [];
    const attempt = (step, fn) => {
        try { fn(); applied.push(step); }
        catch (e) {
            refused.push({ step, reason: String(e.message ?? e).replace(/^.*failed assert: /, '') });
        }
    };

    // No registrar argument: whoever the simulator is acting as supplies the
     // secret, and the circuit derives the identity from it.
    attempt('registerPassport', () =>
        sim.registerPassport(vin,
            contentRoot(intake.vin, intake.fields, intake.panel ?? {})));
    if (intake.panel && Object.keys(intake.panel).length) {
        applied.push(`anchor panel: ${Object.keys(intake.panel).length} declaration fields in the content root (values stay private)`);
    }

    for (const [name, value] of Object.entries(intake.fields)) {
        if (!(name in FIELDS)) { refused.push({ step: `initialiseField ${name}`, reason: 'unknown field' }); continue; }
        attempt(`initialiseField ${name}`, () =>
            sim.initialiseField(vin, K[name], FIELDS[name].rule, BigInt(value), salt()));
    }

    for (const [i, update] of (intake.updates ?? []).entries()) {
        for (const [name, value] of Object.entries(update)) {
            if (!(name in FIELDS)) { refused.push({ step: `update ${i + 1} ${name}`, reason: 'unknown field' }); continue; }
            attempt(`update ${i + 1}: ${name} -> ${value}`, () =>
                sim.recordField(vin, K[name], BigInt(value), salt()));
        }
    }

    const CLAIMS = {
        neverWrittenOff: () => sim.proveFieldAtMost(vin, K.writeOffCategory, 0n),
        noAccidents:     () => sim.proveFieldAtMost(vin, K.accidentCount, 0n),
        oneKeeper:       () => sim.proveFieldAtMost(vin, K.ownerCount, 1n),
        mileageUnder:    () => sim.proveFieldAtMost(vin, K.odometerKm, BigInt(intake.prove.mileageUnder))
    };
    for (const [name, run] of Object.entries(CLAIMS)) {
        const wanted = name === 'mileageUnder' ? intake.prove?.mileageUnder : intake.prove?.[name];
        if (wanted) attempt(`prove ${name}`, run);
    }

    return { vinHex, applied, refused };
}

// ---------------------------------------------------------------- demo pair

/** The two standing demonstration vehicles. Returns their vin hex hashes. */
export function buildDemoVehicles(sim, salt) {
    const a = applyIntake(sim, {
        vin: 'WVWZZZ1JZXW000001',
        registrar: 'demo-authority',
        fields: { odometerKm: 18_430, accidentCount: 0, ownerCount: 1, writeOffCategory: 0, serviceCount: 1 },
        panel: {
            vehicleCategory: 'M1', fuelType: 'bev', emissionsClass: 'n/a',
            batteryPassportId: 'BPID-EU-000184-2027', batteryChemistry: 'NMC811',
            firstRegistrationDate: 20_240, co2FootprintKgCO2e: 8_400,
            recycledPlasticPct: 26.5, recycledSteelPct: 31.0
        },
        updates: [
            { odometerKm: 44_210, serviceCount: 2 },
            { odometerKm: 61_890, serviceCount: 3 },
            { odometerKm: 83_260, serviceCount: 4 }
        ],
        prove: { neverWrittenOff: true, noAccidents: true, oneKeeper: true, mileageUnder: 150_000 }
    }, salt);

    const b = applyIntake(sim, {
        vin: 'WAUZZZ8V5KA000002',
        registrar: 'demo-authority',
        fields: { odometerKm: 96_500, accidentCount: 2, ownerCount: 3, writeOffCategory: 1 },
        panel: { vehicleCategory: 'M1', fuelType: 'diesel', emissionsClass: 'Euro 5', firstRegistrationDate: 15_910 },
        updates: [{ odometerKm: 112_040 }],
        prove: { mileageUnder: 200_000 }
    }, salt);

    return { a, b };
}

// ---------------------------------------------------------------- export

export function exportLedger(sim, sourceNote) {
    const l = sim.ledger;
    const mapToObj = (m, val) => {
        const out = {};
        for (const [k, v] of m) out[hex(k)] = val(v);
        return out;
    };
    const claims = [];
    for (const [key, c] of l.claims) {
        claims.push({
            key: hex(key), slot: hex(c.slot), vinHash: hex(c.vinHash),
            fieldKey: hex(c.fieldKey), commitment: hex(c.commitment),
            bound: c.bound.toString(), atMost: c.atMost
        });
    }
    return {
        source: sourceNote,
        note: 'Real public ledger state. Values, and the secret salt seed that hides them, never leave the generating process; the published commitments do not disclose their values.',
        passports: mapToObj(l.passports, hex),
        registrar: mapToObj(l.registrar, hex),
        fieldCommitment: mapToObj(l.fieldCommitment, hex),
        fieldRule: mapToObj(l.fieldRule, (r) => Number(r)),
        claims,
        updateCount: l.updateCount.toString()
    };
}

export function vocabulary(demoVehicles) {
    return {
        note: 'Public vocabulary: blake2b-256(field name) -> display metadata. See docs/FIELDS.md.',
        fields: Object.fromEntries(
            Object.entries(FIELDS).map(([name, meta]) => [
                hex(K[name]), { name, label: meta.label, kind: meta.kind }
            ])
        ),
        demoVehicles
    };
}
