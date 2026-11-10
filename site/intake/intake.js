/**
 * Intake console wiring for the hand-designed page.
 *
 * Two modes, decided by whether the app server answers /api/health:
 *
 *   server   REGISTER & PROVE posts to /api/intake, the compiled circuits run
 *            in-process, and the result section lists every step accepted or
 *            REFUSED, then links to the vehicle's verdicts.
 *   browser  no server (GitHub Pages): the SAME circuits run in this page,
 *            and the ledger they produce is kept in sessionStorage so
 *            /v/ can read it. Same intake, same validation, same
 *            refusals: both call scripts/lib/intake-engine.mjs.
 *
 * The browser mode is narrower than it looks and the page has to say so
 * before anyone presses anything. The circuits are the compiled contract and
 * the commitments are real, but nothing is PROVEN, nothing reaches a chain,
 * and the record dies with the tab. Overstating any of those would be the
 * same failure as the page that once reported a circuit server it did not
 * have, only in the other direction.
 *
 * The markup is the designer's specification: this script only fills selects,
 * sets the states the design draws (aria-pressed, checked, hidden), and builds
 * the result rows. Every element it touches has an id or a data attribute, and
 * every look lives in vp.css. Refusals are rendered, never hidden.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { DEMO_VEHICLES } from '../assets/demo-vehicles.mjs';
import { CLAIM_CATALOGUE, isCompare } from '../assets/claim-catalogue.mjs';
import { qrPanel } from '../assets/passport-qr.mjs?v=3';
import { networkOf } from '../assets/networks.mjs?v=1';

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- selects

const OPTIONS = {
    cat: [['M1', 'M1, passenger car'], ['M2', 'M2, minibus'], ['M3', 'M3, bus or coach'],
        ['N1', 'N1, van up to 3.5t'], ['N2', 'N2, truck up to 12t'], ['L', 'L, two or three wheeler']],
    fuel: [['bev', 'Battery electric (BEV)'], ['phev', 'Plug-in hybrid (PHEV)'], ['hev', 'Hybrid (HEV)'],
        ['petrol', 'Petrol'], ['diesel', 'Diesel'], ['h2', 'Hydrogen']],
    em: [['n/a', 'n/a (zero-emission)'], ['Euro 6e', 'Euro 6e'], ['Euro 6d', 'Euro 6d'],
        ['Euro 6', 'Euro 6'], ['Euro 5', 'Euro 5'], ['Euro 7', 'Euro 7']],
    wo: [['0', '0, none'], ['1', '1, category N, non-structural'],
        ['2', '2, category S, structural'], ['3', '3, category B, break']]
};
for (const [id, opts] of Object.entries(OPTIONS)) {
    const sel = $(id);
    sel.replaceChildren(...opts.map(([value, label]) => {
        const o = document.createElement('option');
        o.value = value; o.textContent = label;
        return o;
    }));
}

// ---------------------------------------------------------------- mode

/* Anchored on an id, not on `nav ~ div div[style*="240px"]`. That selector
   stopped matching the day the <main> landmark went in for Annex V 4.2.1:
   the card moved inside <main>, so it was no longer a sibling of <nav>. The
   lookup returned null, this module threw before it could set the state, and
   the page was left saying "Local circuit server found" with REGISTER enabled
   on a static host that has no circuit server at all. It failed OPEN.
   The page now ships in the neutral state with the button disabled, and only
   this code turns it on, so the same class of failure fails closed. */
const statusCard = document.querySelector('#server-status');
const registerBtn = $('register');
const downloadBtn = $('download');
const circuitsNote = $('circuits');

let serverMode = false;
let apiBase = '';
(async () => {
    try {
        const { resolveApiBase } = await import('../assets/sources.mjs?v=5');
        const base = await resolveApiBase();
        serverMode = base != null;
        apiBase = base ?? '';
    } catch { serverMode = false; }

    /* The label is SET, never string-replaced. The old code rewrote the
       literal "Local circuit server found" that the page shipped with, so if
       that text ever changed the rewrite became a no-op and the stale label
       survived: a second way to report a server that is not there. */
    const dot = statusCard.querySelector('[data-status-dot]');
    const note = statusCard.querySelector('[data-status-note]');
    const label = (text) => { statusCard.querySelector('[data-status-label]').textContent = text; };

    if (serverMode) {
        dot.dataset.state = 'on';
        label(apiBase === '' ? 'Local circuit server found' : 'Circuit server connected');
        note.textContent = apiBase === ''
            ? 'attestation-vault-32 · depth 5'
            : `${apiBase.replace(/^https?:\/\//, '')} · shared demo ledger, resets on restart`;
        registerBtn.disabled = false;
        registerBtn.title = '';
    } else {
        /* No server, so the circuits run HERE. The button is enabled because
           something real happens when it is pressed, and the note says what
           that is and what it is not, before the press rather than after. */
        dot.dataset.state = 'wait';
        label('Running the circuits in this browser');
        note.textContent = 'real commitments, nothing proven, nothing on a chain · kept in this tab only';
        registerBtn.disabled = false;
        registerBtn.title = 'Runs the compiled circuits in this page; the record stays in this tab';
    }
})();

// ---------------------------------------------------------------- origin toggle

const originButtons = [...document.querySelectorAll('[data-origin]')];
let origin = 'new';

const paintOrigin = () => {
    for (const b of originButtons) b.setAttribute('aria-pressed', String(b.dataset.origin === origin));
};
for (const b of originButtons) {
    b.addEventListener('click', () => { origin = b.dataset.origin; paintOrigin(); rebuildPicker(); });
}

// ---------------------------------------------------------------- demo picker

const picker = $('dv');
const pickerLabel = document.querySelector('label[for="dv"]');
const expectBox = $('expect');
let selected = null;

function rebuildPicker() {
    const mine = DEMO_VEHICLES.map((v, i) => [v, i]).filter(([v]) => (v.origin ?? 'retrofit') === origin);
    pickerLabel.textContent = origin === 'new' ? 'Sample vehicle, new' : 'Sample vehicle, retrofit';
    picker.replaceChildren();
    const none = document.createElement('option');
    none.value = '';
    none.textContent = 'choose, or fill the form yourself';
    picker.append(none);
    const groups = {};
    const groupOf = (v) => {
        if (origin === 'retrofit') return 'Existing fleet';
        if (v.fuelType === 'bev') return 'Battery electric';
        if (['phev', 'hev'].includes(v.fuelType)) return 'Plug-in hybrid · hybrid';
        return 'Petrol · diesel · hydrogen';
    };
    for (const [v, i] of mine) {
        const g = groupOf(v);
        if (!groups[g]) {
            groups[g] = document.createElement('optgroup');
            groups[g].label = g;
            picker.append(groups[g]);
        }
        const o = document.createElement('option');
        o.value = String(i);
        o.textContent = v.name;
        groups[g].append(o);
    }
    selected = null;
    expectBox.textContent = origin === 'new'
        ? 'All accepted. A new vehicle proves its four claims by construction: keepers 0, and nothing on the record yet.'
        : 'Watch the odometer-rollback attempt get REFUSED in-circuit, and the written-off car decline the clean claims it cannot prove.';
}
rebuildPicker();

// ---------------------------------------------------------------- claims

// The fields this form collects. A question about anything else cannot be
// answered here, however good a question it is, because the field would
// never be initialised and the circuit would refuse.
const FORM_FIELDS = new Set([
    'odometerKm', 'accidentCount', 'ownerCount', 'writeOffCategory',
    'serviceCount', 'lastServiceOdometerKm', 'recallIssuedCount', 'recallCompletedCount'
]);

// The catalogue, narrowed to what this form can answer. Derived rather than
// listed, so a question added to the catalogue appears here the moment the
// form collects its field, and never before.
const OFFERED = CLAIM_CATALOGUE.filter((q) => (isCompare(q)
    ? FORM_FIELDS.has(q.field) && FORM_FIELDS.has(q.against)
    : FORM_FIELDS.has(q.field)));

// Ticked by default: the four a buyer asks first, which are also the four
// this console offered before the catalogue existed.
const DEFAULT_ON = new Set(['neverWrittenOff', 'noAccidents', 'oneKeeper', 'mileageUnder']);
const claimState = Object.fromEntries(OFFERED.map((q) => [q.id, DEFAULT_ON.has(q.id)]));

/** The line under a question: what it actually asks of the ledger. */
const claimSub = (q) => {
    if (isCompare(q)) return `${q.field} − ${q.against} ≤ ${q.slack}`;
    if (q.bound === null) return `${q.field} ≤ a bound you set`;
    if (typeof q.bound === 'object') return `${q.field}, within ${q.bound.daysAgo} days`;
    return `${q.field} ${q.atMost ? '≤' : '≥'} ${q.bound}`;
};

const claimGrid = document.getElementById('claimgrid');
// Replaces the four static checkboxes the page ships as a no-script fallback.
// Each question is a real checkbox, so the keyboard and a screen reader get
// it for free; the open-bound one carries its number in its own field.
claimGrid.innerHTML = OFFERED.map((q) => {
    const open = q.bound === null;
    const box = `<input type="checkbox" data-claim="${q.id}" id="claim-${q.id}">`;
    return open
        ? `<div class="ev-check">${box}<span class="ev-check__text"><span class="ev-check__bound"><label for="claim-${q.id}"><b>Mileage under</b></label><input class="input" data-bound="${q.id}" value="500" inputmode="numeric" aria-label="Mileage ceiling in km">km</span><small>${claimSub(q)}</small></span></div>`
        : `<label class="ev-check">${box}<span class="ev-check__text"><b>${q.label}</b><small>${claimSub(q)}</small></span></label>`;
}).join('');

const claimBoxes = Object.fromEntries(
    [...claimGrid.querySelectorAll('input[data-claim]')].map((b) => [b.dataset.claim, b])
);
const mileageInput = claimGrid.querySelector('input[data-bound="mileageUnder"]');

const paintClaim = (id) => {
    if (claimBoxes[id]) claimBoxes[id].checked = Boolean(claimState[id]);
};
for (const [id, box] of Object.entries(claimBoxes)) {
    box.addEventListener('change', () => {
        claimState[id] = box.checked;
        paintCircuitCount();
    });
}
Object.keys(claimState).forEach(paintClaim);
document.getElementById('claimsmeta').textContent =
    `${OFFERED.length} of ${CLAIM_CATALOGUE.length} catalogue questions`;

// ------------------------------------------------- who else may write it
//
// The page holds LABELS and nothing else. The identity behind a label, and
// the secret that proves it in-circuit, stay on the server: a console that
// handled a writer's secret would be handing it to every viewer, which is
// the opposite of what a per-vehicle writer list is for.
const writerBoxes = [...document.querySelectorAll('input[data-writer]')];
const writerBy = $('writerby');
const bySelect = $('wby');
const withdrawBox = $('wdraw');
const authorised = new Set();

const paintWriters = () => {
    for (const box of writerBoxes) box.checked = authorised.has(box.dataset.writer);
    // Choosing who writes only means something when there is an update to
    // write and somebody authorised to write it.
    const updates = selected?.updates?.length ?? 0;
    const offer = authorised.size > 0 && updates > 0;
    writerBy.hidden = !offer;
    // The withdraw box lives in that block, so hiding it must also clear it.
    // A checked box behind a hidden section would add a circuit call the
    // operator cannot see and did not ask for on this intake.
    if (!offer && withdrawBox) withdrawBox.checked = false;
    const keep = bySelect.value;
    bySelect.innerHTML = '<option value="">the registering authority</option>'
        + [...authorised].map((w) => `<option value="${w}">the ${w}</option>`).join('');
    bySelect.value = authorised.has(keep) ? keep : '';
};

writerBoxes.forEach((box) => {
    box.addEventListener('change', () => {
        const who = box.dataset.writer;
        if (box.checked) authorised.add(who); else authorised.delete(who);
        paintWriters();
        paintCircuitCount();
    });
});

// Ticking it adds a call per writer, so the count has to follow it.
withdrawBox?.addEventListener('change', paintCircuitCount);

// What a chain run is allowed to cost, mirroring MAX_CALLS_PER_RUN in
// scripts/lib/preprod-plan.mjs. Exceeded, the server refuses the intake, so
// the console says so before the button is pressed rather than after.
const RUN_CAP = 24;

function paintCircuitCount() {
    const updates = selected?.updates?.length ?? 0;
    const ticked = Object.values(claimState).filter(Boolean).length;
    // Each authorisation is a circuit call of its own, so the count has to
    // know about them or it understates what the run will do.
    // A withdrawal is its own circuit call, one per writer taken back.
    const withdrawals = withdrawBox?.checked ? authorised.size : 0;
    const n = 1 + FORM_FIELDS.size + updates + authorised.size + withdrawals + ticked;
    circuitsNote.textContent = n > RUN_CAP
        ? `${n} circuits will run, over the ${RUN_CAP} a chain run allows`
        : `${n} circuits will run`;
    circuitsNote.classList.toggle('ev-note--warn', n > RUN_CAP);
}
paintWriters();
paintCircuitCount();

// ---------------------------------------------------------------- fill

const evBlock = $('evblock');
const syncEv = () => {
    evBlock.hidden = !['bev', 'phev'].includes($('fuel').value);
};
$('fuel').addEventListener('change', syncEv);

function fillForm(v) {
    $('vin').value = v.vin;
    $('reg').value = v.registrar;
    $('dl').value = v.label ?? '';
    $('cat').value = v.vehicleCategory ?? 'M1';
    $('fuel').value = v.fuelType ?? 'petrol';
    syncEv();
    $('em').value = v.emissionsClass ?? 'Euro 6e';
    $('bp').value = v.batteryPassportId ?? '';
    $('bc').value = v.batteryChemistry ?? '';
    $('km').value = v.fields.odometerKm;
    $('ac').value = v.fields.accidentCount;
    $('kp').value = v.fields.ownerCount;
    $('wo').value = String(v.fields.writeOffCategory);
    $('sv').value = v.fields.serviceCount;
    $('lsv').value = v.fields.lastServiceOdometerKm ?? 0;
    $('ri').value = v.fields.recallIssuedCount ?? 0;
    $('rc').value = v.fields.recallCompletedCount ?? 0;
    // A demo record names the four classic claims. Everything else the
    // catalogue offers is left as the operator set it.
    claimState.neverWrittenOff = v.prove.neverWrittenOff;
    claimState.noAccidents = v.prove.noAccidents;
    claimState.oneKeeper = v.prove.oneKeeper;
    claimState.mileageUnder = v.prove.mileageUnder > 0;
    if (v.prove.mileageUnder > 0) mileageInput.value = v.prove.mileageUnder;
    Object.keys(claimState).forEach(paintClaim);
    paintWriters();
    paintCircuitCount();
}

picker.addEventListener('change', () => {
    const v = DEMO_VEHICLES[Number(picker.value)];
    selected = v ?? null;
    if (v) {
        fillForm(v);
        expectBox.textContent = v.expect.replace(/^Expect: /, '');
    }
    paintWriters();
    paintCircuitCount();
});

// ---------------------------------------------------------------- intake

function buildIntake() {
    const intake = {
        vin: $('vin').value.trim().toUpperCase(),
        registrar: $('reg').value.trim(),
        fields: {
            odometerKm: Number($('km').value),
            accidentCount: Number($('ac').value),
            ownerCount: Number($('kp').value),
            writeOffCategory: Number($('wo').value),
            serviceCount: Number($('sv').value),
            lastServiceOdometerKm: Number($('lsv').value),
            recallIssuedCount: Number($('ri').value),
            recallCompletedCount: Number($('rc').value)
        },
        // Labels only. The server resolves each to an identity it holds.
        authorise: [...authorised],
        /* Granted, used, then taken back: the same life cycle the guided run
           shows. The fields the writer already wrote stay written and stay
           stamped with it, which is the contract's documented behaviour, so
           withdrawing proves the grant was real rather than undoing it. */
        ...(withdrawBox?.checked && authorised.size
            ? { withdraw: [...authorised] }
            : {}),
        updates: (selected?.updates ?? []).map((round) =>
            (bySelect.value && authorised.has(bySelect.value))
                ? { ...round, by: bySelect.value }
                : round),
        // Every ticked question, by its catalogue id. An open-bound
        // question carries the number the operator set; the rest are a plain
        // yes, because their bound is the catalogue's standard rung.
        prove: Object.fromEntries(OFFERED
            .filter((q) => claimState[q.id])
            .map((q) => [q.id, q.bound === null ? Number(mileageInput.value) : true]))
    };
    if ($('dl').value.trim()) intake.label = $('dl').value.trim();

    const panel = { passportOrigin: origin };
    const put = (name, value) => {
        if (value !== '' && value !== undefined && value !== null) panel[name] = value;
    };
    put('vehicleCategory', $('cat').value);
    put('fuelType', $('fuel').value);
    put('emissionsClass', $('em').value);
    if (['bev', 'phev'].includes($('fuel').value)) {
        put('batteryPassportId', $('bp').value.trim());
        put('batteryChemistry', $('bc').value.trim());
    }
    // Fields the compact form does not show ride along from the demo record;
    // absent for manual entry, and absent slots are salted anyway.
    if (selected) {
        put('euTypeApprovalNumber', selected.euTypeApprovalNumber);
        if (selected.firstRegistrationDate) {
            panel.firstRegistrationDate = Math.floor(
                new Date(selected.firstRegistrationDate + 'T00:00:00Z').getTime() / 86_400_000);
        }
        for (const [k, val] of Object.entries(selected.env ?? {})) put(k, val);
    }
    intake.panel = panel;
    return intake;
}

// ---------------------------------------------------------------- result

const resultSection = $('result');
const resultRows = $('result-rows');
const resultCount = $('result-count');
const linksBar = $('result-links');

/** One step, accepted or refused, built as text so nothing it carries is read as markup. */
function resultRow(kind, name, text) {
    const row = document.createElement('li');
    row.className = kind === 'refused' ? 'ev-row ev-row--refused' : 'ev-row';
    for (const [cls, value] of [['ev-row__state', kind === 'refused' ? 'REFUSED' : 'OK'], ['ev-row__name', name], ['ev-row__text', text]]) {
        const span = document.createElement('span');
        span.className = cls;
        span.textContent = value;
        row.append(span);
    }
    return row;
}

function renderResult(result) {
    const rows = [];
    for (const step of result.applied) {
        const [name, ...rest] = String(step).split(': ');
        rows.push(resultRow('ok', name, rest.join(': ') || 'accepted'));
    }
    for (const r of result.refused) {
        rows.push(resultRow('refused', r.step, r.reason));
    }
    resultRows.replaceChildren(...rows);
    resultCount.textContent =
        `${result.applied.length} accepted · ${result.refused.length} refused`;
    $('result-view').href = `../v/?v=${result.vinHex}`;
    // The run is finished, so the vehicle now has somewhere to point at.
    // This is the artefact that leaves the screen: it goes on the car.
    resultSection.querySelector('.qr-panel')?.remove();
    linksBar.after(qrPanel(result.vinHex, { role: 'intake' }));
    resultSection.hidden = false;
    resultSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------------------------------------------------------------- chain

// The same intake, aimed at the real chain instead of this process. The
// toggle only offers itself when the server actually has chain runs enabled
// and a run left today, so switching it on cannot fail on click. Which chain
// comes from the server's status; networks.mjs names it.
const ppWrap = $('ppwrap');
const ppBox = $('ppbox');
const ppNote = $('ppnote');
const ppLabel = $('pplabel');
const ppRun = $('pprun');
let toChain = false;
let ppReady = false;
let chainNet = networkOf();

// The box is disabled until the server offers a run, so it cannot be
// switched on to fail. Its look, checked or disabled, lives in vp.css.
const paintChainToggle = () => {
    ppBox.disabled = !ppReady;
    if (!ppReady) toChain = false;
    ppBox.checked = toChain;
    registerBtn.textContent = toChain ? `Register and prove on ${chainNet.label}` : 'Register and prove';
};
ppBox.addEventListener('change', () => {
    toChain = ppReady && ppBox.checked;
    paintChainToggle();
});

(async () => {
    let status = null;
    try {
        const { apiBase: resolveBase, getStatus } = await import('../assets/chain-run.mjs?v=7');
        status = await getStatus(await resolveBase());
    } catch (e) {
        // Not answering is not the same as not offered: the engine restores a
        // large wallet before it can reply.
        status = e?.unreachable ? 'unreachable' : null;
    }

    if (status?.network) chainNet = networkOf(status.network);
    if (ppLabel) ppLabel.textContent = `Submit to ${chainNet.name}`;
    ppReady = Boolean(status?.enabled && status?.ready && !status?.error && status.remaining > 0);
    if (ppReady) {
        ppNote.textContent = `${status.remaining} of ${status.capacity} runs on ${chainNet.name} left today. Switch this on and the fields below become real transactions on the deployed contract, with every fee paid by us, ending in a receipt only you can open. The VIN is replaced with a generated demo one, so a real vehicle is never claimed on a test chain.`;
    } else if (status?.enabled && !status?.ready) {
        ppNote.textContent = 'Our signing service is catching up to the chain tip. Until it is level, the circuits below still run here.';
    } else if (status?.enabled && status?.remaining <= 0) {
        ppNote.textContent = "Today's chain runs are used; the count resets at 00:00 UTC. The circuits below still run here.";
    } else if (status === 'unreachable') {
        ppNote.textContent = 'The chain engine is not answering right now: it blocks while our signing service starts up, and again while it generates a proof for someone else. Reload shortly to submit to the chain. The circuits below run here either way.';
    } else {
        ppNote.textContent = 'Chain submission is not available from this server. The circuits below still run here, against an in-process ledger.';
    }
    paintChainToggle();
})();

/**
 * Register without a server: the compiled circuits, in this page.
 *
 * The engine is imported here and not at the top of the module, so the
 * 1.4 MB of runtime wasm is fetched only when somebody actually registers.
 * A visitor who reads the page and leaves never downloads it.
 *
 * The result is MERGED onto whatever this tab already held, so a second
 * vehicle joins the first and both sit alongside the demo ones.
 */
async function registerInThisBrowser() {
    const engine = await import('../assets/intake-engine/intake-engine.js');
    const { saveLocalLedger, loadLocalLedger } = await import('../assets/local-ledger.mjs');
    const out = await engine.registerLocally(buildIntake());

    const held = loadLocalLedger();
    const base = held?.ledger
        ?? await fetch('../verify/demo-data.json', { cache: 'no-store' }).then((r) => r.json());
    const vehicles = [
        ...(held?.vehicles ?? []).filter((v) => v.vinHash !== out.vinHex),
        { vinHash: out.vinHex, title: String($('dl').value.trim() || 'Added here').slice(0, 60) }
    ];
    /* A storage failure is reported, never swallowed. Silently losing the
       record means the visitor sees every step succeed and then finds
       nothing on the scan page, with no idea which half went wrong. */
    if (!saveLocalLedger(engine.mergeLedgers(base, out.ledger), { vehicles })) {
        throw new Error(
            'the registration ran, but this browser would not store it, so the scan page '
            + 'will not see it. Private windows and blocked site data both do this.');
    }
    return out;
}

registerBtn.addEventListener('click', async () => {
    registerBtn.disabled = true;
    const was = registerBtn.textContent;
    registerBtn.textContent = toChain ? 'Submitting…' : 'Proving…';
    try {
        if (!serverMode) {
            renderResult(await registerInThisBrowser());
        } else if (toChain) {
            const { startManual, followJob } = await import('../assets/chain-run.mjs?v=7');
            const started = await startManual(apiBase, buildIntake());
            registerBtn.textContent = `Running on ${chainNet.label}…`;
            ppRun.scrollIntoView({ behavior: 'smooth', block: 'start' });
            await followJob(apiBase, started.jobId, ppRun);
        } else {
            const r = await fetch(`${apiBase}/api/intake`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(buildIntake())
            });
            const result = await r.json();
            if (!r.ok) throw new Error(result.error ?? `server said ${r.status}`);
            renderResult(result);
        }
    } catch (e) {
        alert(`Could not submit: ${e.message}`);
    } finally {
        registerBtn.disabled = false;
        registerBtn.textContent = was;
    }
});

downloadBtn.addEventListener('click', () => {
    const intake = buildIntake();
    const text = JSON.stringify(intake, null, 2);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = `intake-${(intake.vin || 'vehicle').slice(-6).toLowerCase()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
});
