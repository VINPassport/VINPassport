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
 *   - Every item is a page. The bar carries no anchors into home page
 *     sections: Watch, How it works and Honest limits were all dropped,
 *     because a reader reaches each of them by scrolling the home page.
 *
 * THE 2026 REDESIGN. A page marked `design: 'vp'` in PAGES gets the new
 * header (notice band, bar, phone menu) and footer instead of the bar above,
 * stamped between `<header class="vp-header"` and `</header>` and between
 * `<footer class="vp-footer"` and `</footer>`. Pages move over as they are
 * ported; the old bar and its markers go once the last one has. In the new
 * header the current page stays a link and carries `aria-current="page"`,
 * as the design does.
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

/** The bar, in order. */
const ITEMS = [
    { key: 'guide', label: 'Guide', href: 'guide/', kind: 'link' },
    { key: 'regulation', label: 'Regulation', href: 'regulation/', kind: 'link' },
    { key: 'demo', label: 'Live demo', href: 'demo/', kind: 'link' },
    { key: 'manufacturers', label: 'For manufacturers', href: 'manufacturers/', kind: 'link' },
    { key: 'verify', label: 'SCAN A VEHICLE', href: 'verify/', kind: 'ghost' },
    { key: 'intake', label: 'ADD PASSPORT', href: 'intake/', kind: 'solid' }
];

/**
 * `current` names the item this page IS, so the bar marks it instead of
 * offering a trip to where the reader already is. `/proofs/`, `/disclose/` and
 * `/wallet/` have no item of their own: they are reached from the pages that cite them.
 * The bar holds six items today; at eight it wrapped to a second row on a
 * laptop.
 */
export const PAGES = [
    { file: 'index.html', depth: 0, current: 'home', design: 'vp' },
    { file: 'guide/index.html', depth: 1, current: 'guide' },
    { file: 'regulation/index.html', depth: 1, current: 'regulation' },
    { file: 'demo/index.html', depth: 1, current: null, design: 'vp' },
    { file: 'verify/index.html', depth: 1, current: 'verify' },
    { file: 'intake/index.html', depth: 1, current: null, design: 'vp' },
    { file: 'proofs/index.html', depth: 1, current: null, design: 'vp' },
    { file: 'manufacturers/index.html', depth: 1, current: 'manufacturers', design: 'vp' },
    { file: 'disclose/index.html', depth: 1, current: null, design: 'vp' },
    { file: 'wallet/index.html', depth: 1, current: null, design: 'vp' },
    // The 2026 redesign. A page joins the new design when it is ported: `design: 'vp'` stamps
    // the new header and footer instead of the old bar. The old bar goes once every page has
    // moved. 404.html is served from any depth, so its links are root-absolute.
    { file: 'privacy/index.html', depth: 1, current: null, design: 'vp' },
    { file: '404.html', depth: 0, current: null, design: 'vp', absolute: true },
    { file: 'compliance/index.html', depth: 1, current: 'compliance', design: 'vp' },
    { file: 'how-it-works/index.html', depth: 1, current: 'how', design: 'vp' },
    { file: 'lifestyle/index.html', depth: 1, current: 'lifestyle', design: 'vp' },
    { file: 'developers/index.html', depth: 1, current: 'developers', design: 'vp' },
    { file: 'about/index.html', depth: 1, current: 'about', design: 'vp' },
    { file: 'scan/index.html', depth: 1, current: 'scan', design: 'vp' },
    { file: 'v/index.html', depth: 1, current: null, design: 'vp' }
];

// ---- The redesign's header and footer (design handoff, Header.dc.html and Footer.dc.html) ----

/** Header items, in order. `key` is what a page names as `current`. */
export const VP_ITEMS = [
    { key: 'how', label: 'How it works', href: 'how-it-works/' },
    { key: 'compliance', label: 'Compliance', href: 'compliance/' },
    { key: 'manufacturers', label: 'Manufacturers', href: 'manufacturers/' },
    { key: 'lifestyle', label: 'Lifestyle', href: 'lifestyle/' },
    { key: 'developers', label: 'Developers', href: 'developers/' }
];

/**
 * The notice band's two tenses. Euro 7 applies to new M1 and N1 types from 29 November 2026
 * (Reg (EU) 2024/1257, Art. 21); assets/chrome.mjs shows the second text from that date.
 */
export const BAND = {
    switchAt: '2026-11-29T00:00:00+01:00',
    before: { long: 'Euro 7 applies to new vehicle types from 29 Nov 2026', short: 'Euro 7 from 29 Nov 2026' },
    after: { long: 'Euro 7 has applied to new vehicle types since 29 Nov 2026', short: 'Euro 7 since 29 Nov 2026' }
};

const QR_ICON = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" `
    + 'stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"></rect>'
    + '<rect x="14" y="3" width="7" height="7" rx="1"></rect><rect x="3" y="14" width="7" height="7" rx="1"></rect>'
    + '<path d="M14 14h3v3M21 14v7h-7"></path></svg>';
const NEW_TAB = '<span class="vp-sr"> (opens in a new tab)</span>';
const GITHUB = 'https://github.com/VINPassport/VINPassport';

const rootOf = (page) => (page.absolute ? '/' : page.depth ? '../'.repeat(page.depth) : '');
const homeOf = (page) => (page.absolute ? '/' : page.depth ? '../'.repeat(page.depth) : './');
// The size lives in vp.css (45 px on the desktop bar, 36 px on the phone bar, 40 px in the
// footer), never inline: an inline height beats the phone media query. width and height here
// only give the browser the aspect ratio, so the bar does not shift while the logo loads.
const logo = (page) => `<a class="vp-logo" href="${homeOf(page)}" aria-label="VINPassport home">`
    + `<img src="${rootOf(page)}assets/brand/vinpassport-logo-horizontal-primary.svg" alt="VINPassport" width="1204" height="248"></a>`;

export function headerMarkup(page) {
    const r = rootOf(page);
    const here = (key) => (page.current === key ? ' aria-current="page"' : '');
    const desk = VP_ITEMS.map((i) => `<a href="${r}${i.href}"${here(i.key)}>${i.label}</a>`).join('');
    const phone = [
        `<a href="${homeOf(page)}"${page.current === 'home' ? ' aria-current="page"' : ''}>Home</a>`,
        ...VP_ITEMS.map((i) => `<a href="${r}${i.href}"${here(i.key)}>${i.label}</a>`),
        `<a href="${r}about/"${here('about')}>About and contact</a>`
    ].join('\n        ');
    const band = (t) => `<span class="vp-band__long">${t.long}</span><span class="vp-band__short">${t.short}</span>`;
    return [
        '<header class="vp-header">',
        '  <a class="vp-skip" href="#main">Skip to main content</a>',
        `  <div class="vp-band" data-switch-at="${BAND.switchAt}"><span class="vp-band__before">${band(BAND.before)}</span>`
            + `<span class="vp-band__after">${band(BAND.after)}</span> · <a href="${r}compliance/">What it means</a></div>`,
        '  <nav aria-label="Main">',
        '    <div class="vp-bar">',
        `      ${logo(page)}`,
        `      <div class="vp-nav">${desk}</div>`,
        `      <div class="vp-actions"><a class="vp-btn vp-btn--ghost" href="${r}scan/"${here('scan')}>${QR_ICON(18)}Scan a vehicle</a>`
            + `<a class="vp-btn vp-btn--primary" href="${r}manufacturers/#pilot">Book a pilot call</a></div>`,
        `      <a class="vp-icon-btn vp-icon-btn--scan" href="${r}scan/" aria-label="Scan a vehicle"${here('scan')}>${QR_ICON(22)}</a>`,
        '      <button class="vp-icon-btn vp-burger" type="button" aria-expanded="false" aria-controls="vp-menu" aria-label="Open menu">'
            + '<svg class="vp-burger__open" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"></path></svg>'
            + '<svg class="vp-burger__close" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"></path></svg></button>',
        '    </div>',
        '    <div class="vp-menu" id="vp-menu">',
        `        ${phone}`,
        `        <a class="vp-btn vp-btn--primary" href="${r}manufacturers/#pilot">Book a pilot call</a>`,
        `        <a class="vp-btn vp-btn--secondary" href="${r}scan/"${here('scan')}>Scan a vehicle</a>`,
        '    </div>',
        '  </nav>',
        '</header>'
    ].join('\n');
}

/** Footer columns. Anchors name the section on each page; until a page exists they land on its top. */
const FOOTER = [
    ['Product', [['How it works', 'how-it-works/'], ['Who sees what', 'how-it-works/#who-sees-what'], ['Trust and limits', 'how-it-works/#trust'], ['Scan a vehicle', 'scan/'], ['Boats, quads and motorhomes', 'lifestyle/']]],
    ['Compliance', [['Euro 7 passport', 'compliance/#euro-7'], ['Circularity 2032', 'compliance/#circularity'], ['Standards', 'compliance/#standards']]],
    ['Manufacturers', [['Pilot programme', 'manufacturers/#pilot'], ['Security and data', 'manufacturers/#security'], ['Your brand on the verdict', 'manufacturers/#your-brand']]],
    ['Developers', [['Contract and docs', 'developers/'], ['GitHub', GITHUB], ['Try it live', 'developers/#try'], ['Pitch deck', 'deck/'], ['About and contact', 'about/']]]
];

export function footerMarkup(page) {
    const r = rootOf(page);
    const link = ([label, href]) => (href.startsWith('https://')
        ? `<a href="${href}" target="_blank" rel="noopener">${label}${NEW_TAB}</a>`
        : `<a href="${r}${href}">${label}</a>`);
    const cols = FOOTER.map(([title, links]) => `      <div class="vp-footer__col"><div class="vp-label">${title}</div>${links.map(link).join('')}</div>`);
    return [
        '<footer class="vp-footer">',
        '  <div class="wrap vp-footer__inner">',
        '    <div class="vp-footer__cols">',
        `      <div class="vp-footer__brand">${logo(page)}<p class="small">Vehicle passports issued at the factory and trusted for life. Built on Midnight.</p></div>`,
        ...cols,
        '    </div>',
        `    <div class="vp-footer__base"><span>Apache-2.0 · Euro 7 · Reg. (EU) 2026/1738 · Built on Midnight</span><span><a href="${r}privacy/">Privacy</a> · © 2026 VINPassport</span></div>`,
        '    <div class="vp-mrz" aria-hidden="true">P&lt;VINPASSPORT&lt;&lt;ISSUED&lt;AT&lt;SOURCE&lt;&lt;VERIFIED&lt;FOR&lt;LIFE&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;&lt;</div>',
        '  </div>',
        '</footer>'
    ].join('\n');
}

/** Replace the region from `<open` to `</close>` with `markup`; throws if the page lacks it. */
function stamp(body, file, open, close, markup) {
    const a = body.indexOf(open);
    const b = body.indexOf(close, a);
    if (a < 0 || b < 0) throw new Error(`${file} has no ${open}…${close}`);
    return body.slice(0, a) + markup + body.slice(b + close.length);
}

const LINK = 'text-decoration:none;font-size:14px;color:#0E1726;white-space:nowrap';
// The mark is a text decoration, not a border. A border and its padding made
// the marked item 4px taller than its neighbours, so the bar centred it 2px
// higher on every page whose current item is a link, and in the phone menu its
// inline padding beat the menu's own and squeezed that one row.
const LINK_HERE = 'font-size:14px;color:#004AAD;white-space:nowrap;text-decoration:underline;'
    + 'text-decoration-thickness:2px;text-underline-offset:6px;text-decoration-skip-ink:none';
const BTN = "display:inline-flex;align-items:center;justify-content:center;text-align:center;"
    + "line-height:1.2;text-decoration:none;font-family:'Barlow Condensed',sans-serif;"
    + "font-weight:600;font-size:15px;letter-spacing:.06em;padding:9px 20px;white-space:nowrap;flex:none";
const SOLID = `${BTN};background:#004AAD;color:#EDE4D8;border:1px solid #004AAD`;
const GHOST = `${BTN};background:transparent;color:#0E1726;border:1px solid rgba(0,74,173,.28)`;
const BTN_HERE = `${BTN};background:transparent;color:#004AAD;border:1px solid #004AAD`;

const itemMarkup = (item, page) => {
    const prefix = page.depth ? '../' : '';
    const href = `${prefix}${item.href}`;
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
    // The logo goes home from every page, home included. A reader far down the
    // home page expects it to take them back to the top, and a link to the page
    // itself, without any fragment, reloads it there.
    const brand = `<a href="${page.depth ? prefix : './'}"${page.depth ? '' : ' aria-current="page"'} `
        + `style="display:flex;align-items:center;margin-right:auto;flex:none;text-decoration:none">\n      ${img}\n    </a>`;
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

    let next;
    if (page.design === 'vp') {
        next = stamp(body, page.file, '<header class="vp-header"', '</header>', headerMarkup(page));
        next = stamp(next, page.file, '<footer class="vp-footer"', '</footer>', footerMarkup(page));
    } else {
        next = stamp(body, page.file, '<nav', '</nav>', navMarkup(page));
    }

    if (next === body) { console.log(`  same  ${page.file}`); continue; }
    drift += 1;
    if (CHECK) { console.log(`  DRIFT ${page.file}`); continue; }

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
