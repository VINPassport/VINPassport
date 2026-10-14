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

/** Every page that carries the shared bar. Mockups are Wave 1 and excluded. */
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
