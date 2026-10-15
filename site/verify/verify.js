/**
 * Verify page wiring: render real ledger state into the hand-designed markup.
 *
 * The shipped HTML is the specification for how a verdict must look; this
 * script rebuilds the same structures from `passportView()` over the exported
 * ledger (or the live /api/ledger when `npm run app` is serving). The rules it
 * must keep are the design's rules: `.tick` only for a claim proven on the
 * ledger, `.none` for not proven (which is not a no), and no value, ever.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { passportView, QUESTIONS } from '../assets/verdict.mjs';
import { loadState } from '../assets/sources.mjs?v=4';
import { chainSeesBlock, fmt, short, esc } from '../assets/chain-sees.mjs?v=2';
import { qrPanel } from '../assets/passport-qr.mjs?v=1';
import { parseEntry } from '../assets/vin.mjs?v=1';


const TICK =
    '<span class="tick"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" ' +
    'stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"></path></svg></span>';

const qLabel = (q, claim) =>
    q.field === 'odometerKm' && claim
        ? `Mileage under ${fmt(claim.bound)} km`
        : q.label;

const qSub = (a) => {
    if (a.status === 'not-proven') return 'No claim on the ledger. Not proven, not a no.';
    if (a.invalid) return `Field key ${short(a.claim.fieldKey)} is not a canonical VINPassport field. A claim on an unrecognised key proves nothing about this vehicle; treat it as invalid.`;
    const bound = `${a.meta?.name ?? a.field} ${a.atMost ? '≤' : '≥'} ${fmt(a.claim.bound)}`;
    return a.status === 'proven'
        ? `${bound} · proven against the current record`
        : `${bound} · proven against an earlier version, since superseded`;
};

function detailBlock(a, ctx) {
    if (a.status === 'not-proven') {
        return `<div class="vp-detail vfy-measure" style="margin:0 0 16px;padding:13px 15px;border:1px solid rgba(0,74,173,.3)">
      <p style="margin:0 0 11px;font-size:13px;line-height:1.55;color:rgba(14,23,38,.78)">Nothing on the ledger answers this question. A failed proof writes nothing and no proof was recorded, so the honest rendering is not proven. Ask the seller for it: if the claim is true of the record, producing it costs one transaction.</p>
      <button type="button" class="vp-ask"
        data-vehicle="${esc(ctx?.title ?? 'this vehicle')}" data-vin="${esc(ctx?.vin ?? '')}"
        data-claim="${esc(qLabel(a, a.claim))}"
        style="display:inline-flex;align-items:center;justify-content:center;text-align:center;line-height:1.2;min-height:44px;font-family:'Barlow Condensed',sans-serif;font-weight:600;font-size:15px;letter-spacing:.06em;background:#004AAD;color:#EDE4D8;border:1px solid #004AAD;padding:10px 18px;cursor:pointer">COPY THE REQUEST</button>
      <span style="display:block;margin-top:9px;font-size:12px;color:rgba(14,23,38,.62)">Copies the vehicle and the claim as text you can send to the seller. Nothing leaves this page: there is no request inbox behind it.</span>
    </div>`;
    }
    const c = a.claim;
    const cname = a.invalid ? 'unrecognised field key' : (a.meta?.name ?? a.field ?? 'field');
    return `<div class="vp-detail vfy-measure" style="margin:0 0 16px;padding:13px 15px;border:1px solid rgba(0,74,173,.3);background:#EDE4D8">
      <p style="margin:0 0 11px;font-size:13px;line-height:1.55;color:rgba(14,23,38,.78)">A zero-knowledge proof was accepted on the ledger. It could not have been produced unless the hidden value satisfied the bound, and the value itself was never published.</p>
      <div class="mono" style="display:grid;grid-template-columns:auto 1fr;gap:5px 14px;font-size:10.5px">
        <span style="color:rgba(14,23,38,.62)">claim</span><span>${esc(cname)} ${a.atMost ? '≤' : '≥'} ${fmt(c.bound)}</span>
        <span style="color:rgba(14,23,38,.62)">field key</span><span style="word-break:break-all">${short(c.fieldKey)}</span>
        <span style="color:rgba(14,23,38,.62)">proven against</span><span style="word-break:break-all">${short(c.commitment)}</span>
        <span style="color:rgba(14,23,38,.62)">ledger slot</span><span style="word-break:break-all">${short(c.slot)}</span>
      </div>
    </div>`;
}

function rowsFor(view, secondary = false, ctx = null) {
    const extras = (view.extras ?? []).map((x) => ({
        field: x.meta?.name, atMost: x.claim.atMost, meta: x.meta,
        // A claim whose fieldKey is not in the canonical vocabulary is not a
        // recognised VINPassport field: render it as invalid, never as a
        // friendly-labelled claim (a forged key must not read as legitimate).
        invalid: !x.meta,
        label: x.meta
            ? `${x.meta.label} ${x.claim.atMost ? 'at most' : 'at least'} ${fmt(x.claim.bound)}`
            : 'Unrecognised field key, not a canonical VINPassport claim',
        status: x.status, claim: x.claim
    }));
    const all = view.answers.concat(extras);
    let openAt = -1;
    if (secondary) {
        openAt = all.findIndex((a) => a.status === 'not-proven');
    } else {
        openAt = all.findIndex((a) => a.field === 'odometerKm' && a.status !== 'not-proven');
        if (openAt === -1) openAt = all.findIndex((a) => a.status !== 'not-proven');
    }
    const openRow = all[openAt] ?? null;

    const claimRow = (a) => {
        const proven = a.status !== 'not-proven';
        const open = a === openRow;
        const mark = proven ? TICK : '<span class="none"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M5 12h14"></path></svg></span>';
        const name = proven
            ? `<b style="display:block;font-size:15.5px">${esc(qLabel(a, a.claim))}</b>`
            : `<b style="display:block;font-size:15.5px;color:rgba(14,23,38,.78)">${esc(qLabel(a, null))}</b>`;
        // <details>/<summary> rather than a div with a click handler: it
        // opens with the keyboard, is announced as expandable, and still works
        // if this script never runs.
        return `<details class="vp-claim"${open ? ' open' : ''}><summary>
      <div class="row">
        ${mark}
        <div style="flex:1;min-width:0">${name}<span style="font-size:12px;color:rgba(14,23,38,.62)">${esc(qSub(a))}</span></div>
        <span class="mono vp-toggle" aria-hidden="true" style="flex:none;font-size:12px;color:rgba(14,23,38,.62)"></span>
      </div></summary>${detailBlock(a, ctx)}</details>`;
    };

    // Grouped, and every group is shown even when it answers nothing.
    //
    // THE UNANSWERED GROUPS ARE THE POINT. A buyer is entitled to see the
    // whole list of questions this passport could answer, not only the ones
    // the seller chose to answer, because a question nobody answered is the
    // thing worth asking about. They are collapsed rather than hidden: the
    // tally on the summary states the score before anything is opened.
    const groupBlock = (label, items, proven, forceOpen) => {
        const total = items.length;
        const done = proven === total && total > 0;
        const tally = total === 0 ? 'none'
            : done ? `all ${total} answered`
                : `${proven} of ${total} answered`;
        return `<details class="vp-group"${forceOpen || proven > 0 ? ' open' : ''}><summary>
      <div class="vp-group-head">
        <b>${esc(label)}</b>
        <span class="vp-group-tally${proven > 0 ? ' is-some' : ''}">${esc(tally)}</span>
        <span class="mono vp-toggle" aria-hidden="true"></span>
      </div></summary>${items.map(claimRow).join('\n')}</details>`;
    };

    const sections = (view.groups ?? []).map((g) => groupBlock(g.label, g.answers, g.proven, false));
    if (extras.length) {
        // Anything on the ledger that no catalogue question covers. Shown
        // open, because an unrecognised claim is exactly what a reader must
        // not have to go looking for.
        sections.push(groupBlock('Other claims on this ledger', extras, extras.length, true));
    }
    return sections.join('\n');
}

function scoreBand(view, secondary) {
    const proven = view.answers.filter((a) => a.status === 'proven').length;
    const total = view.answers.length;
    const all = proven === total;
    const word = proven === 1 ? 'ONE QUESTION PROVEN'
        : all ? 'BUYER QUESTIONS PROVEN' : `${proven} OF ${total} QUESTIONS PROVEN`;
    const note = all
        ? 'Each tick is a zero-knowledge proof on the ledger. No value was ever published, not to us and not to the chain.'
        : 'The rest carry no claim. That is not a no, it is the absence of a proof, and the difference matters.';
    if (all && !secondary) {
        return `<div style="margin:18px 0;padding:16px 18px;background:#004AAD;color:#EDE4D8;display:flex;align-items:center;gap:16px;flex-wrap:wrap">
      <div style="font-family:'Barlow Condensed',sans-serif;font-weight:600;font-size:48px;line-height:.9;flex:none">${proven}<span style="opacity:.55;font-size:25px">/${total}</span></div>
      <div style="flex:1 1 190px;min-width:0"><b style="display:block;font-family:'Barlow Condensed',sans-serif;font-size:18px;letter-spacing:.03em">${word}</b>
      <span style="font-size:12px;line-height:1.45;opacity:.8">${note}</span></div></div>`;
    }
    return `<div style="margin:16px 0;padding:15px 17px;border:1px solid #8B95FF;background:rgba(139,149,255,.18);display:flex;align-items:center;gap:16px;flex-wrap:wrap">
      <div style="font-family:'Barlow Condensed',sans-serif;font-weight:600;font-size:46px;line-height:.9;color:#004AAD;flex:none">${proven}<span style="opacity:.5;font-size:24px">/${total}</span></div>
      <div style="flex:1 1 190px;min-width:0"><b style="display:block;font-family:'Barlow Condensed',sans-serif;font-size:18px;letter-spacing:.03em">${word}</b>
      <span style="font-size:12px;line-height:1.45;color:rgba(14,23,38,.75)">${note}</span></div></div>`;
}

function statsBlock(view, vinfo, badge) {
    const battery = vinfo?.battery
        ? `<div style="display:flex;justify-content:space-between;gap:12px;font-size:12.5px;color:rgba(14,23,38,.62)"><span>Battery passport</span><span class="mono">${esc(vinfo.battery)}</span></div>`
        : '';
    return `<div style="padding:16px 0;border-top:1px solid rgba(0,74,173,.26);display:flex;flex-direction:column;gap:9px">
    <div style="display:flex;justify-content:space-between;gap:12px;font-size:12.5px;color:rgba(14,23,38,.62)"><span>Registered by</span><span class="mono" style="text-align:right;word-break:break-all">${view.registrar ? short(view.registrar) : 'unknown'}</span></div>
    <div style="display:flex;justify-content:space-between;gap:12px;font-size:12.5px;color:rgba(14,23,38,.62)"><span>Claims on the ledger</span><span class="mono">${view.claimCount}</span></div>
    ${battery}
    <div style="display:flex;justify-content:space-between;gap:12px;font-size:12.5px;color:rgba(14,23,38,.62)"><span>Source</span><span class="mono" style="text-align:right">${esc(badge)}</span></div>
  </div>`;
}

const HONESTY =
    `<div style="padding:16px 18px;border-top:1px solid rgba(0,74,173,.26);background:rgba(0,74,173,.05)">
    <b style="display:block;font-family:'Barlow Condensed',sans-serif;font-size:17px;letter-spacing:.02em;margin-bottom:7px">WHAT A TICK DOES, AND DOES NOT, MEAN</b>
    <p style="margin:0;font-size:12.5px;line-height:1.6;color:rgba(14,23,38,.72)">Proven against the anchored record, attributable to a named registrar, tamper-evident. Not a guarantee that the record matched physical reality when it was written. That is the registrar's word, which is why every passport names one.</p>
  </div>`;

/**
 * What this page is, said once at the top. Everything below assumes the
 * reader knows that a tick is a proof and a dash is silence, and until now
 * nothing on the page told them.
 */
const LEDE = `<section class="vfy-lede">
  <span style="display:block;font:600 10.5px Barlow,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#002E6E">How to read this page</span>
  <p class="vfy-measure" style="margin:9px 0 0;font-size:14.5px;line-height:1.6;color:rgba(14,23,38,.8)">
    This is a buyer's verdict on one vehicle. Each line is a question a buyer actually asks, answered
    against the record anchored on the ledger. Open any line to see the proof behind it: which field it
    covers, the commitment it was proven against, and where it sits on the ledger.
    <b>No reading is ever shown, because none was ever published</b>, not to this page and not to the chain.
  </p>
  <p class="vfy-measure" style="margin:10px 0 0;font-size:13.5px;line-height:1.6;color:rgba(14,23,38,.66)">First time reading one of these? <a href="../guide/#verify" style="color:#004AAD">The guide explains every part of this page</a>, including what a tick does not mean.</p>
  <div class="vfy-legend">
    <div>${TICK}<span style="font-size:13px;line-height:1.5;color:rgba(14,23,38,.72)"><b style="display:block;font-size:14px;color:#0E1726">Proven</b>A zero-knowledge proof for this claim was accepted on the ledger. It could not exist unless the hidden value satisfied the bound.</span></div>
    <div><span class="none"><svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M5 12h14"></path></svg></span><span style="font-size:13px;line-height:1.5;color:rgba(14,23,38,.72)"><b style="display:block;font-size:14px;color:#0E1726">Not proven</b>Nothing on the ledger answers this question. That is silence, <b>not a no</b>. The difference matters, and the page will not blur it.</span></div>
  </div>
</section>`;

/**
 * The lookup. Annex V 4.2.2 of Implementing Reg (EU) 2025/1707 expects a code
 * to reach a vehicle-specific page, or a landing page that then asks for the
 * VIN; 4.2.3 forbids asking for anything else. This is the second of those,
 * and it asks for nothing else: no account, no software, and the VIN is
 * hashed here rather than sent anywhere.
 */
const FIND = `<section class="vfy-find blueprint" style="position:relative;padding:clamp(16px,3vw,22px)">
  <i class="corner tl"></i><i class="corner tr"></i><i class="corner bl"></i><i class="corner br"></i>
  <form id="vin-find" novalidate autocomplete="off">
    <label for="vin-input" style="display:block;font:600 10.5px Barlow,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#002E6E">Look up a vehicle by VIN</label>
    <div class="vfy-find-row">
      <input id="vin-input" name="vin" type="text" inputmode="latin" maxlength="64" spellcheck="false"
             autocapitalize="characters" autocorrect="off" placeholder="The 17 characters on the windscreen"
             aria-describedby="vin-note">
      <button type="submit">FIND THE PASSPORT</button>
    </div>
    <p id="vin-note" class="vfy-measure" style="margin:10px 0 0;font-size:12.5px;line-height:1.55;color:rgba(14,23,38,.68)">
      The VIN is hashed <b>in this browser</b> and only the hash is used to look the passport up. The VIN itself is
      never sent anywhere, never stored, and never put in the address bar.
    </p>
    <p id="vin-error" role="alert" style="margin:10px 0 0;font-size:13px;line-height:1.55;color:#8A1C1C" hidden></p>
  </form>
</section>`;

/**
 * Nothing holds a passport for this identifier.
 *
 * This is the same discipline the claim rows follow, one level up: an absent
 * passport is silence, not a verdict. A page that answered "no record" with
 * anything resembling a clean bill of health would be worse than useless, and
 * so would one that implied the vehicle is suspect.
 */
function notFoundSection(asked, typedVin) {
    return `<section class="vfy-card">
  <header style="padding:20px 0 14px;border-bottom:1px solid rgba(0,74,173,.16)">
    <span style="display:block;font:600 10.5px Barlow,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#002E6E">Vehicle passport &middot; not on this ledger</span>
    <h1 style="margin:5px 0 4px;font-size:clamp(26px,6vw,34px);line-height:1.05;letter-spacing:.01em;text-transform:uppercase">No passport for this vehicle</h1>
    ${typedVin
        ? `<span class="mono" style="font-size:11px;color:rgba(14,23,38,.62);word-break:break-all">VIN ${esc(typedVin)}</span><br>`
        : ''}<span class="mono" style="font-size:10.5px;color:rgba(14,23,38,.62);word-break:break-all">VIN HASH ${esc(asked)}</span>
  </header>
  <div style="padding:16px 0 4px">
    <p class="vfy-measure" style="margin:0;font-size:14.5px;line-height:1.6;color:rgba(14,23,38,.8)">
      <b>This is not a verdict on the vehicle.</b> A passport that was never issued cannot say anything about a car,
      good or bad, and this page will not pretend otherwise. It means only that the ledger it reads holds no record
      under that identifier.
    </p>
    <p class="vfy-measure" style="margin:12px 0 0;font-size:14px;line-height:1.6;color:rgba(14,23,38,.72)">
      The usual reasons, in the order they happen: a mistyped character, a vehicle whose passport was issued on a
      different deployment, or a vehicle that simply has no passport yet. If a seller says there is one, ask them for
      the link or let you scan the code on the car.
    </p>
    <p class="vfy-measure" style="margin:12px 0 0;font-size:13.5px;line-height:1.6;color:rgba(14,23,38,.68)">
      This deployment is a demonstration and holds two vehicles. Their VINs are
      <button type="button" class="vfy-try mono" data-vin="WVWZZZ1JZXW000001">WVWZZZ1JZXW000001</button> and
      <button type="button" class="vfy-try mono" data-vin="WAUZZZ8V5KA000002">WAUZZZ8V5KA000002</button>,
      and both are fictional.
    </p>
  </div>
</section>`;
}

function mainSection(vin, view, vinfo, badge, ledger) {
    return `<section class="vfy-card"><header style="padding:20px 0 14px;border-bottom:1px solid rgba(0,74,173,.16)">
    <span style="display:block;font:600 10.5px Barlow,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#002E6E">Vehicle passport · Reg (EU) 2026/1738</span>
    <h1 style="margin:5px 0 4px;font-size:clamp(28px,7vw,38px);line-height:1;letter-spacing:.01em;text-transform:uppercase">${esc(vinfo?.title ?? 'Vehicle passport')}</h1>
    <span class="mono" style="font-size:10.5px;color:rgba(14,23,38,.62);word-break:break-all">VIN HASH ${vin}</span>
  </header>
  ${scoreBand(view, false)}
  ${rowsFor(view, false, { vin, title: vinfo?.title })}
  <div class="vfy-foot">${statsBlock(view, vinfo, badge)}${chainSeesBlock(vin, view, ledger)}${HONESTY}</div></section>`;
}

function secondarySection(vin, view, vinfo, index) {
    const proven = view.answers.filter((a) => a.status === 'proven').length;
    const total = view.answers.length;
    return `<details class="vfy-more" id="${index === 0 ? 'b' : 'v-' + vin.slice(0, 8)}"><summary>
      <span class="vfy-chip"${proven === total ? ' data-all' : ''}>${proven}/${total}</span>
      <span style="flex:1 1 240px;min-width:0">
        <b style="display:block;font-family:'Barlow Condensed',sans-serif;font-size:20px;letter-spacing:.02em;text-transform:uppercase">${esc(vinfo?.title ?? 'Vehicle passport')}</b>
        <span style="font-size:12.5px;color:rgba(14,23,38,.62)">Another passport on the same ledger &middot; ${esc(vinfo?.blurb ?? 'for comparison')}</span>
      </span>
      <span class="vfy-open" style="flex:none;font:600 10.5px Barlow,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#004AAD"></span>
    </summary>
    <div class="vfy-more-body">
      <span class="mono" style="display:block;margin-bottom:4px;font-size:10.5px;color:rgba(14,23,38,.62);word-break:break-all">VIN HASH ${vin}</span>
      ${scoreBand(view, true)}
      ${rowsFor(view, true, { vin, title: vinfo?.title })}
      <p style="margin:16px 0 0;font-size:13px"><a href="../proofs/">See every claim in the proof explorer &rarr;</a></p>
    </div></details>`;
}

(async () => {
    const root = document.querySelector('body > div');
    const nav = root.querySelector('nav');
    const footer = root.querySelector('footer');

    let state;
    try {
        state = await loadState('', new URLSearchParams(location.search));
    } catch (e) {
        const p = document.createElement('main');
        p.id = 'main';
        p.style.cssText = 'padding:30px 0;font-size:14px';
        p.textContent = `Could not read the ledger: ${e.message}`;
        root.replaceChildren(nav, p, footer);
        return;
    }
    const { ledger, vocabulary } = state;
    const byVin = Object.fromEntries(
        (vocabulary.demoVehicles ?? []).map((v) => [v.vinHash, v]));

    const vins = Object.keys(ledger.passports);
    const asked = new URLSearchParams(location.search).get('v');

    // A bare /verify/ opens on the first passport, which is the demo's front
    // door. An identifier that was asked for and not found is a different
    // thing entirely and must never resolve to a different vehicle's verdict.
    const missed = asked && !ledger.passports[asked] ? asked : null;
    const main = missed ? null : (asked && ledger.passports[asked] ? asked : vins[0]);
    const rest = vins.filter((v) => v !== main);

    const holder = document.createElement('div');
    holder.innerHTML =
        LEDE + FIND +
        (missed
            ? notFoundSection(missed, null)
            : mainSection(main, passportView(ledger, main, vocabulary), byVin[main], state.badge, ledger)) +
        (rest.length
            ? `<h2 style="margin:8px 0 -8px;font-family:'Barlow Condensed',sans-serif;font-size:20px;letter-spacing:.03em;text-transform:uppercase;color:#002E6E">${missed ? 'The passports this ledger does hold' : 'Other passports on this ledger'}</h2>
               <p class="vfy-measure" style="margin:0;font-size:13.5px;line-height:1.6;color:rgba(14,23,38,.7)">${missed ? 'Every vehicle on this deployment, so the page is not a dead end. Open either to see what a passport answers.' : 'Two more vehicles, kept collapsed so they do not compete with the one you came to check. They exist to show the range: a record that answers every question, and one that cannot.'}</p>`
            : '') +
        rest.map((v, i) =>
            secondarySection(v, passportView(ledger, v, vocabulary), byVin[v], i)).join('\n');

    // A landmark, not a wrapper: this script replaces the whole body, so if it
    // builds a plain div the page loses the only <main> a screen reader has.
    const stack = document.createElement('main');
    stack.id = 'main';
    stack.className = 'vfy-stack';
    stack.replaceChildren(...holder.children);

    // The code for the vehicle being read, under its verdict and above the
    // other passports, so it belongs to this one and not to the page.
    // The demo ledger's vehicle identifiers are real 32-byte hashes; a state
    // that ever carried something else should not take the page down with it.
    try {
        if (!main) throw new Error('no passport to encode');
        const panel = qrPanel(main, { role: 'verify' });
        const others = stack.querySelector('h2');
        if (others) stack.insertBefore(panel, others); else stack.append(panel);
    } catch (e) {
        console.warn('no code for this passport:', e.message);
    }

    root.replaceChildren(nav, stack, footer);


    // The VIN box. A hit navigates, so the result is a shareable address that
    // carries the hash and not the VIN. A miss re-renders in place, because
    // the one useful thing to show someone who mistyped is what they typed,
    // and that must not go in the address bar to do it.
    const findForm = root.querySelector('#vin-find');
    const findInput = root.querySelector('#vin-input');
    const findError = root.querySelector('#vin-error');

    const complain = (message) => {
        findError.textContent = message;
        findError.hidden = false;
        findInput.setAttribute('aria-invalid', 'true');
        findInput.focus();
    };

    const lookUp = (typed) => {
        findError.hidden = true;
        findInput.removeAttribute('aria-invalid');

        const parsed = parseEntry(typed);
        if (parsed.error) return complain(parsed.error);
        const { key, vin } = parsed;

        if (ledger.passports[key]) {
            location.search = '?v=' + key;
            return;
        }

        const section = stack.querySelector('.vfy-card, .vfy-find + *');
        const holderEl = document.createElement('div');
        holderEl.innerHTML = notFoundSection(key, vin);
        const fresh = holderEl.firstElementChild;
        if (section) section.replaceWith(fresh); else stack.append(fresh);

        // Shareable without carrying the VIN, and the back button still works.
        history.replaceState(null, '', '?v=' + key);
        wireTryButtons();
        fresh.scrollIntoView({ block: 'nearest' });
    };

    function wireTryButtons() {
        for (const b of root.querySelectorAll('.vfy-try')) {
            b.addEventListener('click', () => {
                findInput.value = b.dataset.vin;
                lookUp(b.dataset.vin);
            });
        }
    }
    wireTryButtons();

    findForm.addEventListener('submit', (e) => {
        e.preventDefault();
        lookUp(findInput.value);
    });

    // Claim rows are <details>, so opening one needs no script.
    //
    // The one thing that does: the not-proven action. It says it copies the
    // request rather than sending it, so it has to actually copy something,
    // and it has to say so when the browser refuses the clipboard.
    for (const btn of root.querySelectorAll('.vp-ask')) {
        btn.addEventListener('click', async () => {
            const { vehicle, vin, claim } = btn.dataset;
            const text =
                `Please prove this claim on the vehicle passport.\n\n` +
                `Vehicle: ${vehicle}\n` +
                (vin ? `VIN hash: ${vin}\n` : '') +
                `Claim:   ${claim}\n\n` +
                `A proof writes only a commitment to the ledger; the reading itself stays private.`;
            const said = (m) => { btn.textContent = m; setTimeout(() => { btn.textContent = 'COPY THE REQUEST'; }, 2600); };
            try {
                await navigator.clipboard.writeText(text);
                said('COPIED');
            } catch {
                said('PRESS CTRL+C');
                // A clipboard the browser will not give us is not a dead end:
                // select the text so the keyboard can still take it.
                const pre = document.createElement('textarea');
                pre.value = text;
                pre.setAttribute('style', 'width:100%;margin-top:10px;font:11px/1.5 ui-monospace,monospace;padding:8px;border:1px solid rgba(0,74,173,.3);background:#EDE4D8;resize:vertical');
                pre.rows = 9;
                btn.after(pre);
                pre.select();
            }
        });
    }
})();
