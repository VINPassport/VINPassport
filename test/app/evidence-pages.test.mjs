/**
 * The evidence pages (demo, intake, disclose, proofs, wallet) on the 2026 design.
 *
 * These pages are scripts as much as markup, and twice a script lost an
 * element it looked up by position and failed quietly (proofs.js, intake.js).
 * So: every element a script looks up by id exists on its page or in markup
 * the script writes itself; the scripts carry no inline colours, so the look
 * lives in vp.css; and the heavy wallet engine still loads only on demand.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PAGES } from '../../scripts/build-nav.mjs';
import { chainSeesBlock } from '../../site/assets/chain-sees.mjs';
import { passportView } from '../../site/assets/verdict.mjs';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'site');
const read = (p) => readFileSync(join(SITE, p), 'utf8');

const EVIDENCE = {
    demo: { script: 'demo/demo.js', ids: ['eyebrow', 'lede', 'capdot', 'capstate', 'capline', 'go', 'gonote', 'run', 'nodename', 'curl', 'explorernote'] },
    intake: { script: 'intake/intake.js', ids: ['ppwrap', 'ppbox', 'ppnote', 'pplabel', 'pprun', 'server-status', 'register', 'download', 'circuits', 'result', 'result-rows', 'result-count', 'result-links', 'result-view', 'evblock', 'claimgrid', 'claimsmeta', 'writerby', 'wby', 'wdraw', 'expect', 'dv'] },
    disclose: { script: 'disclose/disclose.js', ids: ['ledger-note', 'tier-panel', 'tab-public', 'tab-trade', 'tab-authority'] },
    proofs: { script: 'proofs/proofs.js', ids: ['stat-passports', 'stat-claims', 'stat-fields', 'stat-values', 'vehicles', 'source'] },
    wallet: { script: 'wallet/wallet.js', ids: ['walletstatus', 'walletlist', 'vehiclekey', 'askbtn', 'result'] }
};

test('the five evidence pages are on the new design, with none of the old sheet', () => {
    for (const name of Object.keys(EVIDENCE)) {
        const file = `${name}/index.html`;
        assert.equal(PAGES.find((p) => p.file === file)?.design, 'vp', `${file} is not marked as redesigned`);
        const html = read(file);
        assert.match(html, /assets\/vp\.css">/, file);
        assert.doesNotMatch(html, /site\.css|nav\.mjs|fonts\.googleapis/, `${file} still loads the old design`);
        assert.equal((html.match(/<main id="main">/g) ?? []).length, 1, `${file}: one main`);
    }
});

test('the ids the handoff list names are on each page', () => {
    for (const [name, { ids }] of Object.entries(EVIDENCE)) {
        const html = read(`${name}/index.html`);
        for (const id of ids) assert.ok(html.includes(`id="${id}"`), `${name}: #${id} is missing`);
    }
    const disclose = read('disclose/index.html');
    for (const l of ['demo', 'preview', 'preprod']) assert.match(disclose, new RegExp(`data-ledger="${l}"`));
    const intake = read('intake/index.html');
    for (const id of ['vin', 'reg', 'dl', 'cat', 'fuel', 'em', 'bp', 'bc', 'km', 'ac', 'kp', 'wo', 'sv', 'lsv', 'ri', 'rc']) {
        assert.ok(intake.includes(`id="${id}"`), `intake: form field #${id} is missing`);
    }
    assert.ok(intake.includes('data-origin="new"') && intake.includes('data-origin="retrofit"'));
    assert.ok(intake.includes('data-writer="dealership"') && intake.includes('data-writer="service garage"'));
});

test('every id a script looks up exists on its page, or in markup the script writes', () => {
    for (const [name, { script }] of Object.entries(EVIDENCE)) {
        const js = read(script);
        const html = read(`${name}/index.html`);
        const asked = new Set([...js.matchAll(/(?:\$|getElementById)\('([\w-]+)'\)/g)].map((m) => m[1]));
        for (const id of asked) {
            assert.ok(html.includes(`id="${id}"`) || js.includes(`id="${id}"`), `${script} looks up #${id}, which nothing provides`);
        }
    }
});

test('the scripts set states, never colours: the look lives in vp.css', () => {
    for (const file of [...Object.values(EVIDENCE).map((e) => e.script), 'assets/chain-run.mjs', 'assets/passport-qr.mjs']) {
        const js = read(file);
        assert.doesNotMatch(js, /style="|\.style\.|cssText/, `${file} still writes inline styles`);
        assert.doesNotMatch(js, /#004AAD|#EDE4D8|#8B95FF|#0E1726/i, `${file} still names an old colour`);
    }
});

test('a visitor without a wallet never downloads the wallet engine', () => {
    const js = read('wallet/wallet.js');
    assert.match(js, /await import\('\.\.\/assets\/wallet-engine\/wallet-engine\.js'\)/);
    assert.doesNotMatch(js, /^import .*wallet-engine/m, 'the engine is imported up front');
});

test('the ledger block lists each of a vehicle\'s claims once, including ones no question covers', () => {
    const ledger = JSON.parse(read('verify/demo-data.json'));
    const vocabulary = JSON.parse(read('verify/fields.json'));
    for (const key of Object.keys(ledger.passports)) {
        const html = chainSeesBlock(key, passportView(ledger, key, vocabulary), ledger, { bare: true });
        const own = ledger.claims.filter((c) => c.vinHash === key).length
            + (ledger.relClaims ?? []).filter((c) => c.vinHash === key).length;
        assert.equal((html.match(/Claim · /g) ?? []).length, own, key);
        assert.doesNotMatch(html, /<details/, 'the bare form nests no disclosure');
    }
});
