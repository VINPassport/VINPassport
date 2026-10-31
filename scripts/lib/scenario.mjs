/**
 * Shared scenario machinery for everything that builds ledger state off-chain:
 * the demo export and the intake runner. One module, so the two cannot drift.
 * a vehicle added through the console is built by exactly the code that built
 * the demo vehicles.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import {
    PassportSimulator, Rule, fieldKey, bytes32, hex,
    REGISTRAR_SECRET, DEALER_SECRET, DEALER_ID, GARAGE_SECRET, GARAGE_ID
} from '../../test/passport-simulator.mjs';
import { buildTree, padToWidth } from '@odatano/dpp-sdk/merkle';
import { CLAIM_CATALOGUE, CLAIM_GROUPS, boundFor, isCompare } from '../../site/assets/claim-catalogue.mjs';
import { blake2b } from '@noble/hashes/blake2';
import { tierOf } from './tiers.mjs';
/**
 * PORTABILITY. This module builds ledger state, and the intake console needs
 * to build it in a browser on the published static site, where there is no
 * server to post a registration to. Nothing here is Node-specific in
 * substance, so the four places that reached for a Node API now use the web
 * equivalents, which Node has had as globals for years. No conditional
 * imports, no bundler shims, and one code path rather than two.
 */

/** Fresh random bytes, from whichever crypto this runtime has. */
const randomBytes = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));

/** Hex in, bytes out. Replaces Buffer.from(hex, 'hex'). */
const fromHex = (hex) =>
    Uint8Array.from(hex.match(/../g) ?? [], (byte) => parseInt(byte, 16));

export { PassportSimulator, Rule, fieldKey, bytes32, hex };

// Re-exported so a caller needs one import for "the registry and the
// questions asked of it". The catalogue lives under site/assets because the
// verify page loads it directly in a browser; this is the same file.
export { CLAIM_CATALOGUE, CLAIM_GROUPS, boundFor, isCompare };

/**
 * The parties a registrar can hand the pen to in this demonstration.
 *
 * Keyed by label because a LABEL is all a browser ever sends. The secret is
 * what proves the identity in-circuit, so it stays in this process: a console
 * that accepted a secret over HTTP would be handing anyone the ability to
 * write as the dealership, which is the opposite of what the writer list is
 * for. The id is public, and is what the ledger records.
 */
export const DEMO_WRITERS = {
    dealership: { label: 'dealership', id: DEALER_ID, secret: DEALER_SECRET },
    'service garage': { label: 'service garage', id: GARAGE_ID, secret: GARAGE_SECRET }
};

/** The identity the console itself acts as. */
export const CONSOLE_REGISTRAR_SECRET = REGISTRAR_SECRET;

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
    dismantlingTimeMinutes:    { label: 'Dismantling time',     kind: 'minutes',  rule: Rule.neverChanges },

    // ---------------------------------------------------------------------
    // THE HISTORY SET: slots 17 and up do not exist, and that is the point.
    //
    // Everything below is a PROVABLE FIELD WITHOUT A PANEL SLOT. The panel is
    // capped at 32 and `contentRoot` reads names from PANEL only, so these
    // contribute nothing to the root: adding them re-anchors nothing and
    // leaves every existing passport valid. `fieldCommitment` is an unbounded
    // Map keyed by slotOf(vinHash, fieldKey, contentRoot), so the number of
    // provable fields was never capped; only the anchored document is.
    //
    // The division is not arbitrary. The PANEL is the canonical document the
    // regulation asks a manufacturer to hand over. A vehicle's HISTORY is not
    // document content: it is a stream of events that outlives the party that
    // registered the car, and it belongs in the field map.
    //
    // PRESENCE IS PUBLIC, SO THE SET MUST BE WRITTEN WHOLE. `slotOf` is an
    // exported pure circuit over a public vinHash and contentRoot, so anyone
    // can probe whether a vehicle holds a given field. If floodDamageCount
    // were initialised only on cars that flooded, the FIELD'S EXISTENCE would
    // be the disclosure and hiding its value would protect nothing. A vehicle
    // therefore initialises the whole registry, zeros included, or none of it.
    // The panel already behaves this way ("absent leaves are still salted");
    // the field map does not, which is why this is written down here.
    //
    // Rules follow from what each field IS, as above. Every history field is
    // neverFalls because history accumulates: a count of accidents, a date
    // that moves forward, a bitmask that only ever gains bits. The
    // specification block is neverChanges because it describes the vehicle as
    // built. Dates are EPOCH DAYS. Masks are integers whose bits are ordered
    // by severity, so an `atMost` bound reads as "nothing worse than this".
    // ---------------------------------------------------------------------

    // Title and legal status
    titleStatusMask:           { label: 'Title status',            kind: 'mask',  rule: Rule.neverFalls },
    writeOffDate:              { label: 'Write-off recorded',      kind: 'date',  rule: Rule.neverFalls },
    repairedAndReturnedDate:   { label: 'Repaired, back on road',  kind: 'date',  rule: Rule.neverFalls },
    stolenRecordCount:         { label: 'Theft reports',           kind: 'count', rule: Rule.neverFalls },
    recoveredRecordCount:      { label: 'Recovery records',        kind: 'count', rule: Rule.neverFalls },
    scrapCertificateDate:      { label: 'Certificate of destruction', kind: 'date', rule: Rule.neverFalls },
    exportMarkerCount:         { label: 'Export markers',          kind: 'count', rule: Rule.neverFalls },

    // Ownership and use. No person appears here, and none ever should: a
    // keeper's name on an immutable ledger could never be erased, which is
    // why this records COUNTS AND DATES only. Belgium's Car-Pass has run on
    // the same rule for twenty years.
    keeperSinceDate:           { label: 'Current keeper since',    kind: 'date',  rule: Rule.neverFalls },
    usageClassMask:            { label: 'Recorded uses',           kind: 'mask',  rule: Rule.neverFalls },
    importStatus:              { label: 'Import status',           kind: 'code',  rule: Rule.neverFalls },
    countryChangeCount:        { label: 'Country changes',         kind: 'count', rule: Rule.neverFalls },
    plateChangeCount:          { label: 'Plate changes',           kind: 'count', rule: Rule.neverFalls },
    colourChangeCount:         { label: 'Colour changes',          kind: 'count', rule: Rule.neverFalls },

    // Odometer. The reading DATE is what makes a mileage claim mean anything:
    // "under 150 000 km" is a different statement if it was read last week or
    // in 2019.
    odometerReadingDate:       { label: 'Odometer read on',        kind: 'date',  rule: Rule.neverFalls },
    odometerReadingCount:      { label: 'Odometer readings',       kind: 'count', rule: Rule.neverFalls },
    odometerSourceMask:        { label: 'Reading sources',         kind: 'mask',  rule: Rule.neverFalls },
    odometerAnomalyCount:      { label: 'Odometer anomalies',      kind: 'count', rule: Rule.neverFalls },

    // Roadworthiness
    inspectionCount:           { label: 'Inspections',             kind: 'count', rule: Rule.neverFalls },
    inspectionPassCount:       { label: 'Inspections passed',      kind: 'count', rule: Rule.neverFalls },
    inspectionFailCount:       { label: 'Inspections failed',      kind: 'count', rule: Rule.neverFalls },
    inspectionExpiryDate:      { label: 'Inspection valid until',  kind: 'date',  rule: Rule.neverFalls },
    dangerousDefectCount:      { label: 'Dangerous defects',       kind: 'count', rule: Rule.neverFalls },
    majorDefectCount:          { label: 'Major defects',           kind: 'count', rule: Rule.neverFalls },
    advisoryCount:             { label: 'Advisories',              kind: 'count', rule: Rule.neverFalls },

    // Damage and repair. Cost is BANDED rather than an amount: a precise
    // repair bill is commercially sensitive and a band answers the question.
    damageEventCount:          { label: 'Damage events',           kind: 'count', rule: Rule.neverFalls },
    structuralRepairCount:     { label: 'Structural repairs',      kind: 'count', rule: Rule.neverFalls },
    airbagDeploymentCount:     { label: 'Airbag deployments',      kind: 'count', rule: Rule.neverFalls },
    floodDamageCount:          { label: 'Flood damage records',    kind: 'count', rule: Rule.neverFalls },
    fireDamageCount:           { label: 'Fire damage records',     kind: 'count', rule: Rule.neverFalls },
    hailDamageCount:           { label: 'Hail damage records',     kind: 'count', rule: Rule.neverFalls },
    repairCount:               { label: 'Repairs recorded',        kind: 'count', rule: Rule.neverFalls },
    partsReplacedCount:        { label: 'Parts replaced',          kind: 'count', rule: Rule.neverFalls },
    maxRepairCostBandCode:     { label: 'Largest repair band',     kind: 'code',  rule: Rule.neverFalls },

    // Service
    lastServiceDate:           { label: 'Last service',            kind: 'date',  rule: Rule.neverFalls },
    lastServiceOdometerKm:     { label: 'Odometer at last service', kind: 'km',   rule: Rule.neverFalls },
    scheduledServiceMissedCount: { label: 'Scheduled services missed', kind: 'count', rule: Rule.neverFalls },
    timingBeltReplacedDate:    { label: 'Timing belt replaced',    kind: 'date',  rule: Rule.neverFalls },

    // Recalls. Two monotone counters rather than one "open recalls" that
    // would have to FALL when a recall is fixed, which no rule here permits.
    // Open recalls is the difference, and neither half can be walked back.
    recallIssuedCount:         { label: 'Recalls issued',          kind: 'count', rule: Rule.neverFalls },
    recallCompletedCount:      { label: 'Recalls completed',       kind: 'count', rule: Rule.neverFalls },

    // Specification, as numeric codes against a published list. A provable
    // value is Uint<64>, so a make or a body type cannot be a string here;
    // an enumeration can, and then it is provable like anything else. Free
    // text stays in the document, bound by the content root.
    modelYear:                 { label: 'Model year',              kind: 'year',  rule: Rule.neverChanges },
    makeCode:                  { label: 'Make',                    kind: 'code',  rule: Rule.neverChanges },
    modelCode:                 { label: 'Model',                   kind: 'code',  rule: Rule.neverChanges },
    bodyTypeCode:              { label: 'Body type',               kind: 'code',  rule: Rule.neverChanges },
    transmissionCode:          { label: 'Transmission',            kind: 'code',  rule: Rule.neverChanges },
    driveTypeCode:             { label: 'Drive type',              kind: 'code',  rule: Rule.neverChanges },
    colourCodeAtFirstReg:      { label: 'Colour at first registration', kind: 'code', rule: Rule.neverChanges },
    engineCapacityCc:          { label: 'Engine capacity',         kind: 'cc',    rule: Rule.neverChanges },
    enginePowerKw:             { label: 'Engine power',            kind: 'kw',    rule: Rule.neverChanges },
    seatCount:                 { label: 'Seats',                   kind: 'count', rule: Rule.neverChanges },
    doorCount:                 { label: 'Doors',                   kind: 'count', rule: Rule.neverChanges },
    kerbWeightKg:              { label: 'Kerb weight',             kind: 'kg',    rule: Rule.neverChanges }
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
// `process` does not exist in a browser, and a missing override there is
// the ordinary case rather than an error: the page generates a fresh seed.
const SEED_OVERRIDE = typeof process !== 'undefined'
    ? process.env?.VINPASSPORT_SALT_SEED?.trim()
    : undefined;
if (SEED_OVERRIDE !== undefined && SEED_OVERRIDE !== '' && !/^[0-9a-fA-F]{64}$/.test(SEED_OVERRIDE)) {
    throw new Error(
        'VINPASSPORT_SALT_SEED must be exactly 64 hex characters (32 bytes). '
        + `Got ${SEED_OVERRIDE.length} character(s). Unset it to generate a fresh random seed; `
        + 'a malformed value would silently weaken every commitment rather than fail.'
    );
}
const SALT_SEED = SEED_OVERRIDE ? fromHex(SEED_OVERRIDE) : randomBytes(32);
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
    return fromHex(tree.rootHex);
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

    // A vehicle outlives the party that registered it. The registrar may hand
    // the right to write this ONE vehicle to a dealership or a garage, and
    // take it back; the circuit checks the authorisation, so a party that was
    // never given it cannot write however it is asked. Identities are derived
    // in-circuit from secrets the chain never sees.
    const writers = new Map((intake.writers ?? []).map((w) => [w.label, w]));
    const asRegistrar = () => { if (intake.registrarSecret) sim.actAs(intake.registrarSecret); };
    for (const w of writers.values()) {
        asRegistrar();
        attempt(`authoriseWriter ${w.label}`, () => sim.authoriseWriter(vin, w.id));
    }

    for (const [i, update] of (intake.updates ?? []).entries()) {
        // `by` names which authorised party is writing this round. Without it
        // the registrar writes, which is what every existing intake expects.
        const { by, ...values } = update;
        const writer = by ? writers.get(by) : null;
        if (by && !writer) { refused.push({ step: `update ${i + 1}`, reason: `unknown writer "${by}"` }); continue; }
        for (const [name, value] of Object.entries(values)) {
            if (!(name in FIELDS)) { refused.push({ step: `update ${i + 1} ${name}`, reason: 'unknown field' }); continue; }
            const who = writer ? ` (by ${writer.label})` : '';
            attempt(`update ${i + 1}: ${name} -> ${value}${who}`, () => {
                if (writer) sim.actAs(writer.secret); else asRegistrar();
                sim.recordField(vin, K[name], BigInt(value), salt());
            });
        }
    }
    asRegistrar();

    // Every question in the published catalogue, rather than a hardcoded four.
    // An intake names a claim by its catalogue id. A question whose bound is
    // null takes the bound from the request, because its whole shape is
    // "under a ceiling the asker names"; everything else uses the standard
    // rung, which is what stops a bespoke bound per enquiry narrowing the
    // value. See site/assets/claim-catalogue.mjs.
    //
    // A claim whose field was never initialised is REFUSED by the circuit and
    // lands in `refused`, which is the honest outcome: the question exists,
    // this passport cannot answer it, and nothing is written.
    for (const q of CLAIM_CATALOGUE) {
        const wanted = intake.prove?.[q.id];
        if (!wanted) continue;
        // A question comparing two of the vehicle's own fields publishes only
        // how far apart they may be, and opens both commitments.
        if (isCompare(q)) {
            attempt(`prove ${q.id}`, () =>
                sim.proveFieldAtMostField(vin, K[q.field], K[q.against], q.slack));
            continue;
        }
        const bound = q.bound === null ? BigInt(wanted) : boundFor(q);
        attempt(`prove ${q.id}`, () => (q.atMost
            ? sim.proveFieldAtMost(vin, K[q.field], bound)
            : sim.proveFieldAtLeast(vin, K[q.field], bound)));
    }

    return { vinHex, applied, refused };
}

// ---------------------------------------------------------------- demo pair

/** The two standing demonstration vehicles. Returns their vin hex hashes. */
export function buildDemoVehicles(sim, salt) {
    const a = applyIntake(sim, {
        vin: 'WVWZZZ1JZXW000001',
        registrar: 'demo-authority',
        fields: {
            odometerKm: 18_430, accidentCount: 0, ownerCount: 1, writeOffCategory: 0,
            serviceCount: 1,
            // The pair behind "serviced within the last 15 000 km": the
            // odometer, and the reading taken when it was last serviced.
            // Neither is ever published; only how far apart they may be.
            lastServiceOdometerKm: 18_430,
            // And the pair behind "every recall has been carried out". One
            // recall is issued here and completed below, so the claim says
            // something: with both at zero it would be true but empty.
            recallIssuedCount: 1, recallCompletedCount: 0
        },
        panel: {
            vehicleCategory: 'M1', fuelType: 'bev', emissionsClass: 'n/a',
            batteryPassportId: 'BPID-EU-000184-2027', batteryChemistry: 'NMC811',
            firstRegistrationDate: 20_240, co2FootprintKgCO2e: 8_400,
            recycledPlasticPct: 26.5, recycledSteelPct: 31.0
        },
        // This vehicle shows a LIFE, not a snapshot. The authority registers
        // it, then hands the right to write this one vehicle to the selling
        // dealership and to a service garage, each writing under its own
        // identity. The integrity rules still apply to every one of them:
        // delegation hands over the pen, never the right to break the rule.
        registrarSecret: REGISTRAR_SECRET,
        writers: [
            { label: 'dealership', id: DEALER_ID, secret: DEALER_SECRET },
            { label: 'service garage', id: GARAGE_ID, secret: GARAGE_SECRET }
        ],
        updates: [
            { odometerKm: 44_210, serviceCount: 2, lastServiceOdometerKm: 44_210, by: 'service garage' },
            { odometerKm: 61_890, serviceCount: 3, lastServiceOdometerKm: 61_890, by: 'service garage' },
            // The recall is carried out at this service, which is what
            // lets the vehicle answer "every recall has been carried out"
            // without saying how many there were.
            {
                odometerKm: 79_000, serviceCount: 4, lastServiceOdometerKm: 79_000,
                recallCompletedCount: 1, by: 'service garage'
            },
            // The resale: the dealership takes the car in and records the
            // reading at handover. It is the last party to write the
            // odometer, which is why the panel can name it rather than the
            // manufacturer who registered the vehicle years earlier. It does
            // NOT service the car, so the odometer now runs 4 260 km past the
            // last service reading, which is what the compare claim proves.
            { odometerKm: 83_260, by: 'dealership' }
        ],
        prove: {
            neverWrittenOff: true, noAccidents: true, oneKeeper: true, mileageUnder: 150_000,
            servicedWithin15000km: true, allRecallsDone: true
        }
    }, salt);

    const b = applyIntake(sim, {
        vin: 'WAUZZZ8V5KA000002',
        registrar: 'demo-authority',
        fields: {
            odometerKm: 96_500, accidentCount: 2, ownerCount: 3, writeOffCategory: 1,
            // Present, so the questions are askable, and unanswered, because
            // this seller declined to answer them. That is the contrast.
            lastServiceOdometerKm: 41_000, recallIssuedCount: 2, recallCompletedCount: 0
        },
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
    // A claim comparing two of a vehicle's fields. Both commitments and the
    // public slack, and neither value: the same bargain as a single-field
    // claim, made about a pair.
    const relClaims = [];
    for (const [key, c] of l.relClaims) {
        relClaims.push({
            key: hex(key), slotHigh: hex(c.slotHigh), slotLow: hex(c.slotLow),
            vinHash: hex(c.vinHash),
            fieldKeyHigh: hex(c.fieldKeyHigh), fieldKeyLow: hex(c.fieldKeyLow),
            commitmentHigh: hex(c.commitmentHigh), commitmentLow: hex(c.commitmentLow),
            slack: c.slack.toString()
        });
    }
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
        // Who wrote each field, and who is allowed to.
        //
        // A passport that cannot say who last touched a value is asking to be
        // taken on trust, and over a vehicle's life the writer changes: the
        // manufacturer registers it, a dealership records the handover, a
        // garage records the service. The ledger holds the identity, derived
        // in-circuit from a secret it never sees, so publishing it discloses
        // nothing that was private and lets a reader see the custody chain.
        writers: [...l.writers].map(hex),
        fieldWriter: mapToObj(l.fieldWriter, hex),
        claims,
        relClaims
    };
}

export function vocabulary(demoVehicles) {
    return {
        note: 'Public vocabulary: blake2b-256(field name) -> display metadata. See docs/FIELDS.md.',
        fields: Object.fromEntries(
            Object.entries(FIELDS).map(([name, meta]) => [
                hex(K[name]), { name, label: meta.label, kind: meta.kind, tier: tierOf(name) }
            ])
        ),
        demoVehicles
    };
}
