/**
 * Every page was nav, then content, then footer, with nothing naming the
 * content. A screen reader has no landmark to jump to and no way to skip the
 * seven links in the bar, so reaching the verdict on /verify/ meant tabbing
 * past the whole navigation on every page load.
 *
 * Two of the pages make this easy to get wrong in a way no one would notice.
 * /verify/ throws its own markup away: `verify.js` replaces the body with
 * (nav, stack, footer), so a <main> written into verify/index.html survives
 * only until the script runs. /guide/ is generated, so a <main> added to the
 * output lasts until the next build. Both are asserted at their source.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const SITE = join(ROOT, 'site');

/** Every page the site serves, including the redirect left at the old path. */
const PAGES = ['index.html', 'verify/index.html', 'intake/index.html', 'proofs/index.html',
               'demo/index.html', 'regulation/index.html', 'guide/index.html',
               'console/index.html', 'manufacturers/index.html'];

const read = (page) => readFileSync(join(SITE, page), 'utf8');

test('every page names its content with exactly one main', () => {
    for (const page of PAGES) {
        const html = read(page);
        const opens = html.match(/<main\b/g) ?? [];
        assert.equal(opens.length, 1, `${page} has ${opens.length} <main> elements, expected 1`);
        assert.equal((html.match(/<\/main>/g) ?? []).length, 1, `${page} does not close its main`);
        assert.match(html, /<main id="main">/, `${page} has a main with no id to skip to`);
    }
});

test('the main holds the content, not the bar or the footer', () => {
    for (const page of PAGES.filter((p) => p !== 'console/index.html')) {
        const html = read(page);
        const navEnd = html.indexOf('</nav>');
        const open = html.indexOf('<main');
        const close = html.indexOf('</main>');
        const foot = html.indexOf('<footer');
        assert.ok(navEnd >= 0 && foot >= 0, `${page} is not the usual nav/content/footer shape`);
        assert.ok(open > navEnd, `${page} opens its main before the bar closes`);
        assert.ok(close > open && close < foot, `${page} closes its main inside the footer`);
    }
});

test('every bar starts with a way past it', () => {
    for (const page of PAGES.filter((p) => p !== 'console/index.html')) {
        const html = read(page);
        const nav = html.slice(html.indexOf('<nav'), html.indexOf('</nav>'));
        assert.match(nav, /<a class="nav-skip" href="#main">/,
            `${page} offers no skip link`);
        // It has to be first, or it is a link you reach after the thing it skips.
        const first = nav.indexOf('<a ');
        assert.equal(nav.indexOf('<a class="nav-skip"'), first,
            `${page} puts other links before the skip link`);
    }
    const css = readFileSync(join(SITE, 'assets', 'site.css'), 'utf8');
    assert.match(css, /\.nav-skip\{[^}]*clip-path:inset\(50%\)/,
        'the skip link is not hidden until focus');
    assert.match(css, /\.nav-skip:focus\{[^}]*clip-path:none/,
        'the skip link never becomes visible');
    // Clipped, not pushed off-canvas: the bar scrolls its own overflow.
    assert.ok(!/\.nav-skip\{[^}]*-9999px/.test(css),
        'an off-canvas offset would give the sticky bar a horizontal scrollbar');
});

test('the page that rebuilds itself rebuilds the landmark too', () => {
    const js = readFileSync(join(SITE, 'verify', 'verify.js'), 'utf8');
    // Both exits replace the body: the ledger read that worked, and the one
    // that could not. Neither may hand back a page with no main.
    const built = js.match(/createElement\('main'\)/g) ?? [];
    assert.equal(built.length, 2,
        `verify.js builds ${built.length} main elements, expected one per exit path`);
    assert.ok(!/const stack = document\.createElement\('div'\)/.test(js),
        'the stack is a plain div again, so the rendered page has no main');
    for (const m of js.matchAll(/root\.replaceChildren\(([^)]*)\)/g)) {
        assert.match(m[1], /^nav, \w+, footer$/,
            `verify.js assembles the body as (${m[1]}), which is not nav/main/footer`);
    }
});

test('regenerating the guide cannot drop either of them', () => {
    const gen = readFileSync(join(ROOT, 'scripts', 'build-guide.mjs'), 'utf8');
    assert.match(gen, /<main id="main">/, 'the generator emits no main');
    assert.match(gen, /<\/main>/, 'the generator never closes the main');

    // The skip link arrives with the bar, and the bar now comes from
    // scripts/build-nav.mjs so that all seven pages share one definition.
    // Assert on what reaches the page rather than on which file holds the
    // string: this test used to grep the guide generator, and moving the bar
    // out of it broke the test while the page stayed correct.
    const nav = readFileSync(join(ROOT, 'scripts', 'build-nav.mjs'), 'utf8');
    assert.match(nav, /<a class="nav-skip" href="#main">/, 'the nav builder emits no skip link');

    const built = read('guide/index.html');
    assert.match(built, /<a class="nav-skip" href="#main">/, 'the built guide has no skip link');
    assert.match(built, /<main id="main">/, 'the built guide has no main');
});
