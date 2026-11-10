/**
 * Every page was nav, then content, then footer, with nothing naming the
 * content. A screen reader had no landmark to jump to and no way to skip the
 * links in the bar, so reaching the verdict meant tabbing past the whole
 * navigation on every page load.
 *
 * So: every page the site serves names its content with exactly one <main id="main">,
 * the main sits between the header and the footer rather than around either,
 * and the header opens with a link past itself that stays hidden until it is
 * focused. The pages left at moved addresses carry a main too: a reader
 * whose browser does not run the forwarding script still lands on a page
 * with a landmark and a link onward.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PAGES, MOVED } from '../../scripts/build-nav.mjs';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'site');
const read = (file) => readFileSync(join(SITE, file), 'utf8');
const count = (s, re) => (s.match(re) ?? []).length;

const SERVED = [...PAGES.map((p) => p.file), ...MOVED.map((m) => `${m.from}index.html`)];

test('every page names its content with exactly one main', () => {
    for (const file of SERVED) {
        const html = read(file);
        assert.equal(count(html, /<main\b/g), 1, `${file}: expected one <main>`);
        assert.equal(count(html, /<\/main>/g), 1, `${file} does not close its main`);
        assert.match(html, /<main id="main"[ >]/, `${file} has a main with no id to skip to`);
    }
});

test('the main holds the content, not the header or the footer', () => {
    for (const { file } of PAGES) {
        const html = read(file);
        const headerEnd = html.indexOf('</header>');
        const open = html.indexOf('<main');
        const close = html.indexOf('</main>');
        const foot = html.indexOf('<footer class="vp-footer"');
        assert.ok(headerEnd >= 0 && foot >= 0, `${file} is not the header, content, footer shape`);
        assert.ok(open > headerEnd, `${file} opens its main before the header closes`);
        assert.ok(close > open && close < foot, `${file} closes its main inside the footer`);
    }
});

test('every header starts with a way past it, hidden until it is focused', () => {
    for (const { file } of PAGES) {
        const html = read(file);
        const header = html.slice(html.indexOf('<header class="vp-header"'), html.indexOf('</header>'));
        // It has to be first, or it is a link you reach after the thing it skips.
        assert.equal(header.indexOf('<a '), header.indexOf('<a class="vp-skip" href="#main">'), `${file}: the skip link is not the first link`);
    }
    const css = read('assets/vp.css');
    assert.match(css, /\.vp-skip\{position:absolute;[^}]*top:-64px/, 'the skip link is not parked out of sight');
    assert.match(css, /\.vp-skip:focus\{top:16px\}/, 'the skip link never comes into view on focus');
});
