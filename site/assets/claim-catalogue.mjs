/**
 * The questions this passport can answer, and nothing else.
 *
 * A verifier should be able to see the WHOLE list of questions a passport
 * could answer, and for each one get back a yes, or silence. Not a value.
 * That is the product, so the list of questions is a published artefact
 * rather than something each surface invents for itself.
 *
 * ONE CATALOGUE, THREE READERS. Until now the claims a buyer sees
 * (`site/assets/verdict.mjs`), the claims a console can request
 * (`scripts/lib/preprod-plan.mjs`) and the claims the simulator runs
 * (`scripts/lib/scenario.mjs`) were three separate lists of four. They agreed
 * by luck. This file is the only list; all three import it, so a question
 * cannot exist on one surface and not another.
 *
 * Browser-safe on purpose: no imports, no Node built-ins, plain data. The
 * page loads it directly and the scripts import the same file.
 *
 * ---------------------------------------------------------------------------
 * WHAT A READER GETS BACK, STATED HONESTLY
 *
 * There is no proven NO. A failed proof writes nothing to the ledger, so the
 * states are `proven`, `superseded` and `not-proven`, and the last of those is
 * silence rather than a denial. A "no" exists only if somebody deliberately
 * proves the opposite direction, which a seller has no reason to do. Every
 * surface that renders this list must keep that distinction; see
 * `site/assets/verdict.mjs`.
 *
 * A BOUND OF ZERO IS A FULL DISCLOSURE. Values are Uint<64>, so `atMost 0`
 * means the value is exactly 0. Most of the yes/no questions here are that
 * shape. They do not hide the value, they let the holder choose to reveal it,
 * and the README says so under "What a published claim gives away".
 *
 * CLAIMS ACCUMULATE AND NEVER RESET. `claimKey` includes the bound, so a
 * second bound joins the first rather than replacing it. Answering enough
 * differently-phrased questions narrows a value towards a point. That is why
 * every bound below is a FIXED STANDARD RUNG rather than something a buyer
 * types: a bespoke bound per enquiry is the thing that leaks.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Display groups, in the order a buyer actually asks them. Title and mileage
 * first because those are the questions that end a sale.
 */
export const CLAIM_GROUPS = [
    { id: 'title', label: 'Title and legal status' },
    { id: 'mileage', label: 'Mileage' },
    { id: 'damage', label: 'Damage and repair' },
    { id: 'ownership', label: 'Ownership and use' },
    { id: 'service', label: 'Service and roadworthiness' },
    { id: 'circularity', label: 'Environmental and circularity' },
    { id: 'spec', label: 'Specification' }
];

/**
 * One entry is one question.
 *
 *   field    the registry field name, which must exist in scenario.mjs FIELDS
 *   against  SET ONLY ON A TWO-FIELD QUESTION. The second field, compared
 *            against the first. These are the questions that are not a field
 *            against a number: "serviced within the last 15 000 km" is the
 *            odometer against the reading at the last service, and neither
 *            value can be published without giving away the thing the
 *            passport exists to keep. A two-field question carries `slack`
 *            instead of `bound`, and is answered by proveFieldAtMostField.
 *   slack    two-field questions only: how far apart the pair may be. Zero
 *            means they must be equal, which is what "every recall has been
 *            done" means.
 *   atMost   true for a ceiling, false for a floor
 *   bound    how the question is scored against a claim's bound:
 *              bigint          a fixed rung
 *              null            any claim in this direction answers it; the
 *                              bound is shown rather than judged
 *              { daysAgo: N }  a moving threshold, today minus N days, in
 *                              epoch days. An old claim stops answering as
 *                              the threshold passes it, which is correct:
 *                              "serviced within 12 months" must expire.
 *   label    the question, as a buyer would put it
 *   yes      what a tick actually licenses the reader to conclude
 *
 * `bound: 0n` entries are the full-disclosure shape described above.
 */
export const CLAIM_CATALOGUE = [
    // ---------------------------------------------------------------- title
    {
        id: 'cleanTitle', group: 'title', field: 'titleStatusMask', atMost: true, bound: 0n,
        label: 'Nothing at all on the title',
        yes: 'Never written off, stolen, flooded, burnt or scrapped, as far as this record goes'
    },
    {
        id: 'neverWrittenOff', group: 'title', field: 'writeOffCategory', atMost: true, bound: 0n,
        label: 'Never written off',
        yes: 'No insurer has categorised this vehicle as a total loss in this record'
    },
    {
        id: 'notStructuralWriteOff', group: 'title', field: 'writeOffCategory', atMost: true, bound: 2n,
        label: 'Not a structural write-off (not Category A or B)',
        yes: 'Any write-off recorded was Category S or N, not a scrap or break category'
    },
    {
        id: 'neverStolen', group: 'title', field: 'stolenRecordCount', atMost: true, bound: 0n,
        label: 'Never reported stolen',
        yes: 'No theft report reached this record'
    },
    {
        id: 'neverScrapped', group: 'title', field: 'scrapCertificateDate', atMost: true, bound: 0n,
        label: 'No certificate of destruction issued',
        yes: 'The vehicle has not been through an authorised treatment facility'
    },

    // -------------------------------------------------------------- mileage
    {
        id: 'mileageUnder', group: 'mileage', field: 'odometerKm', atMost: true, bound: null,
        label: 'Mileage under a stated ceiling', openLabel: 'Mileage under',
        yes: 'The odometer is at or below the ceiling shown, which the claim names'
    },
    {
        id: 'odometerReadRecently', group: 'mileage', field: 'odometerReadingDate',
        atMost: false, bound: { daysAgo: 365 },
        label: 'Odometer read within the last 12 months',
        yes: 'The mileage above is recent, not a figure from years ago'
    },
    {
        id: 'noOdometerAnomaly', group: 'mileage', field: 'odometerAnomalyCount', atMost: true, bound: 0n,
        label: 'No odometer anomaly ever recorded',
        yes: 'No source has reported a reading lower than one before it'
    },

    // --------------------------------------------------------------- damage
    {
        id: 'noAccidents', group: 'damage', field: 'accidentCount', atMost: true, bound: 0n,
        label: 'No reported accidents',
        yes: 'No accident reached this record. It does not mean none happened'
    },
    {
        id: 'noStructuralRepair', group: 'damage', field: 'structuralRepairCount', atMost: true, bound: 0n,
        label: 'No structural repair',
        yes: 'Nothing was repaired on the vehicle structure in this record'
    },
    {
        id: 'airbagsNeverDeployed', group: 'damage', field: 'airbagDeploymentCount', atMost: true, bound: 0n,
        label: 'Airbags never deployed',
        yes: 'No airbag deployment reached this record'
    },
    {
        id: 'neverFlooded', group: 'damage', field: 'floodDamageCount', atMost: true, bound: 0n,
        label: 'No flood damage recorded',
        yes: 'No water damage event reached this record'
    },
    {
        id: 'neverFireDamaged', group: 'damage', field: 'fireDamageCount', atMost: true, bound: 0n,
        label: 'No fire damage recorded',
        yes: 'No fire event reached this record'
    },
    {
        id: 'atMostOneDamageEvent', group: 'damage', field: 'damageEventCount', atMost: true, bound: 1n,
        label: 'At most one damage event of any kind',
        yes: 'One damage event at most, counting accidents, flood, fire and hail together'
    },

    // ------------------------------------------------------------ ownership
    {
        id: 'oneKeeper', group: 'ownership', field: 'ownerCount', atMost: true, bound: 1n,
        label: 'One keeper from new',
        yes: 'The vehicle has had a single keeper'
    },
    {
        id: 'atMostThreeKeepers', group: 'ownership', field: 'ownerCount', atMost: true, bound: 3n,
        label: 'Three keepers or fewer',
        yes: 'No more than three keepers in this record'
    },
    {
        id: 'heldTwoYears', group: 'ownership', field: 'keeperSinceDate',
        atMost: true, bound: { daysAgo: 730 },
        label: 'Held by the current keeper for two years or more',
        yes: 'Not a quick flip. The keeper has had it at least two years'
    },
    {
        id: 'neverCommercialUse', group: 'ownership', field: 'usageClassMask', atMost: true, bound: 0n,
        label: 'Never a taxi, rental, driving school or fleet car',
        yes: 'Only private use is recorded'
    },
    {
        id: 'neverImported', group: 'ownership', field: 'importStatus', atMost: true, bound: 0n,
        label: 'Never imported',
        yes: 'First registered in this market and not brought in from another'
    },
    {
        id: 'plateNeverChanged', group: 'ownership', field: 'plateChangeCount', atMost: true, bound: 0n,
        label: 'Registration plate never changed',
        yes: 'The plate has not been swapped, which is sometimes used to shed a history'
    },

    // -------------------------------------------------------------- service
    {
        id: 'fourServices', group: 'service', field: 'serviceCount', atMost: false, bound: 4n,
        label: 'At least four services recorded',
        yes: 'Four or more services reached this record'
    },
    {
        id: 'servicedRecently', group: 'service', field: 'lastServiceDate',
        atMost: false, bound: { daysAgo: 365 },
        label: 'Serviced within the last 12 months',
        yes: 'A service was recorded in the last year'
    },
    {
        id: 'noMissedService', group: 'service', field: 'scheduledServiceMissedCount', atMost: true, bound: 0n,
        label: 'No scheduled service missed',
        yes: 'Every service the schedule called for was recorded'
    },
    {
        id: 'servicedWithin15000km', group: 'service',
        field: 'odometerKm', against: 'lastServiceOdometerKm', slack: 15_000n,
        label: 'Serviced within the last 15,000 km',
        yes: 'The odometer has not run more than 15,000 km past the reading taken at the last service. Neither reading is published'
    },
    {
        id: 'timingBeltDone', group: 'service', field: 'timingBeltReplacedDate', atMost: false, bound: 1n,
        label: 'Timing belt has been replaced',
        yes: 'A timing belt replacement is on the record, with a date'
    },
    {
        id: 'inspectionValid', group: 'service', field: 'inspectionExpiryDate',
        atMost: false, bound: { daysAgo: 0 },
        label: 'Roadworthiness inspection currently valid',
        yes: 'The inspection has not expired as at today'
    },
    {
        id: 'neverFailedInspection', group: 'service', field: 'inspectionFailCount', atMost: true, bound: 0n,
        label: 'Never failed a roadworthiness inspection',
        yes: 'Every recorded inspection was a pass'
    },
    {
        id: 'noDangerousDefect', group: 'service', field: 'dangerousDefectCount', atMost: true, bound: 0n,
        label: 'No dangerous defect ever recorded',
        yes: 'No inspection recorded a defect classed as dangerous'
    },
    {
        id: 'allRecallsDone', group: 'service',
        field: 'recallIssuedCount', against: 'recallCompletedCount', slack: 0n,
        label: 'Every recall has been carried out',
        yes: 'As many recalls were completed as were issued. How many there were stays hidden'
    },

    // ---------------------------------------------------------- circularity
    {
        id: 'recycledPlastic25', group: 'circularity', field: 'recycledPlasticPct', atMost: false, bound: 25n,
        label: 'Recycled plastic content at least 25%',
        yes: 'Meets the share that Art. 6(1) of Reg (EU) 2026/1738 sets for types approved from 2036'
    },
    {
        id: 'recyclability95', group: 'circularity', field: 'recyclabilityPct', atMost: false, bound: 95n,
        label: 'Recyclability at least 95%',
        yes: 'Meets the 3R level inherited from Directive 2005/64/EC'
    },
    {
        id: 'reusability85', group: 'circularity', field: 'reusabilityPct', atMost: false, bound: 85n,
        label: 'Reusability at least 85%',
        yes: 'Meets the 3R reusability level'
    },
    {
        id: 'co2Under', group: 'circularity', field: 'co2FootprintKgCO2e', atMost: true, bound: null,
        label: 'Production CO2 footprint under a stated ceiling', openLabel: 'CO2 footprint under',
        yes: 'The declared footprint is at or below the ceiling the claim names'
    },

    // ----------------------------------------------------------------- spec
    {
        id: 'modelYear2019', group: 'spec', field: 'modelYear', atMost: false, bound: 2019n,
        label: 'Model year 2019 or later',
        yes: 'Built to a 2019 or later model year'
    },
    {
        id: 'engineUnder2000cc', group: 'spec', field: 'engineCapacityCc', atMost: true, bound: 2000n,
        label: 'Engine capacity 2000cc or under',
        yes: 'Relevant where tax or licence class turns on capacity'
    },
    {
        id: 'fiveSeats', group: 'spec', field: 'seatCount', atMost: false, bound: 5n,
        label: 'At least five seats',
        yes: 'Five seats or more'
    }
];

/** Days since the Unix epoch, which is how every date field is stored. */
export const epochDaysToday = (now = Date.now()) => Math.floor(now / 86_400_000);

/**
 * The bound a question is scored against right now, as a bigint, or null for
 * the "any claim in this direction" questions.
 *
 * Separated from the catalogue because a moving threshold cannot be a literal:
 * "serviced within 12 months" is a different epoch day every day, and a claim
 * proven last year must stop answering it rather than quietly going on.
 */
export const boundFor = (q, now = Date.now()) => {
    if (isCompare(q)) return q.slack;
    if (q.bound === null) return null;
    if (typeof q.bound === 'bigint') return q.bound;
    return BigInt(epochDaysToday(now) - q.bound.daysAgo);
};

/** The questions in a group, in catalogue order. */
export const questionsIn = (groupId) => CLAIM_CATALOGUE.filter((q) => q.group === groupId);

/** True for a question that compares two of a vehicle's own fields. */
export const isCompare = (q) => typeof q.against === 'string';

/** Every distinct field the catalogue can ask about, both sides included. */
export const CLAIM_FIELDS = [...new Set(
    CLAIM_CATALOGUE.flatMap((q) => (isCompare(q) ? [q.field, q.against] : [q.field]))
)];
