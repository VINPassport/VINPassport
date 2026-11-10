/**
 * Home page: the reader tabs ("One passport. Each reader sees their page.").
 *
 * The ARIA tabs pattern: one tab in the Tab order at a time, arrow keys move
 * and select, Home and End jump to the ends, and the panel is relabelled by
 * the tab that shows it. The page ships the buyer's view in its HTML, so it
 * reads correctly before this module runs and if it never does.
 *
 * The rows are the design handoff's sample (Main.dc.html), about an invented
 * vehicle the page labels as a sample.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

export const READERS = { buyer: 'A buyer', recycler: 'A recycler', authority: 'A market authority' };

export const ROWS = [
    ['Written off', { buyer: 'Never · verified', recycler: 'Category: none', authority: 'Never · issuer record' }],
    ['Accidents', { buyer: 'None reported · verified', authority: 'None reported · issuer record' }],
    ['Mileage', { buyer: 'Under 150,000 km · verified', authority: '84,210 km · 12 Jan 2031' }],
    ['Keepers', { buyer: 'One from new · verified', authority: '1 · registered owner on file' }],
    ['Parts replaced', { recycler: 'Battery module 3 · 2031', authority: 'Battery module 3 · 2031' }],
    ['Battery passport', { buyer: 'Linked', recycler: 'Linked, full access', authority: 'Linked, full access' }],
    ['Environmental data', { buyer: 'Euro 7 summary', recycler: 'Materials summary', authority: 'Full EVP record' }]
];

/** The rows one reader sees, as markup. A row without a value is shown as withheld, never dropped. */
export function rowsFor(reader) {
    const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    return ROWS.map(([label, v]) => `<li><span class="vp-label">${esc(label)}</span>${v[reader]
        ? `<span class="vp-readout__value">${esc(v[reader])}</span>`
        : '<span class="vp-readout__hidden">Not shown to this reader</span>'}</li>`).join('');
}

function wireTabs(list) {
    const tabs = [...list.querySelectorAll('[role="tab"]')];
    const panel = document.getElementById(tabs[0].getAttribute('aria-controls'));
    const name = panel.querySelector('[data-reader-name]');
    const rows = panel.querySelector('[data-reader-rows]');

    const select = (tab, { focus = true } = {}) => {
        for (const t of tabs) {
            const on = t === tab;
            t.setAttribute('aria-selected', String(on));
            t.tabIndex = on ? 0 : -1;
        }
        const reader = tab.dataset.reader;
        name.textContent = READERS[reader];
        rows.innerHTML = rowsFor(reader);
        panel.setAttribute('aria-labelledby', tab.id);
        if (focus) tab.focus();
    };

    list.addEventListener('click', (e) => {
        const tab = e.target.closest('[role="tab"]');
        if (tab) select(tab);
    });
    list.addEventListener('keydown', (e) => {
        const at = tabs.indexOf(document.activeElement);
        if (at < 0) return;
        const to = { ArrowRight: at + 1, ArrowDown: at + 1, ArrowLeft: at - 1, ArrowUp: at - 1, Home: 0, End: tabs.length - 1 }[e.key];
        if (to === undefined) return;
        e.preventDefault();
        select(tabs[(to + tabs.length) % tabs.length]);
    });
}

if (typeof document !== 'undefined') {
    const list = document.querySelector('.vp-tabs[role="tablist"]');
    if (list) wireTabs(list);
}
