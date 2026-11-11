/**
 * Scan a passport with the camera, the way a phone does, and fail if it does not open the passport.
 *
 * A real camera cannot be pointed at a QR code from a script, so Brave is given a fake one: a video
 * file of the sample passport's QR code, the one /scan/ itself prints, drawn by Brave and written out
 * as a YUV4MPEG2 file. Then, on a 390 px touch screen:
 *
 *   allowed   pressing Scan with your camera asks for the camera (granted here), the code is read,
 *             and the browser lands on /v/ showing "This passport is genuine"
 *   denied    with the camera refused, nothing is read, the page says why and what to do instead,
 *             and the typed box is still there
 *   at rest   before the press the camera is off and the button is the only way to start it
 *
 * It names the reader that ran: the browser's BarcodeDetector where it has one, else jsQR from
 * site/assets/vendor/jsqr/. Brave on a desktop has no BarcodeDetector, so this exercises jsQR, the
 * reader an iPhone uses.
 *
 *   npm run check:camera
 *   npm run check:camera -- --base https://passport.vin      (the live site)
 *
 * Zero dependencies: node:http, Node's global WebSocket, the DevTools protocol. Brave, never Chrome.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { join, normalize, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'site');
const BRAVE = process.env.BRAVE_PATH ?? 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = (name) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; };

const TYPES = { '.html': 'text/html', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.mjs': 'text/javascript', '.js': 'text/javascript', '.json': 'application/json', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm' };
let server = null;
let base = arg('--base')?.replace(/\/$/, '');
if (!base) {
    server = createServer((req, res) => {
        let p = normalize(join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
        if (existsSync(p) && statSync(p).isDirectory()) p = join(p, 'index.html');
        if (!p.startsWith(ROOT) || !existsSync(p)) { res.writeHead(404).end(); return; }
        res.writeHead(200, { 'content-type': TYPES[extname(p)] ?? 'application/octet-stream' }).end(readFileSync(p));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
}

const work = join(process.env.TEMP ?? tmpdir(), 'vinpassport-check-camera');
rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });
const browsers = [];

async function brave(name, extra = []) {
    const port = 9700 + Math.floor(Math.random() * 200);
    const proc = spawn(BRAVE, [`--remote-debugging-port=${port}`, `--user-data-dir=${join(work, 'profile-' + name)}`, '--headless=new',
        '--disable-gpu', '--no-first-run', '--no-default-browser-check', ...extra, 'about:blank'], { stdio: 'ignore' });
    browsers.push(proc);
    let target = null;
    for (let i = 0; i < 80 && !target; i++) {
        try { const r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' }); if (r.ok) target = await r.json(); } catch { await sleep(250); }
    }
    if (!target) throw new Error('Brave did not open a debugging port');
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let id = 0;
    const pending = new Map();
    ws.onmessage = (m) => { const x = JSON.parse(m.data); const p = x.id && pending.get(x.id); if (p) { pending.delete(x.id); p(x); } };
    const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
    const ev = async (expression, userGesture = false) => {
        const x = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture });
        if (x.result?.exceptionDetails) throw new Error(x.result.exceptionDetails.exception?.description ?? 'threw');
        return x.result?.result?.value;
    };
    await send('Page.enable');
    await send('Runtime.enable');
    return { send, ev, close: () => { try { ws.close(); } catch { /* gone */ } proc.kill(); } };
}

const until = async (ev, expression, ms) => {
    const end = Date.now() + ms;
    while (Date.now() < end) { try { if (await ev(expression)) return true; } catch { /* navigating */ } await sleep(250); }
    return false;
};

let failed = 0;
const fail = (what) => { failed++; console.error(`  FAIL  ${what}`); };
const ok = (what) => console.log(`  ok    ${what}`);

try {
    // 1. The fake camera: the QR code /scan/ prints, on its paper ground, framed as a phone would see it.
    const painter = await brave('paint');
    await painter.send('Page.navigate', { url: `${base}/scan/` });
    await sleep(1500);
    const W = 640, H = 480;
    const luma = await painter.ev(`(async () => {
        const svg = document.querySelector('.scan-qr svg');
        const src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(new XMLSerializer().serializeToString(svg))));
        const img = new Image(); img.src = src; await img.decode();
        const c = document.createElement('canvas'); c.width = ${W}; c.height = ${H};
        const g = c.getContext('2d'); g.fillStyle = '#eae2d2'; g.fillRect(0, 0, ${W}, ${H});
        g.drawImage(img, (${W} - 360) / 2, (${H} - 360) / 2, 360, 360);
        const d = g.getImageData(0, 0, ${W}, ${H}).data; const y = new Array(${W * H});
        for (let i = 0; i < ${W * H}; i++) y[i] = Math.round(0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2]);
        return y;
    })()`);
    painter.close();
    if (!Array.isArray(luma) || luma.length !== W * H) throw new Error('could not draw the sample QR code');
    const frame = Buffer.concat([Buffer.from('FRAME\n'), Buffer.from(luma), Buffer.alloc(W * H / 2, 128)]);
    const y4m = join(work, 'sample-qr.y4m');
    writeFileSync(y4m, Buffer.concat([Buffer.from(`YUV4MPEG2 W${W} H${H} F30:1 Ip A1:1 C420jpeg\n`), frame, frame, frame]));

    const phone = async (b) => {
        await b.send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
        await b.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
        await b.send('Page.navigate', { url: `${base}/scan/` });
        await sleep(1500);
    };
    const camera = ['--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${y4m}`];

    // 2. Allowed: the press asks, the code is read, the passport opens.
    console.log(`  base  ${base}`);
    const yes = await brave('allow', [...camera, '--use-fake-ui-for-media-stream']);
    await phone(yes);
    const rest = await yes.ev(`({ shown: !document.querySelector('[data-camera-start]').hidden && getComputedStyle(document.querySelector('[data-camera-start]')).display !== 'none',
        scanning: document.querySelector('[data-camera]').classList.contains('is-scanning'),
        live: !!document.querySelector('[data-camera-video]').srcObject, reader: 'BarcodeDetector' in window ? 'BarcodeDetector' : 'jsQR' })`);
    if (rest.shown) ok('the Scan with your camera button shows on a phone'); else fail('no Scan with your camera button on a 390 px touch screen');
    if (!rest.scanning && !rest.live) ok('the camera is off until the button is pressed'); else fail('the camera was on before anyone pressed the button');
    await yes.ev(`document.querySelector('[data-camera-start]').click()`, true);
    const landed = await until(yes.ev, `location.pathname === '/v/' && /This passport is genuine/.test(document.getElementById('v-h1')?.textContent ?? '')`, 20000);
    const where = await yes.ev('location.pathname + location.search').catch(() => '?');
    if (landed) ok(`the camera read the sample QR code with ${rest.reader} and opened ${where}: "This passport is genuine"`);
    else fail(`the camera did not open the passport (at ${where}; status: ${await yes.ev(`document.querySelector('[data-camera-status]')?.textContent ?? ''`).catch(() => '?')})`);
    yes.close();

    // 3. Denied: nothing is read, the page says why, and the typed box is still there.
    const no = await brave('deny', camera);
    await phone(no);
    const origin = new URL(base).origin;
    const denied = await no.send('Browser.setPermission', { permission: { name: 'camera' }, setting: 'denied', origin });
    if (denied.error) fail(`could not refuse the camera for the test: ${denied.error.message}`);
    await no.ev(`document.querySelector('[data-camera-start]').click()`, true);
    const said = await until(no.ev, `/not allowed/.test(document.querySelector('[data-camera-status]').textContent)`, 8000);
    const after = await no.ev(`({ path: location.pathname, scanning: document.querySelector('[data-camera]').classList.contains('is-scanning'),
        status: document.querySelector('[data-camera-status]').textContent, box: !!document.querySelector('[data-scan-form] #code') })`);
    if (said && !after.scanning && after.path === '/scan/' && after.box) ok(`with the camera refused the page stays put and says: "${after.status.slice(0, 60)}…"`);
    else fail(`with the camera refused: ${JSON.stringify(after)}`);
    no.close();
} catch (e) {
    fail(e.message);
} finally {
    for (const b of browsers) { try { b.kill(); } catch { /* gone */ } }
    server?.close();
}

if (failed) { console.error(`\ncheck:camera FAILED - ${failed} problem(s).`); process.exit(1); }
console.log('\ncheck:camera: the button asks for the camera, the sample QR code opens its passport, and a refusal is explained');
process.exit(0);
