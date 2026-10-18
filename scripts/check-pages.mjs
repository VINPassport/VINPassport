/**
 * Load every site page in a browser and fail if any of them throws.
 *
 * This exists because two pages were throwing on load in production and
 * nothing noticed. Adding the `<main id="main">` landmark for Annex V 4.2.1
 * moved content one level deeper, which quietly invalidated two selectors
 * written against the old shape:
 *
 *   intake  `nav ~ div div[style*="240px"]`  the status card left <nav>'s
 *           sibling set, the lookup returned null, the module threw before it
 *           could set the state, and the page was left saying "Local circuit
 *           server found" with REGISTER enabled on a host with no circuit
 *           server at all. It failed OPEN, which is the worst way to fail.
 *   proofs  `body > div > section`           matched nothing, so the real
 *           ledger never replaced the two hard-coded examples and the page
 *           served a stale "16 field updates" to the public.
 *
 * Neither produced a visible error. The markup stayed valid, the CSS stayed
 * correct, the pages looked finished, and every existing check passed. The
 * only way to see it is to run the page and listen for the exception.
 *
 *   npm run check:pages
 *   npm run check:pages -- --base http://localhost:8797   (against the app)
 *   npm run check:pages -- --base <url> --expect app|static
 *
 * It refuses outright if the base is some other application. `{ok:true}` on
 * /api/health means an app is there, not that it is this one.
 *
 * It names the server that answered before it tests anything, and --expect
 * turns that into a refusal: the pages behave differently with and without a
 * circuit server, so a run against the wrong one passes while proving nothing.
 *
 * With no --base it serves ./site itself from a throwaway port, which is the
 * static-host case: /api/* is expected to 404 there and is not reported.
 *
 * Zero dependencies: node:http, Node's global WebSocket, the DevTools
 * protocol. Brave, never Chrome.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname, relative } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SITE = join(ROOT, 'site');
const PORT = 9460;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
const baseArg = argv.indexOf('--base');
const EXTERNAL = baseArg >= 0 ? argv[baseArg + 1].replace(/\/$/, '') : null;
const expectArg = argv.indexOf('--expect');
const EXPECT = expectArg >= 0 ? argv[expectArg + 1] : null;

/** Every directory under site/ that holds an index.html, as a URL path. */
const pages = [];
(function walk(dir) {
    if (existsSync(join(dir, 'index.html'))) {
        const rel = relative(SITE, dir).split(/[\\/]/).filter(Boolean).join('/');
        pages.push(rel ? `/${rel}/` : '/');
    }
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry);
        if (entry !== 'shots' && statSync(full).isDirectory()) walk(full);
    }
})(SITE);
pages.sort();

const TYPES = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp',
    '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.mp4': 'video/mp4',
    '.wasm': 'application/wasm'
};

let server, base = EXTERNAL;
if (!EXTERNAL) {
    server = createServer((req, res) => {
        const path = decodeURIComponent(req.url.split('?')[0]);
        let file = join(SITE, path);
        if (path.endsWith('/')) file = join(file, 'index.html');
        if (!file.startsWith(SITE) || !existsSync(file) || statSync(file).isDirectory()) {
            res.writeHead(404).end('not found');
            return;
        }
        res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
        res.end(readFileSync(file));
    });
    await new Promise((r) => server.listen(PORT + 1, '127.0.0.1', r));
    base = `http://127.0.0.1:${PORT + 1}`;
}

/**
 * WHICH SERVER IS ANSWERING, said out loud before anything is tested.
 *
 * The pages behave differently depending on this and look identical either
 * way: with a circuit server the intake console enables REGISTER and the demo
 * page offers a guided run, and without one both must say so and disable
 * themselves. So a check run against the wrong server is not a failed check,
 * it is a check of something else that passes.
 *
 * That is not hypothetical. Stale `npx serve` processes outlived the pattern
 * meant to kill them and kept the earlier ports, so `npm run app` moved up the
 * range and a browser pointed at the old port was driving a static host while
 * the results were being read as the app's. Nothing was wrong with either
 * server; the report just described a different one. One line of output and an
 * optional `--expect` make that impossible to do quietly.
 */
async function identify(url) {
    const get = async (path) => {
        try {
            const r = await fetch(url + path, { signal: AbortSignal.timeout(4000) });
            return { status: r.status, body: r.ok ? await r.json().catch(() => null) : null };
        } catch (e) { return { status: 0, error: String(e?.message ?? e) }; }
    };
    const health = await get('/api/health');
    if (health.status === 0) return { kind: 'unreachable', detail: health.error };
    if (health.body?.ok !== true) return { kind: 'static', detail: `/api/health answered ${health.status}` };
    // `{ok:true}` says an app is there, not that it is THIS app. Another
    // project on this machine answers /api/health exactly the same way and
    // serves its own single page for every path, so a run against it loaded
    // eight pages, threw nothing, and passed while testing another product.
    // The ledger payload is ours and nothing else's, so ask for that.
    const led = await get('/api/ledger');
    const source = led.body?.ledger?.source ?? '';
    if (!source.startsWith('vinpassport')) {
        return { kind: 'foreign', detail: `an app, but not this one: /api/ledger said ${JSON.stringify(source) || `status ${led.status}`}` };
    }
    const demo = await get('/api/demo/status');
    const d = demo.body ?? {};
    return {
        kind: 'app',
        detail: d.enabled
            ? `preprod runner ${d.ready ? 'ready' : d.warming ? 'warming' : d.error ? `error: ${d.error}` : 'idle'}`
            : 'local circuits only, no preprod runner'
    };
}

const who = await identify(base);
console.log(`  base  ${base}  ->  ${who.kind}  (${who.detail})`);
if (who.kind === 'unreachable') {
    console.error(`\ncheck:pages FAILED - nothing is listening on ${base}.`);
    server?.close();
    process.exit(2);
}
if (who.kind === 'foreign') {
    console.error('');
    console.error(`check:pages FAILED - ${base} is serving a different application.`);
    server?.close();
    process.exit(2);
}
if (EXPECT && EXPECT !== who.kind) {
    console.error(`\ncheck:pages FAILED - asked for --expect ${EXPECT} and found a ${who.kind} server.`);
    console.error('Checking the wrong server is not a failed check, it is a passing check of something else.');
    server?.close();
    process.exit(2);
}

const BRAVE = [
    'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    'C:/Program Files (x86)/BraveSoftware/Brave-Browser/Application/brave.exe',
    `${process.env.LOCALAPPDATA}/BraveSoftware/Brave-Browser/Application/brave.exe`,
    '/usr/bin/brave-browser',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
].find((p) => p && existsSync(p));
if (!BRAVE) {
    console.error('Brave was not found, and this does not fall back to Chrome.');
    server?.close();
    process.exit(2);
}

const browser = spawn(BRAVE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.env.TEMP ?? '/tmp'}/brave-vinpassport-pages`,
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--window-size=1280,1000', 'about:blank',
], { stdio: 'ignore' });

const finish = (code) => { browser.kill(); server?.close(); process.exit(code); };

let target;
for (let i = 0; i < 80 && !target; i++) {
    try {
        const r = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' });
        if (r.ok) target = await r.json();
    } catch { await sleep(250); }
}
if (!target) { console.error('Brave did not open a debugging port'); finish(2); }

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let id = 0;
const pending = new Map();
let thrown = [];
let missing = [];
ws.onmessage = (m) => {
    const msg = JSON.parse(m.data);
    if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        thrown.push((d.exception?.description || d.text || 'exception').split('\n')[0]);
    }
    if (msg.method === 'Network.responseReceived') {
        const { url, status } = msg.params.response;
        // /api/* legitimately 404s on a static host: that is the mode probe.
        if (status >= 400 && !url.includes('/api/')) missing.push(`${status} ${url}`);
    }
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
await send('Network.enable');

/* The profile directory persists between runs, so without this the browser
   will happily answer from its disk cache and this check reports the state of
   the last run rather than the current one. That is worse than no check: it
   passes on content nobody is serving any more. It bit during the very
   investigation this script came out of, reporting a stale figure from a
   version that had already been replaced. */
await send('Network.setCacheDisabled', { cacheDisabled: true });

let bad = 0;
for (const page of pages) {
    thrown = []; missing = [];
    await send('Page.navigate', { url: base + page });
    await sleep(4500);
    if (!thrown.length && !missing.length) { console.log(`  ok    ${page}`); continue; }
    bad++;
    console.error(`  FAIL  ${page}`);
    for (const t of [...new Set(thrown)]) console.error(`          threw: ${t}`);
    for (const m of [...new Set(missing)]) console.error(`          ${m}`);
}

if (bad) {
    console.error(`\ncheck:pages FAILED - ${bad} of ${pages.length} pages throw or cannot load an asset.`);
    console.error('A page that throws still renders, so this will not be visible by looking at it.');
    finish(1);
}
console.log(`\ncheck:pages: ${pages.length} pages, none throw, every asset resolves`);
finish(0);
