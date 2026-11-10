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
import { passportCode } from './passport-code.mjs';

/** The absolute link a code for this vehicle should carry. */
export function passportUrl(vinHash, origin = location.origin) {
    if (!/^[0-9a-f]{64}$/i.test(vinHash)) throw new Error('a vin hash is 64 hex characters');
    return `${origin}/v/?v=${vinHash.toLowerCase()}`;
}

/**
 * Build the panel. `role` decides only the wording: a registrar is being
 * told to put this somewhere, a buyer is being told they can keep it. The
 * typed passport code sits under the QR, as printed on a sticker (fix C4).
 */
export function qrPanel(vinHash, { role = 'verify', origin = location.origin } = {}) {
    const url = passportUrl(vinHash, origin);
    const code = passportCode(vinHash);
    const svg = toSvg(url, { scale: 4, quiet: 4, dark: '#0f1c35', light: '#ffffff' });

    const forRegistrar = role === 'intake';
    const heading = forRegistrar ? 'The code for this vehicle' : 'Take this passport with you';
    const lead = forRegistrar
        ? 'Print it and put it on the vehicle, the windscreen, or the listing. Scanning it opens '
          + 'this passport, and the code under it can be typed on the Scan page. It carries a link '
          + 'and the vehicle key, which is already public on the ledger: no reading and no VIN travels with it.'
        : 'Scan or save this to come back to the same passport, or to hand it to someone else. '
          + 'It needs no app and no account, and it carries nothing that is not already on the ledger.';

    const wrap = document.createElement('div');
    wrap.className = 'ev-qr qr-panel';
    wrap.innerHTML = `
      <div class="ev-qr__code">${svg}</div>
      <div class="ev-qr__text">
        <div class="vp-label">${heading}</div>
        <p class="vp-code">${code}</p>
        <p class="ev-copy">${lead}</p>
        <p class="ev-qr__url">${url}</p>
        <div class="ev-actions">
          <button type="button" class="vp-btn vp-btn--primary qr-copy">Copy link</button>
          <a class="vp-btn vp-btn--secondary qr-save" download="vinpassport-${code}.svg">Download the code</a>
        </div>
        <p class="ev-note qr-said" aria-live="polite"></p>
      </div>`;

    const copy = wrap.querySelector('.qr-copy');
    const said = wrap.querySelector('.qr-said');
    copy.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText(url);
            copy.textContent = 'Link copied';
            said.textContent = 'The link is on your clipboard.';
        } catch {
            said.textContent = 'Your browser would not copy it: press and hold the link above to copy it.';
        }
        setTimeout(() => { copy.textContent = 'Copy link'; }, 2400);
    });

    // A blob rather than a data URI: the same file the page is showing, and
    // nothing has to be re-encoded or escaped on the way out.
    const save = wrap.querySelector('.qr-save');
    save.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));

    return wrap;
}
