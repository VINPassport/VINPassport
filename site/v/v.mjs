/**
 * The verdict page (/v/): one passport, read from the ledger, in the 2026 design.
 *
 * What it must keep from /verify/, which it replaces:
 *   - a verdict comes from a claim on the ledger or it does not exist; silence
 *     is "not proven", never a no (verdict.mjs decides, this file only draws);
 *   - an identifier that was asked for and not found shows "no passport",
 *     never a different vehicle's verdict;
 *   - the VIN never reaches the address bar: every navigation carries the key;
 *   - nothing on the ledger is withheld: the whole catalogue, the claims no
 *     question covers, and what the ledger holds, one click away.
 *
 * The functions above the DOM block are pure, so test/app/verdict-page.test.mjs
 * runs them under node against the same demo ledger the page reads.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { passportView } from '../assets/verdict.mjs';
import { chainSeesBlock, fmt, short, esc } from '../assets/chain-sees.mjs';
import { passportCode, parseCode, resolveCode } from '../assets/passport-code.mjs';
import { parseEntry, HASH_RE } from '../assets/vin.mjs';

/** The buyer's four questions, in the design's fixed order. */
export const FOUR = ['neverWrittenOff', 'noAccidents', 'oneKeeper', 'mileageUnder'];

/** How each of the four reads as a question, and the word a verified answer gives. */
const ASK = {
    neverWrittenOff: { q: () => 'Has it ever been written off?', yes: 'Never' },
    noAccidents: { q: () => 'Any reported accidents?', yes: 'None' },
    oneKeeper: { q: () => 'One keeper from new?', yes: 'Yes' },
    mileageUnder: {
        q: (claim) => (claim && claim.bound !== undefined
            ? `Mileage under ${fmt(claim.bound)} km?`
            : 'Mileage under a stated ceiling?'),
        yes: 'Yes'
    }
};

/** Brands that have a sample white-label verdict. Volta is made up. */
export const BRANDS = { volta: { name: 'Volta', band: 'VOLTA' } };

const ICON = {
    proven: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"></path></svg>',
    'not-proven': '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h8"></path></svg>',
    superseded: '<svg viewBox="0 0 16 16" aria-hidden="true"><circle cx="8" cy="8" r="5.5"></circle><path d="M8 5v3.2l2 1.3"></path></svg>'
};
const CLASS = { proven: 'verified', 'not-proven': 'not-proven', superseded: 'superseded' };

/**
 * What the address asks for. Pure: the ledger's keys come in, a decision comes out.
 *
 * `?v=` carries a vehicle key (the QR code and every link we hand out), `?c=` a
 * typed passport code (also where the 404 page sends `/v/<code>`), and nothing
 * at all opens the sample. A key that was asked for and is not held is a miss:
 * it never falls back to another vehicle.
 */
export function readRequest(params, keys) {
    const held = new Set([...keys].map((k) => String(k).toLowerCase()));
    const v = (params.get('v') ?? '').trim().toLowerCase();
    let c = (params.get('c') ?? '').trim();
    // A key pasted as a path (/v/<key>) arrives as ?c=; it is still a key.
    if (!v && HASH_RE.test(c.toLowerCase())) return readRequest(new URLSearchParams({ v: c }), keys);
    if (v) {
        if (HASH_RE.test(v) && held.has(v)) return { kind: 'found', key: v, via: 'key' };
        return { kind: 'missing', via: 'key', asked: v };
    }
    if (c) {
        const parsed = parseCode(c);
        if (parsed.error) return { kind: 'bad-code', typed: c, error: parsed.error };
        const hit = resolveCode(parsed, held);
        if (hit.key) return { kind: 'found', key: hit.key, via: 'code', code: parsed.code };
        if (hit.ambiguous) return { kind: 'ambiguous', code: parsed.code };
        return { kind: 'missing', via: 'code', code: parsed.code };
    }
    const first = [...held][0];
    return first ? { kind: 'found', key: first, via: 'sample' } : { kind: 'missing', via: 'sample' };
}

/** The four headline answers, from a passportView. */
export const headline = (view) => FOUR.map((id) => view.answers.find((a) => a.id === id)).filter(Boolean);

/** "3 answers verified, 1 not proven": counted over the four, in that order. */
export function tally(four) {
    const n = (s) => four.filter((a) => a.status === s).length;
    const proven = n('proven');
    if (proven === four.length) return `All ${proven} answers verified`;
    const parts = [proven === 0 ? 'No answers verified' : `${proven} answer${proven === 1 ? '' : 's'} verified`];
    if (n('not-proven')) parts.push(`${n('not-proven')} not proven`);
    if (n('superseded')) parts.push(`${n('superseded')} superseded`);
    return parts.join(', ');
}

/** The four rows. A verified row says its answer and, to a screen reader, its state. */
export function verdictRows(four) {
    return four.map((a) => {
        const ask = ASK[a.id];
        const q = esc(ask.q(a.status === 'not-proven' ? null : a.claim));
        const cls = CLASS[a.status];
        const icon = `<span class="vp-verdict__icon">${ICON[a.status]}</span>`;
        if (a.status === 'proven') {
            return `<li class="vp-verdict vp-verdict--${cls}">${icon}<span class="vp-verdict__q">${q}</span>`
                + `<span class="vp-verdict__state"><span class="vp-sr">Verified: </span>${ask.yes}</span></li>`;
        }
        if (a.status === 'superseded') {
            return `<li class="vp-verdict vp-verdict--${cls}">${icon}<span class="vp-verdict__q">${q}</span>`
                + '<span class="vp-verdict__state">Superseded</span></li>';
        }
        // Not proven links to what that means: it is the one answer a buyer
        // most often reads as a no, and it is not one.
        return `<li><a class="vp-verdict vp-verdict--${cls}" href="#meanings">${icon}<span class="vp-verdict__q">${q}</span>`
            + '<span class="vp-verdict__state">Not proven ›</span></a></li>';
    }).join('');
}

/** A decorative machine-readable strip for the data page, from public values only. */
export function mrzOf(title, code) {
    const clean = (s) => String(s).toUpperCase().replace(/[^A-Z0-9]+/g, '<').replace(/^<|<$/g, '');
    const line = `P<VINPASSPORT<<${clean(code)}<<${clean(title)}`;
    return (line + '<'.repeat(44)).slice(0, Math.max(44, line.length));
}

/** The address a shared link carries: the key, and the brand if one is shown. */
export function shareUrl(origin, key, brand) {
    return `${origin}/v/?v=${key}${brand ? `&brand=${brand}` : ''}`;
}

/* ------------------------------------------------- the full record ---- */

const qLabel = (a) => (a.field === 'odometerKm' && a.claim && a.claim.bound !== undefined && !a.against
    ? `Mileage under ${fmt(a.claim.bound)} km` : a.label);

const comparePair = (a) =>
    `${a.field ?? a.meta?.name ?? 'first'} − ${a.against ?? 'second'} ≤ ${fmt(a.claim.slack)}`;

function subOf(a) {
    if (a.status === 'not-proven') return 'No claim on the ledger. Not proven, not a no.';
    if (a.invalid) return `Field key ${short(a.claim.fieldKey)} is not a VINPassport field, so this claim proves nothing about the vehicle. Treat it as invalid.`;
    if (a.claim?.slack !== undefined) {
        return a.status === 'proven'
            ? `${comparePair(a)} · both values hidden, proven against the current record`
            : `${comparePair(a)} · one of the two has moved since, so this is superseded`;
    }
    const bound = `${a.meta?.name ?? a.field} ${a.atMost ? '≤' : '≥'} ${fmt(a.claim.bound)}`;
    return a.status === 'proven'
        ? `${bound} · proven against the current record`
        : `${bound} · proven against an earlier version, since superseded`;
}

function proofOf(a, ctx) {
    if (a.status === 'not-proven') {
        return `<div class="v-proof">
      <p>Nothing on the ledger answers this question. A failed proof writes nothing and no proof was recorded, so the honest answer is not proven. Ask the seller for it: if the claim is true of the record, proving it takes one transaction.</p>
      <button type="button" class="vp-btn vp-btn--secondary v-ask" data-vehicle="${esc(ctx.title)}" data-key="${esc(ctx.key)}" data-claim="${esc(qLabel(a))}">Copy a request for the seller</button>
      <p class="small">Copies the vehicle and the question as text you can send. Nothing is sent from this page.</p>
    </div>`;
    }
    const c = a.claim;
    if (c?.slack !== undefined) {
        return `<div class="v-proof">
      <p>This claim compares <strong>two hidden values of the same vehicle</strong>. The proof opens both commitments inside the circuit and publishes only how far apart they may be. Neither reading, and not even the difference, was put on the ledger.</p>
      <dl class="v-proof__grid"><dt>Claim</dt><dd>${esc(comparePair(a))}</dd><dt>First field</dt><dd>${short(c.fieldKeyHigh)}</dd><dt>Second field</dt><dd>${short(c.fieldKeyLow)}</dd><dt>Proven against</dt><dd>${short(c.commitmentHigh)}</dd><dt>And against</dt><dd>${short(c.commitmentLow)}</dd></dl>
    </div>`;
    }
    const name = a.invalid ? 'unrecognised field key' : (a.meta?.name ?? a.field ?? 'field');
    return `<div class="v-proof">
      <p>The circuit accepted this claim. It could not have been produced unless the hidden value met the bound, and the value itself was never published. On a live chain that acceptance is a zero-knowledge proof on the ledger.</p>
      <dl class="v-proof__grid"><dt>Claim</dt><dd>${esc(name)} ${a.atMost ? '≤' : '≥'} ${fmt(c.bound)}</dd><dt>Field key</dt><dd>${short(c.fieldKey)}</dd><dt>Proven against</dt><dd>${short(c.commitment)}</dd><dt>Ledger slot</dt><dd>${short(c.slot)}</dd></dl>
    </div>`;
}

const STATE_WORD = { proven: 'Verified', 'not-proven': 'Not proven', superseded: 'Superseded' };

function claimRow(a, ctx) {
    const cls = CLASS[a.status];
    return `<details class="v-claim v-claim--${cls}"><summary>
      <span class="v-mark v-mark--${cls}">${ICON[a.status]}</span>
      <span class="v-claim__text"><span class="v-claim__q">${esc(qLabel(a))}</span><span class="v-claim__sub">${esc(subOf(a))}</span></span>
      <span class="v-claim__state">${STATE_WORD[a.status]}</span>
    </summary>${proofOf(a, ctx)}</details>`;
}

/**
 * Every question the catalogue holds, grouped, and every group shown even when
 * it answers nothing: a question nobody answered is the one worth asking
 * about. Claims no question covers come last, open, because an unrecognised
 * claim is exactly what a reader must not have to go looking for.
 */
export function fullRecord(view, ctx) {
    const extras = (view.extras ?? []).map((x) => ({
        field: x.meta?.name, atMost: x.claim.atMost, meta: x.meta, invalid: !x.meta,
        label: x.compare
            ? `${x.meta?.label ?? 'A field'} compared with another field of this vehicle`
            : x.meta
                ? `${x.meta.label} ${x.claim.atMost ? 'at most' : 'at least'} ${fmt(x.claim.bound)}`
                : 'Unrecognised field key, not a VINPassport claim',
        status: x.status, claim: x.claim
    }));
    const group = (label, items, proven, open) => {
        const total = items.length;
        const word = total === 0 ? 'none' : proven === total ? `all ${total} answered` : `${proven} of ${total} answered`;
        return `<details class="v-group"${open || proven > 0 ? ' open' : ''}><summary><span class="v-group__name">${esc(label)}</span>`
            + `<span class="v-group__tally${proven > 0 ? ' is-some' : ''}">${esc(word)}</span></summary>`
            + `<div class="v-group__rows">${items.map((a) => claimRow(a, ctx)).join('')}</div></details>`;
    };
    const parts = (view.groups ?? []).map((g) => group(g.label, g.answers, g.proven, false));
    if (extras.length) parts.push(group('Other claims on this ledger', extras, extras.length, true));
    return parts.join('');
}

/* ------------------------------------------------------------ DOM ---- */

const MEANINGS = `<div id="meanings" class="card v-meanings" tabindex="-1">
  <h2 class="h3">What the answers mean</h2>
  <div class="v-legend">
    <span class="v-mark v-mark--verified">${ICON.proven}</span><p class="small"><strong>Verified.</strong> Proven from the issuer's record. The exact value stays private.</p>
    <span class="v-mark v-mark--not-proven">${ICON['not-proven']}</span><p class="small"><strong>Not proven.</strong> Nothing on record for this question. Unknown, not a no. Ask the seller for the registration documents.</p>
    <span class="v-mark v-mark--superseded">${ICON.superseded}</span><p class="small"><strong>Superseded.</strong> A newer reading exists, so this older proof is no longer current.</p>
  </div>
</div>`;

const SHIELD = (size) => `<img src="../assets/brand/vinpassport-icon-primary.svg" alt="VINPassport shield" width="${size}" height="${size}" class="v-shield">`;

const LEDGER_WORD = { static: 'Demo ledger', local: 'This browser', server: 'Live server' };

function verdictMarkup({ key, view, vinfo, state, brand, via, checkedAt, others }) {
    const four = headline(view);
    const title = vinfo?.title ?? 'Vehicle passport';
    const code = passportCode(key);
    const b = brand ? BRANDS[brand] : null;
    const ctx = { key, title };
    const sample = via === 'sample';
    const total = view.answers.length;
    const answered = view.answers.filter((a) => a.status !== 'not-proven').length;
    const share = shareUrl(location.origin, key, brand);

    return `
${b ? `<div class="v-oem"><div class="wrap v-oem__bar"><span class="v-oem__name">${esc(b.band)}</span><span>Vehicle passport</span></div></div>
<div class="wrap"><p class="small v-oem__note">Sample branding on a demo vehicle. ${esc(b.name)} is a made-up manufacturer: on a manufacturer's own verdict, its name and colour sit here and everything below stays the same.</p></div>` : ''}
<section aria-labelledby="v-h1">
  <div class="wrap v-head">
    <div class="stack" style="gap: 6px;">
      <nav aria-label="Breadcrumb" class="small v-crumb"><a class="link" href="../scan/">Scan a vehicle</a> › ${sample ? 'Sample verdict' : 'Verdict'}</nav>
      <h1 id="v-h1" class="h1 v-title">This passport is genuine</h1>
      <p class="copy">${esc(tally(four))} · Checked ${esc(checkedAt)}</p>
      ${sample ? '<p class="small">This is the sample passport, a fictional vehicle on the demo ledger.</p>' : ''}
    </div>
    <span class="vp-stamp vp-stamp--verified" data-animate>Verified</span>
  </div>
</section>

<section aria-label="Passport">
  <div class="wrap split v-split">
    <div class="v-main">
      <div class="vp-datapage">
        <div class="vp-datapage__head">
          <div><div class="vp-label">Vehicle passport · Page 01</div><p class="vp-datapage__title">${esc(title)}</p></div>
          ${SHIELD(72)}
        </div>
        <div class="vp-fields">
          <div><div class="vp-label">Registered by</div><div class="vp-field__value">${view.registrar ? esc(short(view.registrar)) : 'Unknown'}</div></div>
          <div><div class="vp-label">Passport code</div><div class="vp-field__value">${esc(code)}</div></div>
          <div><div class="vp-label">Claims on record</div><div class="vp-field__value">${view.claimCount}</div></div>
          <div><div class="vp-label">Read from</div><div class="vp-field__value">${esc(LEDGER_WORD[state.mode] ?? state.mode)}</div></div>
        </div>
        <ul class="vp-verdicts">${verdictRows(four)}</ul>
        <p class="small v-note">Answers are proven from the issuer's record. Exact values are never shown. <a class="link" href="../how-it-works/#trust">What a passport cannot prove →</a></p>
        <div class="vp-mrz" aria-hidden="true">${esc(mrzOf(title, code))}</div>
      </div>
      <p class="small v-source">Read from: ${esc(state.badge)}.</p>
    </div>

    <div class="stack v-side">
      <div class="card v-match" data-match>
        <h2 class="h3">Is this the car in front of you?</h2>
        <p class="copy">Codes can be copied or swapped. Type the VIN from the windscreen plate. It is checked against this passport and never stored or shown.</p>
        <form class="stack" style="gap: 12px;" novalidate autocomplete="off" data-match-form>
          <div class="field"><label for="vin">Vehicle identification number</label>
            <input id="vin" class="input v-vin" inputmode="latin" maxlength="40" spellcheck="false" autocapitalize="characters" autocorrect="off" aria-describedby="vin-count vin-err">
            <span id="vin-count" class="v-count" data-vin-count>0 of 17 characters</span>
            <p class="field__error" id="vin-err" hidden></p>
          </div>
          <button type="submit" class="vp-btn vp-btn--primary${b ? ' v-oem-btn' : ''}" style="justify-content: center;">Match this car</button>
        </form>
        <div data-match-result role="status" aria-live="polite"></div>
        ${state.mode === 'static' ? '<p class="small">On this demo the check runs in your browser. The demo cars\' VINs are on the <a class="link" href="../scan/#demo">Scan page</a>.</p>' : ''}
      </div>

      <div class="card v-share">
        <h2 class="h3">Share this verdict</h2>
        <p class="copy">Send a link to a lender, insurer or partner. It always opens the current answers.</p>
        <label class="vp-sr" for="share-url">Link to this verdict</label>
        <input id="share-url" class="input v-share__url" readonly value="${esc(share)}">
        <button type="button" class="vp-btn vp-btn--secondary" style="justify-content: center;" data-copy-link>Copy link</button>
        <p class="small" data-copy-status aria-live="polite"></p>
        <details class="v-qr"><summary>Show the QR code</summary><div class="v-qr__body" data-qr></div></details>
      </div>

      ${b ? '<p class="small v-oem__links">A manufacturer\'s own links, such as booking a service, sit here.</p>' : ''}
      ${MEANINGS}
      ${b ? `<div class="v-byline">${SHIELD(36)}<p class="small"><strong>Verified by VINPassport.</strong> An independent check, not ${esc(b.name)}'s own claim. <a class="link" href="#meanings">What is this?</a></p></div>` : ''}
    </div>
  </div>
</section>

<section class="sec--tint" aria-labelledby="all-title">
  <div class="wrap sec stack-lg">
    <div class="stack" style="max-width: 780px;">
      <div class="vp-label">The full record</div>
      <h2 id="all-title" class="h2">Every question this passport can answer</h2>
      <p class="lead">The four above are a buyer's first questions. This passport answers ${answered} of the ${total} a passport can. Most go unanswered on most vehicles, and an unanswered question is the one worth asking about. Open an answer to see the proof behind it.</p>
    </div>
    <div class="v-groups">${fullRecord(view, ctx)}</div>
    <details class="v-ledger"><summary>What the ledger holds for this passport, and what it does not</summary><div class="v-ledger__body">${chainSeesBlockFor(key, view, state.ledger)}</div></details>
    <div class="card v-honest">
      <h3 class="h3">What a tick does, and does not, mean</h3>
      <p class="copy">Proven against the anchored record, attributable to a named registrar, tamper-evident. Not a guarantee that the record matched the vehicle when it was written: that is the registrar's word, which is why every passport names one.</p>
      <p class="copy">A dealer or an authority is entitled to more than a buyer, and receives it in a file the holder hands them, checked against the same ledger: <a class="link" href="../disclose/">one vehicle, three readers</a>. Every claim on this ledger is in the <a class="link" href="../proofs/">proof explorer</a>.</p>
    </div>
    ${others.length ? `<div class="stack" style="gap: 12px;"><h3 class="h3">Other passports on this ledger</h3><ul class="v-others">${others.map((o) => `<li><a class="link" href="?v=${o.key}${brand ? `&amp;brand=${brand}` : ''}">${esc(o.title)}</a> <span class="small">${esc(o.tally)}</span></li>`).join('')}</ul></div>` : ''}
  </div>
</section>`;
}

// chainSeesBlock is shared with other pages and draws in the old palette; it
// sits inside a collapsed box here, as evidence rather than the answer.
const chainSeesBlockFor = (key, view, ledger) => chainSeesBlock(key, view, ledger);

const NONE_ICON = '<svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5"></circle><path d="M16 16l4.5 4.5"></path></svg>';

/**
 * Nothing holds a passport for what was asked. This is not a verdict on the
 * vehicle, and the page must read as neither a clean bill of health nor a
 * warning.
 */
function missingMarkup(req, others) {
    const asked = req.asked ?? '';
    const shown = req.code ?? req.typed ?? (asked.length > 24 ? short(asked) : asked);
    const heading = req.kind === 'bad-code' ? 'That is not a passport code'
        : req.kind === 'ambiguous' ? 'This short code belongs to more than one passport'
            : req.via === 'code' ? 'No passport on record for this code' : 'No passport on record for this vehicle';
    const lead = req.kind === 'bad-code'
        ? `<p class="lead">${esc(req.error)}</p>`
        : req.kind === 'ambiguous'
            ? '<p class="lead">Two passports share these first characters, so the page will not guess. Scan the QR code on the vehicle instead, or open the link the seller sent: both carry the full key.</p>'
            : '<p class="lead"><strong>This is not a failed check, and not a verdict on the vehicle.</strong> Most vehicles built before 29 November 2026 have no passport yet, so a missing record says nothing bad about the car.</p>';
    const report = `mailto:info@passport.vin?subject=${encodeURIComponent('Suspicious passport code')}&body=${encodeURIComponent(`The code: ${shown}\nWhere I saw it: \n`)}`;
    return `
<section aria-labelledby="v-h1">
  <div class="wrap sec v-none">
    <div class="stack" style="gap: 20px; max-width: 720px;">
      <nav aria-label="Breadcrumb" class="small v-crumb"><a class="link" href="../scan/">Scan a vehicle</a> › Verdict</nav>
      <span class="v-none__icon">${NONE_ICON}</span>
      <div class="stack" style="gap: 8px;"><h1 id="v-h1" class="h1 v-title">${heading}</h1>${shown ? `<p class="vp-code v-none__code">${esc(shown)}</p>` : ''}</div>
      ${lead}
      <div class="card" style="gap: 12px;">
        <span class="vp-label">What you can do</span>
        <ol class="v-steps">
          <li>Check you typed the code exactly as printed.</li>
          <li>Ask the seller for the service book and registration documents.</li>
          <li>If the code was printed on the vehicle and looks official, report it so we can look into it.</li>
        </ol>
      </div>
      <div class="btns"><a class="vp-btn vp-btn--primary" href="../scan/">Try another code</a><a class="vp-btn vp-btn--ghost" href="${report}">Report a suspicious code</a></div>
      ${others.length ? `<p class="small">This site reads a demonstration ledger, which holds ${others.length === 1 ? 'one passport' : `${others.length} passports`}: ${others.map((o) => `<a class="link" href="?v=${o.key}">${esc(o.title)}</a>`).join(' and ')}. They are fictional vehicles.</p>` : ''}
    </div>
  </div>
</section>`;
}

function wireMatch(root, key) {
    const form = root.querySelector('[data-match-form]');
    if (!form) return;
    const input = form.querySelector('#vin');
    const count = form.querySelector('[data-vin-count]');
    const err = form.querySelector('#vin-err');
    const out = root.querySelector('[data-match-result]');
    const plain = (s) => String(s).toUpperCase().replace(/[\s-]/g, '');
    input.addEventListener('input', () => {
        const typed = plain(input.value).length;
        count.textContent = typed + ' of 17 characters';
        out.replaceChildren();
    });
    const complain = (m) => {
        err.textContent = m; err.hidden = false;
        input.setAttribute('aria-invalid', 'true');
        input.focus();
    };
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        err.hidden = true; input.removeAttribute('aria-invalid');
        const parsed = parseEntry(input.value);
        if (parsed.error) return complain(parsed.error);
        if (!parsed.vin) return complain('Type the VIN itself: the seventeen characters on the plate at the base of the windscreen.');
        // The typed VIN is hashed and compared here, then dropped. It is never
        // put in the address, stored, or written back onto the page.
        const match = parsed.key === key;
        out.innerHTML = match
            ? '<div class="v-result v-result--match"><span class="vp-stamp vp-stamp--verified" data-animate>Match</span>'
              + '<p class="v-result__head">This passport belongs to this car.</p>'
              + '<p class="small">The VIN was checked against this passport. It was not stored, and it is not shown.</p></div>'
            : '<div class="v-result v-result--nomatch"><span class="vp-stamp vp-stamp--caution">No match</span>'
              + '<p class="v-result__head">This passport does not belong to the VIN you typed.</p>'
              + '<p class="small">Check each character against the plate: a VIN never contains I, O or Q. Then compare it with the VIN on the registration document and the door frame. If they agree with each other and not with this passport, the code is for a different vehicle: ask the seller why before you pay anything.</p></div>';
    });
}

function wireShare(root, key, brand) {
    const btn = root.querySelector('[data-copy-link]');
    if (!btn) return;
    const url = root.querySelector('#share-url');
    const status = root.querySelector('[data-copy-status]');
    btn.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(url.value);
            btn.textContent = 'Link copied';
            status.textContent = 'The link is on your clipboard.';
        } catch {
            url.focus(); url.select();
            status.textContent = 'Your browser would not copy it. The link is selected: copy it from the box above.';
        }
        setTimeout(() => { btn.textContent = 'Copy link'; }, 4000);
    });
    // The QR code is drawn only when asked for: it costs nothing, but most
    // readers never open it.
    const qr = root.querySelector('.v-qr');
    qr?.addEventListener('toggle', async () => {
        const body = qr.querySelector('[data-qr]');
        if (!qr.open || body.firstChild) return;
        const { toSvg } = await import('../assets/qr.mjs');
        const link = shareUrl(location.origin, key, null);
        const svg = toSvg(link, { scale: 4, quiet: 4, dark: '#0f1c35', light: '#ffffff' });
        body.innerHTML = `<div class="v-qr__code">${svg}</div><p class="small">The code opens this passport. It carries the link and the vehicle key, which is already public on the ledger: no VIN and no reading.</p>`
            + `<a class="vp-btn vp-btn--ghost" download="vinpassport-${passportCode(key)}.svg" href="${URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))}">Download the code</a>`;
    });
}

function wireAsk(root) {
    for (const btn of root.querySelectorAll('.v-ask')) {
        btn.addEventListener('click', async () => {
            const { vehicle, key, claim } = btn.dataset;
            const text = 'Please prove this on the vehicle passport.\n\n'
                + `Vehicle: ${vehicle}\nPassport: ${location.origin}/v/?v=${key}\nQuestion: ${claim}\n\n`
                + 'A proof writes only a commitment to the ledger; the reading itself stays private.';
            const label = btn.textContent;
            try {
                await navigator.clipboard.writeText(text);
                btn.textContent = 'Copied';
            } catch {
                btn.textContent = 'Select the text below';
                const box = document.createElement('textarea');
                box.className = 'input v-ask__text';
                box.rows = 8; box.value = text;
                btn.after(box); box.select();
            }
            setTimeout(() => { btn.textContent = label; }, 2600);
        });
    }
}

export async function start(doc = document) {
    const main = doc.querySelector('[data-verdict]');
    if (!main) return;
    const { loadState } = await import('../assets/sources.mjs');
    const params = new URLSearchParams(location.search);
    let state;
    try {
        state = await loadState('../verify/', params);
    } catch (e) {
        main.querySelector('[data-v-body]').innerHTML = `<section><div class="wrap sec"><h1 class="h1">The ledger could not be read</h1><p class="lead">${esc(e.message)}. Try again in a moment.</p></div></section>`;
        main.removeAttribute('aria-busy');
        return;
    }
    const { ledger, vocabulary } = state;
    const byKey = Object.fromEntries((vocabulary.demoVehicles ?? []).map((v) => [v.vinHash, v]));
    const keys = Object.keys(ledger.passports);
    const brand = BRANDS[params.get('brand')] ? params.get('brand') : null;
    const req = readRequest(params, keys);
    const titleOf = (k) => byKey[k]?.title ?? `Passport ${passportCode(k)}`;
    const othersOf = (except) => keys.filter((k) => k !== except).map((k) => ({
        key: k, title: titleOf(k), tally: tally(headline(passportView(ledger, k, vocabulary)))
    }));

    const body = main.querySelector('[data-v-body]');
    if (req.kind === 'found') {
        const checkedAt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date());
        body.innerHTML = verdictMarkup({
            key: req.key, view: passportView(ledger, req.key, vocabulary), vinfo: byKey[req.key],
            state, brand, via: req.via, checkedAt, others: othersOf(req.key)
        });
        doc.title = 'This passport is genuine · VINPassport';
        // A typed code becomes the full key in the address, so a reload or a
        // shared address opens exactly this passport, whatever is added later.
        if (req.via === 'code') history.replaceState(null, '', '?v=' + req.key + (brand ? '&brand=' + brand : ''));
        wireMatch(body, req.key);
        wireShare(body, req.key, brand);
        wireAsk(body);
    } else {
        body.innerHTML = missingMarkup(req, state.mode === 'static' ? othersOf(null) : []);
        doc.title = 'No passport on record · VINPassport';
    }
    main.removeAttribute('aria-busy');
}

if (typeof document !== 'undefined') start();
