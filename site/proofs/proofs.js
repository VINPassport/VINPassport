/**
 * Proof explorer wiring: the whole claims ledger, grouped by vehicle.
 *
 * Every passport gets a section, including ones with no claims, because
 * "registered, nothing proven" is a state worth seeing. A claim is current
 * when its recorded commitment still matches the field's live one, which is
 * the same check the verdict page makes.
 *
 * Everything it fills has an id (stat-*, vehicles, source); the look lives
 * in vp.css. Nothing here is anchored on the page's shape, which twice let
 * this script fail quietly and leave hard-coded examples on screen.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { loadState } from '../assets/sources.mjs?v=5';

const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
const short = (h) => `${String(h).slice(0, 10)}…${String(h).slice(-6)}`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const $ = (id) => document.getElementById(id);

const claimTitle = (meta, c) => {
    // No meta means the claim's fieldKey is not a canonical VINPassport field.
    // Name it as invalid rather than lending it a generic "Field" label, because a
    // forged key (e.g. "odometerKm " with a trailing space) must not read as real.
    if (!meta) return `Unrecognised field key ${short(c.fieldKey)}, not canonical`;
    const label = meta.label ?? 'Field';
    const op = c.atMost ? '≤' : '≥';
    const suffix = meta.kind === 'km' ? ' km' : '';
    return `${label} ${op} ${fmt(c.bound)}${suffix}`;
};

function claimRow(meta, c, current) {
    const chip = !meta ? '<span class="ev-chip ev-chip--invalid">Invalid</span>'
        : current ? '<span class="ev-chip ev-chip--current">Current</span>'
            : '<span class="ev-chip ev-chip--superseded">Superseded</span>';
    return `<div class="ev-claim">
      <div class="ev-claim__text"><b>${esc(claimTitle(meta, c))}</b><span>${esc(meta?.name ?? short(c.fieldKey))} · slot ${short(c.slot)} · proven against ${short(c.commitment)}</span></div>
      ${chip}
    </div>`;
}

function vehicleSection(vin, claims, ledger, vinfo, fields) {
    const currentCount = claims.filter((c) => ledger.fieldCommitment[c.slot] === c.commitment).length;
    const summary = claims.length === 0
        ? 'registered · no claims proven yet'
        : currentCount === claims.length
            ? `${claims.length} claim${claims.length === 1 ? '' : 's'} · all current`
            : `${claims.length} claims · ${claims.length - currentCount} superseded`;
    const body = claims.length === 0
        ? '<p class="ev-panel__sub">Registered, nothing proven yet. Not a judgement; a blank page. A failed proof writes nothing, and absence of a claim is rendered as absence, never as a quiet no.</p>'
        : claims.map((c) => claimRow(fields[c.fieldKey], c, ledger.fieldCommitment[c.slot] === c.commitment)).join('\n');
    const note = vinfo?.blurb && claims.length > 0 && currentCount !== 0 && claims.length < 4
        ? `<p class="ev-panel__sub">${esc(vinfo.blurb)}. Claims not on this list were <b>not requested</b> or would have aborted in-circuit. Absence of a claim is what the verdict page renders, never a quiet no.</p>`
        : '';
    return `<section class="ev-panel" aria-label="${esc(vinfo?.title ?? 'Unlabelled vehicle')}">
    <div class="ev-panel__head">
      <h3 class="ev-panel__title">${esc(vinfo?.title ?? 'Unlabelled vehicle')}</h3>
      <span class="small">${esc(summary)}</span>
      <a class="link ev-panel__link" href="../v/?v=${vin}">Verdict view →</a>
    </div>
    <div class="ev-key">VIN HASH ${vin}</div>
    ${body}
    ${note}
  </section>`;
}

(async () => {
    let state;
    try {
        state = await loadState('../verify/', new URLSearchParams(location.search));
    } catch (e) {
        $('vehicles').innerHTML = `<p class="ev-alert">Could not read the ledger: ${esc(e.message)}</p>`;
        $('source').textContent = 'The ledger could not be read.';
        return;
    }
    const { ledger, vocabulary } = state;
    const byVin = Object.fromEntries((vocabulary.demoVehicles ?? []).map((v) => [v.vinHash, v]));
    const vins = Object.keys(ledger.passports);

    // passports · claims · field updates · values published (0 by construction).
    // Field updates is the number of committed (vehicle, field) cells, which is
    // `fieldCommitment`, not the two-field claims in `relClaims`.
    $('stat-passports').textContent = String(vins.length);
    $('stat-claims').textContent = String(ledger.claims.length);
    $('stat-fields').textContent = String(Object.keys(ledger.fieldCommitment ?? {}).length);
    $('stat-values').textContent = '0';

    $('vehicles').innerHTML = vins.map((vin) =>
        vehicleSection(vin, ledger.claims.filter((c) => c.vinHash === vin),
            ledger, byVin[vin], vocabulary.fields)).join('\n');
    $('source').textContent = `Read from: ${state.badge}.`;
})();
