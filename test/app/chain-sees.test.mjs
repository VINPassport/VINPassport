/**
 * The what-the-chain-sees panel, rendered against the committed ledger export.
 *
 * The panel makes two kinds of claim. The first is easy to keep honest: every
 * public value it shows must actually be on the ledger, and a test can check
 * that by looking the value up. The second is the one worth testing, because
 * nothing else will catch it: the panel asserts that certain things are NOT
 * published. An absence cannot be verified by rendering, and a future edit
 * that quietly drops a line from that list leaves a page which is still
 * beautiful and now overclaims.
 *
 * So the list is pinned here by meaning rather than by wording, and the panel
 * is fed the real export rather than a fixture, so it fails if the shape of
 * the ledger moves under it.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { passportView } from '../../site/assets/verdict.mjs';
import { chainSeesBlock, esc, short } from '../../site/assets/chain-sees.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, 'site', 'verify', p), 'utf8'));

const ledger = read('demo-data.json');
const vocabulary = read('fields.json');
const vin = Object.keys(ledger.passports)[0];
const view = passportView(ledger, vin, vocabulary);
const html = chainSeesBlock(vin, view, ledger);

test('it shows the vehicle identifier the ledger actually holds', () => {
    assert.ok(html.includes(vin), 'the VIN hash is public and must be shown in full');
});

test('every public value it shows is one the ledger holds', () => {
    assert.ok(html.includes(esc(ledger.passports[vin])), 'the content root');
    assert.ok(html.includes(esc(ledger.registrar[vin])), 'the registrar identity');
    assert.ok(html.includes(String(Object.keys(ledger.fieldCommitment).length)),
        'the commitment count');
});

test('it names every claim it was given, by its bound and its commitment', () => {
    const claims = view.answers.map((a) => a.claim).filter(Boolean);
    assert.ok(claims.length > 0, 'the export should carry at least one claim to render');
    for (const c of claims) {
        // Two shapes. A single-field claim has one commitment; a two-field
        // claim has a pair and a slack, and both of its commitments must
        // appear or the panel is hiding half of what the ledger holds.
        const shown = c.slack === undefined
            ? [c.commitment]
            : [c.commitmentHigh, c.commitmentLow];
        for (const h of shown) {
            assert.ok(html.includes(short(h)),
                `claim against ${short(h)} is missing from the panel`);
        }
    }
});

test('a two-field claim is rendered as a pair, never as a bound', () => {
    const compares = view.answers
        .map((a) => a.claim).filter(Boolean)
        .filter((c) => c.slack !== undefined);
    assert.ok(compares.length > 0, 'the demo export should carry a two-field claim');
    // The single-field builder would print "≥ undefined" for these, which is
    // exactly what this guards against.
    assert.ok(!html.includes('undefined'), 'the panel printed undefined');
    assert.ok(html.includes('pair ≤'), 'no pair row was rendered');
});

/**
 * The absences, by meaning. Each entry is a thing a reader could reasonably
 * assume is on the ledger, and the panel's job is to say plainly that it is
 * not. Matching on a distinctive fragment rather than the whole sentence so
 * the prose can be improved without the test becoming a transcription.
 */
const MUST_NAME_AS_ABSENT = [
    ['the VIN itself', 'The VIN'],
    ['the field values', 'Every field value'],
    ['the salts', 'The salts'],
    ['the registrar secret', 'secret'],
    ['who owns the vehicle', 'Who owns the vehicle'],
    ['which commitments belong to this vehicle', 'Which commitments']
];

test('it names each thing that stays off the ledger', () => {
    const absentSection = html.slice(html.indexOf('Not on the ledger'));
    assert.ok(absentSection.length > 0, 'the panel must have an absences section');
    for (const [what, fragment] of MUST_NAME_AS_ABSENT) {
        assert.ok(absentSection.includes(fragment),
            `the panel no longer tells the reader that ${what} is absent`);
    }
});

/**
 * The verdict rows above this panel mark an unanswered question with the
 * dashed `.none` badge, and say in prose what it means: "Nothing on the ledger
 * answers this question. That is silence, not a no."
 *
 * Nothing in the absences list is an unanswered question. Each one is a thing
 * the design never publishes. Borrowing the badge puts both meanings on one
 * screen and tells the reader the stronger, wrong one: that we tried to show
 * who owns the vehicle and failed, rather than that the contract has no owner.
 *
 * Found by rendering the page, not by reading it.
 */
test('the absences borrow no part of the claim vocabulary', () => {
    assert.ok(!html.includes('class="none"'),
        'the dashed badge means "not proven"; a value withheld by design is not an unproven claim');
    assert.ok(!html.includes('class="tick"'),
        'nor is an absence a proven claim');
});

test('the absences are marked up as the list they are', () => {
    const absentSection = html.slice(html.indexOf('Not on the ledger'));
    assert.match(absentSection, /<ul[\s>]/, 'a list of six things should be a list');
    assert.equal((absentSection.match(/<li[\s>]/g) ?? []).length, MUST_NAME_AS_ABSENT.length,
        'one list item per absence');
});

test('no field value reaches the panel, because none reaches the ledger', () => {
    // Values are scaled x1000 into the commitments and never published, so any
    // bare reading in the rendered output would have to have come from
    // somewhere it should not exist. The bounds ARE public: they are the
    // questions asked, and they are rendered deliberately.
    const bounds = new Set(view.answers.map((a) => a.claim?.bound).filter((b) => b != null)
        .map((b) => String(b)));
    const numbers = [...html.matchAll(/>\s*([0-9][0-9,]{2,})\s*</g)].map((m) => m[1]);
    for (const n of numbers) {
        const bare = n.replace(/,/g, '');
        assert.ok(bounds.has(bare) || Number(bare) <= Object.keys(ledger.fieldCommitment).length,
            `rendered number ${n} is neither a public bound nor a count`);
    }
});

test('it escapes what it renders', () => {
    const hostile = { ...ledger, registrar: { ...ledger.registrar, [vin]: '<img src=x onerror=1>' } };
    const out = chainSeesBlock(vin, passportView(hostile, vin, vocabulary), hostile);

    assert.ok(!out.includes('<img src=x'), 'a ledger value must not reach the DOM as markup');
    assert.ok(out.includes('&lt;img'), 'it should appear escaped instead');
});
