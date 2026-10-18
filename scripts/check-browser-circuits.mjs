/**
 * Can the compiled contract run in a browser?
 *
 * The answer decides where the intake console can live. The console executes
 * circuits and proves nothing, so it needs the 1.4 MB runtime wasm and none
 * of the 52 MB of prover keys. If that bundles and runs client side, the
 * published static site can offer "add a passport" with no host at all, and
 * only the guided preprod run still needs a machine, a wallet and fees.
 *
 * Two layers, because either can fail without the other noticing: the
 * compiled contract through PassportSimulator, and scenario.mjs above it,
 * which is what the console actually calls and which reached for node:crypto
 * and Buffer until it was made runtime-agnostic. Node keeps passing whether
 * or not those four lines come back, so only this would catch it.
 *
 * Measured 18 October: bundles with no shim beyond one Buffer helper, 416 KB
 * of wasm gzipped, loads in about 45 ms, five circuits in about 35 ms, and
 * the whole intake path - demo vehicles, a delegated registration and the
 * ledger export - in about 240 ms.
 *
 * This is a check rather than a note in a document because what it
 * establishes belongs to a dependency, not to us.
 * `@midnight-ntwrk/onchain-runtime-v3` declares a `browser` export condition
 * pointing at the wasm-bindgen bundler target; an upgrade could drop it, and
 * nothing else in the suite would notice.
 *
 *   npm run check:browser
 *
 * Brave, never Chrome. The build output goes to a temporary directory, so
 * nothing lands in the working tree.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, readFileSync, statSync, rmSync, mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, extname } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'test', 'browser-circuits');
const OUT = mkdtempSync(join(tmpdir(), 'vinpassport-browser-'));
const PORT = 9462;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- build ---------------------------------------------------------------

const { build } = await import('vite');
let bundle;
try {
    bundle = await build({
        root: SRC,
        logLevel: 'warn',
        build: { outDir: OUT, emptyOutDir: true, target: 'es2022' }
    });
} catch (e) {
    console.error('check:browser FAILED - the contract no longer bundles for the browser.');
    console.error(String(e?.message ?? e).split('\n').slice(0, 6).join('\n'));
    rmSync(OUT, { recursive: true, force: true });
    process.exit(1);
}

const sizes = (Array.isArray(bundle) ? bundle[0] : bundle)?.output ?? [];
const wasm = sizes.find((o) => o.fileName.endsWith('.wasm'));
if (!wasm) {
    console.error('check:browser FAILED - no wasm in the bundle, so the runtime did not come along.');
    rmSync(OUT, { recursive: true, force: true });
    process.exit(1);
}
const kb = (n) => `${Math.round(n / 1024)} kB`;
console.log(`  bundled  ${kb((wasm.source ?? wasm.code ?? '').length)} of runtime wasm`);

// ---- serve ---------------------------------------------------------------

const TYPES = {
    '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
    '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json'
};
const server = createServer((req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0]);
    let file = join(OUT, path);
    if (path.endsWith('/')) file = join(file, 'index.html');
    if (!file.startsWith(OUT) || !existsSync(file) || statSync(file).isDirectory()) {
        res.writeHead(404).end('not found');
        return;
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    res.end(readFileSync(file));
});
await new Promise((r) => server.listen(PORT + 1, '127.0.0.1', r));

// ---- run it in Brave -----------------------------------------------------

const BRAVE = [
    'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    'C:/Program Files (x86)/BraveSoftware/Brave-Browser/Application/brave.exe',
    `${process.env.LOCALAPPDATA}/BraveSoftware/Brave-Browser/Application/brave.exe`,
    '/usr/bin/brave-browser',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
].find((p) => p && existsSync(p));
if (!BRAVE) {
    console.error('Brave was not found, and this does not fall back to Chrome.');
    server.close();
    rmSync(OUT, { recursive: true, force: true });
    process.exit(2);
}

const browser = spawn(BRAVE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.env.TEMP ?? '/tmp'}/brave-vinpassport-circuits`,
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    'about:blank',
], { stdio: 'ignore' });

const finish = (code) => {
    browser.kill();
    server.close();
    rmSync(OUT, { recursive: true, force: true });
    process.exit(code);
};

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
// The profile persists between runs and the page is served from a fresh
// directory each time, so without this a cached index.html can point at
// assets that no longer exist.
await send('Network.setCacheDisabled', { cacheDisabled: true });
await send('Page.navigate', { url: `http://127.0.0.1:${PORT + 1}/` });
await sleep(8000);

const r = await send('Runtime.evaluate', {
    expression: 'document.getElementById("out").textContent',
    returnByValue: true
});
const text = String(r.result.value ?? '');
for (const line of text.split('\n')) console.log(`  ${line}`);

if (!text.includes('RESULT ok')) {
    console.error('\ncheck:browser FAILED - the contract bundled but did not run in the browser.');
    finish(1);
}
console.log('\ncheck:browser: circuits and the whole intake path run client side');
finish(0);
