/**
 * The evidence pages (demo, intake, disclose, proofs) on the 2026 design.
 *
 * These pages are scripts as much as markup, and twice a script lost an
 * element it looked up by position and failed quietly (proofs.js, intake.js).
 * So: every element a script looks up by id exists on its page or in markup
 * the script writes itself; the scripts carry no inline colours, so the look
 * lives in vp.css; and no page asks a visitor for a wallet.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
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
    proofs: { script: 'proofs/proofs.js', ids: ['stat-passports', 'stat-claims', 'stat-fields', 'stat-values', 'vehicles', 'source'] }
};

test('the four evidence pages are on the new design, with none of the old sheet', () => {
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

// A Web2 face on a Web3 backbone (D36): the project pays every fee from its own wallet
// (D24), so no page looks for a wallet extension or ships the code to talk to one.
test('no page asks a visitor for a wallet', () => {
    const own = (dir) => readdirSync(join(SITE, dir), { withFileTypes: true }).flatMap((e) => {
        const p = dir ? `${dir}/${e.name}` : e.name;
        if (e.isDirectory()) return /^(assets\/(intake-engine|fonts|brand)|zk)$/.test(p) ? [] : own(p);
        return /\.(html|m?js)$/.test(e.name) ? [p] : [];
    });
    const files = own('');
    assert.ok(files.length > 30, `only ${files.length} files read`);
    for (const file of files) {
        assert.doesNotMatch(read(file), /window\.midnight|dapp-connector|DApp Connector|wallet-engine|listWallets/i, `${file} reaches for a wallet`);
    }

    // Nor does any text a visitor reads mention one, except to say none is needed. The
    // backend that pays the fees is "our signing service" on a page; code comments may
    // still describe it as the wallet it is.
    const SAYS_NONE = /\bno wallet\b|\bnever asks for a wallet\b/gi;
    const said = [];
    for (const file of files) {
        const src = read(file);
        if (file.endsWith('.html')) {
            const text = src.replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
                .replace(/<[^>]+>/g, ' ').replace(SAYS_NONE, ' ');
            if (/wallet/i.test(text)) said.push(file);
        } else {
            for (const [i, line] of src.split(/\r?\n/).entries()) {
                if (/^\s*(\/\/|\/?\*)/.test(line)) continue;
                for (const [, , body] of line.matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)) {
                    if (/wallet/i.test(body.replace(SAYS_NONE, ' '))) said.push(`${file}:${i + 1}`);
                }
            }
        }
    }
    assert.deepEqual(said, [], 'a page tells a visitor about a wallet');
});

test('the ledger block lists each of a vehicle\'s claims once, including ones no question covers', () => {
    const ledger = JSON.parse(read('verify/demo-data.json'));
    const vocabulary = JSON.parse(read('verify/fields.json'));
    for (const key of Object.keys(ledger.passports)) {
        const html = chainSeesBlock(key, passportView(ledger, key, vocabulary), ledger);
        const own = ledger.claims.filter((c) => c.vinHash === key).length
            + (ledger.relClaims ?? []).filter((c) => c.vinHash === key).length;
        assert.equal((html.match(/Claim · /g) ?? []).length, own, key);
        assert.doesNotMatch(html, /<details/, 'the block nests no disclosure of its own: the page wraps it');
    }
});
