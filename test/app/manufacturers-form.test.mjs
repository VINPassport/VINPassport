/**
 * The manufacturer application form: what it promises a manufacturer.
 *
 *  1. Every control is labelled and touchable, because Annex V 4.2.1 holds the
 *     passport page to Directive (EU) 2019/882 and this page should not be the
 *     one that falls short.
 *  2. It posts only to a form service we chose, and never with a half-set
 *     configuration: a Web3Forms endpoint without its key is refused.
 *  3. It fails closed. Unconnected, it says so and sends nothing.
 *  4. The privacy notice names who receives the data, on what basis and for how
 *     long, and nothing on the page is left as a placeholder.
 *  5. No price figure appears. Pricing stays out of public material.
 *
 * Tests marked REPOSITORY ASSERTION read source rather than run it: the script
 * needs a browser, and check:pages is what runs it.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = join(ROOT, 'site');
const html = readFileSync(join(SITE, 'manufacturers', 'index.html'), 'utf8');
const js = readFileSync(join(SITE, 'manufacturers', 'apply.js'), 'utf8');
const form = html.slice(html.indexOf('<form id="apply-form"'), html.indexOf('</form>'));

const ENDPOINTS = ['https://api.web3forms.com/submit', 'https://script.google.com/macros/s/'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];

/** Every user-facing control: no hidden inputs, no honeypot. */
const controls = [...form.matchAll(/<(input|select|textarea)\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((t) => attr(t, 'type') !== 'hidden' && attr(t, 'name') !== 'botcheck');

test('every control has a label', () => {
    assert.ok(controls.length >= 10, `expected the full form, found ${controls.length} controls`);
    for (const tag of controls) {
        const id = attr(tag, 'id');
        const labelled = id && form.includes(`<label for="${id}"`);
        // A checkbox may sit inside its label instead.
        const wrapped = attr(tag, 'type') === 'checkbox'
            && new RegExp(`<label class="mf-check"[^>]*><input[^>]*name="${attr(tag, 'name')}"`).test(form);
        assert.ok(labelled || wrapped, `no label for ${tag}`);
    }
});

test('the fields we need to reply are required, and only those', () => {
    const required = controls.filter((t) => /\srequired\b/.test(t)).map((t) => attr(t, 'name')).sort();
    assert.deepEqual(required,
        ['Consent', 'Country', 'Name', 'Organisation', 'Organisation type', 'Timing', 'email'].sort());
    assert.match(form, /<input class="mf-input" id="f-email" name="email" type="email"/,
        'the reply address must be named email, which is the field the services reply to');
});

test('every control clears a 44px touch target', () => {
    const css = html.slice(html.indexOf('<style>'), html.indexOf('</style>'));
    assert.match(css, /\.mf-input\{[^}]*min-height:44px/);
    assert.match(css, /\.mf-check\{[^}]*min-height:44px/);
    assert.match(css, /\.mf-submit\{[^}]*min-height:48px/);
});

test('the honeypot is invisible and out of the tab order', () => {
    const trap = form.match(/<div class="mf-trap"[^>]*>[\s\S]*?<\/div>/)?.[0] ?? '';
    assert.match(trap, /name="botcheck"/, 'no honeypot');
    assert.match(trap, /tabindex="-1"/, 'a keyboard user could tab into the honeypot');
    assert.match(trap, /aria-hidden="true"/, 'a screen reader would announce the honeypot');
    assert.match(html, /\.mf-trap\{display:none\}/);
});

test('the form posts only to a service we chose, never half configured', () => {
    const action = attr(form.match(/<form[^>]*>/)[0], 'action');
    const key = attr(form.match(/<input type="hidden" name="access_key"[^>]*>/)?.[0] ?? '', 'value') ?? '';
    if (action === '') return;                       // unconnected: the next test covers it
    assert.ok(ENDPOINTS.some((e) => action.startsWith(e)), `unexpected endpoint ${action}`);
    if (action.startsWith(ENDPOINTS[0])) assert.match(key, UUID, 'a Web3Forms endpoint with no valid key');
    else assert.equal(key, '', 'an access key with no use only leaks');
});

test('REPOSITORY ASSERTION: the script accepts the same endpoints and fails closed', () => {
    for (const e of ENDPOINTS) assert.ok(js.includes(`'${e}'`), `apply.js does not know ${e}`);
    // Disabled until the script vouches for the endpoint, so neither an
    // unconnected form nor a press before the module runs can post natively.
    assert.match(form, /<button class="mf-submit" type="submit" disabled>/,
        'the button must start disabled');
    assert.match(js, /const MODE = endpoint\(\) \? 'service' : \(contact\(\) \? 'mail' : null\);\s*if \(MODE\) button\.disabled = false;/,
        'only a valid way out may enable the button');
    assert.equal((js.match(/button\.disabled = false/g) ?? []).length, 2,
        'the button is enabled in exactly two places: a valid way out, and a failed send');
    assert.match(js, /body\.success !== true/, 'success must be read from the reply, not assumed');
    assert.ok(!/mode:\s*['"]no-cors['"]/.test(js), 'no-cors hides the reply, so failure would read as success');
});

test('one contact address, and the notice describes the way out actually in use', () => {
    const contact = attr(form.match(/<form[^>]*>/)[0], 'data-contact');
    assert.match(contact, /^[^\s@]+@passport\.vin$/, 'the contact must be an address on our own domain');
    // Every address published on the page is that one address.
    const published = new Set([...html.matchAll(/mailto:([^"?]+)/g)].map((m) => m[1]));
    assert.deepEqual([...published], [contact], `the page publishes more than one address: ${[...published]}`);
    const notice = html.slice(html.indexOf('id="privacy"'), html.indexOf('</main>'));
    const action = attr(form.match(/<form[^>]*>/)[0], 'action');
    if (action === '') {
        assert.match(notice, /your own mail app/, 'mail mode, but the notice describes a form service');
        assert.match(notice, /No form service sits in between/);
    } else {
        assert.ok(!/No form service sits in between/.test(notice), 'a service is wired, but the notice denies one');
        assert.match(notice, action.startsWith(ENDPOINTS[0]) ? /Web3Forms/ : /Google/, 'the notice does not name the service');
    }
    assert.match(form, /<button id="apply-copy" class="mf-copy" type="button" hidden>/,
        'the copy fallback must exist, start hidden, and never submit');
    assert.match(html, /\.mf-copy\{[^}]*min-height:48px/);
});

test('REPOSITORY ASSERTION: the letter never carries form plumbing', () => {
    assert.match(js, /const PLUMBING = new Set\(\['access_key', 'subject', 'from_name', 'botcheck'\]\);/);
    assert.match(js, /if \(PLUMBING\.has\(name\) \|\| !value\) continue;/);
    assert.match(js, /if \(data\.get\('botcheck'\)\) return;/, 'a ticked honeypot must stop both ways out');
});

test('the privacy notice is complete and cites its basis', () => {
    const notice = html.slice(html.indexOf('id="privacy"'), html.indexOf('</main>'));
    for (const must of ['GDPR Art. 13', 'POPIA s18', 'Art. 6(1)(a)', 's11(1)(a)', 'twelve months']) {
        assert.ok(notice.includes(must), `the notice does not say ${must}`);
    }
    assert.ok(!/\{\{[A-Z_]+\}\}/.test(html), 'a placeholder was left on the page');
});

test('no price figure and no dash in the copy', () => {
    const text = html.replace(/<style>[\s\S]*?<\/style>/, '');
    assert.ok(!/[€$£]\s?\d|EUR\s?\d|\d\s?EUR/.test(text), 'a price appears on a public page');
    assert.ok(!/[\u2013\u2014]/.test(text), 'an en or em dash appears in the copy');
});

test('the page is reachable: home page, sitemap and the shared bar', async () => {
    const home = readFileSync(join(SITE, 'index.html'), 'utf8');
    assert.match(home, /<a href="manufacturers\/"/, 'the home page does not link to it');
    assert.ok(readFileSync(join(SITE, 'sitemap.xml'), 'utf8').includes('https://passport.vin/manufacturers/'));
    const { PAGES } = await import('../../scripts/build-nav.mjs');
    assert.ok(PAGES.some((p) => p.file === 'manufacturers/index.html'), 'the bar is not generated for it');
});
