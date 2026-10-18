/**
 * A passport added in this browser, kept where the next page can read it.
 *
 * The published site is static, so the intake console has nowhere to post a
 * registration. It runs the compiled circuits in the tab instead, and the
 * ledger they produce has to reach /verify/ and /proofs/ somehow. This is
 * that somehow: the same public-ledger snapshot the static export already
 * holds, written to sessionStorage and read back by sources.mjs.
 *
 * WHY sessionStorage AND NOT localStorage. A vehicle added here is a
 * demonstration, not a record. Session scope makes that true rather than
 * merely said: it belongs to one tab, it is gone when that tab closes, and
 * the next visitor on a shared machine does not inherit it. localStorage
 * would quietly turn a demo into persistent state that nothing ever cleans
 * up, on a site whose whole argument is about who may write what.
 *
 * Nothing here leaves the browser. There is no server to send it to, which
 * is the point, and the page says so rather than implying a shared record.
 *
 * EVERY ACCESS CAN THROW. Storage is unavailable in private windows, with
 * site data blocked, and inside some embedded views; a quota error can
 * arrive on write even when reads work. A page that assumed otherwise would
 * fail on load for exactly the privacy-minded visitor this project is for.
 * So every entry point catches, and the absence of storage degrades to "no
 * local ledger" rather than to an error.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/** Bumped when the stored shape changes, so an old entry is ignored, not misread. */
const KEY = 'vinpassport:ledger:v1';

/**
 * Injectable so this is testable off a browser.
 *
 * Omitted means "use the real thing"; an explicit null means "there is no
 * storage", which is a case a test has to be able to state. `??` would
 * conflate the two and leave the no-storage test passing only because the
 * test runner happens not to define sessionStorage.
 */
const store = (given) =>
    given !== undefined ? given
        : (typeof sessionStorage === 'undefined' ? null : sessionStorage);

/**
 * Is this really one of our snapshots?
 *
 * Storage is shared with anything else served from this origin and survives
 * a deploy, so what comes back is untrusted input, not state we left behind.
 * The check is deliberately about shape rather than contents: a snapshot with
 * no passports is a legitimate empty ledger, while one missing the collection
 * entirely is something else wearing our key.
 */
const looksLikeLedger = (v) =>
    !!v && typeof v === 'object'
    && ['passports', 'registrar', 'fieldCommitment', 'fieldRule', 'fieldWriter']
        .every((k) => v[k] && typeof v[k] === 'object')
    && Array.isArray(v.claims);

/**
 * Keep `ledger` as the record this tab is reading.
 *
 * `vehicles` is what the picker needs: the vinHash and a label per vehicle
 * the ledger holds, so a page can list them without re-deriving anything.
 * Returns false when storage refused, which callers must surface rather than
 * swallow: a silent failure here means the visitor presses register, sees
 * success, and finds nothing on the next page.
 */
export function saveLocalLedger(ledger, { vehicles = [], storage } = {}) {
    const s = store(storage);
    if (!s) return false;
    try {
        s.setItem(KEY, JSON.stringify({
            savedAt: new Date().toISOString(),
            vehicles,
            ledger
        }));
        return true;
    } catch {
        // Quota, or storage disabled between load and now.
        return false;
    }
}

/** The stored snapshot, or null when there is none and when there is nonsense. */
export function loadLocalLedger({ storage } = {}) {
    const s = store(storage);
    if (!s) return null;
    let raw;
    try { raw = s.getItem(KEY); } catch { return null; }
    if (!raw) return null;
    let parsed;
    try { parsed = JSON.parse(raw); } catch { return null; }
    if (!looksLikeLedger(parsed?.ledger)) {
        // Someone else's key, or ours from before a shape change. Drop it:
        // leaving it would make every later load pay the parse and fail again.
        clearLocalLedger({ storage });
        return null;
    }
    return {
        ledger: parsed.ledger,
        savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : null,
        vehicles: Array.isArray(parsed.vehicles) ? parsed.vehicles : []
    };
}

/** Forget it. Used by the console's reset, and on reading something unusable. */
export function clearLocalLedger({ storage } = {}) {
    const s = store(storage);
    if (!s) return;
    try { s.removeItem(KEY); } catch { /* nothing to do and nothing to say */ }
}

/** Cheap enough to call on any page that only needs to know whether to offer a reset. */
export const hasLocalLedger = (opts) => loadLocalLedger(opts) != null;
