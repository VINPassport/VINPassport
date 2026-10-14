/**
 * Does the explainer actually play?
 *
 * The cuts are not in this repository. They are release assets, served from
 * another host, as `application/octet-stream` whatever they were uploaded as.
 * Nothing about that is visible in the page source, and a `<source>` element
 * that fails is silent: no console error worth reading, just a black box.
 *
 * So this is the check that replaces reading the markup. It loads the page in
 * Brave, waits for metadata, decodes a frame, and seeks to the middle. Run it
 * after replacing a cut, before trusting the page.
 *
 *   node scripts/check-video.mjs                     # against the live site
 *   node scripts/check-video.mjs http://127.0.0.1:5178
 *
 * Zero dependencies: Node's global WebSocket and the DevTools protocol.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const BASE = process.argv[2] ?? 'https://passport.vin';
const PORT = 9444;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Brave, never Chrome: the project's browser checks all run in the browser the
// author actually uses.
const BRAVE = [
    'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    'C:/Program Files (x86)/BraveSoftware/Brave-Browser/Application/brave.exe',
    `${process.env.LOCALAPPDATA}/BraveSoftware/Brave-Browser/Application/brave.exe`,
    '/usr/bin/brave-browser',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
].find((p) => p && existsSync(p));

if (!BRAVE) {
    console.error('Brave was not found, and this check does not fall back to Chrome.');
    process.exit(2);
}

const browser = spawn(BRAVE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.env.TEMP ?? '/tmp'}/brave-vinpassport-video`,
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--window-size=1280,900', 'about:blank',
], { stdio: 'ignore' });

const quit = (code) => { browser.kill(); process.exit(code); };

let target;
for (let i = 0; i < 60 && !target; i++) {
    try {
        const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
        if (r.ok) target = await r.json();
    } catch { await sleep(250); }
}
if (!target) { console.error('Brave did not open a debugging port'); quit(2); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    const p = msg.id && pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    msg.error ? p.rej(new Error(JSON.stringify(msg.error))) : p.res(msg.result);
};
const send = (method, params = {}) => new Promise((res, rej) => {
    const n = ++id;
    pending.set(n, { res, rej });
    ws.send(JSON.stringify({ id: n, method, params }));
});

await send('Page.enable');
await send('Runtime.enable');
await send('Page.navigate', { url: BASE + '/' });
await sleep(3500);

// A real gesture: autoplay policy refuses play() without one, and that refusal
// reads exactly like a video that cannot decode.
for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: 20, y: 400, button: 'left', clickCount: 1 });
}

const probe = async (selector) => {
    const expr = `(${(async (sel) => {
        const v = document.querySelector(sel);
        if (!v) return { missing: true };
        const src = v.querySelector('source')?.src ?? v.src;
        const settle = (name, ms) => new Promise((res) => {
            v.addEventListener(name, () => res('event'), { once: true });
            v.addEventListener('error', () => res('error'), { once: true });
            setTimeout(() => res('timeout'), ms);
        });

        v.load();
        const meta = v.readyState >= 1 ? 'already' : await settle('loadedmetadata', 30000);
        const out = {
            src, meta, readyState: v.readyState,
            duration: Number.isFinite(v.duration) ? Math.round(v.duration * 10) / 10 : null,
            w: v.videoWidth, h: v.videoHeight,
            error: v.error ? `${v.error.code}: ${v.error.message}` : null,
        };
        if (out.readyState < 1) return out;

        try { await v.play(); } catch (e) { out.playThrew = e.message; }
        await new Promise((r) => setTimeout(r, 1200));
        out.playedTo = Math.round(v.currentTime * 100) / 100;
        v.pause();

        out.seekTarget = Math.round(v.duration / 2);
        v.currentTime = out.seekTarget;
        out.seek = await settle('seeked', 20000);
        out.seekLanded = Math.round(v.currentTime * 10) / 10;
        return out;
    }).toString()})(${JSON.stringify(selector)})`;
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'page threw');
    return r.result.value;
};

let failures = 0;
for (const sel of ['video.vid-desktop', 'video.vid-mobile']) {
    const r = await probe(sel);
    if (r.missing) { console.log(`MISSING  ${sel}`); failures++; continue; }

    const ok = r.readyState >= 1 && r.w > 0 && !r.error && r.playedTo > 0
        && r.seek === 'event' && Math.abs(r.seekLanded - r.seekTarget) < 2;
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'BAD '} ${sel}`);
    console.log(`     ${r.src}`);
    console.log(r.readyState < 1
        // Nothing decoded, so every later field is undefined and printing them
        // buries the one fact that matters.
        ? `     no metadata after ${r.meta}, readyState ${r.readyState}`
            + (r.error ? `, ${r.error}` : ', and the element reported no error')
        : `     ${r.w}x${r.h}, ${r.duration}s, played to ${r.playedTo}s, `
            + `seek ${r.seekTarget}s -> ${r.seekLanded}s (${r.seek})`
            + (r.error ? `, ERROR ${r.error}` : ''));
}

console.log(failures
    ? `\n${failures} video(s) did not play from ${BASE}`
    : `\nboth cuts play and seek from ${BASE}`);
quit(failures ? 1 : 0);
