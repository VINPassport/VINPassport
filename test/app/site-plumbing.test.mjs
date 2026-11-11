/**
 * The plumbing behind the 2026 pages: moved addresses, the sitemap, link
 * previews, fonts and the 29 November switch.
 *
 * Printed QR codes say /verify/?v=<key>, and that query IS the passport. A
 * redirect that dropped it would open the sample vehicle instead of the one
 * on the sticker, which is the worst answer this site can give. GitHub Pages
 * has no server redirects, so each moved address keeps a small page whose
 * script forwards the path, the query and the section; these tests run that
 * script, they do not just read it.
 *
 * Link previews are read by chat apps that never run the page's script, so
 * whatever the static head says is what a buyer sees before they open a
 * link. The verdict page's head must therefore claim nothing about a vehicle:
 * a link to a key with no passport must not arrive saying "genuine".
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import vm from 'node:vm';
import { PAGES, MOVED, BAND } from '../../scripts/build-nav.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = join(ROOT, 'site');
const read = (p) => readFileSync(join(SITE, p), 'utf8');
const ORIGIN = 'https://passport.vin/';
const urlOf = (file) => ORIGIN + file.replace(/index\.html$/, '');
const GOLF = '391ce048e0feacde85e7978c2c8320b3763a6c5ed5b2aacc7ca524469bafe357';

/** Run a moved page's forwarding script as a browser would, and say where it went. */
function forward(from, search = '', hash = '') {
    const html = read(`${from}index.html`);
    const script = html.match(/<script data-moved-to="[^"]+">([\s\S]*?)<\/script>/)?.[1];
    assert.ok(script, `${from} has no forwarding script`);
    const location = { search, hash, to: null, replace(u) { this.to = u; } };
    vm.runInNewContext(script, { location });
    assert.ok(location.to, `${from} did not forward`);
    return new URL(location.to, `${ORIGIN}${from}${search}${hash}`).href;
}
const sectionsOf = (from) => JSON.parse(read(`${from}index.html`).match(/sections = (\{[^}]*\})/)[1]);

const htmlFiles = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return /engine|zk|fonts|brand|og/.test(e.name) ? [] : htmlFiles(p);
    return e.name.endsWith('.html') ? [p] : [];
});

// ------------------------------------------------------------------ moved addresses

test('a moved address forwards the path, the query and the section', () => {
    assert.equal(forward('verify/', `?v=${GOLF}`), `${ORIGIN}v/?v=${GOLF}`, 'a printed QR code opens its own passport');
    assert.equal(forward('verify/', `?v=${GOLF}&brand=volta`, '#meanings'), `${ORIGIN}v/?v=${GOLF}&brand=volta#meanings`);
    assert.equal(forward('verify/', '?src=demo'), `${ORIGIN}v/?src=demo`);
    assert.equal(forward('verify/'), `${ORIGIN}v/`);
    assert.equal(forward('guide/', '', '#create'), `${ORIGIN}how-it-works/#life-title`);
    assert.equal(forward('guide/', '', '#somewhere'), `${ORIGIN}how-it-works/#somewhere`, 'an unknown section is carried as it is');
    assert.equal(forward('regulation/', '', '#euro7'), `${ORIGIN}compliance/#euro-7`);
    assert.equal(forward('regulation/', '', '#sources'), `${ORIGIN}compliance/#src-title`);
    assert.equal(forward('console/', '?x=1'), `${ORIGIN}intake/?x=1`);
    for (const { from, to } of MOVED) assert.equal(forward(from), ORIGIN + to, from);
});

test('each old section lands on a section that exists', () => {
    for (const { from, to } of MOVED) {
        const target = read(`${to}index.html`);
        for (const [old, now] of Object.entries(sectionsOf(from))) {
            assert.ok(target.includes(`id="${now}"`), `${from}#${old} lands on #${now}, which /${to} does not have`);
        }
    }
});

test('a moved address is a signpost: no index entry, no header, a link onward without the script', () => {
    const pageFiles = new Set(PAGES.map((p) => p.file));
    for (const { from, to } of MOVED) {
        const file = `${from}index.html`;
        assert.ok(!pageFiles.has(file), `${file} is both a page and a redirect`);
        const html = read(file);
        assert.match(html, /<meta name="robots" content="noindex">/, file);
        assert.ok(html.includes(`<link rel="canonical" href="${ORIGIN}${to}">`), `${file}: canonical names the new address`);
        assert.ok(html.includes(`<meta http-equiv="refresh" content="0; url=../${to}">`), `${file}: no fallback without the script`);
        assert.ok(html.includes(`<a href="../${to}">`), `${file}: no link onward`);
        assert.match(html, /location\.replace\(/, `${file}: forwarding adds a history entry, so Back loops`);
        assert.ok(html.indexOf('<script data-moved-to') < html.indexOf('http-equiv="refresh"'), `${file}: the script must run before the refresh can fire`);
        assert.doesNotMatch(html, /vp-header|vp-footer|<script[^>]+src=|<link rel="stylesheet"/, `${file} loads more than it needs`);
    }
});

test('nothing on the site links to a moved address', () => {
    const moved = MOVED.map((m) => `/${m.from}`);
    const bad = [];
    const movedFiles = new Set(MOVED.map((m) => join(SITE, m.from, 'index.html')));
    for (const file of htmlFiles(SITE)) {
        if (movedFiles.has(file)) continue;
        const rel = relative(SITE, file).split(/[\\/]/).join('/');
        for (const [, href] of read(rel).matchAll(/href="([^"]*)"/g)) {
            if (/^(mailto:|#|https?:\/\/(?!passport\.vin))/.test(href)) continue;
            const path = new URL(href, ORIGIN + rel).pathname;
            if (moved.some((m) => path === m || path.startsWith(m) && !/\.(json|js)$/.test(path))) bad.push(`${rel}: ${href}`);
        }
    }
    // Scripts write links too. The demo data stays under verify/ (verify/demo-data.json,
    // verify/fields.json, and loadState('../verify/')), which is data, not a page link.
    const scripts = readdirSync(join(SITE, 'assets')).filter((f) => /\.m?js$/.test(f)).map((f) => `assets/${f}`)
        .concat(['v/v.mjs', 'scan/scan.mjs', 'demo/demo.js', 'intake/intake.js', 'proofs/proofs.js', 'disclose/disclose.js']);
    for (const s of scripts) {
        const js = read(s);
        for (const m of js.matchAll(/(?:verify|guide|regulation|console)\/(?:\?|#|['"`])/g)) {
            const at = js.slice(Math.max(0, m.index - 40), m.index + 20);
            if (/loadState\(\s*'\.\.\/verify\/'/.test(at)) continue;
            bad.push(`${s}: …${at.replace(/\s+/g, ' ')}…`);
        }
    }
    assert.deepEqual(bad, []);
});

// ------------------------------------------------------------------ sitemap and previews

test('the sitemap lists every page once, and no moved address', () => {
    const locs = [...read('sitemap.xml').matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    assert.equal(new Set(locs).size, locs.length, 'a page is listed twice');
    const expected = PAGES.filter((p) => p.file !== '404.html').map((p) => urlOf(p.file)).concat(`${ORIGIN}deck/`);
    assert.deepEqual([...locs].sort(), [...expected].sort());
    assert.match(read('robots.txt'), /^Sitemap: https:\/\/passport\.vin\/sitemap\.xml$/m);
});

test('every page carries its own title, description and link preview', () => {
    const titles = new Set();
    const descriptions = new Set();
    const images = new Set();
    for (const { file } of PAGES.filter((p) => p.file !== '404.html')) {
        const head = read(file).split('</head>')[0];
        const meta = (re) => head.match(re)?.[1];
        const title = meta(/<title>([^<]+)<\/title>/);
        const description = meta(/<meta name="description" content="([^"]+)">/);
        const canonical = meta(/<link rel="canonical" href="([^"]+)">/);
        const image = meta(/<meta property="og:image" content="([^"]+)">/);
        assert.match(title ?? '', /^VINPassport · .+|.+ · VINPassport$/, `${file}: title names the site`);
        assert.ok(description && description.length >= 50 && description.length <= 180, `${file}: description of ${description?.length} characters`);
        assert.ok(!titles.has(title) && !descriptions.has(description), `${file} repeats another page's title or description`);
        titles.add(title); descriptions.add(description);
        assert.equal(canonical, urlOf(file), `${file}: canonical`);
        assert.equal(meta(/<meta property="og:url" content="([^"]+)">/), canonical, `${file}: og:url`);
        for (const p of ['og:title', 'og:description', 'og:image:alt']) assert.ok(meta(new RegExp(`<meta property="${p}" content="([^"]+)">`)), `${file}: ${p}`);
        assert.match(image ?? '', /^https:\/\/passport\.vin\/og\/[\w-]+\.png$/, `${file}: previews need an absolute image address`);
        assert.ok(existsSync(join(SITE, image.slice(ORIGIN.length))), `${file}: ${image} is not on the site`);
        assert.equal(meta(/<meta name="twitter:card" content="([^"]+)">/), 'summary_large_image', `${file}: twitter:card`);
        assert.equal(meta(/<meta name="twitter:image" content="([^"]+)">/), image, `${file}: twitter:image`);
        images.add(image.slice(`${ORIGIN}og/`.length, -'.png'.length));
    }
    // Each preview is rendered from a template built on the site's own stylesheet (scripts/build-og.mjs),
    // so a change of font or wording reaches the pictures too; a picture no page names is not kept.
    for (const name of images) assert.ok(existsSync(join(ROOT, 'design', 'og', `${name}.html`)), `site/og/${name}.png has no template in design/og/`);
    const kept = readdirSync(join(SITE, 'og')).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4));
    assert.deepEqual(kept.sort(), [...images].sort(), 'site/og/ holds exactly the previews the pages name');
    assert.match(read('404.html'), /<meta name="robots" content="noindex">/);
});

test('a link to a verdict previews as a check, never as a verdict', () => {
    const head = read('v/index.html').split('</head>')[0];
    const said = [...head.matchAll(/<(?:title)>([^<]+)<|(?:og:title|og:description|og:image:alt|name="description") content="([^"]+)"/g)]
        .map((m) => m[1] ?? m[2]).join(' | ');
    assert.doesNotMatch(said, /genuine|this passport is|passed|clean/i, 'a chat preview vouches for whatever key the link carries');
    assert.doesNotMatch(head, /og-verdict\.png/, 'the verdict picture shows a result the linked passport may not have');
});

// ------------------------------------------------------------------ fonts and the switch

test('the deck serves the site\'s own fonts and logos, hashed and licensed', () => {
    const deck = readFileSync(join(ROOT, 'deck', 'index.html'), 'utf8');
    assert.doesNotMatch(deck, /fonts\.(googleapis|gstatic)\.com|<link rel="stylesheet" href="https?:/);
    const sources = readFileSync(join(ROOT, 'deck', 'fonts', 'SOURCES.md'), 'utf8');
    const siteSources = readFileSync(join(SITE, 'assets', 'fonts', 'SOURCES.md'), 'utf8');
    const files = [...deck.matchAll(/url\(fonts\/([\w-]+\.woff2)\)/g)].map((m) => m[1]);
    assert.ok(files.length >= 8, 'the deck declares its fonts');
    for (const file of files) {
        const sha = createHash('sha256').update(readFileSync(join(ROOT, 'deck', 'fonts', file))).digest('hex');
        // Recorded here, and the very file the site serves, as the site recorded it.
        const row = new RegExp(`\\| ${file} \\| (@fontsource[\\w/@.-]+) \\| ${sha} \\|`);
        const pkg = sources.match(row)?.[1];
        assert.ok(pkg, `${file} is not hashed in deck/fonts/SOURCES.md`);
        assert.ok(siteSources.includes(`| ${file} | ${pkg} | ${sha} |`), `${file} differs from site/assets/fonts/`);
    }
    for (const licence of ['OFL-Montserrat.txt', 'OFL-IBM-Plex-Sans.txt', 'OFL-IBM-Plex-Mono.txt', 'OFL-Barlow.txt']) {
        assert.match(readFileSync(join(ROOT, 'deck', 'fonts', licence), 'utf8'), /SIL Open Font License/);
    }
    for (const [, logo] of deck.matchAll(/src="(brand\/[\w-]+\.svg)"/g)) {
        assert.deepEqual(readFileSync(join(ROOT, 'deck', logo)), readFileSync(join(SITE, 'assets', logo)), `deck/${logo} is not the brand kit's file`);
    }
});

test('the old stylesheet and menu script are gone, and nothing asks for them', () => {
    assert.ok(!existsSync(join(SITE, 'assets', 'site.css')) && !existsSync(join(SITE, 'assets', 'nav.mjs')));
    for (const file of htmlFiles(SITE)) {
        assert.doesNotMatch(readFileSync(file, 'utf8'), /assets\/site\.css|assets\/nav\.mjs/, relative(SITE, file));
    }
});

test('a sentence written in two tenses switches with the band, on 29 November 2026', () => {
    let sentences = 0;
    for (const { file } of PAGES) {
        const html = read(file);
        for (const m of html.matchAll(/<(\w+)[^>]*data-switch-at="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)) {
            assert.equal(m[2], BAND.switchAt, `${file}: a second switch date`);
            if (/class="vp-band"/.test(m[0])) continue;
            sentences += 1;
            assert.equal((m[3].match(/class="vp-when-before"/g) ?? []).length, 1, `${file}: one before-text`);
            assert.equal((m[3].match(/class="vp-when-after"/g) ?? []).length, 1, `${file}: one after-text`);
        }
    }
    assert.ok(sentences >= 1, 'the Compliance heading switches tense');
    assert.match(read('compliance/index.html'), /<span class="vp-when-after">Three EU passports\. The first one started on 29 November 2026\.<\/span>/);
    assert.match(read('assets/chrome.mjs'), /querySelectorAll\('\[data-switch-at\]'\)/);
    const css = read('assets/vp.css');
    for (const rule of ['.vp-when-after{display:none}', '.is-after>.vp-when-before{display:none}', '.is-after>.vp-when-after{display:inline}']) assert.ok(css.includes(rule), rule);
});

test('the public site never asks itself for an API it cannot have', async () => {
    // GitHub Pages serves files only, so a probe of passport.vin/api/health can only 404, and
    // each visitor's console would carry the error. Elsewhere (npm run app) the probe still runs.
    const asked = [];
    const resolveOn = async (hostname, n) => {
        const saved = { location: globalThis.location, document: globalThis.document, fetch: globalThis.fetch };
        Object.assign(globalThis, {
            location: { hostname },
            document: { querySelector: () => null },
            fetch: async (url) => { asked.push(`${hostname} ${url}`); return { ok: false }; }
        });
        try {
            const { resolveApiBase } = await import(`../../site/assets/sources.mjs?host=${n}`);
            return await resolveApiBase();
        } finally {
            Object.assign(globalThis, saved);
        }
    };
    assert.equal(await resolveOn('passport.vin', 1), null);
    assert.equal(await resolveOn('www.passport.vin', 2), null);
    assert.equal(await resolveOn('vinpassport.github.io', 3), null);
    assert.deepEqual(asked, [], 'the static site probed itself');
    assert.equal(await resolveOn('localhost', 4), null);
    assert.deepEqual(asked, ['localhost /api/health'], 'the app server is no longer found where it runs');
});
