/**
 * The navigation bar is the one piece of markup repeated on every page, which
 * makes it the easiest thing to update on six pages and forget on the seventh.
 *
 * Three properties are asserted here because all three were asked for and all
 * three are invisible to anyone editing a single page: every bar offers the
 * guide, every bar offers ADD PASSPORT, and every bar sticks to the top.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = join(HERE, '..', '..', 'site');

/** Every page that carries the shared bar. */
const PAGES = ['index.html', 'verify/index.html', 'intake/index.html', 'proofs/index.html',
               'demo/index.html', 'regulation/index.html', 'guide/index.html'];

const navOf = (page) => {
    const html = readFileSync(join(SITE, page), 'utf8');
    const a = html.indexOf('<nav');
    const b = html.indexOf('</nav>', a);
    assert.ok(a >= 0 && b > a, `${page} has no nav`);
    return html.slice(a, b);
};

test('every page offers the guide in its bar', () => {
    for (const page of PAGES) {
        const nav = navOf(page);
        const linked = nav.includes('guide/"');
        // The guide page itself marks the spot instead of linking to itself,
        // which is the convention the other sections already use.
        const marked = page === 'guide/index.html' && />Guide</.test(nav);
        assert.ok(linked || marked, `${page} does not offer the guide`);
    }
});

test('every page offers ADD PASSPORT in its bar', () => {
    for (const page of PAGES) {
        const nav = navOf(page);
        assert.ok(nav.includes('ADD PASSPORT'), `${page} has no ADD PASSPORT`);
        if (page === 'intake/index.html') {
            // ADD PASSPORT opens the intake console, so on the console itself
            // it marks where you are rather than offering a trip to here.
            assert.ok(!/<a[^>]*>\s*ADD PASSPORT/.test(nav),
                'the intake page should mark ADD PASSPORT, not link to itself');
        } else {
            assert.match(nav, /<a href="[^"]*intake\/"[^>]*>ADD PASSPORT<\/a>/,
                `${page} does not link ADD PASSPORT to the intake console`);
        }
    }
});

test('every bar is sticky', () => {
    for (const page of PAGES) {
        assert.match(navOf(page), /<nav class="nav-bar"/, `${page} does not carry the sticky class`);
    }
    const css = readFileSync(join(SITE, 'assets', 'site.css'), 'utf8');
    assert.match(css, /\.nav-bar\{[^}]*position:sticky/, 'the sticky rule is missing');
    // A sticky bar over a scrolling page must be opaque, or the content
    // shows through it, and must sit above that content.
    assert.match(css, /\.nav-bar\{[^}]*background:var\(--color-bg\)/, 'the sticky bar is transparent');
    assert.match(css, /\.nav-bar\{[^}]*z-index:/, 'the sticky bar has no stacking order');
    // An anchored jump must clear the bar rather than land under it.
    assert.match(css, /:target\{[^}]*scroll-margin-top/, 'anchors would land behind the bar');
});

test('the stylesheet the pages ask for is the one that carries the rule', () => {
    // The sheet is cache-busted by query string. If a page still asks for an
    // older key it gets a cached sheet without the sticky rule, and the bar
    // silently stops sticking for returning visitors only.
    const keys = new Set();
    for (const page of PAGES) {
        const html = readFileSync(join(SITE, page), 'utf8');
        const m = html.match(/site\.css\?v=(\d+)/);
        assert.ok(m, `${page} does not version the stylesheet`);
        keys.add(m[1]);
    }
    assert.equal(keys.size, 1, `pages disagree on the stylesheet version: ${[...keys].join(', ')}`);
});

test('every bar is the shared one, character for character', async () => {
    // The bars had drifted into three different sets of items: the home page
    // offered Watch, How it works and Honest limits; the application pages
    // offered Intake, Proofs and Verify; the content pages offered a mix. A
    // reader moving between them saw the site change shape. They are now
    // generated from one definition, and this is what keeps them that way.
    const { navMarkup, PAGES: NAV_PAGES } = await import('../../scripts/build-nav.mjs');
    for (const page of NAV_PAGES) {
        const html = readFileSync(join(SITE, page.file), 'utf8').replace(/\r\n/g, '\n');
        const a = html.indexOf('<nav');
        const b = html.indexOf('</nav>', a);
        assert.equal(html.slice(a, b + 6), navMarkup(page),
            `${page.file} has drifted from the shared bar; run node scripts/build-nav.mjs`);
    }
});

test('every bar offers SCAN A VEHICLE', () => {
    for (const page of PAGES) {
        const nav = navOf(page);
        assert.ok(nav.includes('SCAN A VEHICLE'), `${page} has no SCAN A VEHICLE`);
        if (page === 'verify/index.html') {
            // It IS the scan page, so the bar marks the spot rather than
            // offering a trip to where the reader already is.
            assert.ok(!/<a[^>]*>SCAN A VEHICLE/.test(nav),
                'the verify page should mark SCAN A VEHICLE, not link to itself');
        } else {
            assert.match(nav, /<a href="[^"]*verify\/"[^>]*>SCAN A VEHICLE<\/a>/,
                `${page} does not link SCAN A VEHICLE to the verify page`);
        }
    }
});

test('one gap under the bar, on every page', () => {
    // Each page used to set its own: 96px at home, 76px on the guide and the
    // regulation page, 40px on the consoles, and nothing at all on /verify/,
    // where the first line sat against the bar. Those are inline paddings, so
    // the rule that replaces them has to outrank an inline style.
    const css = readFileSync(join(SITE, 'assets', 'site.css'), 'utf8');
    assert.match(css, /--main-top:/, 'there is no shared top-gap token');
    assert.match(css, /main#main\s*>\s*:first-child\{padding-top:var\(--main-top\)!important\}/,
        'the shared top gap is missing, so pages can set their own again');
});
