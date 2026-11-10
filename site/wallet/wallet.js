// The wallet page (build plan 2.6). Lists the visitor's Midnight wallets
// without loading anything heavy; loads the wallet engine (about 13 MB of
// runtime, site/assets/wallet-engine/) only once a wallet is chosen.
//
// Element ids the redesign must keep: walletstatus, walletlist, vehiclekey,
// askbtn, result. Everything shown comes from config.json (generated from the
// deploy record by scripts/build-wallet-engine.mjs) or from the chain.
import { waitForWallets } from '../assets/wallet-detect.mjs';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const say = (id, html) => { $(id).innerHTML = html; };

const config = await (await fetch('config.json', { cache: 'no-cache' })).json();
$('vehiclekey').value = config.sampleVehicleKey ?? '';
let engine = null;
let providers = null;

/** Words a visitor can act on, for the failures a wallet call can meet. */
function explain(e) {
    const msgs = [];
    const codes = [];
    for (let c = e, d = 0; c && d < 6; c = c.cause, d += 1) { msgs.push(String(c.message ?? c)); if (c.code) codes.push(String(c.code)); }
    // "Declined" only on the wallet's own signals: Midnight.js says "proveTx
    // rejected the transaction" for any proving failure, which is not a no.
    const all = msgs.join(' | ').replace(/\b(proveTx|balanceTx|submitTx) rejected the transaction/g, '');
    if (codes.some((c) => /^(Rejected|PermissionRejected)$/.test(c))) msgs.unshift('the wallet said no');
    // The words first, then what actually failed: a guess with no evidence
    // under it sends a visitor to fix the wrong thing.
    const detail = `<br><small>${esc(msgs.join(' ← '))}</small>`;
    if (codes.some((c) => /^(Rejected|PermissionRejected)$/.test(c)) || /user (rejected|denied|cancell?ed)|rejected by (the )?user|request (was )?(rejected|denied|cancell?ed)/i.test(all)) {
        return 'The wallet declined the request. Nothing was sent.' + detail;
    }
    if (/insufficient|could not balance|not enough/i.test(all)) return 'The wallet could not pay the fee: it needs DUST on Preview. DUST builds up from registered NIGHT.' + detail;
    if (/:6300|proof server/i.test(all)) return 'The wallet asked for a local proof server and none answered. Lace proves through one on your machine; 1AM proves in the page.' + detail;
    if (/network/i.test(all) && /preview/i.test(all)) return 'The wallet is on another network. Switch it to Preview and try again.' + detail;
    return 'The call did not go through.' + detail;
}

async function choose(entry) {
    say('walletstatus', `Connecting to <b>${esc(entry.name)}</b>… your wallet may ask you to approve this page.`);
    try {
        engine ??= await import('../assets/wallet-engine/wallet-engine.js');
        const conn = await engine.connectWallet(entry, config.network);
        providers = await engine.walletProviders(conn.api, {
            networkId: config.network,
            zkBase: new URL('../zk/vinpassport', location.href).href,
            expectedManifestHash: config.manifestSha256
        });
        say('walletstatus', `Connected to <b>${esc(entry.name)}</b> on ${esc(config.network)}. `
            + (conn.provesItself ? 'It proves the call itself.' : 'It will prove through the proof server it names.'));
        $('askbtn').disabled = false;
    } catch (e) {
        say('walletstatus', explain(e));
    }
}

async function ask() {
    const key = $('vehiclekey').value.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(key)) { say('result', 'A vehicle key is 64 hex characters.'); return; }
    $('askbtn').disabled = true;
    say('result', 'Proving the call and handing it to your wallet. Approve it there; it then pays and submits. This takes about a minute.');
    try {
        const r = await engine.askOnChain(providers, { contractAddress: config.contractAddress, circuitId: 'isRegistered', vehicleKey: key });
        const fee = r.fees?.paidFees ? `${(Number(r.fees.paidFees) / 1e15).toFixed(3)} DUST` : 'paid by your wallet';
        say('result', `<b>${r.answer ? 'Yes: this vehicle is registered.' : 'No: no passport is registered under this key.'}</b><br>`
            + `Accepted by the chain in block ${esc(r.blockHeight)}, fee ${esc(fee)}.<br>`
            + `Transaction <code>${esc(r.txHash)}</code>`);
    } catch (e) {
        say('result', explain(e));
    } finally {
        $('askbtn').disabled = false;
    }
}

$('askbtn').addEventListener('click', ask);

const wallets = await waitForWallets(window);
if (!wallets.length) {
    say('walletstatus', 'No Midnight wallet found on this page. Install 1AM or Lace, set it to Preview, and reload.');
} else {
    say('walletstatus', 'Choose a wallet:');
    for (const w of wallets) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = w.name;
        b.className = 'vp-btn vp-btn--secondary';
        b.addEventListener('click', () => choose(w));
        $('walletlist').appendChild(b);
    }
}
