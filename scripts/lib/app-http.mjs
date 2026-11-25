/**
 * The HTTP rules of the app server (scripts/app-server.mjs), as functions the
 * tests can call without starting it.
 *
 *   - every response carries the security headers below; an HTML page gets a
 *     Content-Security-Policy whose script-src lists the hash of each inline
 *     script that page holds, and nothing else inline;
 *   - a request body is JSON only when it says so (415 otherwise), and a
 *     cross-site page cannot post one: an Origin header, when the browser
 *     sends it, must be this server or a listed site (403 otherwise);
 *   - X-Forwarded-For counts only when VINPASSPORT_TRUST_PROXY says a proxy
 *     stands in front, and only from that proxy;
 *   - every string that leaves in an error goes through the endpoint
 *     redaction, because a provider's error text can carry a URL with the
 *     Blockfrost project id in it;
 *   - per-caller budgets, bounded lists and a window on finished jobs keep
 *     a stranger from growing the process without limit.
 *
 * WHY THE CSP ALLOWS WHAT IT ALLOWS, read from site/ as it stands:
 *   - style-src 'unsafe-inline': most pages carry style="" attributes, and
 *     pages build markup with them through innerHTML. A hash cannot cover an
 *     attribute, so inline style is allowed; inline script is not.
 *   - script-src 'wasm-unsafe-eval': the intake engine compiles its runtime
 *     with WebAssembly.instantiate. Nothing here allows eval.
 *   - connect-src adds the two contact-form endpoints of site/assets/mail-form.mjs
 *     (Google Apps Script answers from script.googleusercontent.com).
 *   - img-src data: blob: for the QR codes and downloads the pages make.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash } from 'node:crypto';
import { redacted, assertNoSecrets } from './endpoints.mjs';

export const TYPES = Object.freeze({
    '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml',
    '.mp4': 'video/mp4', '.webp': 'image/webp', '.ico': 'image/x-icon',
    '.woff2': 'font/woff2', '.webmanifest': 'application/manifest+json',
    // The intake engine's runtime. Served as anything else, the browser
    // refuses to compile it and the console has no circuits.
    '.wasm': 'application/wasm'
});

export const typeOf = (file) => TYPES[file.slice(file.lastIndexOf('.')).toLowerCase()] ?? 'application/octet-stream';

/** Sent with every response. */
export const SECURITY_HEADERS = Object.freeze({
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY'
});

const MAIL_ENDPOINTS = ['https://api.web3forms.com', 'https://script.google.com', 'https://script.googleusercontent.com'];

/** For everything that is not a page: nothing may load, nothing may frame it. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'; base-uri 'none'";

/** The sha256 source of each inline script in `html`, as the browser hashes it (CRLF read as LF). */
export function inlineScriptHashes(html) {
    const out = [];
    for (const m of String(html).matchAll(/<script(\s[^>]*)?>([\s\S]*?)<\/script\s*>/gi)) {
        const attrs = m[1] ?? '';
        if (/\ssrc\s*=/i.test(attrs)) continue;
        // A data block is never run, so CSP does not apply to it.
        const type = /\stype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1]?.toLowerCase();
        if (type && !['module', 'text/javascript', 'application/javascript'].includes(type)) continue;
        const text = m[2].replace(/\r\n?/g, '\n');
        out.push(`'sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}'`);
    }
    return [...new Set(out)];
}

/** The policy for one page. */
export function pageCsp(html) {
    return [
        "default-src 'self'",
        `script-src 'self' 'wasm-unsafe-eval'${inlineScriptHashes(html).map((h) => ` ${h}`).join('')}`,
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "media-src 'self'",
        "font-src 'self'",
        `connect-src 'self' ${MAIL_ENDPOINTS.join(' ')}`,
        `form-action 'self' ${MAIL_ENDPOINTS.join(' ')}`,
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'"
    ].join('; ');
}

/** Set the headers every response carries; `csp` defaults to the API policy. */
export function applySecurityHeaders(res, csp = API_CSP) {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.setHeader(k, v);
    res.setHeader('content-security-policy', csp);
}

/** True for the server's own origin (as the request names its host) or a listed one. */
export function originAllowed(req, allowed) {
    const origin = req.headers?.origin;
    if (!origin) return true;
    const host = req.headers?.host;
    if (host && (origin === `http://${host}` || origin === `https://${host}`)) return true;
    return allowed.has(origin);
}

/**
 * The JSON body of `req`: 415 unless it says application/json, 403 for a
 * cross-site Origin, 413 past `limit` characters, 400 when it does not parse.
 * Errors carry the status as `code`.
 */
export async function readJson(req, { allowed = new Set(), limit = 100_000 } = {}) {
    const type = String(req.headers?.['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (type !== 'application/json') {
        throw Object.assign(new Error('send the body as application/json'), { code: 415 });
    }
    if (!originAllowed(req, allowed)) {
        throw Object.assign(new Error('requests from this origin are not accepted'), { code: 403 });
    }
    let body = '';
    for await (const chunk of req) {
        body += chunk;
        if (body.length > limit) throw Object.assign(new Error('body too large'), { code: 413 });
    }
    try { return body ? JSON.parse(body) : {}; }
    catch { throw Object.assign(new Error('body is not JSON'), { code: 400 }); }
}

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/**
 * Who forwards for us, from VINPASSPORT_TRUST_PROXY: unset means nobody, so
 * X-Forwarded-For is ignored; '1', 'true' or 'loopback' means a proxy on this
 * machine; anything else is a comma list of proxy addresses.
 */
export function trustedProxies(value = process.env.VINPASSPORT_TRUST_PROXY) {
    const v = String(value ?? '').trim();
    if (!v || v === '0' || v.toLowerCase() === 'false') return new Set();
    if (['1', 'true', 'loopback'].includes(v.toLowerCase())) return LOOPBACK;
    return new Set(v.split(',').map((s) => s.trim()).filter(Boolean));
}

/**
 * The caller's address. A trusted proxy appends the address it observed, so
 * the last hop is the one it vouches for; earlier entries arrived with the
 * request and carry no authority.
 */
export function callerIp(req, proxies = trustedProxies()) {
    const sock = req.socket?.remoteAddress ?? '';
    if (!proxies.has(sock)) return sock || 'unknown';
    const hops = String(req.headers?.['x-forwarded-for'] ?? '').split(',').map((h) => h.trim()).filter(Boolean);
    return hops.length ? hops[hops.length - 1] : (sock || 'unknown');
}

/**
 * A per-caller allowance per UTC day. `take(ip)` returns a function that
 * gives the slot back, or throws with status 429. At most `maxEntries`
 * callers are remembered; the oldest is dropped first.
 */
export function ipBudget({ perDay, maxEntries = 5000, what = 'runs', now = () => new Date() }) {
    const seen = new Map();
    return {
        take(ip) {
            const today = now().toISOString().slice(0, 10);
            const rec = seen.get(ip);
            const cur = rec && rec.date === today ? rec : { date: today, used: 0 };
            if (cur.used >= perDay) {
                throw Object.assign(new Error(`you have used ${cur.used} ${what} today, the most one caller may. `
                    + 'The counter resets at 00:00 UTC.'), { status: 429 });
            }
            cur.used += 1;
            seen.delete(ip);
            seen.set(ip, cur);
            if (seen.size > maxEntries) seen.delete(seen.keys().next().value);
            return () => { cur.used = Math.max(0, cur.used - 1); };
        },
        size: () => seen.size
    };
}

/** The status for an error a runner threw: its own `status` first, then the old codes. */
export function statusOf(e, fallback = 400) {
    const s = Number(e?.status);
    if (Number.isInteger(s) && s >= 400 && s <= 599) return s;
    if (e?.code === 'CAP') return 429;
    return fallback;
}

/**
 * A string fit to send: the project id cut out of any URL (redacted()), and
 * if a credential still shows anywhere (assertNoSecrets), a plain sentence
 * in its place.
 */
export function safeText(text) {
    const s = redacted(String(text ?? ''));
    try { assertNoSecrets(s, 'an error message'); return s; } catch {
        return 'the request failed; the details named a credential and are withheld';
    }
}

/** A copy of `value` with every string passed through safeText. */
export function safeDeep(value) {
    if (typeof value === 'string') return safeText(value);
    if (Array.isArray(value)) return value.map(safeDeep);
    if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
        return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, safeDeep(v)]));
    }
    return value;
}

/** Limits on what one POST /api/intake may ask the shared simulator to do. */
export const INTAKE_LIMITS = Object.freeze({ fields: 64, panel: 64, updates: 16, updateFields: 32, grants: 8, authorise: 4, withdraw: 4, prove: 64 });

const sizeOf = (v) => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.keys(v).length : 0);

/**
 * Refuse an intake that would rewrite a standing demo vehicle or is larger
 * than the page ever sends. `demoVinHashes` holds the demo vehicles' keys and
 * `vinHashOf(vin)` returns a key as hex. Throws with status 400.
 */
export function checkIntakeLimits(intake, { demoVinHashes = new Set(), vinHashOf, limits = INTAKE_LIMITS } = {}) {
    const refuse = (m) => { throw Object.assign(new Error(m), { status: 400 }); };
    if (vinHashOf && demoVinHashes.has(vinHashOf(String(intake?.vin ?? '')))) {
        refuse('that VIN belongs to a standing demo vehicle; register a vehicle of your own');
    }
    for (const [key, max] of Object.entries(limits)) {
        if (key === 'updateFields') continue;
        const v = intake?.[key];
        if (v !== undefined && (typeof v !== 'object' || v === null)) refuse(`"${key}" has the wrong shape`);
        if (sizeOf(v) > max) refuse(`"${key}" holds ${sizeOf(v)} entries; at most ${max}`);
    }
    for (const [i, round] of (intake?.updates ?? []).entries()) {
        if (sizeOf(round) > limits.updateFields) refuse(`update ${i + 1} writes ${sizeOf(round)} fields; at most ${limits.updateFields}`);
    }
}

/**
 * The demo jobs this server serves. `lookup(id)` reads a job from the runner.
 * A finished job stays readable for `ttlMs` after it was first seen finished,
 * and only while it is among the `maxFinished` most recent; then `get` stops
 * returning it. Ids this server never handed out are never served. Call
 * `sweep` on a timer so a job nobody polls is still timed out. `onEvict(id)`
 * lets the runner free the job and its receipt too.
 */
export function jobWindow({ lookup, onEvict = () => { }, ttlMs = 30 * 60_000, maxFinished = 50, maxIssued = 1000, now = () => Date.now() }) {
    const issued = new Map();   // id -> when first seen finished, or null while it runs
    const evict = (id) => { issued.delete(id); onEvict(id); };
    const sweep = () => {
        const t = now();
        for (const [id, at] of issued) {
            if (at !== null) continue;
            const job = lookup(id);
            if (!job || job.status === 'done' || job.status === 'failed') issued.set(id, t);
        }
        const done = [...issued].filter(([, at]) => at !== null);
        const over = done.length - maxFinished;
        done.forEach(([id, at], i) => { if (i < over || t - at > ttlMs) evict(id); });
        while (issued.size > maxIssued) evict(issued.keys().next().value);
    };
    return {
        issue(id) { issued.set(id, null); sweep(); },
        get(id) { sweep(); return issued.has(id) ? lookup(id) ?? null : null; },
        sweep,
        size: () => issued.size
    };
}

/** Keep the standing vehicles and at most `max` added ones, dropping the oldest added first. */
export function boundVehicles(list, standing, max = 50) {
    while (list.length - standing > max) list.splice(standing, 1);
    return list;
}
