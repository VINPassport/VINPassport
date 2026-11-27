/**
 * The functional frontend, in one command:
 *
 *   npm run app        ->  http://localhost:8790
 *
 * Serves every site surface and runs the REAL compiled circuits in-process:
 *
 *   /            home - the problem and the mechanism
 *   /compliance/ what Euro 7 and Reg (EU) 2026/1738 require, and when
 *   /scan/       scan a vehicle: a passport code, a VIN or a link
 *   /v/          the verdict - what a passport has proven and what it has not
 *   /intake/     intake - fill in the fields, submit, watch the proofs land
 *   /proofs/     proof explorer - every claim on the ledger, with status
 *   /demo/       the guided run against the DEPLOYED contract (VINPASSPORT_NETWORK_ID, Preview by default)
 *   /verify/, /guide/, /regulation/, /console/ and /wallet/ forward to /v/, /how-it-works/,
 *                /compliance/, /intake/ and /developers/, query kept (old links and printed QR codes)
 *
 *   POST /api/intake   run an intake through the circuits (register, record,
 *                      prove). Refusals are results: a step the circuit
 *                      rejects writes nothing and is reported as refused.
 *   GET  /api/ledger   the public ledger as an observer would see it -
 *                      commitments and claims, never a value or a VIN
 *   GET  /api/health   {"ok":true}
 *
 * HTTP rules (scripts/lib/app-http.mjs): security headers and a per-page CSP
 * on every response, JSON bodies only as application/json and only from this
 * server's own pages or the listed sites, a per-caller budget on every route
 * that writes, error text redacted of credentials. It listens on 127.0.0.1
 * unless VINPASSPORT_HOST says otherwise, and believes X-Forwarded-For only
 * from a proxy VINPASSPORT_TRUST_PROXY names.
 *
 * Zero dependencies beyond Node itself, by design (D11's spirit): a judge
 * clones, installs, and has the full flow running in one command. The ledger
 * lives in memory, seeded with the two demo vehicles; restarting resets it.
 * Values submitted through the console exist only inside this process - the
 * export they produce is the same shape the chain would show.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join, normalize } from 'node:path';
import {
    PassportSimulator, buildDemoVehicles, applyIntake, exportLedger, vocabulary, saltStream,
    CONSOLE_REGISTRAR_SECRET, vinHash, hex
} from './lib/scenario.mjs';
import { requireIntakeFields, resolveWriters } from './lib/intake-engine.mjs';
import {
    typeOf, applySecurityHeaders, pageCsp, readJson, callerIp, trustedProxies, ipBudget, statusOf,
    safeText, safeDeep, checkIntakeLimits, jobWindow, boundVehicles
} from './lib/app-http.mjs';
import { takeSeedLock } from './lib/files.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 8790);
// Loopback unless told otherwise: a proxy on this machine is how the public reaches it.
const HOST = process.env.VINPASSPORT_HOST?.trim() || '127.0.0.1';
const PROXIES = trustedProxies();

// ---------------------------------------------------------------- state

const sim = await PassportSimulator.create();
const salt = saltStream();
const demo = await buildDemoVehicles(sim, salt);

// ------------------------------------------------------------ chain demo
// Off by default: `npm run app` stays the dependency-light judge path. With
// VINPASSPORT_CHAIN=1 (`npm run app:chain` sets it), /api/demo/* runs REAL
// transactions against the contract deployed on VINPASSPORT_NETWORK_ID
// (default preview; ledger 9 runner, scripts/lib/runner9.mjs) - capped per UTC
// day, one at a time, fresh random VPD VINs.
const DEMO_ENABLED = process.env.VINPASSPORT_CHAIN === '1';
let runner = null;
let runnerError = null;
if (DEMO_ENABLED) {
    // One process per seed (scripts/lib/files.mjs), taken before the wallet opens.
    try { takeSeedLock(process.env.VINPASSPORT_NETWORK_ID ?? 'preview'); } catch (e) {
        console.error(e.message);
        process.exit(1);
    }
    import('./lib/runner9.mjs')
        .then((m) => m.createRunner({ log: console.log }))
        .then((r) => { runner = r; })
        .catch((e) => { runnerError = e; console.error('chain demo failed to start:', e.message); });
}
const vehicles = [
    { vinHash: demo.a.vinHex, title: 'Vehicle A', blurb: 'Full service history, claims proven' },
    { vinHash: demo.b.vinHex, title: 'Vehicle B', blurb: 'A record it cannot prove clean' }
];
const STANDING = vehicles.length;
const DEMO_VIN_HASHES = new Set([demo.a.vinHex, demo.b.vinHex]);
const MAX_ADDED_VEHICLES = Number(process.env.VINPASSPORT_MAX_ADDED_VEHICLES ?? 50);

// ---------------------------------------------------------------- static

async function serveStatic(res, urlPath) {
    // The published site is the single source: every path resolves under site/,
    // and a directory path serves its index.html, exactly as Pages does.
    let rest = urlPath;
    if (!rest.slice(rest.lastIndexOf('/')).includes('.')) {
        rest = rest.endsWith('/') ? rest + 'index.html' : rest + '/index.html';
    }
    const file = normalize(join(ROOT, 'site', rest));
    if (!file.startsWith(normalize(join(ROOT, 'site')))) { res.writeHead(403); return res.end(); }
    try {
        const body = await readFile(file);
        const type = typeOf(file);
        // A page gets its own policy: the hashes of exactly its inline scripts.
        if (type.startsWith('text/html')) res.setHeader('content-security-policy', pageCsp(body.toString('utf8')));
        res.writeHead(200, { 'content-type': type });
        res.end(body);
    } catch {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('not found');
    }
}

// ---------------------------------------------------------------- api

// Serialise BEFORE committing to a status code. Writing the header first and
// stringifying after means a value that cannot be represented sends a 200 with
// an empty body - a caller then fails on parse and has nothing to report,
// which is a worse outcome than a plain 500 saying what happened.
const json = (res, code, obj) => {
    let body;
    try {
        body = JSON.stringify(obj);
    } catch (e) {
        console.error('demo: response could not be serialised:', String(e?.message ?? e));
        body = JSON.stringify({ error: 'response could not be serialised' });
        code = 500;
    }
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
    res.end(body);
};

function ledgerPayload() {
    return {
        ledger: exportLedger(sim, 'vinpassport, compiled circuits run in-process by scripts/app-server.mjs'),
        vocabulary: vocabulary(vehicles)
    };
}

// /api/intake rewrites the one simulator every visitor reads, so it has a
// budget per caller and per day, and it never touches a standing demo vehicle.
const intakeBudget = ipBudget({ perDay: Number(process.env.VINPASSPORT_PER_IP_INTAKES ?? 20), what: 'intakes' });
const INTAKE_DAILY_CAP = Number(process.env.VINPASSPORT_INTAKE_DAILY_CAP ?? 500);
const intakeDay = { date: null, used: 0 };

async function handleIntake(req, res) {
    let intake;
    try { intake = await readJson(req, { allowed: CORS_ORIGINS }); }
    catch (e) { return json(res, e.code ?? 400, { error: e.message }); }
    // Validation and label resolution live in intake-engine.mjs, which the
    // browser console also calls. Two intake paths is how delegation came to
    // be honoured on one and silently dropped on the other.
    let writers;
    try {
        requireIntakeFields(intake);
        checkIntakeLimits(intake, { demoVinHashes: DEMO_VIN_HASHES, vinHashOf: (v) => hex(vinHash(v)) });
        writers = resolveWriters(intake);
    } catch (e) {
        return json(res, statusOf(e, e.code ?? 400), { error: safeText(e.message) });
    }
    const today = new Date().toISOString().slice(0, 10);
    if (intakeDay.date !== today) Object.assign(intakeDay, { date: today, used: 0 });
    if (intakeDay.used >= INTAKE_DAILY_CAP) {
        return json(res, 429, { error: `this server has run its ${INTAKE_DAILY_CAP} intakes for today; the counter resets at 00:00 UTC` });
    }
    try { intakeBudget.take(callerIp(req, PROXIES)); }
    catch (e) { return json(res, statusOf(e, 429), { error: e.message }); }
    intakeDay.used += 1;

    const result = await applyIntake(
        sim,
        { ...intake, writers, registrarSecret: CONSOLE_REGISTRAR_SECRET },
        salt
    );
    if (!vehicles.some((v) => v.vinHash === result.vinHex) &&
        result.applied.includes('registerPassport')) {
        vehicles.push({
            vinHash: result.vinHex,
            title: String(intake.label || 'Added vehicle').slice(0, 60),
            blurb: 'Added through the intake console'
        });
        boundVehicles(vehicles, STANDING, MAX_ADDED_VEHICLES);
    }
    // The response carries results and public identifiers only - the values
    // stay in this process, exactly as they would stay in a wallet.
    json(res, 200, result);
}

// Per-caller share of the daily cap.
//
// The global cap bounds what the wallet spends in a day; this bounds what any
// one caller may take of it, so the day's runs are still there for the next
// visitor. Open to anyone by design - a stranger clicking it is the point.
const PER_IP_RUNS = Number(process.env.VINPASSPORT_PER_IP_RUNS ?? 2);
const runBudget = ipBudget({ perDay: PER_IP_RUNS, what: 'runs (each writes permanent public state, so the rest are left for other visitors)' });

// The jobs this server handed out. Finished ones are served for a bounded time
// and count, then forgotten here (scripts/lib/app-http.mjs jobWindow).
const jobs = jobWindow({
    lookup: (id) => runner?.job(id) ?? null,
    // Frees the receipt in the runner too, once the runner offers forget(id).
    onEvict: (id) => runner?.forget?.(id),
    ttlMs: Number(process.env.VINPASSPORT_JOB_TTL_MINUTES ?? 30) * 60_000,
    maxFinished: Number(process.env.VINPASSPORT_JOB_KEEP ?? 50)
});
if (DEMO_ENABLED) setInterval(() => jobs.sweep(), 60_000).unref();

// The chain demo API. Every route degrades honestly: disabled mode says so,
// a warming wallet says so, a spent daily cap says so with the reset time.
async function handleDemo(req, res, url) {
    const path = url.pathname;
    if (path === '/api/demo/status') {
        if (!DEMO_ENABLED) return json(res, 200, { enabled: false });
        if (runnerError) return json(res, 200, { enabled: true, ready: false, error: safeText(runnerError.message) });
        if (!runner) return json(res, 200, { enabled: true, ready: false, warming: true });
        return json(res, 200, safeDeep(runner.status()));
    }
    if (!DEMO_ENABLED) return json(res, 503, { error: 'chain demo mode is not enabled on this server' });
    if (runnerError) return json(res, 503, { error: 'the chain demo failed to start: ' + safeText(runnerError.message) });
    if (!runner) return json(res, 503, { error: 'the chain demo is still starting; try again shortly' });

    if ((path === '/api/demo/run' || path === '/api/demo/intake') && req.method === 'POST') {
        let body;
        try { body = await readJson(req, { allowed: CORS_ORIGINS }); }
        catch (e) { return json(res, e.code ?? 400, { error: e.message }); }
        let giveBack;
        try { giveBack = runBudget.take(callerIp(req, PROXIES)); }
        catch (e) { return json(res, statusOf(e, 429), { error: safeText(e.message ?? e) }); }
        try {
            const job = path === '/api/demo/run' ? runner.runGuided() : runner.runManual(body);
            jobs.issue(job.id);
            return json(res, 202, { jobId: job.id, status: job.status, remaining: runner.status().remaining });
        } catch (e) {
            // The run never started, so it should not count against them.
            giveBack();
            // The runner's daily cap throws { status: 429 }; a refused intake has no status.
            return json(res, statusOf(e), { error: safeText(e.message ?? e) });
        }
    }
    if (path === '/api/demo/job' && req.method === 'GET') {
        const job = jobs.get(url.searchParams.get('id') ?? '');
        if (!job) return json(res, 404, { error: 'unknown job, or finished too long ago to be kept' });
        return json(res, 200, safeDeep(job));
    }
    if (path === '/api/demo/report' && req.method === 'GET') {
        // The receipt holds the run's values and salts. Whoever holds the job id
        // (the page that started the run) can download it until the job is evicted.
        const job = jobs.get(url.searchParams.get('id') ?? '');
        if (!job) return json(res, 404, { error: 'unknown job, or finished too long ago to be kept' });
        if (!job.receipt) return json(res, 409, { error: safeText('no report yet: job is ' + job.status + (job.error ? ' (' + job.error + ')' : '')) });
        const receipt = safeDeep(job.receipt);
        res.writeHead(200, {
            'content-type': 'application/json; charset=utf-8',
            'content-disposition': `attachment; filename="vinpassport-demo-${String(receipt.vin).replace(/[^A-Za-z0-9-]/g, '')}.json"`,
            'cache-control': 'no-store'
        });
        return res.end(JSON.stringify(receipt, null, 2));
    }
    return json(res, 404, { error: 'unknown demo endpoint' });
}

// ---------------------------------------------------------------- server

// The published site lives on passport.vin (GitHub Pages) while /api/ lives
// here; the browser needs these headers before it lets that page call us.
const CORS_ORIGINS = new Set(['https://passport.vin', 'https://www.passport.vin']);
function cors(req, res) {
    const origin = req.headers.origin;
    if (origin && CORS_ORIGINS.has(origin)) {
        res.setHeader('access-control-allow-origin', origin);
        res.setHeader('vary', 'origin');
        // `Date` is not one of the headers a cross-origin page may read by
        // default, and the run page's clock needs it: it is the only true
        // server "now" the page ever sees, and without it the clock has to
        // trust the viewer's own, which may be minutes out.
        res.setHeader('access-control-expose-headers', 'date');
    }
}

// One request must not be able to end the process. The handler is async, so
// anything thrown inside it becomes a rejected promise that nothing awaits,
// and Node ends the process on an unhandled rejection - which is how a single
// GET took the demo engine down mid-run, along with the run it was reporting
// on. A failed request is a 500; the engine keeps the wallet and the queue.
const server = createServer((req, res) => {
    route(req, res).catch((e) => {
        console.error('demo: request failed:', String(e?.stack ?? e));
        if (!res.headersSent) json(res, 500, { error: 'internal error' });
        else try { res.end(); } catch { /* client already gone */ }
    });
});

async function route(req, res) {
    applySecurityHeaders(res);
    const url = new URL(req.url, 'http://x');
    const { pathname } = url;
    if (pathname.startsWith('/api/')) {
        cors(req, res);
        if (req.method === 'OPTIONS') {
            res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
            res.setHeader('access-control-allow-headers', 'content-type');
            res.setHeader('access-control-max-age', '86400');
            res.writeHead(204);
            return res.end();
        }
    }
    if (pathname === '/api/health') return json(res, 200, { ok: true });
    if (pathname === '/api/ledger' && req.method === 'GET') return json(res, 200, ledgerPayload());
    if (pathname === '/api/intake' && req.method === 'POST') return handleIntake(req, res);
    if (pathname.startsWith('/api/demo/')) return handleDemo(req, res, url);
    if (pathname.startsWith('/api/')) return json(res, 404, { error: 'unknown endpoint' });
    return serveStatic(res, pathname);
}

// A busy port greets nobody with a stack trace: walk forward a few ports -
// the previous run, or another tool, may still be holding the default.
//
// NOT in chain mode. There a busy port means an instance is already
// running, and exactly one process may hold the wallet state. The
// convenience is worth a stack trace; a second wallet is not.
let port = PORT;
server.on('error', (e) => {
    if (e.code === 'EADDRINUSE' && !DEMO_ENABLED && port < PORT + 10) {
        console.log(`port ${port} is in use, trying ${port + 1}…`);
        server.listen(++port, HOST);
    } else if (e.code === 'EADDRINUSE' && DEMO_ENABLED) {
        console.error(`port ${port} is already in use, and VINPASSPORT_CHAIN=1.`);
        console.error('Refusing to start a second instance against the same wallet state.');
        console.error('Stop the running instance first (systemctl stop vinpassport-demo).');
        process.exit(1);
    } else {
        console.error(e.message);
        process.exit(1);
    }
});
server.listen(port, HOST, () => {
    console.log(`VINPassport app  http://${HOST.includes(':') ? `[${HOST}]` : HOST}:${port}`);
    console.log(`  site  /       scan  /scan/       verdict  /v/       intake  /intake/       proofs  /proofs/`);
    console.log(`  circuits: compiled vinpassport, in-process; ledger resets on restart`);
});
