/**
 * Registering a vehicle, in whichever runtime is asking.
 *
 * The app server has always done this in `handleIntake`. The published site
 * has no server, so the intake console has to do the same work in the page,
 * and the two must not drift: the last time there were two intake paths, one
 * honoured delegation and the other silently dropped it, producing a run
 * that looked delegated and was not. So the parts that decide anything live
 * here, once, and both callers use them.
 *
 * Nothing here proves or submits. It executes the compiled circuits and
 * returns the public ledger they produced, which is what the console needs
 * and all it needs: /verify/ reads commitments, never values.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import {
    PassportSimulator, applyIntake, exportLedger, saltStream,
    DEMO_WRITERS, CONSOLE_REGISTRAR_SECRET
} from './scenario.mjs';

// The reading half, for /disclose/. A bundle is checked by recomputing slots
// and commitments with the runtime's own primitives, which this bundle
// already carries along with its wasm, so the page reuses it rather than
// shipping a second 1.4 MB copy. Same code as the CLI and the tests.
export { verifyBundle, fieldsOnLedger } from './disclosure.mjs';

/**
 * Turn the labels a console sends into the identities a circuit needs.
 *
 * Labels, never secrets. A console that accepted a writer's secret would be
 * handing anyone the ability to write as that party, which is the opposite
 * of what a per-vehicle writer list is for, and on a static site the secret
 * would be sitting in the page source for anyone to read.
 *
 * An unknown label is REFUSED, never ignored. Dropping it quietly is the
 * failure this module exists to prevent: the registration still succeeds,
 * the fields are written by the registrar, the writer circuits never run,
 * and nothing anywhere says so.
 *
 * Throws with a message fit to show a person; the caller decides whether
 * that becomes a 400 or a line on the page.
 */
export function resolveWriters(intake) {
    const asked = Array.isArray(intake.authorise) ? intake.authorise : [];
    const writers = [];
    for (const label of asked) {
        const w = DEMO_WRITERS[String(label)];
        if (!w) throw Object.assign(new Error(`unknown writer "${label}"`), { code: 400 });
        if (!writers.some((x) => x.label === w.label)) writers.push(w);
    }
    for (const round of intake.updates ?? []) {
        const by = round?.by;
        if (by && !writers.some((x) => x.label === by)) {
            throw Object.assign(
                new Error(`"${by}" writes an update but was never authorised`), { code: 400 });
        }
    }
    return writers;
}

/** The fields every intake must carry, checked before anything runs. */
export function requireIntakeFields(intake) {
    for (const name of ['vin', 'registrar', 'fields']) {
        if (!intake?.[name]) throw Object.assign(new Error(`missing "${name}"`), { code: 400 });
    }
}

/**
 * Register one vehicle through the compiled circuits and hand back the
 * public ledger holding it.
 *
 * The simulator is FRESH and holds this vehicle alone. It does not need the
 * demo vehicles: the contract keys everything by vinHash, so a registration
 * touches nothing else, and rebuilding two demo vehicles to immediately
 * discard them cost about 200 ms for nothing. The caller merges the result
 * onto whatever record it already had.
 */
export function registerLocally(intake) {
    requireIntakeFields(intake);
    const writers = resolveWriters(intake);
    const sim = new PassportSimulator();
    const result = applyIntake(
        sim,
        { ...intake, writers, registrarSecret: CONSOLE_REGISTRAR_SECRET },
        saltStream()
    );
    return { ...result, ledger: exportLedger(sim, 'vinpassport, compiled circuits run in this browser') };
}

/** Collections keyed by an opaque hash; a later write of the same key wins. */
const MAPS = ['passports', 'registrar', 'fieldCommitment', 'fieldRule', 'fieldWriter', 'grants'];
/** Collections of objects carrying their own `key`. */
const KEYED_LISTS = ['claims', 'relClaims'];

/**
 * Fold a newly registered vehicle into the record this browser already had.
 *
 * A tab can register more than one vehicle, and each registration runs on a
 * simulator that knows only about itself, so without this the second would
 * replace the first. Merging rather than replacing is also what makes the
 * added vehicle appear ALONGSIDE the demo ones instead of erasing them.
 *
 * Keys are domain-separated hashes of (vehicle, field), so two vehicles
 * cannot collide; a repeated key means the same vehicle registered twice and
 * the newer write is the right answer. Claims carry their own key and are
 * deduplicated on it, because re-proving the same claim against the same
 * value is idempotent on chain and must look idempotent here too.
 */
export function mergeLedgers(base, add) {
    const out = { ...base, ...Object.fromEntries(MAPS.map((k) => [k, { ...(base?.[k] ?? {}), ...(add?.[k] ?? {}) }])) };
    for (const name of KEYED_LISTS) {
        const seen = new Map();
        for (const item of [...(base?.[name] ?? []), ...(add?.[name] ?? [])]) {
            if (item?.key != null) seen.set(item.key, item);
        }
        out[name] = [...seen.values()];
    }
    out.writers = [...new Set([...(base?.writers ?? []), ...(add?.writers ?? [])])];
    // The note travels with the record, so a merged one must not keep
    // claiming it came from wherever the base did.
    out.source = add?.source ?? base?.source;
    return out;
}
