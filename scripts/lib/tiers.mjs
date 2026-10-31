/**
 * Which audience may see which field: the disclosure tier policy.
 *
 * The tiers and their audiences are the table in docs/ARCHITECTURE.md
 * ("Disclosure tiers"); D26 in docs/DECISIONS.md settles that a tier is
 * enforced by what the holder hands over, not by a server. This module is the
 * table made exact, one tier per registry field, so a bundle builder can
 * refuse and a bundle reader can report.
 *
 *   public     a buyer scanning a listing. The vehicle as built and as
 *              declared to the regulator: specification, first registration,
 *              the environmental and circularity declarations. Values a type
 *              approval or an EVP already publishes, and EVP data may not be
 *              gated at all (Reg (EU) 2025/1707, Annex V 4.2.3).
 *   trade      a dealer, recycler, insurer or lender. Adds the history a buyer
 *              asks a seller to prove and an appraiser needs exactly: mileage,
 *              keepers, accidents, damage, inspections, service, recalls.
 *   authority  a registry, the police, a notified body, an ELV facility. Adds
 *              records whose source is an authority and the end-of-life data:
 *              theft and recovery, export, destruction, dismantling. The VIN
 *              itself travels only at this tier.
 *
 * Until the Commission adopts the access rules ordered by Reg (EU) 2026/1738
 * Art. 13(6)(d), due by 14 August 2030, this assignment is our design and must
 * be revisited when that act lands.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

export const TIERS = Object.freeze(['public', 'trade', 'authority']);
export const POLICY_VERSION = 'vinpassport-tiers/v1';

const RANK = Object.freeze({ public: 0, trade: 1, authority: 2 });

const GROUPS = {
    public: [
        // identity date
        'firstRegistrationDate',
        // the regulatory declarations, panel slots 7 to 15
        'co2FootprintKgCO2e', 'recycledPlasticPct', 'recycledPlasticFromELVPct', 'recycledSteelPct',
        'recycledAluminiumPct', 'criticalRawMaterialPct', 'reusabilityPct', 'recyclabilityPct',
        'recoverabilityPct',
        // specification, as built
        'modelYear', 'makeCode', 'modelCode', 'bodyTypeCode', 'transmissionCode', 'driveTypeCode',
        'colourCodeAtFirstReg', 'engineCapacityCc', 'enginePowerKw', 'seatCount', 'doorCount',
        'kerbWeightKg'
    ],
    trade: [
        // the lifecycle counters, panel slots 0 to 4
        'odometerKm', 'accidentCount', 'ownerCount', 'serviceCount', 'writeOffCategory',
        'lastInspectionDate',
        // title status as the trade sees it; the source records stay at authority
        'titleStatusMask', 'writeOffDate', 'repairedAndReturnedDate',
        // ownership and use: counts and dates, never a person
        'keeperSinceDate', 'usageClassMask', 'importStatus', 'countryChangeCount', 'plateChangeCount',
        'colourChangeCount',
        // odometer
        'odometerReadingDate', 'odometerReadingCount', 'odometerSourceMask', 'odometerAnomalyCount',
        // roadworthiness
        'inspectionCount', 'inspectionPassCount', 'inspectionFailCount', 'inspectionExpiryDate',
        'dangerousDefectCount', 'majorDefectCount', 'advisoryCount',
        // damage and repair
        'damageEventCount', 'structuralRepairCount', 'airbagDeploymentCount', 'floodDamageCount',
        'fireDamageCount', 'hailDamageCount', 'repairCount', 'partsReplacedCount', 'maxRepairCostBandCode',
        // service
        'lastServiceDate', 'lastServiceOdometerKm', 'scheduledServiceMissedCount', 'timingBeltReplacedDate',
        // recalls
        'recallIssuedCount', 'recallCompletedCount'
    ],
    authority: [
        // records an authority is the source of
        'stolenRecordCount', 'recoveredRecordCount', 'exportMarkerCount',
        // end of life
        'scrapCertificateDate', 'dismantlingTimeMinutes'
    ]
};

const TIER_OF = Object.freeze(Object.fromEntries(
    Object.entries(GROUPS).flatMap(([tier, names]) => names.map((n) => [n, tier]))
));

/** Every field the policy names, with its tier. */
export const FIELD_TIERS = TIER_OF;

/** The tier a field belongs to. Throws for a name the policy does not know,
 *  because a field nobody assigned must not default to anyone. */
export function tierOf(name) {
    const tier = TIER_OF[name];
    if (!tier) throw new Error(`no disclosure tier for field '${name}'`);
    return tier;
}

/** True when `tier` may see a field of tier `fieldTier`. */
export function allows(tier, fieldTier) {
    if (!(tier in RANK)) throw new Error(`unknown tier '${tier}', expected one of ${TIERS.join(', ')}`);
    if (!(fieldTier in RANK)) throw new Error(`unknown tier '${fieldTier}'`);
    return RANK[fieldTier] <= RANK[tier];
}

/** The VIN travels only to the highest tier. */
export const vinAllowed = (tier) => allows(tier, 'authority');
