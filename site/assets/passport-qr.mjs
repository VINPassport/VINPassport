/**
 * The code that gets a passport off the screen and onto the car.
 *
 * Regulation (EU) 2024/1257 Article 7(4) requires that passport data be
 * reachable "through a QR code, or any similar method", and the thing a
 * buyer in a car park can actually use is the code. Both ends of the product
 * need one and they need the same one: the registrar prints it, the buyer
 * scans it, and both are looking at the same vehicle.
 *
 * The code carries a link and nothing else. No reading, no salt, no VIN:
 * only the hash that already sits on the chain. Anyone who photographs the
 * sticker learns exactly what anyone reading the ledger already knows.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { toSvg } from './qr.mjs?v=1';

/** The absolute link a code for this vehicle should carry. */
export function passportUrl(vinHash, origin = location.origin) {
    if (!/^[0-9a-f]{64}$/i.test(vinHash)) throw new Error('a vin hash is 64 hex characters');
    return `${origin}/verify/?v=${vinHash.toLowerCase()}`;
}

const BTN = "display:inline-flex;align-items:center;justify-content:center;text-align:center;"
    + "line-height:1.2;min-height:40px;font-family:'Barlow Condensed',sans-serif;font-weight:600;"
    + "font-size:14px;letter-spacing:.06em;cursor:pointer;padding:9px 16px";

/**
 * Build the panel. `role` decides only the wording: a registrar is being
 * told to put this somewhere, a buyer is being told they can keep it.
 */
export function qrPanel(vinHash, { role = 'verify', origin = location.origin } = {}) {
    const url = passportUrl(vinHash, origin);
    const svg = toSvg(url, { scale: 4, quiet: 4, dark: '#0E1726', light: '#ffffff' });

    const forRegistrar = role === 'intake';
    const heading = forRegistrar ? 'THE CODE FOR THIS VEHICLE' : 'TAKE THIS PASSPORT WITH YOU';
    const lead = forRegistrar
        ? 'Print it and put it on the vehicle, the windscreen, or the listing. Scanning it opens '
          + 'this passport. The code carries a link and the vehicle hash, which is already public '
          + 'on the ledger: no reading and no VIN travels with it.'
        : 'Scan or save this to come back to the same passport, or to hand it to someone else. '
          + 'It needs no app and no account, and it carries nothing that is not already on the ledger.';

    const wrap = document.createElement('div');
    wrap.className = 'qr-panel';
    wrap.style.cssText = 'margin:18px 0 0;border:1px solid rgba(0,74,173,.26);background:#EDE4D8;'
        + 'padding:16px 18px;display:flex;flex-wrap:wrap;gap:18px 22px;align-items:flex-start';
    wrap.innerHTML = `
      <div style="flex:none;background:#fff;padding:8px;border:1px solid rgba(0,74,173,.18);line-height:0">${svg}</div>
      <div style="flex:1 1 260px;min-width:0">
        <b style="display:block;font-family:'Barlow Condensed',sans-serif;font-weight:600;font-size:15px;letter-spacing:.06em;color:#0E1726">${heading}</b>
        <p style="margin:8px 0 0;font-size:13.5px;line-height:1.6;color:rgba(14,23,38,.78)">${lead}</p>
        <p class="mono qr-url" style="margin:11px 0 0;font-size:10.5px;line-height:1.6;color:rgba(14,23,38,.62);word-break:break-all">${url}</p>
        <div style="display:flex;flex-wrap:wrap;gap:9px;margin-top:11px">
          <button type="button" class="qr-copy" style="${BTN};background:#004AAD;color:#EDE4D8;border:1px solid #004AAD">COPY LINK</button>
          <a class="qr-save" download="vinpassport-${vinHash.slice(0, 10)}.svg" style="${BTN};background:transparent;color:#0E1726;border:1px solid rgba(0,74,173,.28);text-decoration:none">DOWNLOAD THE CODE</a>
        </div>
      </div>`;

    const copy = wrap.querySelector('.qr-copy');
    copy.addEventListener('click', async () => {
        const said = (m) => {
            copy.textContent = m;
            setTimeout(() => { copy.textContent = 'COPY LINK'; }, 2400);
        };
        try { await navigator.clipboard.writeText(url); said('COPIED'); }
        catch { said('PRESS AND HOLD TO COPY'); }
    });

    // A blob rather than a data URI: the same file the page is showing, and
    // nothing has to be re-encoded or escaped on the way out.
    const save = wrap.querySelector('.qr-save');
    save.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));

    return wrap;
}
