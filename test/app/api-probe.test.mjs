/**
 * The API probe must give up, and it must not name a host of its own.
 *
 * Every surface that reads ledger state calls `resolveApiBase()` before it
 * renders anything. For months that probed a hard-coded demo host as well as
 * the page's own origin. When that host stopped answering, the probe had no
 * deadline, so the wait became the browser's connection timeout: tens of
 * seconds of nothing, on three pages, before the static export it falls back
 * to could be shown. The static export was present and complete the whole
 * time.
 *
 * So two rules, and this file is why they cannot quietly come back:
 *
 *   1. every probe has a deadline, and a host that is not answering costs
 *      about that long rather than however long the browser waits
 *   2. the module names no host. A page declares one with
 *      <meta name="vinpassport-api">, so retiring it is an edit to the page
 *      that used it, not to a constant every surface shares
 *
 * Without rule 1 the first test here does not fail, it hangs, which is exactly
 * what the pages did.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'site', 'assets', 'sources.mjs');

/** A page with no `<meta name="vinpassport-api">`. */
const documentWithoutMeta = { querySelector: () => null };
/** A page that names one. */
const documentNaming = (href) => ({
    querySelector: (sel) => sel.includes('vinpassport-api')
        ? { getAttribute: () => href }
        : null
});

/**
 * A fresh copy of the module per test, because `resolveApiBase` memoises its
 * answer for the life of the page and these tests are different pages.
 */
async function loadModule({ doc, fetch }) {
    globalThis.document = doc;
    globalThis.fetch = fetch;
    return import(`${new URL('file:///' + SRC.replace(/\\/g, '/')).href}?t=${Math.random()}`);
}

const neverAnswers = () => new Promise(() => { });

test('a host that never answers costs about the deadline, not the browser timeout', async () => {
    const { resolveApiBase } = await loadModule({
        doc: documentWithoutMeta, fetch: neverAnswers
    });
    const started = Date.now();
    const base = await resolveApiBase();
    const elapsed = Date.now() - started;

    assert.equal(base, null, 'nothing answered, so there is no API base');
    assert.ok(elapsed < 4000, `gave up in ${elapsed}ms, which must be bounded`);
});

test('the module names no host of its own, so a page that names none probes only itself', async () => {
    const tried = [];
    const { resolveApiBase } = await loadModule({
        doc: documentWithoutMeta,
        fetch: (url) => { tried.push(String(url)); return Promise.resolve({ ok: false }); }
    });
    await resolveApiBase();

    assert.deepEqual(tried, ['/api/health'],
        'only the page\'s own origin; a hard-coded host here is the defect this prevents');
});

test('a page may name a host, and it is probed after the page\'s own origin', async () => {
    const tried = [];
    const { resolveApiBase } = await loadModule({
        doc: documentNaming('https://demo.example'),
        fetch: (url) => {
            tried.push(String(url));
            return Promise.resolve({ ok: String(url).startsWith('https://demo.example') });
        }
    });
    const base = await resolveApiBase();

    assert.deepEqual(tried, ['/api/health', 'https://demo.example/api/health']);
    assert.equal(base, 'https://demo.example');
});

test('the source carries no hard-coded api host', () => {
    const text = readFileSync(SRC, 'utf8');
    const hosts = text.match(/https?:\/\/[a-z0-9.-]+/gi) ?? [];

    assert.deepEqual(hosts, [],
        `sources.mjs must name no host; found ${hosts.join(', ')}`);
});
