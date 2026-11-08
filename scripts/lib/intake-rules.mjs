/**
 * What a run is made of, without a wallet: the guided intake, the checks on a
 * manual intake, and the proof-reuse rule. Pure, so the tests and both
 * runners (ledger 8 at the tag ledger8-preprod, ledger 9 in runner9.mjs)
 * share one copy.
 *
 * Moved verbatim from scripts/lib/preprod-runner.mjs on 8 Nov 2026; only
 * guidedIntake changed shape, taking the dealer it used to close over.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { CLAIM_CATALOGUE } from '../../site/assets/claim-catalogue.mjs';
import { FIELDS, PANEL } from './scenario.mjs';
import { CLAIM_DEFS, randomDemoVin } from './preprod-plan.mjs';

export { randomDemoVin };

/**
 * May a contract-call proof made when the contract's latest action was
 * `atBuild` still be submitted now that its latest action is `now`?
 *
 * Returns `null` when it may, and otherwise the reason it may not - so the
 * caller can say why it is about to spend another 30-100s proving.
 *
 * The call carries a transcript that has to replay against the contract's
 * current state, and a call that lands and FAILS costs its fee exactly like
 * one that succeeds. So this answers "reusable" only on positive evidence
 * that nothing moved. Not knowing is not the same as nothing having changed:
 * an indexer that fails to answer, or a contract with no recorded action at
 * either end, both mean rebuild.
 */
export function proofReusable(atBuild, now) {
    if (atBuild?.hash == null) return 'the contract had no recorded action when the call was proven';
    if (now?.hash == null) return 'the indexer did not say what the contract\'s latest action is';
    if (now.hash !== atBuild.hash) return `the contract moved on to ${now.hash}`;
    return null;
}

/**
 * Validate a manual intake posted to the preprod route.
 *
 * Pulled out of `createRunner` so it can be tested without a wallet, a seed
 * file or a registrar secret. `dealer` is the one writer identity the runner
 * holds, or null when registrar C is not configured.
 */
export function validateManualIntake(body, dealer) {
    const fields = {};
    for (const [name, v] of Object.entries(body.fields ?? {})) {
        if (!(name in FIELDS)) throw new Error(`unknown field "${name}"`);
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0 || n > 10_000_000) throw new Error(`field "${name}" must be an integer 0..10000000`);
        fields[name] = n;
    }
    if (!Object.keys(fields).length) throw new Error('at least one field is needed');
    /* Delegation, which this route used to lose.
     *
     * The intake console offers a dealership, sends `authorise: [label]`
     * and stamps the update with `by: label`. Against the LOCAL engine
     * (`/api/intake`) that works. Against preprod it did not: `authorise`
     * was never read, so it was dropped, and `by` fell through the field
     * loop below and threw `unknown field "by" in updates`. One form, two
     * behaviours, and the silent half produced a run that looks delegated
     * and is not, which is the exact thing the local route refuses by
     * name.
     *
     * Labels are resolved against the identities this runner actually
     * holds, and an unresolvable one is refused rather than ignored.
     * Preprod carries a single writer, registrar C, and only when its
     * secrets are configured; the console also offers a service garage,
     * which has no preprod identity and must say so instead of quietly
     * registering a vehicle nobody delegated.
     */
    const known = dealer ? { [dealer.label]: { label: dealer.label, id: dealer.id } } : {};
    const resolve = (list, what) => {
        const out = [];
        for (const entry of Array.isArray(list) ? list : []) {
            const label = String(typeof entry === 'string' ? entry : entry?.label ?? '');
            const w = known[label];
            if (!w) {
                throw new Error(dealer
                    ? `no preprod identity for "${label}"; this runner holds "${dealer.label}"`
                    : `cannot ${what} "${label}": no writer identity is configured on this runner`);
            }
            if (!out.some((x) => x.label === w.label)) out.push(w);
        }
        return out;
    };
    const authorise = resolve(body.authorise, 'authorise');
    const withdraw = resolve(body.withdraw, 'withdraw');

    const updates = (Array.isArray(body.updates) ? body.updates : []).slice(0, 2).map((round) => {
        const out = {};
        for (const [name, v] of Object.entries(round ?? {})) {
            // `by` names the writer, not a field. It is carried through
            // rather than range-checked, and it has to have been
            // authorised in this same intake or the ledger would refuse
            // the write anyway, later and less clearly.
            if (name === 'by') {
                const label = String(v);
                if (!authorise.some((w) => w.label === label)) {
                    throw new Error(`"${label}" writes an update but was never authorised`);
                }
                out.by = label;
                continue;
            }
            if (!(name in FIELDS)) throw new Error(`unknown field "${name}" in updates`);
            const n = Number(v);
            if (!Number.isInteger(n) || n < 0 || n > 10_000_000) throw new Error(`update "${name}" must be an integer 0..10000000`);
            out[name] = n;
        }
        return out;
    }).filter((r) => Object.keys(r).some((k) => k !== 'by'));
    const prove = {};
    for (const [claim, def] of Object.entries(CLAIM_DEFS)) {
        if (def.openBound) {
            // The asker names the ceiling, so it is a number and is range
            // checked. Every other question uses its standard rung.
            const m = Number(body.prove?.[claim]);
            if (Number.isInteger(m) && m > 0 && m <= 10_000_000) prove[claim] = m;
        } else if (body.prove?.[claim]) prove[claim] = true;
    }
    const panel = {};
    for (const [name, v] of Object.entries(body.panel ?? {})) {
        if (!(name in PANEL) || name === 'vinHash') continue;
        panel[name] = String(v).slice(0, 60);
    }
    return {
        vin: randomDemoVin(),   // ALWAYS server-generated: demos never squat a real VIN
        registrar: String(body.registrar ?? 'passport.vin-demo').slice(0, 40) || 'passport.vin-demo',
        fields, panel, updates, prove,
        // Same shape the guided run emits, so both routes exercise the
        // same circuits and the planner needs no special case.
        ...(authorise.length ? { authorise } : {}),
        ...(withdraw.length ? { withdraw } : {})
    };
}

/**
 * The guided run: one vehicle, every circuit the contract has, and one claim
 * designed to be refused in-circuit. `dealer` is registrar C when configured.
 */
export function guidedIntake(dealer = null) {
    const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
    // The catalogue is the authority on how far apart the odometer and the
    // last-service reading may be. Read it; do not restate it.
    const SERVICE_SLACK = Number(CLAIM_CATALOGUE
        .find((q) => q.id === 'servicedWithin15000km').slack);
    const base = 18_000 + Math.floor(Math.random() * 40_000);
    return {
        vin: randomDemoVin(),
        registrar: 'passport.vin-demo',
        fields: {
            odometerKm: base, accidentCount: 0, ownerCount: 2, serviceCount: 6,
            // The pair the compare claim is about. The garage services
            // the car, then the dealership adds miles without servicing
            // it, so the two readings genuinely differ.
            lastServiceOdometerKm: base
        },
        panel: {
            vehicleCategory: 'M1', fuelType: pick(['bev', 'petrol', 'hybrid']),
            firstRegistrationDate: 19_700 + Math.floor(Math.random() * 1_000),
            co2FootprintKgCO2e: 7_000 + Math.floor(Math.random() * 4_000),
            recycledPlasticPct: 20 + Math.floor(Math.random() * 15)
        },
        // The vehicle changes hands. Registrar A registered it; the
        // dealership is handed the right to write THIS vehicle and then
        // records the reading at handover under its own identity. Both
        // circuits land on chain, and the update still has to satisfy the
        // rule fixed when the field was created: delegation hands over the
        // pen, never the right to break the rule.
        ...(dealer ? { authorise: [{ label: dealer.label, id: dealer.id }] } : {}),
        // The same dealership is given the trade view of this vehicle
        // (D26). A grant is not the pen: it records who may be handed the
        // history, so it outlives the withdrawal below, which is the
        // contract's documented behaviour and worth seeing on chain.
        ...(dealer ? { grants: [{ label: dealer.label, id: dealer.id, tier: 'trade' }] } : {}),
        // The gap this update opens is exactly what
        // `servicedWithin15000km` asks about, so it is derived from that
        // question's own slack rather than from a number that has to be
        // kept in step with it by hand. It lands between 55% and 90% of
        // the slack: a real gap, never one that refuses.
        //
        // It used to be `base + 12_000 + rand(20_000)`, a gap of 12 000 to
        // 32 000 against a 15 000 slack, so the two-field circuit refused
        // in about six runs out of seven and had never reached the chain.
        // A claim the page offers and then usually refuses teaches a
        // visitor the opposite of what the circuit does. The run still
        // shows a refusal, from `oneKeeper`, where the data genuinely
        // fails the rule.
        updates: [{
            odometerKm: base + Math.floor(SERVICE_SLACK * 0.55)
                + Math.floor(Math.random() * Math.floor(SERVICE_SLACK * 0.35)),
            ...(dealer ? { by: dealer.label } : {})
        }],
        // ...and then the grant is taken back, so one run shows the whole
        // life cycle of a delegation: granted, used, revoked. The fields
        // the dealership already wrote stay written and stay stamped with
        // it, which is the circuit's documented behaviour: withdrawing an
        // authorisation cannot make it untrue that they wrote them.
        ...(dealer ? { withdraw: [{ label: dealer.label, id: dealer.id }] } : {}),
        // oneKeeper is DESIGNED to refuse (two keepers): the guided run
        // shows a refusal being caught in-circuit and reported, not hidden.
        // fourServices is a FLOOR, so it runs proveFieldAtLeast. Every
        // other demo claim is a ceiling, which is why that circuit had
        // never reached the chain despite being compiled and tested.
        // Four shapes in one run: two ceilings, a floor, and a claim
        // comparing two of the vehicle's own hidden fields. Between them
        // they exercise every proof circuit the contract has.
        prove: {
            noAccidents: true, oneKeeper: true, mileageUnder: 150_000,
            fourServices: true, servicedWithin15000km: true
        }
    };
}
