/**
 * Every figure the site states agrees with the thing it describes.
 *
 * Numbers drift. "43 of 43" lived on the home page and the deck while the
 * suite moved, and the redesign handoff arrived describing a contract two
 * deploys old (17 circuits, 151 tests). A number on a page is typed once and
 * read for months, so this ties each one to its source:
 *
 *   circuits         contracts/vinpassport/.../compiler/contract-info.json
 *                    (all of them, the provable ones, the pure helpers)
 *   contract tests   the README's stated count (the README's own sample run)
 *   guards           the README's "Where this actually stands"
 *   live contract    deploy/preview.json, the deploy record (address, network,
 *                    verifier keys, compiler)
 *   field slots      PANEL in scripts/lib/scenario.mjs (the slot map docs/FIELDS.md lays out)
 *
 * It reads every page the site serves, including what its meta description
 * and image text say (search results and link previews show those before
 * anyone opens the page), and every script that writes copy. `npm run
 * check:facts` runs this file alone.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { PANEL } from '../../scripts/lib/scenario.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = join(ROOT, 'site');
const json = (...p) => JSON.parse(readFileSync(join(ROOT, ...p), 'utf8'));

const README = readFileSync(join(ROOT, 'README.md'), 'utf8');
const NOW = README.slice(README.indexOf('## Where this actually stands'));
const INFO = json('contracts', 'vinpassport', 'src', 'managed', 'vinpassport', 'compiler', 'contract-info.json');
const SOURCE = {
    circuits: INFO.circuits.length,
    provable: INFO.circuits.filter((c) => c.proof).length,
    pure: INFO.circuits.filter((c) => c.pure).length,
    contractTests: Number(README.match(/\*\*(\d+) contract tests, \d+ app tests/)?.[1]),
    guards: NOW.match(/every guard mutation-checked, (\d+) of (\d+)/)?.slice(1).map(Number),
    slotsInUse: Object.keys(PANEL).length,
    deploy: json('deploy', 'preview.json')
};

/** Visible text of an HTML page, with its meta and alt text. */
const visible = (raw) => {
    const said = [...raw.matchAll(/(?:content|alt)="([^"]*)"/g)].map((m) => m[1]).join(' . ');
    return `${raw.replace(/<(script|style)[\s\S]*?<\/\1>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ')} . ${said}`;
};

/** Every page the site serves and scripts as written, plus the deck, which the Pages workflow
 *  serves at /deck/ from the repository root and which states the same figures to judges. */
const texts = (() => {
    const out = [];
    (function walk(d) {
        for (const e of readdirSync(d, { withFileTypes: true })) {
            const p = join(d, e.name);
            if (e.isDirectory()) { if (!/engine|zk|fonts|brand|og/.test(e.name)) walk(p); continue; }
            if (!/\.(html|m?js)$/.test(e.name)) continue;
            const raw = readFileSync(p, 'utf8');
            const text = e.name.endsWith('.html') ? visible(raw) : raw;
            out.push({ file: relative(SITE, p).split(/[\\/]/).join('/'), text: text.replace(/\s+/g, ' ') });
        }
    })(SITE);
    out.push({ file: 'deck/index.html', text: visible(readFileSync(join(ROOT, 'deck', 'index.html'), 'utf8')).replace(/\s+/g, ' ') });
    return out;
})();
const every = (re) => texts.flatMap(({ file, text }) => [...text.matchAll(re)].map((m) => ({ file, m })));
const allEqual = (re, want, what, atLeast = 1) => {
    const found = every(re);
    assert.ok(found.length >= atLeast, `the site states ${what}`);
    for (const { file, m } of found) assert.equal(Number(m[1]), want, `${file}: "${m[0]}"`);
};

test('the sources themselves can be read', () => {
    assert.ok(SOURCE.circuits > 0 && SOURCE.provable + SOURCE.pure === SOURCE.circuits, 'contract-info.json lists the circuits');
    assert.ok(SOURCE.contractTests > 0, 'the README states the contract test count');
    assert.ok(SOURCE.guards?.length === 2, 'the README states the guard count');
    assert.match(SOURCE.deploy.contractAddress, /^[0-9a-f]{64}$/);
});

test('every circuit count on the site is the compiled contract\'s', () => {
    allEqual(/\b(\d+) circuits\b/gi, SOURCE.circuits, 'the circuit count', 3);
    allEqual(/\b(\d+) provable,/gi, SOURCE.provable, 'the provable circuits');
    allEqual(/\b(\d+) pure helpers\b/gi, SOURCE.pure, 'the pure helpers');
});

test('every contract test count on the site is the README\'s', () => {
    allEqual(/\b(\d+) contract tests\b/gi, SOURCE.contractTests, 'the test count', 3);
});

test('every guard count on the site is the README\'s', () => {
    const found = every(/\b(\d+) of (\d+)\b(?=[^.]{0,40}(?:guard|mutation|killed))|(?:guard|mutation)[^.]{0,40}?\b(\d+) of (\d+)\b/gi);
    assert.ok(found.length >= 2, 'the site states the guard count');
    for (const { file, m } of found) {
        const [a, b] = (m[1] ? [m[1], m[2]] : [m[3], m[4]]).map(Number);
        assert.deepEqual([a, b], SOURCE.guards, `${file}: "${m[0]}"`);
    }
});

test('the live contract the site names is the deployed one, built as the record says', () => {
    const dev = texts.find((t) => t.file === 'developers/index.html').text;
    assert.ok(dev.includes(SOURCE.deploy.contractAddress), 'the Developers page names the live contract');
    for (const { file, m } of every(/\b[0-9a-f]{64}\b/g)) {
        // Any contract address a page or script spells out is the deployed one. Vehicle keys and
        // hashes are 64 hex characters too, so only a hash written next to "contract" counts.
        const text = texts.find((t) => t.file === file).text;
        const at = text.indexOf(m[0]);
        if (!/contract/i.test(text.slice(Math.max(0, at - 80), at))) continue;
        if (/preprod|superseded|ledger 8/i.test(text.slice(Math.max(0, at - 160), at))) continue;
        assert.equal(m[0], SOURCE.deploy.contractAddress, `${file} names a contract that is not deploy/preview.json's`);
    }
    assert.equal(SOURCE.deploy.network, 'preview');
    assert.match(dev, /Live on Preview/, 'the Developers page names the network');
    allEqual(/\b(\d+) Verifier keys on chain\b/gi, Object.keys(SOURCE.deploy.build.verifierKeys).length, 'the verifier keys');
    for (const { file, m } of every(/\bCompact (\d+\.\d+\.\d+)\b/g)) assert.equal(m[1], SOURCE.deploy.build.compiler, `${file}: "${m[0]}"`);
    assert.match(dev, /\bLedger 9\b/);
    assert.equal(SOURCE.deploy.ledger, 'v9');
});

test('the field slots on the site are the slot map\'s', () => {
    allEqual(/\b(\d+) Provable field slots\b/gi, 32, 'the slot count');
    allEqual(/\b(\d+) in use, \d+ reserved\b/gi, SOURCE.slotsInUse, 'the slots in use');
    allEqual(/\b\d+ in use, (\d+) reserved\b/gi, 32 - SOURCE.slotsInUse, 'the reserved slots');
});

test('no figure from the stale handoff survives anywhere on the site', () => {
    // The handoff's "approved facts" described the ledger 8 preprod contract (1 Nov).
    for (const stale of [/\b17 circuits\b/i, /\b151 (?:contract )?tests\b/i, /\b37 ?\/ ?37\b/, /\b37 of 37\b/, /\b32 of 32\b/]) {
        const hit = texts.find(({ text }) => stale.test(text));
        assert.ok(!hit, `${hit?.file} still says ${stale}`);
    }
});
