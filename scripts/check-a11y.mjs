/**
 * Use every page the way a keyboard user, a phone user and a reader who
 * turned motion off would, and fail on what they would hit.
 *
 * Source checks cannot see any of this: a focus ring removed by a later rule,
 * a link that is 14 px tall on a phone, a stamp whose landing animation
 * widens the page for a third of a second, a Tab order that skips a button.
 * Each was found here, by driving the rendered pages in a browser.
 *
 * For every page the header and footer are written into (scripts/build-nav.mjs):
 *
 *   overflow     no horizontal page scroll at 320, 360, 390, 414, 768, 1024,
 *                1280, 1440 and 1920 px, at rest or while the page settles
 *   header       at each of those widths the bar is one row (no link in it breaks
 *                onto a second line), and from 1,200 px it stays at the top as
 *                the page scrolls
 *   keyboard     at 390 and 1440 px, real Tab presses from the top reach every
 *                visible control, each shows a focus ring (WCAG 2.2 2.4.7) and
 *                none is hidden under the sticky header (2.4.11); the first
 *                stop is the skip link, and it lands in <main>
 *   targets      at 390 px no control is smaller than 24 x 24 px, apart from a
 *                link inside a sentence (2.5.8)
 *   structure    one h1, headings in order, header/nav/main/footer, every image
 *                loads and has alt text, every svg is hidden or named
 *   motion       with prefers-reduced-motion: reduce, nothing is animating
 *   exceptions   no page throws
 *
 *   npm run check:a11y
 *   npm run check:a11y -- --base https://passport.vin   (the live site)
 *   npm run check:a11y -- --only scan/index.html          (one page)
 *
 * Zero dependencies: node:http, Node's global WebSocket, the DevTools
 * protocol. Brave, never Chrome.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, normalize } from 'node:path';
import { PAGES } from './build-nav.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const PORT = 9470;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const argv = process.argv.slice(2);
const EXTERNAL = argv.includes('--base') ? argv[argv.indexOf('--base') + 1].replace(/\/$/, '') : null;
const ONLY = argv.includes('--only') ? argv[argv.indexOf('--only') + 1] : null;
const CHECKED = ONLY ? PAGES.filter((p) => p.file === ONLY) : PAGES;
if (!CHECKED.length) { console.error(`check:a11y: no page ${ONLY} in scripts/build-nav.mjs`); process.exit(2); }

const TYPES = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
    '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
    '.woff2': 'font/woff2', '.mp4': 'video/mp4', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json'
};
let server, base = EXTERNAL;
if (!EXTERNAL) {
    server = createServer((req, res) => {
        let file = normalize(join(SITE, decodeURIComponent(req.url.split('?')[0])));
        if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
        if (!file.startsWith(SITE) || !existsSync(file)) { res.writeHead(404).end('not found'); return; }
        res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
    });
    await new Promise((r) => server.listen(PORT + 1, '127.0.0.1', r));
    base = `http://127.0.0.1:${PORT + 1}`;
}

const BRAVE = [
    'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    'C:/Program Files (x86)/BraveSoftware/Brave-Browser/Application/brave.exe',
    `${process.env.LOCALAPPDATA}/BraveSoftware/Brave-Browser/Application/brave.exe`,
    '/usr/bin/brave-browser',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
].find((p) => p && existsSync(p));
if (!BRAVE) { console.error('Brave was not found, and this does not fall back to Chrome.'); server?.close(); process.exit(2); }
const browser = spawn(BRAVE, [`--remote-debugging-port=${PORT}`, `--user-data-dir=${process.env.TEMP ?? '/tmp'}/brave-vinpassport-a11y`,
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const finish = (code) => { browser.kill(); server?.close(); process.exit(code); };

let target;
for (let i = 0; i < 80 && !target; i++) {
    try { const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }); if (r.ok) target = await r.json(); } catch { await sleep(250); }
}
if (!target) { console.error('Brave did not open a debugging port'); finish(2); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let id = 0; const pending = new Map(); let thrown = [];
ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.method === 'Runtime.exceptionThrown') thrown.push((msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text ?? '').split('\n')[0]);
    const p = msg.id && pending.get(msg.id);
    if (p) { pending.delete(msg.id); p(msg.result); }
};
const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
const ev = async (expression) => { const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); return r?.exceptionDetails ? { error: r.exceptionDetails.exception?.description ?? 'threw' } : r?.result?.value; };
const press = async (key, code) => {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code: key, windowsVirtualKeyCode: code });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key, code: key, windowsVirtualKeyCode: code });
};
await send('Page.enable'); await send('Runtime.enable');
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Emulation.setFocusEmulationEnabled', { enabled: true });
// The widest the page gets while it settles: a landing animation that overshoots counts.
await send('Page.addScriptToEvaluateOnNewDocument', { source: 'window.__widest=0;(function t(){const d=document.documentElement;if(d)window.__widest=Math.max(window.__widest,d.scrollWidth-d.clientWidth);if(performance.now()<5000)requestAnimationFrame(t)})();' });

const width = (w) => send('Emulation.setDeviceMetricsOverride', { width: w, height: w < 900 ? 844 : 900, deviceScaleFactor: 1, mobile: w < 900 });
const slow = (file) => /^(v|proofs|disclose|intake|demo)\//.test(file);
const open = async (file, extra = 0) => {
    await send('Page.navigate', { url: `${base}/${file.replace(/index\.html$/, '')}` });
    await sleep((slow(file) ? 3000 : 1400) + extra);
};

/* What counts as a control a keyboard user can reach: visible, enabled, in the Tab order, and
   not inside a closed <details> (whose contents are rightly out of the order until opened). */
const CONTROLS = `const shown = (e) => { if (e.closest('[inert],[hidden],details:not([open]) > :not(summary)')) return false; const s = getComputedStyle(e); const r = e.getBoundingClientRect(); return s.display !== 'none' && s.visibility !== 'hidden' && r.width > 0 && r.height > 0 && !e.disabled; };
  const controls = () => [...document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex]:not([tabindex="-1"]), video[controls]')].filter((e) => e.tabIndex >= 0 && shown(e));`;

const STRUCTURE = `(() => { ${CONTROLS}
  const out = [];
  const hs = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6')].filter(shown);
  if (hs.filter((h) => h.tagName === 'H1').length !== 1) out.push('expected one h1');
  let prev = 0; for (const h of hs) { const l = +h.tagName[1]; if (prev && l > prev + 1) out.push('heading skips h' + prev + ' to h' + l + ': ' + h.textContent.trim().slice(0, 40)); prev = l; }
  for (const s of ['header', 'nav', 'main', 'footer']) if (!document.querySelector(s)) out.push('no <' + s + '>');
  for (const i of document.images) { if (!i.hasAttribute('alt')) out.push('image without alt: ' + i.getAttribute('src')); if (i.complete && i.naturalWidth === 0 && i.loading !== 'lazy') out.push('image does not load: ' + i.getAttribute('src')); }
  for (const s of document.querySelectorAll('svg')) { if (s.parentElement.closest('svg') || s.closest('[aria-hidden="true"]')) continue; if (!(s.getAttribute('role') === 'img' && (s.getAttribute('aria-label') || s.querySelector('title')))) out.push('svg neither hidden nor named, in ' + (s.parentElement.className || s.parentElement.tagName)); }
  return out; })()`;

const TARGETS = `(() => { ${CONTROLS}
  const out = [];
  for (const e of controls()) {
    let r = e.getBoundingClientRect();
    const label = (e.type === 'checkbox' || e.type === 'radio') && (e.closest('label') || e.labels?.[0]);
    if (label) r = label.getBoundingClientRect();
    if (r.width >= 24 && r.height >= 24) continue;
    // WCAG 2.5.8: a link inside a sentence is exempt.
    const block = e.closest('p, li, dd, td, small, figcaption, label, .small, .vp-band');
    if (e.tagName === 'A' && block && block.textContent.trim().length > e.textContent.trim().length + 2) continue;
    out.push((e.tagName + ' "' + (e.textContent || e.value || e.getAttribute('aria-label') || '').trim().slice(0, 30) + '" ' + Math.round(r.width) + 'x' + Math.round(r.height)));
  }
  return out; })()`;

const FOCUSED = `(() => { const e = document.activeElement; if (!e || e === document.body) return null;
  const r = e.getBoundingClientRect(); const s = getComputedStyle(e);
  // A media element's own controls draw the browser's ring inside its shadow root.
  const ring = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) >= 2) || (s.boxShadow && s.boxShadow !== 'none') || (e.tagName === 'VIDEO' && !e.matches(':focus-visible'));
  const cx = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1), cy = Math.min(Math.max(r.top + Math.min(r.height / 2, 10), 0), innerHeight - 1);
  const hit = document.elementFromPoint(cx, cy);
  const under = r.bottom > 0 && r.top < innerHeight && hit && !(e === hit || e.contains(hit) || hit.contains(e) || [...(e.labels ?? [])].some((l) => l.contains(hit))) && !!hit.closest('header');
  return { name: e.tagName + ' "' + (e.textContent || e.value || e.getAttribute('aria-label') || '').trim().replace(/\\s+/g, ' ').slice(0, 30) + '"', ring, onScreen: r.bottom > 0 && r.top < innerHeight && r.width > 0, under, mark: e.closest('[data-a11y]')?.getAttribute('data-a11y') ?? null };
})()`;

const fails = [];
const fail = (page, what) => fails.push(`${page}: ${what}`);
console.log(`  base  ${base}`);
for (const page of CHECKED) {
    const f = page.file;
    thrown = [];
    for (const w of [320, 360, 390, 414, 768, 1024, 1280, 1440, 1920]) {
        await width(w); await open(f);
        const [sw, cw, widest] = await ev('[document.documentElement.scrollWidth, document.documentElement.clientWidth, window.__widest]');
        if (sw > cw) fail(f, `scrolls sideways at ${w} px (${sw} > ${cw})`);
        else if (widest > 0) fail(f, `widens by ${widest} px at ${w} px while it settles`);
        // The bar is one row at every width, and from 1,200 px it stays at the top as the page scrolls.
        const head = await ev(`(() => { const bar = document.querySelector('.vp-bar'); if (!bar) return null;
          const h = Math.round(bar.getBoundingClientRect().height); const y = Math.min(1200, document.documentElement.scrollHeight - innerHeight);
          window.scrollTo(0, y); const top = Math.round(bar.getBoundingClientRect().top); window.scrollTo(0, 0); return [h, top, y]; })()`);
        if (head) {
            const [h, top, y] = head;
            if (h > 80) fail(f, `the header bar is ${h} px tall at ${w} px: something in it wraps onto a second line`);
            if (w >= 1200 && y > 40 && top !== 0) fail(f, `the header bar does not stay at the top at ${w} px (at ${top} px after scrolling ${y} px)`);
        }
    }
    for (const w of [390, 1440]) {
        await width(w); await open(f);
        if (w === 1440) for (const x of await ev(STRUCTURE)) fail(f, x);
        if (w === 390) for (const x of await ev(TARGETS)) fail(f, `target under 24 x 24 at 390 px: ${x}`);
        // Mark the controls, then Tab from the top and name any never reached.
        const n = await ev(`(() => { ${CONTROLS} const c = controls(); c.forEach((e, i) => e.setAttribute('data-a11y', i)); return c.length; })()`);
        await ev('window.scrollTo(0, 0); document.activeElement?.blur()');
        const reached = new Set(); let first = null;
        for (let i = 0; i < n + 20; i++) {
            await press('Tab', 9); await sleep(30);
            const st = await ev(FOCUSED);
            if (!st) { if (i > 0) break; continue; }
            if (i === 0) first = st;
            if (st.mark === '0' && reached.size > 1) break;
            if (st.mark !== null) reached.add(st.mark);
            if (!st.ring) fail(f, `no visible focus at ${w} px on ${st.name}`);
            if (!st.onScreen) fail(f, `focus off screen at ${w} px on ${st.name}`);
            if (st.under) fail(f, `focus hidden under the header at ${w} px on ${st.name}`);
        }
        if (reached.size < n) {
            const missed = await ev(`[...document.querySelectorAll('[data-a11y]')].filter((e) => !${JSON.stringify([...reached])}.includes(e.getAttribute('data-a11y'))).map((e) => e.tagName + ' "' + (e.textContent || e.getAttribute('aria-label') || '').trim().slice(0, 30) + '"').slice(0, 4)`);
            fail(f, `Tab reaches ${reached.size} of ${n} controls at ${w} px; never ${missed.join(', ')}`);
        }
        if (!/Skip to main content/.test(first?.name ?? '')) fail(f, `first Tab at ${w} px lands on ${first?.name}, not the skip link`);
        // A fresh load: after the walk above the browser starts the next Tab from where focus last was.
        await open(f);
        await press('Tab', 9); await sleep(250); await press('Enter', 13); await sleep(500); await press('Tab', 9); await sleep(250);
        if (!(await ev('!!document.activeElement.closest("main")'))) fail(f, `at ${w} px the skip link does not lead into main`);
    }
    await width(1440);
    await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await open(f, 600);
    const moving = await ev('[...new Set(document.getAnimations().filter((a) => a.playState === "running").map((a) => a.animationName || "animation"))]');
    if (moving.length) fail(f, `still animating with reduced motion: ${moving.join(', ')}`);
    await send('Emulation.setEmulatedMedia', { features: [] });
    for (const t of [...new Set(thrown)]) fail(f, `threw: ${t}`);
    const mine = fails.filter((x) => x.startsWith(f + ':')).length;
    console.log(`  ${mine ? 'FAIL' : 'ok  '}  /${f.replace(/index\.html$/, '')}`);
}

if (fails.length) {
    console.error(`\ncheck:a11y FAILED - ${fails.length} problem(s):`);
    for (const x of fails) console.error(`  ${x}`);
    finish(1);
}
console.log(`\ncheck:a11y: ${CHECKED.length} page(s); no sideways scroll from 320 to 1920 px; the header bar one row, and stuck to the top from 1200 px; every control reached by Tab with a visible ring; skip links work; no target under 24 px; nothing moves with reduced motion`);
finish(0);
