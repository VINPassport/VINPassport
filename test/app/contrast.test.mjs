/**
 * The muted ink has a floor, and it is not a matter of taste.
 *
 * Body text is #0E1726 at some opacity over the #EDE4D8 ground. Composited,
 * the tones that were in use scored 2.82:1 (.45), 3.24:1 (.5), 3.75:1 (.55),
 * 4.11:1 (.58) and 4.37:1 (.6). WCAG AA asks 4.5:1 for small text, so all of
 * them failed, across captions, field labels, hashes and most of the
 * explanatory copy on the site. .62 is the first value that clears it.
 *
 * This test exists because the failure is invisible to the person adding the
 * style: the text looks fine to someone who can already read it. It also
 * catches the spelling trap that hid half the problem the first time, where
 * `rgba(14, 23, 38, 0.58)` survived a search for `rgba(14,23,38,.58)`.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SITE = join(HERE, '..', '..', 'site');

const GROUND = [237, 228, 216];   // --color-bg, the cream the pages sit on
const INK = [14, 23, 38];         // --color-text
const FLOOR = 0.62;
const AA_SMALL = 4.5;

const luminance = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const composite = (fg, alpha, bg) => fg.map((v, i) => v * alpha + bg[i] * (1 - alpha));
const contrast = (a, b) => {
    const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
};

/** Every page, script and stylesheet the site actually serves. */
function sources(dir) {
    return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const p = join(dir, e.name);
        // Screenshots are pictures. Nothing else is exempt: the Wave 1 mockups
        // were the only other exclusion and they were deleted.
        if (e.isDirectory()) return e.name === 'shots' ? [] : sources(p);
        return /\.(html|css|js|mjs)$/.test(e.name) ? [p] : [];
    });
}

// Matches the ink at any opacity, in any spacing, written either `.58` or `0.58`.
const INK_RE = /rgba\(\s*14\s*,\s*23\s*,\s*38\s*,\s*(0?\.\d+|0|1(?:\.0+)?)\s*\)/g;

test('the floor clears AA, and the tones it replaced did not', () => {
    // Guards the constant itself: if the palette moves, this fails before the
    // rule below starts passing for the wrong reason.
    const score = (a) => contrast(composite(INK, a, GROUND), GROUND);
    assert.ok(score(FLOOR) >= AA_SMALL,
        `ink at ${FLOOR} scores ${score(FLOOR).toFixed(2)}:1, under the ${AA_SMALL}:1 needed`);

    // Every opacity that was actually in use before this was fixed. Naming
    // them is the point: it records what was wrong, not just what is right.
    for (const was of [0.45, 0.5, 0.55, 0.58, 0.6]) {
        assert.ok(score(was) < AA_SMALL,
            `${was} now scores ${score(was).toFixed(2)}:1, so the ground must have changed`);
    }
});

test('no text on the site uses an opacity below the floor', () => {
    const bad = [];
    for (const file of sources(SITE)) {
        const text = readFileSync(file, 'utf8');
        for (const m of text.matchAll(INK_RE)) {
            const alpha = parseFloat(m[1]);
            if (alpha >= FLOOR) continue;
            const score = contrast(composite(INK, alpha, GROUND), GROUND).toFixed(2);
            bad.push(`${relative(SITE, file)}: ${m[0]} scores ${score}:1`);
        }
    }
    assert.deepEqual(bad, [], `${bad.length} sub-AA text colour(s):\n  ${bad.slice(0, 8).join('\n  ')}`);
});

test('the guide generator cannot reintroduce one', () => {
    // The guide is generated, so a tone in the generator outlives any fix to
    // the page it produces. The navigation learned this the hard way.
    for (const f of ['build-guide.mjs', join('lib', 'guide-steps.mjs')]) {
        const src = readFileSync(join(HERE, '..', '..', 'scripts', f), 'utf8');
        for (const m of src.matchAll(INK_RE)) {
            assert.ok(parseFloat(m[1]) >= FLOOR, `scripts/${f} carries ${m[0]}`);
        }
    }
});
