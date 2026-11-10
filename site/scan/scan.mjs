/**
 * Scan a vehicle (/scan/): what someone typed, turned into the verdict's address.
 *
 * A passport code (VP-7K2Q-91XD) goes to /v/?c=, which resolves it against the
 * ledger's public keys. A VIN, a vehicle key or a pasted link goes to /v/?v=
 * with the key only: a VIN is turned into its key here and never travels in
 * the address. Whether a passport exists is the verdict page's answer, not
 * this one's: this only decides what was asked for.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { parseCode } from '../assets/passport-code.mjs';
import { parseEntry, HASH_RE } from '../assets/vin.mjs';

const NEITHER = 'That is neither a passport code nor a VIN. A passport code starts with VP and is printed under the QR code; a VIN is the seventeen characters on the windscreen plate.';

/**
 * @param {string} typed
 * @returns {{href: string} | {error: string}}
 */
export function readEntry(typed) {
    const raw = String(typed ?? '').trim();
    const flat = raw.toUpperCase().replace(/[\s\-_.]/g, '');
    if (!flat) return { error: parseCode('').error };

    // A link we handed out, pasted whole.
    const inCode = raw.match(/[?&]c=([^&#\s]+)/i);
    if (inCode) {
        const code = parseCode(decodeURIComponent(inCode[1]));
        return code.error ? { error: code.error } : { href: `../v/?c=${encodeURIComponent(code.code)}` };
    }
    if (/[?&]v=[0-9a-f]{64}/i.test(raw) || HASH_RE.test(flat.toLowerCase()) || flat.length === 17) {
        const entry = parseEntry(raw);
        return entry.error ? { error: entry.error } : { href: `../v/?v=${entry.key}` };
    }

    const code = parseCode(raw);
    if (!code.error) return { href: `../v/?c=${encodeURIComponent(code.code)}` };
    // Close enough to a code to say what is wrong with it as a code.
    const body = flat.startsWith('VP') ? flat.slice(2) : flat;
    if (flat.startsWith('VP') || (body.length >= 7 && body.length <= 10)) return { error: code.error };
    return { error: NEITHER };
}

if (typeof document !== 'undefined') {
    const form = document.querySelector('[data-scan-form]');
    if (form) {
        const input = form.querySelector('#code');
        const err = form.querySelector('#code-err');
        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const got = readEntry(input.value);
            if (got.error) {
                err.textContent = got.error;
                err.hidden = false;
                input.setAttribute('aria-invalid', 'true');
                input.focus();
                return;
            }
            location.href = got.href;
        });
        input.addEventListener('input', () => {
            err.hidden = true;
            input.removeAttribute('aria-invalid');
        });
    }
}
