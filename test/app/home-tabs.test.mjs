/**
 * The home page's reader tabs: the buyer's view shipped in the HTML is the one
 * the script renders, so the page reads the same before and after it runs, and
 * a row a reader may not see is shown as withheld, never silently dropped.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { READERS, ROWS, rowsFor } from '../../site/assets/home.mjs';

const HOME = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'site', 'index.html'), 'utf8');

test('the HTML ships the buyer view exactly as the script renders it', () => {
    const shipped = HOME.match(/<ul class="vp-readout" data-reader-rows>([\s\S]*?)<\/ul>/)[1].replace(/\s*\n\s*/g, '');
    assert.equal(shipped, rowsFor('buyer'));
    assert.match(HOME, /<p class="vp-datapage__title" data-reader-name>A buyer<\/p>/);
});

test('every reader sees every row, and withheld rows say so', () => {
    for (const reader of Object.keys(READERS)) {
        const html = rowsFor(reader);
        assert.equal((html.match(/<li>/g) ?? []).length, ROWS.length, reader);
        const withheld = ROWS.filter(([, v]) => !v[reader]).length;
        assert.equal((html.match(/Not shown to this reader/g) ?? []).length, withheld, reader);
    }
    assert.match(rowsFor('buyer'), /Parts replaced<\/span><span class="vp-readout__hidden">/, 'a buyer does not see parts');
});

test('the tabs follow the ARIA pattern in the markup', () => {
    const tabs = HOME.match(/<button type="button" role="tab"[^>]*>/g) ?? [];
    assert.equal(tabs.length, 3);
    assert.equal(tabs.filter((t) => /aria-selected="true" tabindex="0"/.test(t)).length, 1, 'one selected tab in the Tab order');
    assert.equal(tabs.filter((t) => /aria-selected="false" tabindex="-1"/.test(t)).length, 2);
    for (const t of tabs) assert.match(t, /aria-controls="reader-panel"/);
    assert.match(HOME, /id="reader-panel" role="tabpanel" aria-labelledby="tab-buyer" tabindex="0"/);
});
