/**
 * The guide is the only page whose content is mostly pictures, which makes it
 * the page most able to rot without anyone noticing: a renamed screenshot
 * leaves a caption describing an empty box, and an image without intrinsic
 * dimensions makes the page jump under the reader as each one loads.
 *
 * These tests hold the two properties that cannot be seen by reading the
 * prose: every screenshot the page asks for exists, and every one of them
 * declares the size it really is.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const GUIDE = join(HERE, '..', '..', 'site', 'guide');
const html = readFileSync(join(GUIDE, 'index.html'), 'utf8');

/** Every <img> on the page that points at a screenshot, with its attributes. */
const shots = [...html.matchAll(/<img\s+src="(shots\/[^"]+)"[^>]*>/g)].map((m) => ({
    tag: m[0], src: m[1]
}));

/** Width and height out of the PNG header, which cannot disagree with itself. */
function pngSize(file) {
    const b = readFileSync(file).subarray(0, 24);
    assert.equal(b.readUInt32BE(0), 0x89504e47, `${file} is not a PNG`);
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

test('the guide shows both journeys', () => {
    assert.ok(html.includes('id="create"'), 'the create journey has an anchor');
    assert.ok(html.includes('id="verify"'), 'the verify journey has an anchor');
    const steps = html.match(/<article\b/g) ?? [];
    assert.ok(steps.length >= 14, `expected both journeys in full, found ${steps.length} steps`);
});

test('every screenshot the page asks for exists', () => {
    assert.ok(shots.length >= 14, `expected a screenshot per step, found ${shots.length}`);
    for (const s of shots) {
        assert.ok(existsSync(join(GUIDE, s.src)), `missing ${s.src}`);
    }
});

test('every screenshot declares the size it really is', () => {
    // Without this the page reflows as each lazily loaded image arrives, and
    // a reader part-way down loses their place.
    for (const s of shots) {
        const w = Number(s.tag.match(/\bwidth="(\d+)"/)?.[1]);
        const h = Number(s.tag.match(/\bheight="(\d+)"/)?.[1]);
        assert.ok(w > 0 && h > 0, `${s.src} does not declare width and height`);
        const real = pngSize(join(GUIDE, s.src));
        assert.equal(w, real.w, `${s.src} says it is ${w} wide but it is ${real.w}`);
        assert.equal(h, real.h, `${s.src} says it is ${h} tall but it is ${real.h}`);
    }
});

test('every screenshot is lazily loaded and described', () => {
    for (const s of shots) {
        assert.match(s.tag, /loading="lazy"/, `${s.src} is not lazily loaded`);
        const alt = s.tag.match(/\balt="([^"]*)"/)?.[1] ?? '';
        assert.ok(alt.trim().length > 3, `${s.src} has no useful alt text`);
    }
});

test('no screenshot is shipped that the page never shows', () => {
    // A stale capture left in the folder is weight the reader pays for and a
    // trap for whoever edits the page next.
    const onDisk = readdirSync(join(GUIDE, 'shots')).filter((f) => f.endsWith('.png'));
    const used = new Set(shots.map((s) => s.src.replace('shots/', '')));
    const orphans = onDisk.filter((f) => !used.has(f));
    assert.deepEqual(orphans, [], `unused screenshots: ${orphans.join(', ')}`);
});

test('each step says both what to do and why', () => {
    // The page exists to answer the second question. If a step ever carries
    // only instructions, it has stopped being a guide and become a manual.
    const todo = (html.match(/>What to do</g) ?? []).length;
    const why = (html.match(/>Why it works that way</g) ?? []).length;
    assert.equal(todo, why, 'every step has both halves');
    assert.equal(todo, shots.length, 'every screenshot has a step written around it');
});

test('the guide is reachable from the pages it explains', () => {
    const site = join(HERE, '..', '..', 'site');
    for (const [page, href] of [['index.html', 'guide/'],
                                ['verify/index.html', '../guide/#verify'],
                                ['intake/index.html', '../guide/#create']]) {
        const body = readFileSync(join(site, page), 'utf8');
        assert.ok(body.includes(`href="${href}"`), `${page} does not link to the guide`);
    }
    const sitemap = readFileSync(join(site, 'sitemap.xml'), 'utf8');
    assert.ok(sitemap.includes('https://passport.vin/guide/'), 'the guide is absent from the sitemap');
});

test('the verify page keeps its guide link after the script rebuilds it', () => {
    // The first version of the test above passed while a visitor saw nothing.
    // verify.js replaces the whole body on load from its own LEDE constant,
    // so a link that exists only in the served markup is thrown away before
    // anyone can click it. Checking the file the page is ASSEMBLED from is
    // the part that corresponds to what gets rendered; the markup copy is
    // only the fallback for a visitor whose script never runs.
    const js = readFileSync(join(HERE, '..', '..', 'site', 'verify', 'verify.js'), 'utf8');
    assert.ok(js.includes('../guide/#verify'),
        'verify.js rebuilds the page and would drop a link held only in index.html');
    const lede = js.slice(js.indexOf('const LEDE'), js.indexOf('const LEDE') + 2000);
    assert.ok(lede.includes('../guide/#verify'),
        'the link must sit in the lede the page actually renders');
});
