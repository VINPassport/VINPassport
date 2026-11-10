/**
 * Text contrast has a floor, and it is not a matter of taste.
 *
 * The site before 2026 set its muted text as ink at an opacity over cream,
 * and the tones in use scored 2.82:1 to 4.37:1: every one under the 4.5:1
 * WCAG 2.1 AA asks of small text (success criterion 1.4.3), across captions,
 * labels, hashes and most explanatory copy. The failure is invisible to the
 * person adding the style, because the text looks fine to someone who can
 * already read it.
 *
 * The 2026 design names every colour as a token in vp.css, so the check is
 * now on the tokens: every rule that sets both a text colour and a background
 * clears 4.5:1, and every token used as text clears it on each of the grounds
 * a page sits on. Pages and scripts carry no colour of their own, so nothing
 * escapes the check (evidence-pages and design-system hold that for scripts
 * and the stylesheet; the last test here holds it for page markup).
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'site');
const AA_SMALL = 4.5;

const css = readFileSync(join(SITE, 'assets', 'vp.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const root = css.slice(css.indexOf(':root{'), css.indexOf('}', css.indexOf(':root{')));
const TOKEN = Object.fromEntries([...root.matchAll(/--([\w-]+):(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const contrast = (a, b) => {
    const [hi, lo] = [luminance(rgb(a)), luminance(rgb(b))].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
};
const RULES = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, decl]) => ({ sel: sel.trim(), decl }));
const textOf = (decl) => decl.match(/(?:^|;)color:var\(--([\w-]+)\)/)?.[1];
const groundOf = (decl) => decl.match(/background(?:-color)?:var\(--([\w-]+)\)/)?.[1];

/** The grounds a page sits on: the page, the deep and raised sections, and the tinted band. */
const GROUNDS = ['paper', 'paper-deep', 'paper-raised', 'blue-tint'];
/** Light text, which belongs on a filled background and nowhere else. */
const ON_FILL = new Set(['on-action', 'paper']);

test('the arithmetic is right: the old muted tones fail and the floor passes', () => {
    // Guards the formula itself, with the pre-2026 palette it was written for.
    const over = (alpha) => rgb('#0e1726').map((v, i) => Math.round(v * alpha + rgb('#ede4d8')[i] * (1 - alpha)));
    const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
    for (const was of [0.45, 0.5, 0.55, 0.58, 0.6]) assert.ok(contrast(hex(over(was)), '#ede4d8') < AA_SMALL, `${was}`);
    assert.ok(contrast(hex(over(0.62)), '#ede4d8') >= AA_SMALL);
    assert.ok(Object.keys(TOKEN).length >= 20, 'the tokens were read');
});

test('every rule that sets a text colour and a background clears AA', () => {
    const pairs = RULES.map((r) => ({ ...r, text: textOf(r.decl), ground: groundOf(r.decl) })).filter((r) => r.text && r.ground);
    assert.ok(pairs.length >= 15, 'the rules were read');
    const bad = pairs.filter((r) => contrast(TOKEN[r.text], TOKEN[r.ground]) < AA_SMALL)
        .map((r) => `${r.sel}: ${r.text} on ${r.ground} is ${contrast(TOKEN[r.text], TOKEN[r.ground]).toFixed(2)}:1`);
    assert.deepEqual(bad, []);
});

test('every token used as text clears AA on every ground a page sits on', () => {
    const used = new Set(RULES.map((r) => textOf(r.decl)).filter(Boolean));
    const bad = [];
    for (const t of used) {
        if (ON_FILL.has(t)) continue;
        for (const g of GROUNDS) {
            const score = contrast(TOKEN[t], TOKEN[g]);
            if (score < AA_SMALL) bad.push(`${t} on ${g} is ${score.toFixed(2)}:1`);
        }
    }
    assert.deepEqual(bad, []);
    // Light text is safe only on a fill, so a rule that sets it sets its background too.
    for (const r of RULES) {
        if (ON_FILL.has(textOf(r.decl))) assert.ok(groundOf(r.decl), `${r.sel} sets light text with no background of its own`);
    }
});

test('page markup carries no colour of its own', () => {
    const pages = [];
    (function walk(d) {
        for (const e of readdirSync(d, { withFileTypes: true })) {
            const p = join(d, e.name);
            if (e.isDirectory()) { if (!/engine|zk|fonts/.test(e.name)) walk(p); } else if (e.name.endsWith('.html')) pages.push(p);
        }
    })(SITE);
    const bad = [];
    for (const p of pages) {
        const html = readFileSync(p, 'utf8');
        const styles = [...html.matchAll(/style="([^"]*)"/g), ...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]);
        for (const s of styles) {
            const lit = s.match(/#[0-9a-f]{3,8}\b|rgba?\(/i);
            if (lit) bad.push(`${relative(SITE, p)}: ${lit[0]}`);
        }
    }
    assert.deepEqual(bad, [], 'use a token from vp.css');
});
