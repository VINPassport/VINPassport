/**
 * Scan a vehicle (/scan/) and the verdict (/v/), on the 2026 design.
 *
 * The verdict page replaces /verify/, so it carries that page's guarantees:
 * a key that was asked for and not found never opens another vehicle, the
 * VIN never reaches the address bar or the page, silence reads as "not
 * proven", and nothing on the ledger is withheld. The fixture is the demo
 * ledger the page reads, written by the compiled circuits.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readRequest, headline, tally, verdictRows, fullRecord, mrzOf, shareUrl, FOUR } from '../../site/v/v.mjs';
import { readEntry } from '../../site/scan/scan.mjs';
import { passportView, QUESTIONS } from '../../site/assets/verdict.mjs';
import { passportCode } from '../../site/assets/passport-code.mjs';
import { passportUrl } from '../../site/assets/passport-qr.mjs';
import { vinHashHex } from '../../site/assets/blake2b.mjs';
import { toSvg } from '../../site/assets/qr.mjs';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'site');
const read = (p) => readFileSync(join(SITE, p), 'utf8');
const ledger = JSON.parse(read('verify/demo-data.json'));
const vocabulary = JSON.parse(read('verify/fields.json'));
const KEYS = Object.keys(ledger.passports);
const [GOLF, BMW] = vocabulary.demoVehicles.map((v) => v.vinHash);
const GOLF_VIN = 'WVWZZZ1JZXW000001';
const ask = (q) => readRequest(new URLSearchParams(q), KEYS);
const view = (key, l = ledger) => passportView(l, key, vocabulary);

// ------------------------------------------------------- what is asked for

test('a key opens its passport, and a key nobody holds opens none', () => {
    assert.deepEqual(ask(`v=${GOLF}`), { kind: 'found', key: GOLF, via: 'key' });
    assert.equal(ask(`v=${GOLF.toUpperCase()}`).key, GOLF, 'case does not matter');
    const miss = ask(`v=${'a'.repeat(64)}`);
    assert.equal(miss.kind, 'missing');
    assert.equal(miss.key, undefined, 'a miss must never carry another vehicle');
    assert.equal(ask('v=not-a-key').kind, 'missing');
});

test('a typed code resolves against the ledger, forgivingly, and refuses to guess', () => {
    const code = passportCode(GOLF);
    assert.deepEqual(ask(`c=${code}`), { kind: 'found', key: GOLF, via: 'code', code });
    assert.equal(ask(`c=${code.toLowerCase().replace(/-/g, ' ')}`).key, GOLF);
    assert.equal(ask('c=VP-74EE-0J75').kind, 'bad-code', 'a wrong check character is caught before any lookup');
    const absent = ask(`c=${passportCode('a'.repeat(64))}`);
    assert.deepEqual([absent.kind, absent.via], ['missing', 'code']);
    // Two keys sharing their first 35 bits share a code: open neither.
    const twin = GOLF.slice(0, -1) + (GOLF.endsWith('0') ? '1' : '0');
    assert.equal(readRequest(new URLSearchParams(`c=${code}`), [GOLF, twin]).kind, 'ambiguous');
});

test('a key typed as a path still opens as a key, and no address opens the sample', () => {
    assert.equal(ask(`c=${GOLF}`).key, GOLF, '/v/<key> arrives from the 404 page as ?c=');
    assert.deepEqual(ask(''), { kind: 'found', key: KEYS[0], via: 'sample' });
});

// --------------------------------------------------------- the four answers

test('the four answers come from the ledger, in the design order', () => {
    const golf = headline(view(GOLF));
    assert.deepEqual(golf.map((a) => a.id), FOUR);
    assert.equal(tally(golf), 'All 4 answers verified');
    const rows = verdictRows(golf);
    assert.equal((rows.match(/vp-verdict--verified/g) ?? []).length, 4);
    assert.match(rows, /Mileage under 150,000 km\?/);
    assert.equal((rows.match(/<span class="vp-sr">Verified: <\/span>/g) ?? []).length, 4, 'the state is spoken, not only coloured');
});

test('silence is not proven, links to what that means, and never reads as a yes', () => {
    const bmw = headline(view(BMW));
    assert.equal(tally(bmw), '1 answer verified, 3 not proven');
    const rows = verdictRows(bmw);
    assert.equal((rows.match(/href="#meanings"/g) ?? []).length, 3);
    for (const li of rows.split('</li>').filter((r) => /not-proven/.test(r))) {
        assert.doesNotMatch(li, />(Never|None|Yes)</, 'a not-proven row must not carry an answer');
    }
    assert.match(rows, /Mileage under 200,000 km\?/);
});

test('a claim whose field has moved on reads as superseded', () => {
    const later = structuredClone(ledger);
    const odo = later.claims.find((c) => c.vinHash === GOLF && c.bound === '150000');
    later.fieldCommitment[odo.slot] = 'f'.repeat(64);
    const four = headline(view(GOLF, later));
    assert.equal(tally(four), '3 answers verified, 1 superseded');
    assert.match(verdictRows(four), /vp-verdict--superseded[\s\S]*Superseded/);
});

// --------------------------------------------------------- the full record

test('the full record shows every question once, and no reading', () => {
    const html = fullRecord(view(GOLF), { key: GOLF, title: 'Golf' });
    assert.equal((html.match(/<details class="v-claim /g) ?? []).length, QUESTIONS.length);
    assert.ok(!html.includes('83260') && !html.includes('83 260'), 'the hidden odometer reading must never appear');
    const unanswered = view(GOLF).answers.filter((a) => a.status === 'not-proven').length;
    assert.equal((html.match(/v-claim--not-proven/g) ?? []).length, unanswered);
});

test('a claim no question covers still gets a row, open, and an unknown field reads as invalid', () => {
    const later = structuredClone(ledger);
    const base = later.claims.find((c) => c.vinHash === GOLF);
    later.claims.push({ ...base, key: '2'.repeat(64), fieldKey: '3'.repeat(64), atMost: false, bound: '1' });
    const html = fullRecord(view(GOLF, later), { key: GOLF, title: 'Golf' });
    assert.match(html, /<details class="v-group" open><summary><span class="v-group__name">Other claims on this ledger/);
    assert.match(html, /not a VINPassport field/);
});

// ------------------------------------------------------- page source rules

test('the verdict page never puts a VIN in the address or on the page', () => {
    const js = read('v/v.mjs');
    for (const m of js.matchAll(/history\.replaceState\([^;]*;/g)) {
        assert.match(m[0], /'\?v=' \+ req\.key/, `rewrites the address with ${m[0]}`);
    }
    assert.doesNotMatch(js, /location\.(search|href)\s*=/, 'the verdict page does not navigate itself');
    assert.doesNotMatch(js, /\$\{[^}]*(parsed\.vin|input\.value)[^}]*\}/, 'the typed VIN is never written back into markup');
    assert.match(js, /It is checked against this passport and never stored or shown\./, 'D5 wording (VIN A)');
    assert.match(js, /This is not a failed check, and not a verdict on the vehicle\./);
});

test('the shell ships no vehicle, so a failed script cannot show the wrong one', () => {
    const html = read('v/index.html');
    const body = html.slice(html.indexOf('<main'), html.indexOf('</main>'));
    assert.match(body, /<h1 id="v-h1" class="h1 v-title">Reading the passport<\/h1>/);
    assert.doesNotMatch(body, /Golf|320d|vp-verdict--/);
    assert.match(body, /<noscript>/);
});

test('shared links and printed codes carry the key only, on the new address', () => {
    assert.equal(passportUrl(GOLF, 'https://passport.vin'), `https://passport.vin/v/?v=${GOLF}`);
    assert.equal(shareUrl('https://passport.vin', GOLF, 'volta'), `https://passport.vin/v/?v=${GOLF}&brand=volta`);
    assert.match(mrzOf('2019 Golf, silver', passportCode(GOLF)), /^P<VINPASSPORT<<VP<74EE<0J74<<2019<GOLF<SILVER<*$/);
});

// ------------------------------------------------------------------ scan

test('scan: a code goes to ?c=, and a VIN goes as its key, never as itself', () => {
    assert.deepEqual(readEntry('VP-74EE-0J74'), { href: '../v/?c=VP-74EE-0J74' });
    assert.deepEqual(readEntry(' vp 74ee 0j74 '), { href: '../v/?c=VP-74EE-0J74' });
    const vin = readEntry(GOLF_VIN);
    assert.deepEqual(vin, { href: `../v/?v=${GOLF}` });
    assert.ok(!vin.href.includes(GOLF_VIN));
    assert.deepEqual(readEntry(`https://passport.vin/v/?v=${GOLF}`), { href: `../v/?v=${GOLF}` });
    assert.deepEqual(readEntry('https://passport.vin/v/?c=VP-74EE-0J74'), { href: '../v/?c=VP-74EE-0J74' });
});

test('scan: a refusal says what is wrong', () => {
    assert.match(readEntry('').error, /Type the passport code first/);
    assert.match(readEntry('VP-74EE-0J75').error, /mistyped/);
    assert.match(readEntry('WVWZZZ1JZXW00000O').error, /I, O or Q/);
    assert.match(readEntry('hello').error, /neither a passport code nor a VIN/);
});

test('scan: the demo cards, the example and the QR code match the ledger', () => {
    const html = read('scan/index.html');
    for (const [vinText, key] of [[GOLF_VIN, GOLF], ['WAUZZZ8V5KA000002', BMW]]) {
        assert.equal(vinHashHex(vinText), key, `${vinText} no longer hashes to its passport`);
        assert.ok(html.includes(`<dd class="vp-code">${passportCode(key)}</dd><dt class="vp-label">VIN</dt><dd class="vp-code">${vinText}</dd>`));
        assert.ok(html.includes(`href="../v/?v=${key}"`));
    }
    assert.ok(html.includes(`placeholder="For example ${passportCode(GOLF)}"`), 'the example code opens the sample');
    const qr = toSvg(`https://passport.vin/v/?v=${KEYS[0]}`, { scale: 4, quiet: 4, dark: '#0f1c35', light: '#fbf8f2' })
        .replace('role="img"', 'role="img" aria-label="QR code that opens the sample passport"');
    assert.ok(html.includes(qr), 'the QR code on the page opens the sample passport');
});
