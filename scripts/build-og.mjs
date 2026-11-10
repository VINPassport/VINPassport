/**
 * Render the link-preview images that carry numbers, so a number that moves is
 * one edit and one command, not a trip back to a design tool.
 *
 *   node scripts/build-og.mjs              every design/og/*.html to site/og/<name>.png
 *   node scripts/build-og.mjs og-developers
 *
 * Each template is a 1200 x 630 page built from the site's own stylesheet,
 * fonts and logo. The repository root is served over HTTP from a throwaway
 * port (browsers refuse web fonts from file:// pages), the page is opened in
 * Brave, and the capture waits for every font and image before it is taken:
 * an image photographed before its fonts load looks finished and is wrong.
 *
 * Zero dependencies: node:http, Node's global WebSocket, the DevTools
 * protocol. Brave, never Chrome.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize, extname, sep } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'design', 'og');
const OUT = join(ROOT, 'site', 'og');
const WIDTH = 1200;
const HEIGHT = 630;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const wanted = process.argv.slice(2);
const names = readdirSync(SRC).filter((f) => f.endsWith('.html')).map((f) => f.slice(0, -5))
    .filter((n) => !wanted.length || wanted.includes(n));
if (!names.length) { console.error(`no templates matching ${wanted.join(', ')} in design/og/`); process.exit(2); }

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.js': 'text/javascript', '.mjs': 'text/javascript' };
const server = createServer((req, res) => {
    const path = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    if (!path.startsWith(ROOT + sep) || !existsSync(path)) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' }).end(readFileSync(path));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const BRAVE = [
    'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    'C:/Program Files (x86)/BraveSoftware/Brave-Browser/Application/brave.exe',
    `${process.env.LOCALAPPDATA}/BraveSoftware/Brave-Browser/Application/brave.exe`,
    '/usr/bin/brave-browser',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'
].find((p) => p && existsSync(p));
if (!BRAVE) { console.error('Brave was not found, and this does not fall back to Chrome.'); process.exit(2); }

const PORT = 9300 + Math.floor(Math.random() * 500);
const browser = spawn(BRAVE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.env.TEMP ?? '/tmp'}/brave-vinpassport-og`,
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', `--window-size=${WIDTH},${HEIGHT}`, 'about:blank'
], { stdio: 'ignore' });
const quit = async (code) => { browser.kill(); server.close(); await sleep(250); process.exit(code); };

let target;
for (let i = 0; i < 60 && !target; i++) {
    try {
        const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
        if (r.ok) target = await r.json();
    } catch { await sleep(250); }
}
if (!target) { console.error('Brave did not open a debugging port'); await quit(2); }

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
await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });

let failures = 0;
mkdirSync(OUT, { recursive: true });
for (const name of names) {
    try {
        await send('Page.navigate', { url: `${base}/design/og/${name}.html` });
        await sleep(500);
        // Every image decoded and every font in use loaded, or refuse.
        const ready = await evaluate(`(async () => {
            for (let i = 0; i < 50 && document.readyState !== 'complete'; i++) await new Promise(r => setTimeout(r, 100));
            await document.fonts.ready;
            const broken = [...document.images].filter(i => !i.complete || !i.naturalWidth).map(i => i.src);
            const fonts = [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family);
            return { broken, fonts: [...new Set(fonts)] };
        })()`);
        if (ready.broken.length) throw new Error(`images did not load: ${ready.broken.join(', ')}`);
        if (!ready.fonts.length) throw new Error('no web font loaded');
        const { data } = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: 1 } });
        writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, 'base64'));
        console.log(`${name}.png  ${WIDTH}x${HEIGHT}  fonts: ${ready.fonts.join(', ')}`);
    } catch (e) {
        failures += 1;
        console.error(`${name}  FAILED: ${e.message}`);
    }
}
await quit(failures ? 1 : 0);
