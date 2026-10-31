/**
 * /disclose/: one vehicle, three audiences (D26 in docs/DECISIONS.md).
 *
 * Loads the three sample bundles and the demo ledger they were written
 * against, then checks every bundle with `verifyBundle`, the function the CLI
 * and the tests call. It reaches the page through the intake engine, which
 * already carries the runtime's commitment primitives and their wasm; the
 * page does none of the hashing itself, so it cannot drift from the code that
 * the tests pin.
 *
 * Two controls let a reader push on the result rather than take it:
 * changing a value must make the bundle fail, and handing the buyer a trade
 * field must still verify but be flagged, because the reader recomputes each
 * field's tier instead of trusting the label.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { esc, short } from '../assets/chain-sees.mjs?v=2';
import { formatBound } from '../assets/verdict.mjs';
import { CLAIM_CATALOGUE, isCompare } from '../assets/claim-catalogue.mjs';

const TIERS = {
    public: {
        who: 'the buyer',
        intro: 'What a private buyer receives: the vehicle as built and as declared, plus the claims already proven about its history. No history value is in this file.',
        edit: 'co2FootprintKgCO2e'
    },
    trade: {
        who: 'the dealer',
        intro: 'What a dealer taking the car in receives: the declared values and the history itself, every reading exact. Theft and export records stay closed.',
        edit: 'odometerKm'
    },
    authority: {
        who: 'the authority',
        intro: 'What a registration authority receives: every field this vehicle has on the ledger, and the VIN, so it can confirm the file is about the car in front of it.',
        edit: 'odometerKm'
    }
};
const ORDER = Object.keys(TIERS);

const panel = document.getElementById('tier-panel');
const tabs = [...document.querySelectorAll('.ds-tab')];

const getJson = async (url) => {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`could not load ${url} (${r.status})`);
    return r.json();
};

let ledger, byName, bundles, engine;
const results = {};
const commitmentAt = (slot) => ledger.fieldCommitment[slot] ?? null;
const claimAt = (key) => ledger.claims.find((c) => c.key === key) ?? null;
const check = (bundle) => engine.verifyBundle(bundle, { commitmentAt, claimAt });

const meta = (name) => byName[name] ?? { label: name, kind: 'count', tier: null };
const value = (name, v) => formatBound(meta(name).kind, v);
/** "Odometer" reads as "odometer" mid-sentence; "CO2 footprint" keeps its capitals. */
const inline = (label) => (/^[A-Z][a-z]/.test(label) ? label[0].toLowerCase() + label.slice(1) : label);

/** The catalogue's wording for a claim, or the bare bound when none fits. */
function claimLabel(c) {
    const q = CLAIM_CATALOGUE.find((x) => !isCompare(x) && x.field === c.fieldName && x.atMost === c.atMost
        && x.bound !== null && String(x.bound) === String(c.bound));
    if (q) return q.label;
    const open = CLAIM_CATALOGUE.find((x) => !isCompare(x) && x.field === c.fieldName && x.atMost === c.atMost && x.bound === null);
    const bound = value(c.fieldName, c.bound);
    return open?.openLabel ? `${open.openLabel} ${bound}` : `${meta(c.fieldName).label} ${c.atMost ? 'at most' : 'at least'} ${bound}`;
}

const tick = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true" style="vertical-align:-2px"><path d="M20 6L9 17l-5-5"></path></svg>';

function fieldRow(f, r) {
    const m = meta(f.fieldName);
    const state = r ? (r.ok ? 'ok' : 'fail') : 'pending';
    const status = !r ? 'Checking.'
        : r.ok ? `<b>${tick} Opens its commitment</b> at slot <span class="mono">${esc(short(f.slot))}</span>`
            : `<b>Does not check:</b> ${esc(r.why)}`;
    return `<li class="ds-row" data-state="${state}">
      <span class="nm"><b>${esc(m.label)}</b><span class="mono" style="font-size:11px;color:rgba(14,23,38,.62)">${esc(f.fieldName)}</span> <span class="ds-chip">${esc(m.tier ?? 'no tier')}</span></span>
      <span class="val">${esc(value(f.fieldName, f.value))}</span>
      <span class="st">${status}</span>
    </li>`;
}

function claimRow(c) {
    const state = c.ok ? 'ok' : 'fail';
    return `<li class="ds-row" data-state="${state}">
      <span class="nm"><b>${esc(claimLabel(c))}</b><span class="mono" style="font-size:11px;color:rgba(14,23,38,.62)">${esc(c.fieldName ?? 'unknown field')} ${c.atMost ? '&le;' : '&ge;'} ${esc(c.bound ?? '?')}</span></span>
      <span class="st">${c.ok ? `<b>${tick} Proven</b> ${esc(c.why.replace(/^proven /, ''))}` : `<b>Not accepted:</b> ${esc(c.why)}`}</span>
    </li>`;
}

function render(tier) {
    const bundle = bundles[tier];
    const r = results[tier];
    const t = TIERS[tier];
    const onLedger = r ? engine.fieldsOnLedger(bundle.vinHash, bundle.contentRoot, commitmentAt) : null;
    const closed = onLedger ? onLedger.filter((n) => !r.opened.includes(n)) : [];
    const byField = new Map((r?.fields ?? []).map((x) => [x.fieldName, x]));

    const band = !r
        ? `<div class="ds-band" data-state="pending" role="status"><b>Checking</b><span style="font-size:14px">Loading the contract runtime (about 1.5 MB, once) to check this bundle.</span></div>`
        : `<div class="ds-band" data-state="${r.ok ? 'ok' : 'fail'}" role="status">
            <b>${r.ok ? `${tick} Checked in your browser` : 'Does not check'}</b>
            <span style="font-size:14px;line-height:1.5">Opens <b style="font:inherit;font-weight:700">${r.opened.length}</b> of the ${onLedger.length} fields this vehicle has on the ledger
            ${r.claims.length ? `&middot; cites ${r.claims.length} proven claim${r.claims.length === 1 ? '' : 's'}` : ''}
            ${bundle.vin ? `&middot; names the VIN, which hashes to the passport's key: ${r.vinMatchesHash ? 'yes' : 'no'}` : ''}${r.overDisclosed.length ? ` &middot; above its tier: ${esc(r.overDisclosed.join(', '))}` : ''}</span>
          </div>`;

    const edit = bundle.fields.find((f) => f.fieldName === t.edit);
    const odometer = bundles.trade.fields.find((f) => f.fieldName === 'odometerKm');

    panel.innerHTML = `
      <p style="margin:0 0 16px;max-width:74ch;font-size:15px;line-height:1.6;color:rgba(14,23,38,.82)">${esc(t.intro)}</p>
      ${band}
      <h3 class="ds-h3">Opened: ${bundle.fields.length} value${bundle.fields.length === 1 ? '' : 's'}</h3>
      <ul class="ds-rows">${bundle.fields.map((f) => fieldRow(f, byField.get(f.fieldName))).join('')}</ul>
      ${r && r.claims.length ? `<h3 class="ds-h3">Cited: claims already proven on the ledger</h3>
      <ul class="ds-rows">${r.claims.map(claimRow).join('')}</ul>` : ''}
      <h3 class="ds-h3">Left closed${r ? `: ${closed.length}` : ''}</h3>
      ${!r ? '<p style="margin:0;font-size:14px">Checking.</p>'
        : closed.length
            ? `<p style="margin:0 0 10px;max-width:74ch;font-size:14px;line-height:1.6;color:rgba(14,23,38,.78)">These fields have commitments on the ledger for this vehicle. Nothing in ${esc(t.who)}'s file opens them.</p>
               <ul class="ds-closed">${closed.map((n) => `<li>${esc(meta(n).label)} <span class="ds-chip">${esc(meta(n).tier)}</span></li>`).join('')}</ul>`
            : `<p style="margin:0;font-size:14px;line-height:1.6;color:rgba(14,23,38,.78)">None. This file opens every field the vehicle has on the ledger.</p>`}
      ${edit ? `<div class="ds-try">
        <label for="try-value">Try it: change the ${esc(inline(meta(edit.fieldName).label))} in this file and check again</label>
        <div class="ds-tryrow">
          <input class="ds-input" id="try-value" type="number" inputmode="numeric" min="0" step="1" value="${esc(edit.value)}">
          <button class="ds-btn" id="try-check" type="button"${r ? '' : ' disabled'}>CHECK THIS VALUE</button>
        </div>
        <p class="ds-out" id="try-out" role="status" aria-live="polite"></p>
        ${tier === 'public' && odometer ? `<div style="margin-top:16px">
          <button class="ds-btn ghost" id="try-over" type="button"${r ? '' : ' disabled'}>HAND THE BUYER THE MILEAGE TOO</button>
          <p class="ds-out" id="over-out" role="status" aria-live="polite"></p>
        </div>` : ''}
      </div>` : ''}
      <details class="ds-file">
        <summary>Show the file ${esc(t.who)} receives</summary>
        <pre>${esc(JSON.stringify(bundle, null, 2))}</pre>
      </details>
      <p style="margin:12px 0 0;font-size:13.5px"><a href="bundles/${tier}.json" download style="display:inline-flex;align-items:center;min-height:44px;color:#004AAD">Download ${tier}.json</a></p>`;

    wireTry(tier, edit, odometer);
}

function wireTry(tier, edit, odometer) {
    const btn = document.getElementById('try-check');
    const input = document.getElementById('try-value');
    const out = document.getElementById('try-out');
    if (btn && input && out) {
        btn.addEventListener('click', () => {
            const typed = input.value.trim();
            if (!/^\d+$/.test(typed)) {
                out.dataset.state = 'fail';
                out.textContent = 'Enter a whole number: committed values are unsigned integers.';
                return;
            }
            const copy = structuredClone(bundles[tier]);
            copy.fields.find((f) => f.fieldName === edit.fieldName).value = typed;
            const r = check(copy);
            const shown = value(edit.fieldName, typed);
            out.dataset.state = r.ok ? 'ok' : 'fail';
            out.textContent = r.ok
                ? `${shown} opens the commitment: it is the value the registrar committed. The file checks.`
                : `${shown} does not open the commitment the ledger holds, so the whole file fails. Only the committed value checks, and the ledger never stored the value itself.`;
        });
    }
    const over = document.getElementById('try-over');
    const overOut = document.getElementById('over-out');
    if (over && overOut && odometer) {
        over.addEventListener('click', () => {
            const copy = structuredClone(bundles.public);
            copy.fields.push(structuredClone(odometer));
            const r = check(copy);
            overOut.dataset.state = r.ok && r.overDisclosed.length ? 'flag' : 'fail';
            overOut.textContent = r.ok && r.overDisclosed.includes('odometerKm')
                ? `Still checks, because the reading is genuine, but the reader flags it: odometerKm is a trade field in a file that says public. The holder gave more than the tier allows, and the buyer is told. The tool that builds bundles would have refused it.`
                : `Unexpected result: ${JSON.stringify({ ok: r.ok, overDisclosed: r.overDisclosed })}`;
        });
    }
}

function select(tier, focus = false) {
    for (const tab of tabs) {
        const on = tab.dataset.tier === tier;
        tab.setAttribute('aria-selected', String(on));
        tab.tabIndex = on ? 0 : -1;
        if (on) {
            panel.setAttribute('aria-labelledby', tab.id);
            if (focus) tab.focus();
        }
    }
    if (location.hash !== `#${tier}`) history.replaceState(null, '', `#${tier}`);
    if (bundles) render(tier);
}

const current = () => tabs.find((t) => t.getAttribute('aria-selected') === 'true')?.dataset.tier ?? 'public';

// A link to #trade followed from this page changes only the hash, so the
// page has to listen for it rather than read it once on load.
addEventListener('hashchange', () => {
    const t = location.hash.slice(1);
    if (ORDER.includes(t) && t !== current()) select(t);
});

for (const tab of tabs) {
    tab.addEventListener('click', () => select(tab.dataset.tier));
    tab.addEventListener('keydown', (e) => {
        const i = ORDER.indexOf(tab.dataset.tier);
        const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: ORDER.length - 1 }[e.key];
        if (next === undefined) return;
        e.preventDefault();
        select(ORDER[(next + ORDER.length) % ORDER.length], true);
    });
}

(async () => {
    const asked = location.hash.slice(1);
    if (ORDER.includes(asked)) select(asked);
    try {
        const [l, vocab, ...files] = await Promise.all([
            getJson('../verify/demo-data.json'),
            getJson('../verify/fields.json'),
            ...ORDER.map((t) => getJson(`bundles/${t}.json`))
        ]);
        ledger = l;
        byName = Object.fromEntries(Object.values(vocab.fields).map((f) => [f.name, f]));
        bundles = Object.fromEntries(ORDER.map((t, i) => [t, files[i]]));
    } catch (e) {
        panel.innerHTML = `<p style="margin:0;font-size:14.5px;color:#8A1C1C">Could not load the bundles: ${esc(e.message)}</p>`;
        return;
    }
    render(current());
    try {
        engine = await import('../assets/intake-engine/intake-engine.js');
        for (const t of ORDER) results[t] = check(bundles[t]);
    } catch (e) {
        panel.querySelector('.ds-band').outerHTML =
            `<div class="ds-band" data-state="fail" role="status"><b>Could not check</b><span style="font-size:14px">The contract runtime did not load: ${esc(e.message)}</span></div>`;
        return;
    }
    render(current());
})();
