/**
 * Guided demo wiring.
 *
 * The page is honest about all four states it can be in: no server answering,
 * a wallet still catching up, today's runs spent, or ready. Each one says what
 * it is and what would change it, and the button reflects it rather than
 * failing on click.
 *
 * A run in flight survives a reload: the job id goes in the URL, so the
 * follower picks the same run back up instead of starting a second one.
 *
 * Which chain the page talks about comes from the server's status, or from
 * the recording when no server answers; networks.mjs supplies that chain's
 * explorer and indexer. Nothing below names a network itself.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { apiBase, getStatus, startGuided, followJob, capacityLine } from '../assets/chain-run.mjs?v=6';
import { networkOf, explorerUrl, indexerCurlLines } from '../assets/networks.mjs?v=1';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/**
 * Point the page's fixed parts at one network: the eyebrow, the line about
 * where transactions go, the indexer query and the explorer sentence. Called
 * with the server's network, or the recording's when nothing answered.
 */
function paintNetwork(net, address, mode) {
    const eyebrow = $('eyebrow');
    if (eyebrow) eyebrow.textContent = `${net.name}, ${mode}`;
    const node = $('nodename');
    if (node) node.textContent = `a ${net.label} node`;
    const curl = $('curl');
    if (curl && net.indexer) {
        curl.innerHTML = indexerCurlLines(net, address ?? '…').map(esc).join(' \\<br>&nbsp;&nbsp;');
    }
    const note = $('explorernote');
    if (!note) return;
    const contract = explorerUrl(net, 'contracts', address);
    note.innerHTML = contract
        ? `Or read it in a browser: every transaction hash in the run above links to <a href="${esc(contract)}" target="_blank" rel="noopener noreferrer" style="color:#004AAD">the ${esc(net.label)} explorer</a>. The curl above stays the primary answer, because an explorer is somebody else's website, and checking our work should not depend on one staying up.`
        : `No block explorer follows ${esc(net.name)} at the moment, so the hashes above are printed rather than linked, and the curl is the way to check them. It needs nothing from us: no account, no key, no project id.`;
}
const goBtn = $('go');
const goNote = $('gonote');
const runHost = $('run');
const capDot = $('capdot');
const capState = $('capstate');
const capLine = $('capline');

let base = null;
let busy = false;

const disable = (why) => {
    goBtn.disabled = true;
    goBtn.style.opacity = '.45';
    goBtn.style.cursor = 'not-allowed';
    goBtn.title = why;
};
const enable = () => {
    goBtn.disabled = false;
    goBtn.style.opacity = '';
    goBtn.style.cursor = 'pointer';
    goBtn.title = '';
};

function paintStatus(status) {
    // `unreachable` means the engine is there but not answering yet - it
    // restores a large wallet on start. That is a different thing from the
    // feature being off, and the page must not confuse the two.
    if (status?.unreachable) {
        capDot.style.background = '#8B95FF';
        capState.textContent = 'Chain engine busy';
        capLine.textContent = 'Not answering right now: it blocks while it restores its wallet, and again while it generates a proof. This page enables itself once it replies.';
        if (!busy) {
            disable('The chain engine is not answering yet.');
            goNote.textContent = 'checking again every 20 seconds';
        }
        return;
    }
    capLine.textContent = capacityLine(status);
    const ready = status?.enabled && status?.ready && !status?.error;
    // The wallet starts when a run starts, so an idle engine is usable: the
    // run's first step is the wallet catching up, and the page says so.
    const idle = status?.enabled && !status?.ready && !status?.error
        && status?.walletRunning === false;
    const live = ready || idle;
    const spent = live && status.remaining <= 0;
    // The daily cap is not the only thing that can stop a run. Starting one
    // with an empty wallet spends a slot to fail at the first fee, so treat
    // no dust exactly like no runs left.
    const broke = ready && status.funds?.dust != null && BigInt(status.funds.dust) === 0n;
    capDot.style.background = live && !spent && !broke ? '#004AAD' : '#8B95FF';
    const net = networkOf(status?.network);
    capState.textContent = !status?.enabled ? 'Chain runs are off here'
        : status.error ? 'Chain runs unavailable'
            : idle ? 'Ready to run'
                : !status.ready ? 'Wallet syncing'
                : broke ? 'Out of dust'
                    : spent ? "Today's runs are used"
                        : `Connected to ${net.name}`;
    // The query and the explorer sentence name THIS contract, so "check it
    // yourself" lands on our contract's calls, not on a front page.
    if (status?.contractAddress && status?.network) paintNetwork(net, status.contractAddress, 'live');

    if (busy) return;
    if (!live) {
        disable(!status?.enabled
            ? 'This server does not run chain demos.'
            : status.error ? status.error
                : 'The signing wallet is still catching up to the chain tip.');
        goNote.textContent = status?.enabled && !status.ready
            ? 'the wallet is catching up; this page will enable itself'
            : 'the manual console still runs the circuits locally';
    } else if (broke) {
        disable('The signing wallet has no dust, so a run cannot pay its first fee.');
        goNote.textContent = 'the wallet needs dust before a run can start';
    } else if (spent) {
        disable('Today\'s runs are used. The counter resets at 00:00 UTC.');
        goNote.textContent = 'the counter resets at 00:00 UTC';
    } else {
        enable();
        goNote.textContent = idle
            ? `${status.remaining} left today · the wallet starts with your run, so step one takes a few minutes`
            : `${status.remaining} left today · a run writes permanent public state`;
    }
}

let lastStatus = null;
async function refreshStatus() {
    try { lastStatus = await getStatus(base); }
    catch (e) { lastStatus = e.unreachable ? { unreachable: true } : { enabled: false }; }
    paintStatus(lastStatus);
    return lastStatus;
}

/** Keep checking while the engine is warming, so the page heals itself. */
function watchUntilReady() {
    setInterval(async () => {
        if (busy) return;
        const s = lastStatus;
        // An idle engine is a resting state, not a pending one: polling it
        // forever is exactly the background cost this page should not add.
        if (s?.unreachable || (s?.enabled && !s?.ready && s?.walletRunning !== false)) await refreshStatus();
    }, 20000);
}

async function follow(jobId) {
    busy = true;
    disable('A run is already in flight.');
    goBtn.textContent = 'RUNNING…';
    goNote.textContent = 'leave this page open; the run continues on the server either way';
    try {
        await followJob(base, jobId, runHost);
    } catch { /* followJob already explained itself in the panel */ }
    finally {
        busy = false;
        goBtn.textContent = 'RUN THE GUIDED DEMO';
        await refreshStatus();
    }
}

goBtn.addEventListener('click', async () => {
    if (busy || goBtn.disabled) return;
    busy = true;
    disable('Starting…');
    goBtn.textContent = 'STARTING…';
    let started;
    try {
        started = await startGuided(base);
    } catch (e) {
        busy = false;
        runHost.innerHTML = `<section style="border:1px solid #8B95FF;background:rgba(139,149,255,.16);padding:13px 15px">
          <b style="font-size:14px">The run did not start.</b>
          <p style="margin:5px 0 0;font-size:13px;line-height:1.55;color:rgba(14,23,38,.85)">${e.message}</p>
        </section>`;
        goBtn.textContent = 'RUN THE GUIDED DEMO';
        await refreshStatus();
        return;
    }
    // Put the run in the URL so a reload rejoins it instead of starting another.
    const url = new URL(location.href);
    url.searchParams.set('job', started.jobId);
    history.replaceState(null, '', url);
    busy = false;
    await follow(started.jobId);
});


/**
 * No server answering does not have to mean nothing to show. Guided runs
 * really happened, on Preview (ledger 9) and earlier on preprod (ledger 8);
 * render one from its public half, labelled as a recording so nobody mistakes
 * it for a live one. Everything in the file is already on the chain, which is
 * also the point: it is all a stranger can see.
 *
 * `?recorded=preprod` shows the older one. Each recording names its network,
 * and the page takes its links and its indexer query from that.
 */
const RECORDINGS = { preview: 'recorded-run.preview.json', preprod: 'recorded-run.preprod.json' };
const askedRecording = new URLSearchParams(location.search).get('recorded');
const recordingName = askedRecording in RECORDINGS ? askedRecording : 'preview';

/** The refused step's own label, falling back to its identifier. */
function refusedLabel(run) {
    const step = run.refused[0].step.replace(/^prove /, '');
    const match = run.claims.find((c) => c.claim === step);
    return match?.label ?? step;
}

async function showRecordedRun() {
    if (!runHost || runHost.childElementCount) return null;
    let run;
    try {
        const r = await fetch(RECORDINGS[recordingName], { cache: 'no-store' });
        if (!r.ok) return null;
        run = await r.json();
    } catch { return null; }

    const net = networkOf(run.network);
    const when = new Date(run.finishedAt).toLocaleDateString('en-GB',
        { day: 'numeric', month: 'long', year: 'numeric' });
    const short = (h) => esc(h.slice(0, 10)) + '…' + esc(h.slice(-6));

    // With an explorer the hash is shortened and the row links to it; without
    // one the full hash is printed, because then it is what a reader checks.
    const stages = run.stages.map((s) => `
      <div style="display:grid;grid-template-columns:28px 1fr;gap:10px;padding:11px 0;border-top:1px solid rgba(0,74,173,.16)">
        <span class="mono" style="font-size:11px;color:rgba(14,23,38,.62);padding-top:2px">${esc(String(s.stage).padStart(2, '0'))}</span>
        <div style="min-width:0">
          <b style="display:block;font-size:13px;color:#0E1726">${esc(s.label)}</b>
          <span class="mono" style="display:block;margin-top:4px;font-size:10.5px;color:rgba(14,23,38,.62);overflow-wrap:anywhere">block ${esc(s.blockHeight)} &middot; tx ${s.explorer ? short(s.txHash) : esc(s.txHash)}</span>
          ${s.explorer ? `<a href="${esc(s.explorer)}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-top:5px;font-size:12px;color:#004AAD">open in the ${esc(net.label)} explorer &rarr;</a>` : ''}
        </div>
      </div>`).join('');

    const claims = run.claims.map((c) => {
        const refused = /refused/i.test(c.outcome);
        return `<li style="margin:0 0 5px;font-size:13px;color:rgba(14,23,38,.78)">
          <b style="color:#0E1726">${esc(c.label)}</b>: ${refused ? '<span style="color:#8B4A2B">' : '<span>'}${esc(c.outcome)}</span></li>`;
    }).join('');

    const otherName = Object.keys(RECORDINGS).find((n) => n !== recordingName);
    const other = networkOf(otherName);
    const otherLink = `<a href="?recorded=${esc(otherName)}" style="color:#004AAD">the ${esc(other.ledger)} run on ${esc(other.name)}</a>`;

    runHost.innerHTML = `
    <section style="margin:26px 0 0;border:1px solid rgba(0,74,173,.3);background:#EDE4D8;padding:17px 19px">
      <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:baseline;justify-content:space-between">
        <b style="font-family:'Barlow Condensed',sans-serif;font-weight:600;letter-spacing:.06em;font-size:15px;color:#0E1726">A RUN THAT ALREADY HAPPENED</b>
        <span style="font-size:12px;color:rgba(14,23,38,.62)">recorded ${esc(when)} on ${esc(net.name)}${net.ledger ? ` (${esc(net.ledger)})` : ''}, not live</span>
      </div>
      <p style="margin:9px 0 0;font-size:13px;line-height:1.55;color:rgba(14,23,38,.78)">
        No circuit server is answering, so you cannot start a run from this page today. This one
        was real: ${run.stages.length} transactions, proven and submitted to ${esc(net.name)}, in blocks
        ${esc(run.stages[0].blockHeight)} to ${esc(run.stages[run.stages.length - 1].blockHeight)}. Every hash below is
        on the public chain and you can check any of them without us. Also recorded: ${otherLink}.
      </p>
      <div style="margin:13px 0 0">${stages}</div>
      <div style="margin:15px 0 0;padding-top:13px;border-top:1px solid rgba(0,74,173,.16)">
        <b style="display:block;font-size:13px;color:#0E1726;margin-bottom:6px">What the run claimed</b>
        <ul style="margin:0;padding-left:17px">${claims}</ul>
        ${run.refused.length ? `<p style="margin:9px 0 0;font-size:12.5px;line-height:1.5;color:rgba(14,23,38,.62)">
          The refusal is the part worth watching, and the one part you cannot look up: the
          circuit would not produce the claim &quot;${esc(refusedLabel(run))}&quot;, because the
          record did not support it. A refused claim writes nothing, which is why
          ${run.claims.length - run.refused.length} proof calls reached the chain and not
          ${run.claims.length}. No server decided that; the arithmetic did.</p>` : ''}
      </div>
      <p class="mono" style="margin:14px 0 0;font-size:10.5px;line-height:1.6;color:rgba(14,23,38,.62);word-break:break-all">
        contract ${esc(run.contractAddress)}<br>vin hash ${esc(run.vinHash)}
      </p>
    </section>`;
    paintNetwork(net, run.contractAddress, 'recorded');
    return run;
}

(async () => {
    try { base = await apiBase(); }
    catch {
        paintStatus({ enabled: false });
        /* Three things were wrong here and all three told the visitor
           something untrue.

           "Runs are off here" describes a server that answered and said
           demos are switched off. Nothing answered at all, which is a
           different fact with a different remedy.

           "The manual console still runs the real circuits" was simply false
           on this host. /intake/ needs the same circuit server, and with none
           answering it correctly disables its own button. Sending someone
           there promised a second thing that does not work either.

           And the lede above still said "press the button and this site
           registers a vehicle passport", with no working button on the page.

           Naming a host ages badly, so say what is missing, what still works
           here, and how to run it yourself. */
        capState.textContent = 'No circuit server here';
        capLine.textContent = 'this static site has no backend, so no run can start from it';
        // paintStatus sets this to "the manual console still runs the
        // circuits locally", which is true when a server answered and said
        // chain runs are off, and false when nothing answered: /intake/ needs
        // the same server and disables itself without it.
        goNote.textContent = 'the console needs the same server, so it cannot run here either';
        const run = await showRecordedRun();
        const net = networkOf(run?.network);
        const lede = $('lede');
        if (lede) {
            lede.textContent = 'The guided run needs a circuit server, and this static site has '
                + 'none, so nothing here can start a run today. What follows is a real run that '
                + `already happened on the deployed ${net.name} contract: real proofs, real fees, and `
                + 'blocks you can look up yourself. Clone the repository and start it with '
                + 'npm run app to drive the same compiled circuits on your own machine. '
                + `Putting a passport on ${net.name} as well needs a funded wallet, which is `
                + 'the part a static site cannot hold.';
        }
        return;
    }
    const status = await refreshStatus();
    if (!status?.enabled || status.error) await showRecordedRun();
    watchUntilReady();
    const existing = new URLSearchParams(location.search).get('job');
    if (existing) await follow(existing);
})();
