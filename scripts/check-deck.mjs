/**
 * Fail if any deck slide hides content.
 *
 * A slide is `width:1280px; height:720px; overflow:hidden`. Add a paragraph to
 * a full slide and nothing reflows, nothing scrolls and no error appears: the
 * text is simply not on screen. Three slides were shipping that way before
 * this check existed, and a source grep cannot see it, because the markup is
 * perfectly valid. The only way to know is to render it and measure.
 *
 * Two distinct failures are caught:
 *
 *  1. The slide clips. scrollHeight exceeds clientHeight, so content is past
 *     the bottom edge and invisible.
 *  2. Content collides with the footer. The slide-foot is absolutely
 *     positioned at bottom:26px, so a box that grows past it overlaps the
 *     brandline and the page number rather than being cut. It looks like a
 *     design mistake rather than a missing paragraph, which is worse, because
 *     it ships.
 *
 *   npm run check:deck
 *
 * Zero dependencies: Node's global WebSocket and the DevTools protocol. Brave,
 * never Chrome.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize, sep } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DECK = join(ROOT, 'deck');
const PORT = 9454;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const BRAVE = [
    'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    'C:/Program Files (x86)/BraveSoftware/Brave-Browser/Application/brave.exe',
    `${process.env.LOCALAPPDATA}/BraveSoftware/Brave-Browser/Application/brave.exe`,
    '/usr/bin/brave-browser',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
].find((p) => p && existsSync(p));

if (!BRAVE) {
    console.error('Brave was not found, and this does not fall back to Chrome.');
    process.exit(2);
}

const browser = spawn(BRAVE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.env.TEMP ?? '/tmp'}/brave-vinpassport-deck`,
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars',
    '--window-size=1400,900', 'about:blank',
], { stdio: 'ignore' });

/* Served over http, as Pages serves it. Opened as a file the browser refuses the deck's own
   fonts (a file page has no origin to share them with), falls back to a system font, and every
   measurement below is of a deck nobody sees. */
const TYPES = { '.html': 'text/html', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.txt': 'text/plain', '.md': 'text/plain' };
const server = createServer((req, res) => {
    let file = normalize(join(DECK, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    if (file.endsWith(sep)) file = join(file, 'index.html');
    if (!file.startsWith(DECK) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));

const quit = (code) => { browser.kill(); server.close(); process.exit(code); };

let target;
for (let i = 0; i < 80 && !target; i++) {
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
const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text ?? 'evaluation threw');
    return r.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
    width: 1400, height: 900, deviceScaleFactor: 1, mobile: false
});
await send('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/` });
await sleep(3500);

// The deck's fonts come from deck/fonts/. If that path breaks, the deck still renders, in a
// fallback font with different widths, so the slides measured here would not be the slides shown.
// A face loads only once a visible slide uses it, and the slides below are measured one after
// another with no wait, so every face is loaded up front: each slide is measured in its real font.
const FAMILIES = ['Fraunces', 'IBM Plex Sans', 'IBM Plex Mono', 'Barlow Condensed'];
const missing = await evaluate(`Promise.allSettled([...document.fonts].map((f) => f.load()))
    .then(() => ${JSON.stringify(FAMILIES)}.filter((fam) => ![...document.fonts]
        .some((f) => f.family.replace(/['"]/g, '') === fam && f.status === 'loaded')))`);
if (missing.length) {
    console.error(`check:deck FAILED - ${missing.join(', ')} did not load from deck/fonts/, so the deck is in a fallback font.`);
    quit(1);
}
// The logos come from deck/brand/. A broken path leaves an empty box on every slide.
const brokenImages = await evaluate(`Promise.all([...document.images].map((im) => im.decode().catch(() => null)))
    .then(() => [...new Set([...document.images].filter((im) => !im.naturalWidth).map((im) => im.getAttribute('src')))])`);
if (brokenImages.length) {
    console.error(`check:deck FAILED - these images did not load: ${brokenImages.join(', ')}`);
    quit(1);
}

/* Each slide is display:none until it carries `active`, so each has to be
   switched on before anything can be measured. The original classes go back
   afterwards so the deck is left as it was found. */
const report = await evaluate(`(() => {
    const slides = [...document.querySelectorAll('.slide')];
    if (!slides.length) return JSON.stringify({ error: 'no .slide elements found' });
    const was = slides.map((s) => s.className);
    const out = [];
    for (let i = 0; i < slides.length; i++) {
        slides.forEach((s) => s.classList.remove('active'));
        slides[i].classList.add('active');
        const s = slides[i];
        s.getBoundingClientRect();
        const h2 = s.querySelector('h2');
        const label = (h2 ? h2.textContent : '(title slide)').replace(/\\s+/g, ' ').trim().slice(0, 56);
        const issues = [];

        if (s.scrollHeight > s.clientHeight + 1)
            issues.push('slide clips ' + (s.scrollHeight - s.clientHeight) + 'px of content');

        for (const el of s.querySelectorAll('.box, ul')) {
            if (el.scrollHeight > el.clientHeight + 1)
                issues.push((el.className || el.tagName).toString().slice(0, 18)
                    + ' clips ' + (el.scrollHeight - el.clientHeight) + 'px');
        }

        const foot = s.querySelector('.slide-foot');
        const footTop = foot ? foot.getBoundingClientRect().top : s.getBoundingClientRect().bottom;
        for (const el of s.querySelectorAll('.box, .lede, table, svg')) {
            const r = el.getBoundingClientRect();
            if (r.height && r.bottom > footTop - 4)
                issues.push(el.tagName.toLowerCase() + ' overlaps the footer by '
                    + Math.round(r.bottom - footTop + 4) + 'px');
        }
        out.push({ n: i + 1, label, issues });
    }
    slides.forEach((s, i) => { s.className = was[i]; });
    return JSON.stringify({ slides: out });
})()`);

const parsed = JSON.parse(report);
if (parsed.error) { console.error('check:deck -', parsed.error); quit(2); }

let bad = 0;
for (const slide of parsed.slides) {
    if (!slide.issues.length) continue;
    bad++;
    console.error(`  slide ${String(slide.n).padStart(2)}  ${slide.label}`);
    for (const issue of slide.issues) console.error(`            ${issue}`);
}

if (bad) {
    console.error(`\ncheck:deck FAILED - ${bad} of ${parsed.slides.length} slides hide content.`);
    console.error('Trim the copy, or add `dense` to the slide\'s class for about 90px more room.');
    quit(1);
}
console.log(`check:deck: ${parsed.slides.length} slides, none clipped or overlapping`);
quit(0);
