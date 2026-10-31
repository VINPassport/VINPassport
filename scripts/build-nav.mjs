/**
 * One navigation bar, written into every page.
 *
 *   node scripts/build-nav.mjs          rewrite every page's <nav>
 *   node scripts/build-nav.mjs --check  report drift, change nothing (exit 1 if any)
 *
 * The bar was hand-written on seven pages and had drifted into three
 * different bars: the home page offered Watch, How it works and Honest
 * limits; the application pages offered Intake, Proofs and Verify; the
 * content pages offered something in between. A reader moving between them
 * saw the site change shape under them. Repeating markup by hand is what
 * caused that, so it is generated here from one list and one page table.
 *
 * Two conventions, applied uniformly rather than per page:
 *
 *   - The page you are on is MARKED, not linked. A text item gets the blue
 *     underline, a button keeps its shape but loses its fill. Both carry
 *     `aria-current="page"`, which the bars used to do only sometimes.
 *   - Anchors point at the home page's sections from everywhere, so
 *     `Honest limits` is `#limits` at the root and `../#limits` below it.
 *
 * Line endings are preserved per file: the site's pages are CRLF, while
 * /guide/ is generated with LF, and rewriting one in the other's style
 * produces a diff of the whole file and a mixed-ending repository.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', 'site');
const CHECK = process.argv.includes('--check');

/** The bar, in order. `anchor` items address a section of the home page. */
const ITEMS = [
    { key: 'guide', label: 'Guide', href: 'guide/', kind: 'link' },
    { key: 'regulation', label: 'Regulation', href: 'regulation/', kind: 'link' },
    { key: 'limits', label: 'Honest limits', href: '#limits', kind: 'link', anchor: true },
    { key: 'demo', label: 'Live demo', href: 'demo/', kind: 'link' },
    { key: 'manufacturers', label: 'For manufacturers', href: 'manufacturers/', kind: 'link' },
    { key: 'verify', label: 'SCAN A VEHICLE', href: 'verify/', kind: 'ghost' },
    { key: 'intake', label: 'ADD PASSPORT', href: 'intake/', kind: 'solid' }
];

/**
 * `current` names the item this page IS, so the bar marks it instead of
 * offering a trip to where the reader already is. `/proofs/` has no item of
 * its own: it is reached from the pages that cite it. The bar holds seven
 * items; an eighth pushes it into a second row on a laptop. Watch and How it
 * works were dropped for exactly that budget, because both are sections a
 * reader reaches by scrolling the home page.
 */
export const PAGES = [
    { file: 'index.html', depth: 0, current: null },
    { file: 'guide/index.html', depth: 1, current: 'guide' },
    { file: 'regulation/index.html', depth: 1, current: 'regulation' },
    { file: 'demo/index.html', depth: 1, current: 'demo' },
    { file: 'verify/index.html', depth: 1, current: 'verify' },
    { file: 'intake/index.html', depth: 1, current: 'intake' },
    { file: 'proofs/index.html', depth: 1, current: null },
    { file: 'manufacturers/index.html', depth: 1, current: 'manufacturers' }
];

const LINK = 'text-decoration:none;font-size:14px;color:#0E1726;white-space:nowrap';
const LINK_HERE = 'font-size:14px;color:#004AAD;white-space:nowrap;'
    + 'border-bottom:2px solid #004AAD;padding-bottom:2px';
const BTN = "display:inline-flex;align-items:center;justify-content:center;text-align:center;"
    + "line-height:1.2;text-decoration:none;font-family:'Barlow Condensed',sans-serif;"
    + "font-weight:600;font-size:15px;letter-spacing:.06em;padding:9px 20px;white-space:nowrap;flex:none";
const SOLID = `${BTN};background:#004AAD;color:#EDE4D8;border:1px solid #004AAD`;
const GHOST = `${BTN};background:transparent;color:#0E1726;border:1px solid rgba(0,74,173,.28)`;
const BTN_HERE = `${BTN};background:transparent;color:#004AAD;border:1px solid #004AAD`;

const itemMarkup = (item, page) => {
    const prefix = page.depth ? '../' : '';
    const href = item.anchor ? `${prefix}${item.href}` : `${prefix}${item.href}`;
    const here = page.current === item.key;
    if (item.kind === 'link') {
        return here
            ? `<span aria-current="page" style="${LINK_HERE}">${item.label}</span>`
            : `<a href="${href}" style="${LINK}">${item.label}</a>`;
    }
    const style = here ? BTN_HERE : (item.kind === 'solid' ? SOLID : GHOST);
    return here
        ? `<span aria-current="page" style="${style}">${item.label}</span>`
        : `<a href="${href}" style="${style}">${item.label}</a>`;
};

export function navMarkup(page) {
    const prefix = page.depth ? '../' : '';
    const img = `<img src="${prefix}assets/vinpassport-logo.png" alt="VINPassport" `
        + `width="546" height="102" style="height:32px;width:auto">`;
    // The logo goes home, except at home, where it would link to itself.
    const brand = page.depth
        ? `<a href="${prefix}" style="display:flex;align-items:center;margin-right:auto;flex:none;text-decoration:none">\n      ${img}\n    </a>`
        : `<span style="display:flex;align-items:center;margin-right:auto;flex:none">\n      ${img}\n    </span>`;
    const links = ITEMS.map((i) => `      ${itemMarkup(i, page)}`).join('\n');
    return `<nav class="nav-bar" style="display:flex;align-items:center;flex-wrap:wrap;gap:14px 26px;`
        + `padding:18px 0;min-height:75px;border-bottom:1px solid rgba(0,74,173,.26)">\n`
        + `    <a class="nav-skip" href="#main">Skip to content</a>\n`
        + `    ${brand}\n`
        + `    <div class="nav-links" id="navmenu">\n${links}\n    </div>\n`
        + `    <button class="nav-burger" type="button" aria-label="Menu" aria-expanded="false" `
        + `aria-controls="navmenu"><i></i><i></i><i></i></button>\n`
        + `  </nav>`;
}

// Importing this module must not rewrite the site. `scripts/build-guide.mjs`
// imports `navMarkup` so the generated guide carries the same bar as every
// hand-written page; without this guard that import would rewrite all seven.
const RUN_DIRECTLY = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (!RUN_DIRECTLY) {
    // Imported for `navMarkup` / `PAGES`; nothing else to do.
} else {

let changed = 0;
let drift = 0;
for (const page of PAGES) {
    const path = join(SITE, page.file);
    const raw = readFileSync(path, 'utf8');
    const crlf = raw.includes('\r\n');
    const body = crlf ? raw.replace(/\r\n/g, '\n') : raw;

    const a = body.indexOf('<nav');
    const b = body.indexOf('</nav>', a);
    if (a < 0 || b < 0) throw new Error(`${page.file} has no <nav>`);
    const before = body.slice(a, b + 6);
    const after = navMarkup(page);

    if (before === after) { console.log(`  same  ${page.file}`); continue; }
    drift += 1;
    if (CHECK) { console.log(`  DRIFT ${page.file}`); continue; }

    const next = body.slice(0, a) + after + body.slice(b + 6);
    writeFileSync(path, crlf ? next.replace(/\n/g, '\r\n') : next);
    changed += 1;
    console.log(`  wrote ${page.file}${crlf ? '' : '  (LF)'}`);
}

if (CHECK) {
    console.log(drift ? `\n${drift} page(s) drifted from the shared bar` : '\nevery bar matches');
    process.exit(drift ? 1 : 0);
}
console.log(`\n${changed} page(s) rewritten, ${PAGES.length - changed} already correct`);
}
