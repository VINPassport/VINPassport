/**
 * The app server's HTTP rules (scripts/lib/app-http.mjs), without starting it.
 *
 * The server is open to strangers by design, so each rule here is something a
 * stranger could otherwise do: post a form from another site, claim another
 * address through X-Forwarded-For, read a credential out of an error, rewrite
 * a standing demo vehicle, grow a list until the process runs out of memory,
 * or download someone's receipt long after their run. The page policy is
 * checked against the pages in site/ as they stand, so a new inline script
 * that the policy would block fails here before it fails in a browser.
 *
 * Tests marked REPOSITORY ASSERTION read scripts/app-server.mjs, which needs
 * the compiled contract to start.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
    typeOf, SECURITY_HEADERS, API_CSP, inlineScriptHashes, pageCsp, applySecurityHeaders, originAllowed, readJson,
    trustedProxies, callerIp, ipBudget, statusOf, safeText, safeDeep, checkIntakeLimits, INTAKE_LIMITS, jobWindow, boundVehicles
} from '../../scripts/lib/app-http.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = join(ROOT, 'site');
const server = readFileSync(join(ROOT, 'scripts', 'app-server.mjs'), 'utf8');

const request = (body, headers = {}, remoteAddress = '203.0.113.9') =>
    Object.assign(Readable.from(body === undefined ? [] : [body]), { headers, socket: { remoteAddress } });
const ALLOWED = new Set(['https://passport.vin']);

test('a body is read only when it says it is JSON', async () => {
    await assert.rejects(readJson(request('{}', {}), { allowed: ALLOWED }), (e) => e.code === 415);
    await assert.rejects(readJson(request('{}', { 'content-type': 'text/plain' }), { allowed: ALLOWED }), (e) => e.code === 415);
    await assert.rejects(readJson(request('a=1', { 'content-type': 'application/x-www-form-urlencoded' })), (e) => e.code === 415);
    assert.deepEqual(await readJson(request('{"a":1}', { 'content-type': 'application/json; charset=utf-8' })), { a: 1 });
    await assert.rejects(readJson(request('{', { 'content-type': 'application/json' })), (e) => e.code === 400);
    await assert.rejects(readJson(request('x'.repeat(11), { 'content-type': 'application/json' }), { limit: 10 }), (e) => e.code === 413);
});

test('a cross-site Origin is refused; this server and the listed sites are not', async () => {
    const json = { 'content-type': 'application/json', host: 'localhost:8790' };
    await assert.rejects(readJson(request('{}', { ...json, origin: 'https://evil.example' }), { allowed: ALLOWED }), (e) => e.code === 403);
    assert.deepEqual(await readJson(request('{}', { ...json, origin: 'http://localhost:8790' }), { allowed: ALLOWED }), {});
    assert.deepEqual(await readJson(request('{}', { ...json, origin: 'https://passport.vin' }), { allowed: ALLOWED }), {});
    assert.equal(originAllowed({ headers: {} }, ALLOWED), true, 'a client that sends no Origin is not a browser page');
});

test('X-Forwarded-For counts only from a proxy VINPASSPORT_TRUST_PROXY names', () => {
    const local = request(undefined, { 'x-forwarded-for': '198.51.100.1, 192.0.2.7' }, '127.0.0.1');
    assert.equal(callerIp(local, trustedProxies(undefined)), '127.0.0.1', 'trusted without being told to');
    assert.equal(callerIp(local, trustedProxies('1')), '192.0.2.7', 'the last hop is the one the proxy saw');
    assert.equal(callerIp(request(undefined, { 'x-forwarded-for': '192.0.2.7' }, '10.0.0.5'), trustedProxies('1')), '10.0.0.5');
    assert.equal(callerIp(request(undefined, { 'x-forwarded-for': '192.0.2.7' }, '10.0.0.5'), trustedProxies('10.0.0.5')), '192.0.2.7');
    assert.equal(trustedProxies('false').size, 0);
});

test('a per-caller budget refuses with 429, gives a slot back, and forgets the oldest caller first', () => {
    let day = new Date('2026-11-24T10:00:00Z');
    const b = ipBudget({ perDay: 2, maxEntries: 2, now: () => day });
    b.take('a'); const back = b.take('a');
    assert.throws(() => b.take('a'), (e) => e.status === 429 && /resets at 00:00 UTC/.test(e.message));
    back();
    b.take('a');
    b.take('b'); b.take('c');
    assert.equal(b.size(), 2);
    day = new Date('2026-11-25T00:00:01Z');
    b.take('a'); b.take('a');
});

test('a runner refusal keeps its own status; the daily cap is a 429, not a 400', () => {
    assert.equal(statusOf(Object.assign(new Error('the daily cap of 20 runs is reached'), { status: 429 })), 429);
    assert.equal(statusOf(Object.assign(new Error('x'), { code: 'CAP' })), 429);
    assert.equal(statusOf(new Error('bad intake')), 400);
    assert.equal(statusOf({ status: 'nope' }, 503), 503);
});

test('error text loses the project id before it leaves, inside a job as well', () => {
    const msg = 'fetch https://midnight-mainnet.blockfrost.io/api/v0?project_id=mainnetSECRETabc123 failed';
    assert.ok(!safeText(msg).includes('mainnetSECRETabc123'));
    assert.match(safeText(msg), /project_id=…/);
    const job = { id: 'j', status: 'failed', error: msg, steps: [{ detail: msg }], receipt: null };
    assert.ok(!JSON.stringify(safeDeep(job)).includes('mainnetSECRETabc123'));
    assert.equal(safeDeep(job).id, 'j');
});

test('an intake may not rewrite a standing demo vehicle, nor be larger than the page sends', () => {
    const demo = new Set(['aa']);
    const vinHashOf = (v) => (v === 'WVWZZZ1JZXW000001' ? 'aa' : 'bb');
    assert.throws(() => checkIntakeLimits({ vin: 'WVWZZZ1JZXW000001' }, { demoVinHashes: demo, vinHashOf }), /standing demo vehicle/);
    checkIntakeLimits({ vin: 'VPD00000000000001', updates: [{ odometerKm: 1 }], grants: [] }, { demoVinHashes: demo, vinHashOf });
    const many = (n) => Array.from({ length: n }, () => ({ odometerKm: 1 }));
    assert.throws(() => checkIntakeLimits({ updates: many(INTAKE_LIMITS.updates + 1) }), (e) => e.status === 400 && /at most 16/.test(e.message));
    assert.throws(() => checkIntakeLimits({ grants: many(INTAKE_LIMITS.grants + 1) }), /"grants"/);
    const wide = Object.fromEntries(Array.from({ length: INTAKE_LIMITS.updateFields + 1 }, (_, i) => [`f${i}`, 1]));
    assert.throws(() => checkIntakeLimits({ updates: [wide] }), /update 1 writes/);
    assert.throws(() => checkIntakeLimits({ grants: 'all' }), /wrong shape/);
});

test('the vehicle list keeps the standing two and a bounded number of added ones', () => {
    const list = ['A', 'B', ...Array.from({ length: 60 }, (_, i) => `v${i}`)];
    boundVehicles(list, 2, 50);
    assert.equal(list.length, 52);
    assert.deepEqual(list.slice(0, 3), ['A', 'B', 'v10'], 'the oldest added go first');
});

test('finished jobs are served for a bounded time and count, unknown ids never', () => {
    let t = 0;
    const store = new Map();
    const forgotten = [];
    const w = jobWindow({ lookup: (id) => store.get(id), onEvict: (id) => forgotten.push(id), ttlMs: 1000, maxFinished: 2, now: () => t });
    for (const id of ['a', 'b', 'c']) { store.set(id, { id, status: 'running' }); w.issue(id); }
    assert.equal(w.get('zz'), null);
    store.set('zz', { id: 'zz', status: 'done' });
    assert.equal(w.get('zz'), null, 'a job this server never handed out is served');
    for (const id of ['a', 'b', 'c']) store.get(id).status = 'done';
    w.sweep();
    assert.equal(w.get('a'), null, 'more than maxFinished are kept');
    assert.equal(w.get('c').id, 'c');
    t = 1001;
    w.sweep();
    assert.equal(w.get('b'), null);
    assert.equal(w.get('c'), null, 'a finished job is served past its time');
    assert.equal(w.size(), 0);
    assert.deepEqual(forgotten.sort(), ['a', 'b', 'c'], 'the runner is not told to free an evicted job');
});

test('every response carries the security headers; the API policy loads nothing', () => {
    const set = {};
    applySecurityHeaders({ setHeader: (k, v) => { set[k] = v; } });
    assert.deepEqual({ ...set }, { ...SECURITY_HEADERS, 'content-security-policy': API_CSP });
    assert.equal(set['x-content-type-options'], 'nosniff');
    assert.equal(set['referrer-policy'], 'no-referrer');
    assert.equal(set['x-frame-options'], 'DENY');
});

test('the MIME table knows the files the site serves', () => {
    assert.equal(typeOf('a/b.webp'), 'image/webp');
    assert.equal(typeOf('favicon.ico'), 'image/x-icon');
    assert.equal(typeOf('f.woff2'), 'font/woff2');
    assert.equal(typeOf('site.webmanifest'), 'application/manifest+json');
    assert.equal(typeOf('x.wasm'), 'application/wasm');
    assert.equal(typeOf('x.unknown'), 'application/octet-stream');
    const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [f]));
    const unknown = [...new Set(walk(SITE).map((f) => f.slice(f.lastIndexOf('.')).toLowerCase()))]
        .filter((ext) => ext.startsWith('.') && typeOf(`x${ext}`) === 'application/octet-stream');
    // Key material and compiled circuits are opaque bytes: octet-stream is their type.
    const binary = ['.prover', '.verifier', '.bzkir'];
    assert.deepEqual(unknown.filter((e) => ![...binary, '.md', '.map', '.gitkeep', '.nojekyll'].includes(e)), [], 'site/ holds a file type the server sends as octet-stream');
});

test('a page policy allows exactly its own inline scripts, hashed as the browser reads them', () => {
    const html = '<p>x</p><script>\r\nlet a = 1;\r\n</script><script src="a.js"></script><script type="application/ld+json">{"a":1}</script>';
    const want = `'sha256-${createHash('sha256').update('\nlet a = 1;\n').digest('base64')}'`;
    assert.deepEqual(inlineScriptHashes(html), [want], 'CRLF must be hashed as LF, and data blocks and src scripts skipped');
    const csp = pageCsp(html);
    assert.match(csp, new RegExp(`script-src 'self' 'wasm-unsafe-eval' ${want.replace(/[+/]/g, '\\$&')}`));
    assert.ok(!/'unsafe-eval'|script-src[^;]*'unsafe-inline'/.test(csp), 'the page policy allows inline or eval script');
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
});

test('the pages in site/ need nothing the policy forbids', () => {
    const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
    for (const file of walk(SITE).filter((f) => f.endsWith('.html'))) {
        const html = readFileSync(file, 'utf8');
        assert.ok(!/\son[a-z]+\s*=\s*["']/i.test(html), `${file} has an inline event handler, which the policy blocks`);
        assert.ok(!/(href|src)\s*=\s*["']javascript:/i.test(html), `${file} has a javascript: URL`);
        for (const m of html.matchAll(/<script\s[^>]*src\s*=\s*["']([^"']+)/gi)) {
            assert.ok(!/^(https?:)?\/\//.test(m[1]), `${file} loads a script from another host: ${m[1]}`);
        }
        const inline = [...html.matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script/gi)].filter((m) => !/\ssrc\s*=/.test(m[1] ?? '') && m[2].trim()
            && !/type\s*=\s*["']?application\/(ld\+)?json/i.test(m[1] ?? ''));
        assert.equal(inlineScriptHashes(html).length, new Set(inline.map((m) => m[2].replace(/\r\n?/g, '\n'))).size, `${file}: an inline script is not hashed`);
    }
});

test('REPOSITORY ASSERTION: the server applies the rules above', () => {
    assert.match(server, /async function route\(req, res\) \{\n?\r?\n?\s*applySecurityHeaders\(res\);/);
    assert.match(server, /res\.setHeader\('content-security-policy', pageCsp\(body\.toString\('utf8'\)\)\)/);
    assert.equal((server.match(/readJson\(req, \{ allowed: CORS_ORIGINS \}\)/g) ?? []).length, 2);
    assert.match(server, /checkIntakeLimits\(intake, \{ demoVinHashes: DEMO_VIN_HASHES/);
    assert.match(server, /intakeBudget\.take\(callerIp\(req, PROXIES\)\)/);
    assert.match(server, /boundVehicles\(vehicles, STANDING, MAX_ADDED_VEHICLES\)/);
    assert.match(server, /return json\(res, statusOf\(e\), \{ error: safeText\(e\.message \?\? e\) \}\);/);
    assert.ok(!/e\.code === 'CAP' \? 429/.test(server), 'the old cap mapping that answered 400 is back');
    assert.match(server, /const HOST = process\.env\.VINPASSPORT_HOST\?\.trim\(\) \|\| '127\.0\.0\.1';/);
    assert.match(server, /server\.listen\(port, HOST,/);
    for (const route of ['job', 'report']) assert.ok(server.includes(`path === '/api/demo/${route}'`));
    assert.equal((server.match(/jobs\.get\(url\.searchParams\.get\('id'\)/g) ?? []).length, 2, 'a job route reads the runner directly');
    assert.ok(!/runner\.job\(url/.test(server));
    assert.match(server, /safeText\(runnerError\.message\)/);
});
