/**
 * Capture the guide's screenshots from the running product.
 *
 * /guide/ claims its images are the real screens rather than drawings, and
 * that claim is only worth something if recapturing them is a command rather
 * than an afternoon. Each shot names a page, an element and a short script to
 * get the page into the state being described, so a shot cannot quietly stop
 * matching the step it illustrates.
 *
 *   npm run app                                  (in another terminal)
 *   node scripts/capture-guide-shots.mjs         # all shots this script knows
 *   node scripts/capture-guide-shots.mjs v12-not-found
 *   node scripts/capture-guide-shots.mjs --base http://127.0.0.1:5178
 *
 * Pages are loaded with `?src=demo`, which forces the committed static export
 * instead of whatever a local server happens to hold, so two people capturing
 * the same shot get the same image.
 *
 * Width and scale match the shots already in the guide: 1100 CSS pixels at
 * 2x, which is why they are about 2200 wide.
 *
 * Zero dependencies: Node's global WebSocket and the DevTools protocol.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = join(ROOT, 'site', 'guide', 'shots');
const PORT = 9446;
const WIDTH = 1280;
const SCALE = 2;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
const baseArg = argv.indexOf('--base');
const BASE = baseArg >= 0 ? argv[baseArg + 1] : 'http://localhost:8790';
const wanted = argv.filter((a, i) => !a.startsWith('--') && i !== baseArg + 1);

/**
 * Each shot: where to go, what to do once there, and what to photograph.
 *
 * `prepare` runs in the page and resolves when the page is in the state the
 * step describes. It returns a selector to override `element` when the state
 * change replaced the node being photographed.
 */
const SHOTS_SPEC = [
    {
        name: 'v11-find-by-vin',
        path: '/verify/?src=demo',
        element: '.vfy-find',
        prepare: `(async () => {
            const input = document.querySelector('#vin-input');
            if (!input) return { error: 'no #vin-input on the page' };
            input.value = 'WAUZZZ8V5KA000002';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            return { ok: true };
        })()`
    },
    {
        name: 'c9-writers',
        // The console only: this one needs `npm run app`, because the page
        // is static but the writer identities are the server's.
        path: '/intake/',
        element: 'section:has(.wrt)',
        prepare: `(async () => {
            // Retrofit records carry later updates; a new vehicle starts at
            // zero and has none, so there would be nothing to attribute.
            const type = [...document.querySelectorAll('section')]
                .find((s) => /PASSPORT TYPE/.test(s.textContent));
            const labels = type ? [...type.querySelectorAll('label')] : [];
            if (labels[1]) labels[1].click();
            await new Promise((r) => setTimeout(r, 200));
            const picker = document.querySelector('select');
            if (picker && picker.options.length > 1) {
                picker.value = picker.options[1].value;
                picker.dispatchEvent(new Event('change', { bubbles: true }));
            }
            await new Promise((r) => setTimeout(r, 200));
            const dealer = document.querySelector('.wrt[data-writer="dealership"]');
            if (!dealer) return { error: 'the writer control is not on the page' };
            dealer.click();
            await new Promise((r) => setTimeout(r, 250));
            if (document.getElementById('writerby').hidden) {
                return { error: 'the "written by" row did not appear' };
            }
            // Show it attributing the updates, which is the point of the row.
            const by = document.getElementById('wby');
            by.value = 'dealership';
            by.dispatchEvent(new Event('change', { bubbles: true }));
            if (by.value !== 'dealership') return { error: 'the writer could not be selected' };
            return { ok: true };
        })()`
    },
    {
        name: 'v13-written-by',
        path: '/verify/?src=demo',
        element: '.vfy-claims-on-ledger',
        prepare: `(async () => {
            // The custody lines live inside WHAT THE CHAIN SEES, which is
            // collapsed by default because it is evidence, not the answer.
            for (const d of document.querySelectorAll('details')) d.open = true;
            await new Promise((r) => setTimeout(r, 300));
            const el = document.querySelector('.vfy-claims-on-ledger');
            if (!el) return { error: 'the claim rows are not on the page' };
            if (!/Last written by/.test(el.innerText)) return { error: 'no writer is shown on any claim' };
            return { ok: true };
        })()`
    },
    {
        name: 'v12-not-found',
        path: '/verify/?src=demo',
        element: '.vfy-card',
        prepare: `(async () => {
            const input = document.querySelector('#vin-input');
            const form = document.querySelector('#vin-find');
            if (!input || !form) return { error: 'the lookup form is not on the page' };
            // A syntactically valid VIN that this ledger does not hold: the
            // point of the step is the honest silence, not a typo message.
            input.value = 'WF0AXXGCDA1234567';
            input.dispatchEvent(new Event('input', { bubbles: true }));
            form.requestSubmit ? form.requestSubmit() : form.dispatchEvent(new Event('submit', { cancelable: true }));
            for (let i = 0; i < 60; i++) {
                await new Promise((r) => setTimeout(r, 100));
                const h = document.querySelector('h1');
                if (h && /no passport/i.test(h.textContent)) return { ok: true };
            }
            return { error: 'the not-found card never rendered' };
        })()`
    }
];

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

mkdirSync(SHOTS, { recursive: true });

const browser = spawn(BRAVE, [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${process.env.TEMP ?? '/tmp'}/brave-vinpassport-shots`,
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', `--window-size=${WIDTH},1200`, 'about:blank',
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

const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text ?? 'evaluation threw');
    return r.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', {
    width: WIDTH, height: 1200, deviceScaleFactor: SCALE, mobile: false
});

let failures = 0;
for (const shot of SHOTS_SPEC) {
    if (wanted.length && !wanted.includes(shot.name)) continue;
    try {
        await send('Page.navigate', { url: BASE + shot.path });
        await sleep(1500);

        if (shot.prepare) {
            const r = await evaluate(shot.prepare);
            if (r?.error) throw new Error(r.error);
            if (r?.element) shot.element = r.element;
        }
        await sleep(400);

        // Measure from the top of the page, never after scrolling the element
        // into view. The site's nav is sticky, so an element scrolled to the
        // top of the viewport is photographed with the nav sitting over it:
        // the capture succeeds and the picture is of the wrong thing. With
        // captureBeyondViewport the whole page is rendered at once and the
        // nav stays where it belongs, so page coordinates at scroll zero are
        // both correct and stable.
        const box = await evaluate(`(() => {
            scrollTo(0, 0);
            const el = document.querySelector(${JSON.stringify(shot.element)});
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height };
        })()`);
        if (!box) throw new Error(`no element matching ${shot.element}`);
        if (box.width < 50 || box.height < 30) {
            // A hidden or collapsed element photographs as a blank strip and
            // the shot looks captured. Refuse instead.
            throw new Error(`${shot.element} measured ${Math.round(box.width)}x${Math.round(box.height)}, `
                + 'which is too small to be the real element');
        }

        // scale 1, NOT SCALE. The device metrics override already renders at
        // SCALE, and a clip scale multiplies on top of it: the pair produced
        // 4x files that looked fine on their own and rendered at twice the
        // width of every other shot, because the guide sizes an image as
        // max-width = intrinsic / 2.
        const { data } = await send('Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: true,
            clip: { x: box.x, y: box.y, width: box.width, height: box.height, scale: 1 }
        });
        const out = join(SHOTS, `${shot.name}.png`);
        writeFileSync(out, Buffer.from(data, 'base64'));
        console.log(`${shot.name}  ${Math.round(box.width * SCALE)}x${Math.round(box.height * SCALE)}  ${out}`);
    } catch (e) {
        failures += 1;
        console.error(`${shot.name}  FAILED: ${e.message}`);
    }
}

quit(failures ? 1 : 0);
