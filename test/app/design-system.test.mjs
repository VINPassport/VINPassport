/**
 * The design system's rules, held by tests rather than by review:
 *
 *   - every colour is a token: no colour literal outside :root in vp.css
 *   - light theme only: no dark-mode styles
 *   - fonts come from this site: no @import, no remote URL, every file present,
 *     licensed, and hashed in SOURCES.md
 *   - the logo files are the outlined originals, and the on-dark set (partner
 *     material only) is not on the site
 *   - icons and link previews are the sizes their tags declare
 *   - the numbers on the regenerated Developers preview match the build and README
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = join(ROOT, 'site');
const CSS = readFileSync(join(SITE, 'assets', 'vp.css'), 'utf8');
const pngSize = (p) => { const b = readFileSync(p); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '');

test('every colour in vp.css is a token: literals appear only in :root', () => {
    const css = stripComments(CSS);
    const roots = [...css.matchAll(/:root\{[^}]*\}/g)].map((m) => m[0]);
    assert.ok(roots.some((r) => r.includes('--passport-blue:#004bb0')), 'the token block is present');
    let rest = css;
    for (const r of roots) rest = rest.replace(r, '');
    const literals = rest.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/g) ?? [];
    assert.deepEqual(literals, [], `colour literals outside :root: ${literals.join(', ')}`);
});

test('light theme only: no dark-mode styles', () => {
    assert.doesNotMatch(CSS, /prefers-color-scheme/);
    assert.match(CSS, /color-scheme:light/);
});

test('fonts are served from this site, present, licensed and hashed', () => {
    assert.doesNotMatch(CSS, /@import/);
    assert.doesNotMatch(stripComments(CSS), /url\(\s*['"]?(https?:)?\/\//, 'no remote url() in vp.css');
    const fontsDir = join(SITE, 'assets', 'fonts');
    const used = [...CSS.matchAll(/url\(fonts\/([^)]+\.woff2)\)/g)].map((m) => m[1]);
    assert.ok(used.length >= 18, `vp.css names its font files (${used.length})`);
    const sources = readFileSync(join(fontsDir, 'SOURCES.md'), 'utf8');
    for (const f of used) {
        assert.ok(existsSync(join(fontsDir, f)), `${f} exists`);
        const sha = createHash('sha256').update(readFileSync(join(fontsDir, f))).digest('hex');
        assert.match(sources, new RegExp(`\\| ${f.replace(/\./g, '\\.')} \\| [^|]+ \\| ${sha} \\|`), `${f} hashed in SOURCES.md`);
    }
    const onDisk = readdirSync(fontsDir).filter((f) => f.endsWith('.woff2'));
    assert.deepEqual(onDisk.sort(), [...new Set(used)].sort(), 'no font file on disk that vp.css does not use');
    for (const lic of ['OFL-Fraunces.txt', 'OFL-IBM-Plex-Sans.txt', 'OFL-IBM-Plex-Mono.txt', 'OFL-Barlow.txt']) {
        assert.match(readFileSync(join(fontsDir, lic), 'utf8'), /SIL Open Font License/, lic);
    }
});

test('the logo files are outlined originals, and the on-dark set is not on the site', () => {
    const brand = join(SITE, 'assets', 'brand');
    const svgs = readdirSync(brand).filter((f) => f.startsWith('vinpassport-'));
    assert.ok(svgs.includes('vinpassport-logo-horizontal-primary.svg'));
    for (const f of svgs) {
        const svg = readFileSync(join(brand, f), 'utf8');
        assert.doesNotMatch(svg, /<text/, `${f} has no live text, so it never depends on a font`);
        assert.doesNotMatch(f, /on-dark/, 'the on-dark logos are for partner material only');
    }
    assert.ok(existsSync(join(brand, 'wave-a.svg')) && existsSync(join(brand, 'wave-b.svg')));
});

test('the manifest names icons that exist at the sizes it declares', () => {
    const manifest = JSON.parse(readFileSync(join(SITE, 'site.webmanifest'), 'utf8'));
    assert.equal(manifest.display, 'browser');
    assert.equal(manifest.theme_color.toLowerCase(), '#f5f0e6');
    for (const icon of manifest.icons) {
        const file = join(SITE, icon.src.replace(/^\//, ''));
        assert.ok(existsSync(file), icon.src);
        assert.equal(pngSize(file).join('x'), icon.sizes, icon.src);
    }
    assert.deepEqual(pngSize(join(SITE, 'assets', 'favicon-16.png')), [16, 16]);
    assert.deepEqual(pngSize(join(SITE, 'assets', 'favicon-32.png')), [32, 32]);
    assert.deepEqual(pngSize(join(SITE, 'assets', 'apple-touch-icon.png')), [180, 180]);
});

test('every link preview is 1200 x 630', () => {
    const og = readdirSync(join(SITE, 'og')).filter((f) => f.endsWith('.png'));
    for (const name of ['home', 'manufacturers', 'compliance', 'developers', 'lifestyle', 'verdict']) {
        assert.ok(og.includes(`og-${name}.png`), `og-${name}.png`);
    }
    for (const f of og) assert.deepEqual(pngSize(join(SITE, 'og', f)), [1200, 630], f);
});

test('the Developers preview carries the build\'s and README\'s numbers', () => {
    const tpl = readFileSync(join(ROOT, 'design', 'og', 'og-developers.html'), 'utf8');
    const stat = (label) => tpl.match(new RegExp(`<b>([^<]+)</b><span>${label}`))?.[1];
    const info = JSON.parse(readFileSync(join(ROOT, 'contracts', 'vinpassport', 'src', 'managed', 'vinpassport', 'compiler', 'contract-info.json'), 'utf8'));
    assert.equal(Number(stat('Circuits')), info.circuits.length, 'circuits');
    const readme = readFileSync(join(ROOT, 'README.md'), 'utf8');
    const tests = readme.match(/\*\*(\d+) contract tests, \d+ app tests/)?.[1];
    assert.ok(tests, 'README states the contract test count');
    assert.equal(stat('Contract tests'), tests, 'contract tests');
    // The current state, not the wave histories (Wave 2's table says 32 of 32, true then).
    const now = readme.slice(readme.indexOf('## Where this actually stands'));
    const guards = now.match(/Contract test suite \| \*\*Done\.\*\* \d+ tests; every guard mutation-checked, (\d+) of (\d+)/);
    assert.ok(guards, 'README states the guard count under "Where this actually stands"');
    assert.equal(stat('Guards<br>mutation-checked'), `${guards[1]}/${guards[2]}`, 'guards');
});

test('a page on the new design never asks Google for fonts', () => {
    const pages = [];
    const walk = (d) => { for (const n of readdirSync(d, { withFileTypes: true })) { const p = join(d, n.name); if (n.isDirectory()) { if (!/engine|zk|fonts|brand|og/.test(n.name)) walk(p); } else if (n.name.endsWith('.html')) pages.push(p); } };
    walk(SITE);
    for (const p of pages) {
        const html = readFileSync(p, 'utf8');
        if (!html.includes('assets/vp.css')) continue;
        assert.doesNotMatch(html, /fonts\.(googleapis|gstatic)\.com/, `${p} uses vp.css and still loads Google Fonts`);
    }
});
