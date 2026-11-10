/**
 * The redesign's header and footer, as build-nav.mjs writes them, and the
 * pages that carry them.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PAGES, VP_ITEMS, BAND, headerMarkup, footerMarkup } from '../../scripts/build-nav.mjs';
import { bandIsAfter } from '../../site/assets/chrome.mjs';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'site');
const VP_PAGES = PAGES.filter((p) => p.design === 'vp');
const count = (s, re) => (s.match(re) ?? []).length;

test('the page you are on is marked once in the bar and once in the phone menu', () => {
    for (const { key, label } of VP_ITEMS) {
        const html = headerMarkup({ depth: 1, current: key });
        assert.equal(count(html, /aria-current="page"/g), 2, key);
        const desk = html.slice(html.indexOf('class="vp-nav"'), html.indexOf('class="vp-actions"'));
        assert.match(desk, new RegExp(`aria-current="page">${label}<`));
    }
    assert.equal(count(headerMarkup({ depth: 1, current: null }), /aria-current/g), 0);
});

test('the menu button names what it controls and starts closed', () => {
    const html = headerMarkup({ depth: 0, current: null });
    assert.match(html, /<button class="vp-icon-btn vp-burger" type="button" aria-expanded="false" aria-controls="vp-menu" aria-label="Open menu">/);
    assert.match(html, /<div class="vp-menu" id="vp-menu">/);
    assert.match(html, /<a class="vp-skip" href="#main">Skip to main content<\/a>/);
});

test('the logo is the outlined file, with its name, and sized by the stylesheet', () => {
    for (const html of [headerMarkup({ depth: 1, current: null }), footerMarkup({ depth: 1, current: null })]) {
        const img = html.match(/<img src="[^"]*vinpassport-logo-horizontal-primary\.svg"[^>]*>/)?.[0];
        assert.ok(img, 'logo present');
        assert.match(img, /alt="VINPassport"/);
        assert.doesNotMatch(img, /style=/, 'an inline size beats the phone media query');
    }
});

test('the band carries both tenses and switches when Euro 7 applies', () => {
    const html = headerMarkup({ depth: 0, current: null });
    for (const t of [BAND.before.long, BAND.before.short, BAND.after.long, BAND.after.short]) assert.ok(html.includes(t), t);
    assert.ok(html.includes(`data-switch-at="${BAND.switchAt}"`));
    assert.equal(BAND.switchAt, '2026-11-29T00:00:00+01:00', 'Reg (EU) 2024/1257 Art. 21, midnight in Brussels');
    // 29 November 2026, 00:00 in Brussels is 23:00 UTC the day before.
    assert.equal(bandIsAfter(Date.parse('2026-11-28T22:59:59Z'), BAND.switchAt), false);
    assert.equal(bandIsAfter(Date.parse('2026-11-28T23:00:00Z'), BAND.switchAt), true);
    assert.equal(bandIsAfter(Date.now(), 'not a date'), false);
});

test('no sign-in link anywhere (fix B7), and the footer carries what replaced it', () => {
    const html = headerMarkup({ depth: 1, current: null }) + footerMarkup({ depth: 1, current: null });
    assert.doesNotMatch(html, /sign-in|Sign-in|signin/);
    const footer = footerMarkup({ depth: 1, current: null });
    for (const [label, href] of [['Try it live', '../developers/#try'], ['Pitch deck', '../deck/'], ['Privacy', '../privacy/']]) {
        assert.ok(footer.includes(`<a href="${href}">${label}</a>`), label);
    }
});

test('external links open in a new tab, safely, and say so', () => {
    const footer = footerMarkup({ depth: 0, current: null });
    const external = footer.match(/<a href="https:[^"]*"[^>]*>.*?<\/a>/g) ?? [];
    assert.ok(external.length >= 1);
    for (const a of external) {
        assert.match(a, /target="_blank"/);
        assert.match(a, /rel="noopener"/);
        assert.match(a, /<span class="vp-sr"> \(opens in a new tab\)<\/span>/);
    }
    assert.match(footer, /<div class="vp-mrz" aria-hidden="true">/);
});

test('links follow the page: relative by depth, root-absolute on the 404 page', () => {
    const urls = (html) => [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]);
    for (const u of urls(headerMarkup({ depth: 1, current: null }) + footerMarkup({ depth: 1, current: null }))) {
        assert.ok(u.startsWith('../') || u.startsWith('#') || u.startsWith('https://'), u);
    }
    const page404 = readFileSync(join(SITE, '404.html'), 'utf8');
    for (const u of urls(page404)) {
        assert.ok(u.startsWith('/') || u.startsWith('#') || u.startsWith('https://'), `404.html: ${u}`);
    }
});

test('every page on the new design is a complete page', () => {
    assert.ok(VP_PAGES.length >= 2);
    for (const page of VP_PAGES) {
        const html = readFileSync(join(SITE, page.file), 'utf8');
        assert.match(html, /^<!doctype html>\s*<html lang="en">/i, page.file);
        assert.match(html, /<meta name="viewport" content="width=device-width, initial-scale=1">/, page.file);
        assert.match(html, /<meta name="color-scheme" content="light">/, page.file);
        assert.match(html, /assets\/vp\.css">/, page.file);
        assert.match(html, /<script type="module" src="[^"]*assets\/chrome\.mjs"><\/script>/, page.file);
        assert.match(html, /<link rel="manifest" href="[^"]*site\.webmanifest">/, page.file);
        assert.equal(count(html, /<h1[ >]/g), 1, `${page.file}: one h1`);
        assert.equal(count(html, /<main id="main">/g), 1, `${page.file}: one main landmark`);
        assert.ok(html.includes(headerMarkup(page)) && html.includes(footerMarkup(page)), `${page.file}: header and footer as build-nav writes them`);
        if (page.file !== '404.html') assert.match(html, /<link rel="canonical" href="https:\/\/passport\.vin\//, page.file);
    }
});

test('copy rules hold on the new pages: no em or en dashes, never "no personal data"', () => {
    for (const page of VP_PAGES) {
        const text = readFileSync(join(SITE, page.file), 'utf8');
        assert.equal(count(text, /[–—]/g), 0, `${page.file}: em or en dash`);
        assert.doesNotMatch(text, /no personal data/i, `${page.file}: EDPB 02/2025, say what is absent instead`);
    }
});
