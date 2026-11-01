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

/**
 * The two ledgers a reader can check against. The preprod run wrote five
 * readings, all trade fields, and granted only the trade view, so it has no
 * authority bundle and its buyer's file carries claims and no value.
 */
const LEDGERS = {
    demo: {
        ledger: '../verify/demo-data.json',
        base: 'bundles/',
        tiers: ORDER,
        intro: (tier) => TIERS[tier].intro,
        edit: (tier) => TIERS[tier].edit
    },
    preprod: {
        ledger: 'preprod/ledger.json',
        run: 'preprod/run.json',
        base: 'bundles/preprod/',
        tiers: ['public', 'trade'],
        intro: (tier) => ({
            public: 'What a buyer receives from the preprod run: no value at all, only the claims already proven on chain about this vehicle. Every reading the run wrote is a trade field.',
            trade: 'What the dealership receives: the five readings the run wrote, every one exact, and the grant the run recorded for it on the preprod ledger.'
        })[tier],
        edit: (tier) => (tier === 'trade' ? 'odometerKm' : null)
    }
};
let ledgerName = 'demo';
const loaded = {};

const panel = document.getElementById('tier-panel');
const tabs = [...document.querySelectorAll('.ds-tab')];
const ledgerButtons = [...document.querySelectorAll('.ds-ledger button')];
const note = document.getElementById('ledger-note');
const demoNote = note.innerHTML;

const getJson = async (url) => {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`could not load ${url} (${r.status})`);
    return r.json();
};

let ledger, byName, bundles, engine, run;
let results = {};
const commitmentAt = (slot) => ledger.fieldCommitment[slot] ?? null;
const claimAt = (key) => ledger.claims.find((c) => c.key === key) ?? null;
const grantAt = (key) => ledger.grants?.[key] ?? null;
const check = (bundle) => engine.verifyBundle(bundle, { commitmentAt, claimAt, grantAt });

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

/** What the ledger says about this reader's entitlement, in one paragraph. */
function grantLine(tier, r) {
    if (tier === 'public') {
        return 'No grant needed. Reading the public view may require nothing beyond the VIN (Reg. (EU) 2025/1707, Annex V 4.2.3), so the contract has no public tier to grant.';
    }
    if (!r?.grant) return 'This file names no audience, so there is no grant to look up.';
    const who = `<span class="mono">${esc(short(r.grant.audienceId))}</span>`;
    if (!r.grant.held) {
        return `No grant on record for ${who}. The values still check; nothing on the ledger says this reader was entitled to them.`;
    }
    return `<b>${r.grant.covers ? `${tick} Granted` : 'Granted a lower view'}:</b> this vehicle's registrar gave ${who} the ${esc(r.grant.held)} view (grant key <span class="mono">${esc(short(r.grant.key))}</span>). It records who was entitled, and on whose authority; it cannot recall what was handed over.`;
}

function render(tier) {
    const bundle = bundles[tier];
    const r = results[tier];
    const t = TIERS[tier];
    const L = LEDGERS[ledgerName];
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

    const editName = L.edit(tier);
    const edit = editName ? bundle.fields.find((f) => f.fieldName === editName) : null;
    const odometer = bundles.trade.fields.find((f) => f.fieldName === 'odometerKm');

    panel.innerHTML = `
      <p style="margin:0 0 16px;max-width:74ch;font-size:15px;line-height:1.6;color:rgba(14,23,38,.82)">${esc(L.intro(tier))}</p>
      ${band}
      ${r ? `<p class="ds-grant" data-state="${tier === 'public' || r.grant?.covers ? 'ok' : 'none'}">${grantLine(tier, r)}</p>` : ''}
      <h3 class="ds-h3">Opened: ${bundle.fields.length} value${bundle.fields.length === 1 ? '' : 's'}</h3>
      ${bundle.fields.length
        ? `<ul class="ds-rows">${bundle.fields.map((f) => fieldRow(f, byField.get(f.fieldName))).join('')}</ul>`
        : `<p style="margin:0;font-size:14px;line-height:1.6;color:rgba(14,23,38,.78)">None. This file opens no value; every field this vehicle has on the ledger is above the ${esc(tier)} tier.</p>`}
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
      <p style="margin:12px 0 0;font-size:13.5px"><a href="${L.base}${tier}.json" download style="display:inline-flex;align-items:center;min-height:44px;color:#004AAD">Download ${tier}.json</a></p>`;

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
const offered = () => LEDGERS[ledgerName].tiers;

// A link to #trade followed from this page changes only the hash, so the
// page has to listen for it rather than read it once on load.
addEventListener('hashchange', () => {
    const t = location.hash.slice(1);
    if (offered().includes(t) && t !== current()) select(t);
});

for (const tab of tabs) {
    tab.addEventListener('click', () => select(tab.dataset.tier));
    tab.addEventListener('keydown', (e) => {
        const order = offered();
        const i = order.indexOf(tab.dataset.tier);
        const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: order.length - 1 }[e.key];
        if (next === undefined) return;
        e.preventDefault();
        select(order[(next + order.length) % order.length], true);
    });
}

const fullDate = (iso) => new Date(`${iso}T00:00:00Z`)
    .toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Where the ledger under the bundles came from, in one paragraph. */
function provenance() {
    if (ledgerName === 'demo') return demoNote;
    return `<b>Real chain data.</b> The ledger state was read from the public preprod indexer at block ${esc(ledger.readAtBlock)},
      contract <span class="mono">${esc(short(ledger.contractAddress))}</span>. The bundles come from the guided run of
      ${esc(fullDate(run.date))}: ${esc(run.transactions)} transactions in blocks ${esc(run.firstBlock)} to ${esc(run.lastBlock)},
      with the dealership's grant in block ${esc(run.grant.block)}
      (<a href="${esc(run.grant.explorer)}" style="color:#004AAD">on the explorer</a>). There is no authority file:
      the run granted nobody the authority view.`;
}

const checkAll = () => {
    if (!engine) return;
    for (const t of offered()) results[t] ??= check(bundles[t]);
};

async function useLedger(name) {
    ledgerName = name;
    for (const b of ledgerButtons) b.setAttribute('aria-pressed', String(b.dataset.ledger === name));
    for (const tab of tabs) tab.hidden = !LEDGERS[name].tiers.includes(tab.dataset.tier);
    const url = new URL(location.href);
    if (name === 'demo') url.searchParams.delete('ledger'); else url.searchParams.set('ledger', name);
    history.replaceState(null, '', url);
    if (!offered().includes(current())) select('public');
    if (!loaded[name]) {
        panel.innerHTML = `<p style="margin:0;font-size:14.5px;line-height:1.6;color:rgba(14,23,38,.78)">Loading the bundles and the ${name === 'demo' ? 'demo ledger' : 'preprod snapshot'}.</p>`;
        const L = LEDGERS[name];
        try {
            const [l, r, ...files] = await Promise.all([
                getJson(L.ledger),
                L.run ? getJson(L.run) : null,
                ...L.tiers.map((t) => getJson(`${L.base}${t}.json`))
            ]);
            loaded[name] = { ledger: l, run: r, bundles: Object.fromEntries(L.tiers.map((t, i) => [t, files[i]])), results: {} };
        } catch (e) {
            if (ledgerName === name) panel.innerHTML = `<p style="margin:0;font-size:14.5px;color:#8A1C1C">Could not load the bundles: ${esc(e.message)}</p>`;
            return;
        }
    }
    if (ledgerName !== name) return;          // switched again while this loaded
    ({ ledger, run, bundles, results } = loaded[name]);
    note.innerHTML = provenance();
    checkAll();
    render(current());
}

for (const b of ledgerButtons) {
    b.addEventListener('click', () => { if (b.dataset.ledger !== ledgerName) useLedger(b.dataset.ledger); });
}

(async () => {
    const askedLedger = new URL(location.href).searchParams.get('ledger');
    const start = askedLedger in LEDGERS ? askedLedger : 'demo';
    const asked = location.hash.slice(1);
    if (LEDGERS[start].tiers.includes(asked)) select(asked);
    try {
        const vocab = await getJson('../verify/fields.json');
        byName = Object.fromEntries(Object.values(vocab.fields).map((f) => [f.name, f]));
    } catch (e) {
        panel.innerHTML = `<p style="margin:0;font-size:14.5px;color:#8A1C1C">Could not load the bundles: ${esc(e.message)}</p>`;
        return;
    }
    await useLedger(start);
    try {
        engine = await import('../assets/intake-engine/intake-engine.js');
    } catch (e) {
        const band = panel.querySelector('.ds-band');
        if (band) band.outerHTML =
            `<div class="ds-band" data-state="fail" role="status"><b>Could not check</b><span style="font-size:14px">The contract runtime did not load: ${esc(e.message)}</span></div>`;
        return;
    }
    if (!bundles) return;
    checkAll();
    render(current());
})();
