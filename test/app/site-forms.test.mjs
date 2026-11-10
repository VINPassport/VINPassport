/**
 * The site's forms (pilot request, contact, lifestyle enquiry), and what each
 * promises the person filling it in. Carries over every guarantee the first
 * manufacturer form's tests held:
 *
 *  1. Every control is labelled and touchable (Annex V 4.2.1 holds the passport
 *     page to Directive (EU) 2019/882; these pages should not fall short).
 *  2. It posts only to a form service we chose, never half configured.
 *  3. It fails closed: the button starts disabled and only a valid way out
 *     enables it.
 *  4. It is honest about delivery: with the mail route, the confirmation says
 *     the email is ready, never that it arrived.
 *  5. The privacy notice it links to names who receives the data, on what basis
 *     and for how long, and describes the way out actually in use.
 *  6. No price and no dash in the copy.
 *
 * Every form on a redesigned page is found and checked, so a new form cannot
 * skip these. Tests marked REPOSITORY ASSERTION read source; check:pages and
 * the Brave run of the form are what execute it.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PAGES } from '../../scripts/build-nav.mjs';
import { ALLOWED, subjectOf, letterOf, mailtoOf, endpointOf, PLUMBING } from '../../site/assets/mail-form.mjs';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'site');
const read = (f) => readFileSync(join(SITE, f), 'utf8');
const attr = (tag, name) => tag.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1];
const JS = read('assets/mail-form.mjs');
const CSS = read('assets/vp.css');

/** Every form on a redesigned page: [file, page html, form html, the block after it]. */
const FORMS = PAGES.filter((p) => p.design === 'vp').flatMap((p) => {
    const html = read(p.file);
    return [...html.matchAll(/<form data-mail-form[\s\S]*?<\/form>/g)].map((m) => {
        const after = html.slice(m.index + m[0].length, html.indexOf('</section>', m.index));
        return { file: p.file, html, form: m[0], after };
    });
});

const controlsOf = (form) => [...form.matchAll(/<(input|select|textarea)\b[^>]*>/g)].map((m) => m[0])
    .filter((t) => attr(t, 'type') !== 'hidden' && attr(t, 'name') !== 'botcheck');

test('the pilot request is among the forms checked', () => {
    assert.ok(FORMS.some((f) => f.file === 'manufacturers/index.html'), 'no form found on /manufacturers/');
});

test('every control has a visible label and a place for its error', () => {
    for (const { file, form } of FORMS) {
        for (const tag of controlsOf(form)) {
            const id = attr(tag, 'id');
            assert.ok(id, `${file}: a control without an id: ${tag}`);
            const labelled = form.includes(`<label for="${id}"`)
                || new RegExp(`<label class="vp-check"><input[^>]*id="${id}"`).test(form);
            assert.ok(labelled, `${file}: no label for #${id}`);
            assert.ok(form.includes(`<p class="field__error" id="${id}-err" hidden></p>`), `${file}: no error slot for #${id}`);
        }
    }
});

test('the reply address is a required email field named email, and consent is required', () => {
    for (const { file, form } of FORMS) {
        const email = controlsOf(form).find((t) => attr(t, 'name') === 'email');
        assert.ok(email, `${file}: the reply field must be named email`);
        assert.equal(attr(email, 'type'), 'email', file);
        assert.match(email, /\srequired\b/, file);
        const consent = controlsOf(form).find((t) => attr(t, 'name') === 'Consent');
        assert.ok(consent && /\srequired\b/.test(consent) && attr(consent, 'type') === 'checkbox', `${file}: consent must be a required checkbox`);
        for (const t of controlsOf(form).filter((c) => /\srequired\b/.test(c))) {
            assert.ok(attr(t, 'data-error'), `${file}: #${attr(t, 'id')} is required but has no plain-word error`);
        }
    }
});

test('every control clears a 44 px touch target', () => {
    assert.match(CSS, /\.input\{[^}]*min-height:44px/);
    assert.match(CSS, /\.vp-check\{[^}]*min-height:44px/);
    assert.match(CSS, /\.vp-btn\{[^}]*min-height:44px/);
});

test('the honeypot is invisible and out of the tab order', () => {
    assert.match(CSS, /\.vp-trap\{display:none\}/);
    for (const { file, form } of FORMS) {
        const trap = form.match(/<div class="vp-trap"[^>]*>[\s\S]*?<\/div>/)?.[0] ?? '';
        assert.match(trap, /aria-hidden="true"/, `${file}: a screen reader would announce the honeypot`);
        assert.match(trap, /name="botcheck"/, `${file}: no honeypot`);
        assert.match(trap, /tabindex="-1"/, `${file}: a keyboard user could tab into the honeypot`);
    }
});

test('a form posts only to a service we chose, never half configured', () => {
    assert.equal(endpointOf('', ''), null);
    assert.equal(endpointOf('https://example.com/collect', ''), null, 'an unknown endpoint is refused');
    assert.equal(endpointOf(ALLOWED[0], ''), null, 'Web3Forms without its key is refused');
    assert.equal(endpointOf(ALLOWED[0], '0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f'), ALLOWED[0]);
    assert.equal(endpointOf(`${ALLOWED[1]}abc/exec`, ''), `${ALLOWED[1]}abc/exec`);
    for (const { file, form } of FORMS) {
        const action = attr(form.match(/<form[^>]*>/)[0], 'action');
        assert.ok(action === '' || ALLOWED.some((a) => action.startsWith(a)), `${file}: unexpected endpoint ${action}`);
    }
});

test('REPOSITORY ASSERTION: it fails closed and reads success from the reply', () => {
    for (const { file, form } of FORMS) {
        assert.match(form, /<button type="submit"[^>]*\sdisabled>/, `${file}: the button must start disabled`);
    }
    assert.match(JS, /const MODE = endpoint \? 'service' : \(contact \? 'mail' : null\);/);
    assert.match(JS, /if \(MODE\) button\.disabled = false;/);
    assert.equal((JS.match(/button\.disabled = false/g) ?? []).length, 2, 'enabled in exactly two places: a valid way out, and a failed send');
    assert.match(JS, /body\.success !== true/);
    assert.ok(!/mode:\s*['"]no-cors['"]/.test(JS), 'no-cors hides the reply, so failure would read as success');
    assert.match(JS, /if \(data\.get\('botcheck'\)\) return;/, 'a ticked honeypot must stop both ways out');
});

test('one contact address, on our own domain, and a copy fallback that never submits', () => {
    for (const { file, form, after } of FORMS) {
        assert.equal(attr(form.match(/<form[^>]*>/)[0], 'data-contact'), 'info@passport.vin', file);
        assert.match(after, /<button type="button" class="vp-btn vp-btn--secondary" data-form-copy>/, `${file}: no copy fallback`);
        assert.match(after, /data-form-status aria-live="polite"/, `${file}: no live status line`);
        assert.match(after, /<div data-form-done role="status" tabindex="-1" hidden/, `${file}: the done state must be announced`);
    }
});

test('with the mail route, the confirmation never claims the message arrived', () => {
    for (const { file, after } of FORMS) {
        const mail = after.match(/<div data-done-when="mail"[\s\S]*?<\/div>\s*<div data-done-when="service"/)?.[0];
        assert.ok(mail, `${file}: no mail confirmation`);
        assert.doesNotMatch(mail, /Received|received|Thank you\. We'll be in touch/, `${file}: the mail route cannot know it arrived`);
        assert.match(mail, /email app/, `${file}: the confirmation must say where the message is`);
    }
});

test('every form links the privacy notice, and the notice describes the mail route in use', () => {
    const notice = read('privacy/index.html');
    for (const { file, form } of FORMS) {
        assert.match(form, /<a href="(\.\.\/)?privacy\/">privacy notice<\/a>/, `${file}: consent does not link the notice`);
        assert.equal(attr(form.match(/<form[^>]*>/)[0], 'action'), '', `${file}: a service is wired; the notice must name it first`);
    }
    for (const must of ['GDPR Art. 13', 'POPIA s18', 'Art. 6(1)(a)', 's11(1)(a)', 'twelve months', 'twenty-four months', 'your own mail app', 'No form service sits in between']) {
        assert.ok(notice.includes(must), `the privacy notice does not say ${must}`);
    }
});

test('the letter never carries form plumbing, and long answers come last', () => {
    for (const p of PLUMBING) assert.ok(['access_key', 'subject', 'from_name', 'botcheck'].includes(p));
    const letter = letterOf('Title', [['Company', 'Volta'], ['botcheck', 'on'], ['access_key', 'x'], ['email', 'a@b.example'], ['Message', 'Hello\nthere'], ['Empty', '  ']], ['Message']);
    assert.equal(letter, 'Title\n\nCompany: Volta\nEmail: a@b.example\n\nMessage:\nHello\nthere');
    assert.equal(subjectOf('VINPassport pilot request', ' Volta '), 'VINPassport pilot request: Volta');
    assert.equal(subjectOf('VINPassport pilot request', ''), 'VINPassport pilot request');
    const href = mailtoOf('info@passport.vin', 'A & B', 'one\ntwo');
    assert.equal(href, 'mailto:info@passport.vin?subject=A%20%26%20B&body=one%0D%0Atwo', 'RFC 6068: CRLF line breaks, everything encoded');
});

test('no price figure and no dash on a page with a form', () => {
    for (const { file, html } of FORMS) {
        assert.ok(!/[€$£]\s?\d|EUR\s?\d|\d\s?EUR/.test(html), `${file}: a price appears on a public page`);
        assert.ok(!/[–—]/.test(html), `${file}: an en or em dash appears in the copy`);
    }
});

test('the pilot request is reachable: home page, header, sitemap', () => {
    assert.match(read('index.html'), /href="manufacturers\/#pilot"/);
    assert.ok(read('sitemap.xml').includes('https://passport.vin/manufacturers/'));
});
