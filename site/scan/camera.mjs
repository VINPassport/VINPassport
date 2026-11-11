/**
 * Scan with the camera (/scan/): reads a passport's QR code through the browser's own camera and goes
 * where the typed box would.
 *
 * The camera starts only when the visitor presses the button, and the browser asks their permission
 * first. Frames are read in this tab, then dropped: nothing is stored or sent. The browser's own
 * BarcodeDetector reads them where it has one (Chrome and Edge on Android); elsewhere, Safari on an
 * iPhone among them, jsQR does (Apache-2.0, served from this site, fetched on the first press only).
 *
 * What a code says goes through readEntry, the same check as the box, so a code can only ever lead to
 * this site's own verdict page; a code that is not a passport's says so, and the camera keeps looking.
 * The camera stops when it finds one, on Stop, and when the page is hidden or left.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { readEntry } from './scan.mjs';

const JSQR = '../assets/vendor/jsqr/jsQR.js';
const EVERY_MS = 150;  // about seven reads a second: quick to find a code, light on a phone's battery
const START = 'Scan with your camera';

/** What to tell the visitor when the camera does not start, by the browser's error name. */
export function cameraTrouble(name) {
    switch (name) {
        case 'NotAllowedError':
        case 'SecurityError':
            return 'Camera access was not allowed. Allow it for this site in your browser settings and try again, point your phone\'s camera app at the code, or type the code.';
        case 'NotFoundError':
        case 'OverconstrainedError':
            return 'No camera was found on this device. Type the passport code instead.';
        case 'NotReadableError':
            return 'Another app is using the camera. Close it and try again.';
        default:
            return 'The camera could not start. Type the passport code instead.';
    }
}

/** Where a code the camera read should lead: a verdict page of this site, or nowhere. */
export function readScanned(text) {
    const got = readEntry(text);
    return got.href ? { href: got.href } : { error: 'That code is not a VINPassport code. Keep it in the frame, or type the passport code.' };
}

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = src;
        s.onload = resolve;
        s.onerror = () => reject(new Error('the code reader did not load'));
        document.head.append(s);
    });
}

/** A function that returns the text of a QR code in the current frame, or null. */
async function makeReader() {
    if ('BarcodeDetector' in window) {
        try {
            if ((await window.BarcodeDetector.getSupportedFormats()).includes('qr_code')) {
                const detector = new window.BarcodeDetector({ formats: ['qr_code'] });
                return async (video) => (await detector.detect(video))[0]?.rawValue ?? null;
            }
        } catch { /* fall through to jsQR */ }
    }
    if (typeof window.jsQR !== 'function') await loadScript(JSQR);
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    return (video) => {
        const w = video.videoWidth, h = video.videoHeight;
        if (!w || !h) return null;
        const scale = Math.min(1, 720 / Math.max(w, h));
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
        return window.jsQR(img.data, img.width, img.height, { inversionAttempts: 'attemptBoth' })?.data ?? null;
    };
}

function wire(card) {
    const button = card.querySelector('[data-camera-start]');
    const video = card.querySelector('[data-camera-video]');
    const frame = card.querySelector('.scan-frame');
    const status = card.querySelector('[data-camera-status]');
    if (!button || !video || !status) return;
    // No camera interface (an old browser, or a page not served over https): the box and the phone's
    // own camera app still work, so the button simply does not appear.
    if (!navigator.mediaDevices?.getUserMedia) return;
    button.hidden = false;

    const restLabel = frame?.getAttribute('aria-label') ?? '';
    let stream = null, timer = 0, read = null, lastMiss = '';
    const say = (text) => { status.textContent = text; };

    const stop = () => {
        clearTimeout(timer);
        timer = 0;
        if (stream) for (const track of stream.getTracks()) track.stop();
        stream = null;
        video.srcObject = null;
        card.classList.remove('is-scanning');
        button.textContent = START;
        if (frame) frame.setAttribute('aria-label', restLabel);
    };

    const look = async () => {
        if (!stream) return;
        let text = null;
        try { if (video.readyState >= 2) text = await read(video); } catch { text = null; }
        if (!stream) return;
        if (text) {
            const got = readScanned(text);
            if (got.href) {
                say('Found a passport. Opening it…');
                stop();
                location.href = got.href;
                return;
            }
            if (text !== lastMiss) { lastMiss = text; say(got.error); }
        }
        timer = setTimeout(look, EVERY_MS);
    };

    button.addEventListener('click', async () => {
        if (stream) { stop(); say('Camera stopped.'); return; }
        say('Your browser will ask to use the camera.');
        try {
            stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        } catch (e) {
            stream = null;
            say(cameraTrouble(e?.name));
            return;
        }
        video.muted = true;
        video.setAttribute('playsinline', '');
        video.srcObject = stream;
        try { await video.play(); } catch { /* a muted inline video plays; if not, the frames still arrive */ }
        card.classList.add('is-scanning');
        button.textContent = 'Stop the camera';
        if (frame) frame.setAttribute('aria-label', 'The camera view. Line up the passport code inside the frame.');
        say('Line up the passport code inside the frame.');
        try {
            read ??= await makeReader();
        } catch {
            stop();
            say('The code reader did not load. Type the passport code instead.');
            return;
        }
        look();
    });

    // A camera left running in a background tab is a camera the visitor did not ask for.
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && stream) { stop(); say('The camera stopped while the page was out of view.'); }
    });
    addEventListener('pagehide', stop);
}

if (typeof document !== 'undefined') {
    const card = document.querySelector('[data-camera]');
    if (card) wire(card);
}
