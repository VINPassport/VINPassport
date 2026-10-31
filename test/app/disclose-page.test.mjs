/**
 * /disclose/: one vehicle, three audiences, checked in the browser.
 *
 * The page shows three bundles and checks them against the demo ledger. What
 * it shows is only worth anything if these hold:
 *
 *  1. The three committed bundles check against the committed ledger, each
 *     opening exactly what its tier allows and nothing above it. They are
 *     written by the same run as demo-data.json, so a regenerated ledger with
 *     stale bundles fails here before it fails in front of a judge.
 *  2. A bundle carries nothing that opens a field above its tier: no salt,
 *     no name, and the VIN only at authority.
 *  3. The two controls on the page demonstrate what they say: a changed value
 *     fails, and a trade field handed to the buyer still checks but is flagged.
 *  4. The page checks with the same code the tests run, reached through the
 *     engine bundle, and says plainly that its ledger is not preprod.
 *
 * Tests marked REPOSITORY ASSERTION read source rather than run it: the page
 * needs a browser, and check:pages is what loads it.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyBundle, fieldsOnLedger, vinHashOf } from '../../scripts/lib/disclosure.mjs';
import { tierOf, allows } from '../../scripts/lib/tiers.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = join(ROOT, 'site');
const read = (...p) => readFileSync(join(SITE, ...p), 'utf8');
const json = (...p) => JSON.parse(read(...p));

const ledger = json('verify', 'demo-data.json');
const bundles = Object.fromEntries(['public', 'trade', 'authority']
    .map((t) => [t, json('disclose', 'bundles', `${t}.json`)]));
const html = read('disclose', 'index.html');
const js = read('disclose', 'disclose.js');

const commitmentAt = (slot) => ledger.fieldCommitment[slot] ?? null;
const claimAt = (key) => ledger.claims.find((c) => c.key === key) ?? null;
const LEDGER = { commitmentAt, claimAt };
const check = (b) => verifyBundle(b, LEDGER);
const sorted = (a) => [...a].sort();

const HISTORY = ['accidentCount', 'lastServiceOdometerKm', 'odometerKm', 'ownerCount',
    'recallCompletedCount', 'recallIssuedCount', 'serviceCount', 'writeOffCategory'];
const DECLARED = ['co2FootprintKgCO2e', 'enginePowerKw', 'kerbWeightKg'];
const RECORDS = ['exportMarkerCount', 'stolenRecordCount'];

test('every bundle checks against the ledger it was written with', () => {
    for (const [tier, b] of Object.entries(bundles)) {
        const r = check(b);
        assert.equal(r.ok, true, `${tier}: ${JSON.stringify(r.problems)} ${JSON.stringify(r.fields.filter((f) => !f.ok))}`);
        assert.equal(r.tier, tier);
        assert.deepEqual(r.overDisclosed, [], `${tier} opens above its tier`);
        assert.equal(b.contentRoot, ledger.passports[b.vinHash], `${tier} is anchored to a different record`);
    }
});

test('each audience opens a different set, and each set nests in the next', () => {
    assert.deepEqual(sorted(check(bundles.public).opened), sorted(DECLARED));
    assert.deepEqual(sorted(check(bundles.trade).opened), sorted([...DECLARED, ...HISTORY]));
    assert.deepEqual(sorted(check(bundles.authority).opened), sorted([...DECLARED, ...HISTORY, ...RECORDS]));
    for (const [tier, b] of Object.entries(bundles)) {
        for (const f of b.fields) assert.ok(allows(tier, tierOf(f.fieldName)), `${f.fieldName} in ${tier}`);
    }
});

test('the authority opens every field the vehicle has on the ledger, the others leave some closed', () => {
    const b = bundles.authority;
    const present = fieldsOnLedger(b.vinHash, b.contentRoot, commitmentAt);
    assert.deepEqual(sorted(present), sorted(check(b).opened));
    assert.ok(present.length > check(bundles.trade).opened.length);
    // Found from public anchors, per vehicle: the other demo vehicle has its
    // own fields and none of these slots.
    const other = Object.keys(ledger.passports).find((v) => v !== b.vinHash);
    const theirs = fieldsOnLedger(other, ledger.passports[other], commitmentAt);
    assert.ok(theirs.length > 0);
    assert.ok(!theirs.includes('kerbWeightKg'));
});

test('the buyer cites the proven claims, and every one is current', () => {
    const r = check(bundles.public);
    const own = ledger.claims.filter((c) => c.vinHash === bundles.public.vinHash).map((c) => c.key);
    assert.deepEqual(sorted(r.claims.map((c) => c.key)), sorted(own));
    assert.ok(r.claims.length >= 4);
    for (const c of r.claims) assert.equal(c.current, true, `${c.fieldName} is not current`);
});

test('a bundle carries no salt and no name for any field above its tier', () => {
    const salts = new Map(bundles.authority.fields.map((f) => [f.fieldName, f.salt]));
    for (const tier of ['public', 'trade']) {
        const text = JSON.stringify(bundles[tier]);
        for (const [name, salt] of salts) {
            if (allows(tier, tierOf(name))) continue;
            assert.ok(!text.includes(salt), `${tier} carries the salt for ${name}`);
            assert.ok(!text.includes(`"${name}"`), `${tier} names ${name}`);
        }
    }
});

test('only the authority bundle names the VIN, and it is this vehicle', () => {
    assert.equal('vin' in bundles.public, false);
    assert.equal('vin' in bundles.trade, false);
    const { vin, vinHash } = bundles.authority;
    assert.equal(Buffer.from(vinHashOf(vin)).toString('hex'), vinHash);
    assert.equal(check(bundles.authority).vinMatchesHash, true);
});

test('changing any value in a bundle makes it fail', () => {
    // The page's first control. Off by one is the smallest change there is.
    for (const tier of ['public', 'trade', 'authority']) {
        for (const i of bundles[tier].fields.keys()) {
            const copy = structuredClone(bundles[tier]);
            copy.fields[i].value = String(BigInt(copy.fields[i].value) + 1n);
            const r = check(copy);
            assert.equal(r.ok, false, `${tier} still checks with ${copy.fields[i].fieldName} changed`);
            assert.match(r.fields[i].why, /does not open/);
        }
    }
});

test('a trade field handed to the buyer still checks, and is flagged', () => {
    // The page's second control: the reader recomputes the tier rather than
    // trusting the label on the file.
    const copy = structuredClone(bundles.public);
    copy.fields.push(structuredClone(bundles.trade.fields.find((f) => f.fieldName === 'odometerKm')));
    const r = check(copy);
    assert.equal(r.ok, true);
    assert.deepEqual(r.overDisclosed, ['odometerKm']);
});

test('the files say they come from the local demo, not preprod', () => {
    for (const [tier, b] of Object.entries(bundles)) {
        assert.equal(b.network, 'local-simulator', `${tier} could be read as preprod evidence`);
        assert.equal('contractAddress' in b, false);
    }
    assert.match(html, /It is not preprod\./);
    assert.match(html, /scripts\/export-demo-state\.mjs/);
});

test('REPOSITORY ASSERTION: the page checks with the shared verifier, through the engine', () => {
    assert.match(js, /import\('\.\.\/assets\/intake-engine\/intake-engine\.js'\)/);
    assert.match(js, /engine\.verifyBundle\(/);
    assert.match(js, /engine\.fieldsOnLedger\(/);
    // No hashing of its own, so it cannot disagree with the tests.
    assert.doesNotMatch(js, /persistentCommit|persistentHash|blake2b/);
    const source = readFileSync(join(ROOT, 'scripts', 'lib', 'intake-engine.mjs'), 'utf8');
    assert.match(source, /export \{ verifyBundle, fieldsOnLedger \} from '\.\/disclosure\.mjs'/);
    const built = read('assets', 'intake-engine', 'intake-engine.js');
    const exported = built.slice(built.lastIndexOf('export{'));
    assert.match(exported, /as verifyBundle\b/);
    assert.match(exported, /as fieldsOnLedger\b/);
});

test('REPOSITORY ASSERTION: the bundles it loads are the committed files', () => {
    assert.match(js, /getJson\('\.\.\/verify\/demo-data\.json'\)/);
    assert.match(js, /getJson\(`bundles\/\$\{t\}\.json`\)/);
    for (const tier of Object.keys(bundles)) assert.match(html, new RegExp(`href="bundles/${tier}\\.json"`));
});

test('the tabs are a labelled tablist and every control is touchable', () => {
    const tabs = [...html.matchAll(/<button class="ds-tab"[^>]*>/g)].map((m) => m[0]);
    assert.equal(tabs.length, 3);
    for (const t of tabs) {
        assert.match(t, /role="tab"/);
        assert.match(t, /aria-controls="tier-panel"/);
        assert.match(t, /aria-selected="(true|false)"/);
    }
    assert.match(html, /role="tablist" aria-label="Audience"/);
    assert.match(html, /id="tier-panel" role="tabpanel"/);
    for (const cls of ['ds-tab', 'ds-btn', 'ds-input']) {
        const rule = html.match(new RegExp(`\\.${cls}\\{[^}]*\\}`))?.[0] ?? '';
        const h = Number(rule.match(/min-height:(\d+)px/)?.[1] ?? 0);
        assert.ok(h >= 44, `.${cls} is ${h}px tall`);
    }
});

test('no dashes in the page or its script', () => {
    for (const [name, text] of [['index.html', html], ['disclose.js', js]]) {
        assert.doesNotMatch(text, /[\u2013\u2014]/, `${name} has an en or em dash`);
    }
});
