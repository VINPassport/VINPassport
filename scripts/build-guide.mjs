/**
 * Build /guide/: the two journeys through the product, step by step, each one
 * showing the screen it describes and saying both what to do and why it works
 * that way. Screenshots are captured from the running product against the
 * compiled circuits, so they are the real screens rather than drawings.
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CREATE, VERIFY } from './lib/guide-steps.mjs';
// The bar comes from the same definition every hand-written page uses, so a
// guide rebuild cannot quietly revert it (scripts/build-nav.mjs).
import { navMarkup, PAGES as NAV_PAGES } from './build-nav.mjs';

const GUIDE_NAV = navMarkup(NAV_PAGES.find((p) => p.file === 'guide/index.html'));

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', 'site');

/**
 * Every image needs its intrinsic size in the markup. Without it a lazily
 * loaded image occupies no height until it arrives, and the page jumps under
 * the reader as each one lands. Read the real dimensions out of the PNG
 * header rather than recording them by hand, so a recapture cannot leave the
 * markup describing the previous crop.
 */
const SHOTS = join(SITE, 'guide', 'shots');
const dims = (name) => {
    const b = readFileSync(`${SHOTS}/${name}.png`).subarray(0, 24);
    if (b.readUInt32BE(0) !== 0x89504e47) throw new Error(`${name}.png is not a PNG`);
    return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
};

const OUT = join(SITE, 'guide', 'index.html');

const BTN_SOLID = "display:inline-flex;align-items:center;justify-content:center;text-align:center;line-height:1.2;text-decoration:none;font-family:'Barlow Condensed',sans-serif;font-weight:600;font-size:16px;letter-spacing:.06em;background:#004AAD;color:#EDE4D8;border:1px solid #004AAD;padding:12px 22px";
const BTN_GHOST = "display:inline-flex;align-items:center;justify-content:center;text-align:center;line-height:1.2;text-decoration:none;font-family:'Barlow Condensed',sans-serif;font-weight:600;font-size:16px;letter-spacing:.06em;color:#0E1726;border:1px solid rgba(0,74,173,.28);padding:12px 22px";
const CTA_SOLID = "display:inline-flex;align-items:center;justify-content:center;text-align:center;line-height:1.2;text-decoration:none;font-family:'Barlow Condensed',sans-serif;font-weight:600;font-size:15px;letter-spacing:.06em;background:#004AAD;color:#EDE4D8;border:1px solid #004AAD;padding:9px 20px;white-space:nowrap;flex:none";
const CTA_GHOST = "display:inline-flex;align-items:center;justify-content:center;text-align:center;line-height:1.2;text-decoration:none;font-family:'Barlow Condensed',sans-serif;font-weight:600;font-size:15px;letter-spacing:.06em;background:transparent;color:#0E1726;border:1px solid rgba(0,74,173,.28);padding:9px 20px;white-space:nowrap;flex:none";
const NAVLINK = 'style="text-decoration:none;font-size:14px;color:#0E1726;white-space:nowrap"';
const LABEL = 'display:block;font:600 10.5px Barlow,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#002E6E;margin-bottom:6px';
const SECTAG = 'display:block;font:600 13px Barlow,sans-serif;letter-spacing:.08em;text-transform:uppercase;color:#002E6E;margin-bottom:12px';

const step = (n, [img, title, todo, why], kind) => {
    const { w, h } = dims(img);
    return `
      <article style="margin:0 0 44px">
        <div style="display:flex;align-items:baseline;gap:12px;margin-bottom:12px">
          <span class="mono" style="flex:none;font-size:13px;color:#004AAD">${kind}${String(n).padStart(2, '0')}</span>
          <h3 style="margin:0;font-size:21px;line-height:1.2;letter-spacing:.01em">${title}</h3>
        </div>
        <div style="border:1px solid rgba(0,74,173,.26);background:#fff;padding:8px">
          <img src="shots/${img}.png" alt="${title}" loading="lazy" decoding="async" width="${w}" height="${h}" style="display:block;width:100%;height:auto;aspect-ratio:${w}/${h};max-width:${Math.round(w / 2)}px">
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:18px 30px;margin-top:16px">
          <div style="flex:1 1 290px;min-width:0">
            <span style="${LABEL}">What to do</span>
            <p style="margin:0;font-size:15px;line-height:1.6;color:rgba(14,23,38,.84)">${todo}</p>
          </div>
          <div style="flex:1 1 290px;min-width:0;padding-left:18px;border-left:3px solid rgba(0,74,173,.3)">
            <span style="${LABEL}">Why it works that way</span>
            <p style="margin:0;font-size:15px;line-height:1.6;color:rgba(14,23,38,.84)">${why}</p>
          </div>
        </div>
      </article>`;
};

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Guide &middot; VINPassport</title>
<meta name="description" content="Step by step through both sides of a vehicle passport: creating a record, and verifying one. Every step shows the real screen and says why it works that way.">
<link rel="icon" href="../favicon.ico" sizes="32x32">
<link rel="icon" type="image/png" sizes="32x32" href="../assets/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="../assets/favicon-16.png">
<link rel="apple-touch-icon" href="../assets/apple-touch-icon.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<meta property="og:type" content="website">
<meta property="og:site_name" content="VINPassport">
<meta property="og:title" content="VINPassport &middot; The guide">
<meta property="og:description" content="Creating a record, and verifying one. Both journeys, screen by screen.">
<meta property="og:url" content="https://passport.vin/guide/">
<meta property="og:image" content="https://passport.vin/assets/vinpassport-banner.png">
<meta property="og:image:width" content="1500">
<meta property="og:image:height" content="500">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="https://passport.vin/assets/vinpassport-banner.png">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow:wght@400;500;700&family=Barlow+Condensed:wght@400;600;700&display=swap">
<link rel="stylesheet" href="../assets/site.css?v=13">
</head>
<body>
<div style="max-width:1200px;margin:0 auto;padding:0 var(--edge)">

  ${GUIDE_NAV}

  <main id="main">
  <section style="padding:clamp(40px,7vw,76px) 0 34px">
    <span style="${SECTAG}">The guide</span>
    <h1 class="hero-head" style="margin:0;letter-spacing:.01em;text-transform:uppercase;max-width:17ch">Both sides of a passport</h1>
    <p style="font-size:17px;line-height:1.55;max-width:62ch;margin:24px 0 0;color:rgba(14,23,38,.82)">A vehicle passport has two users who never meet. One <b>creates the record</b>, usually at registration or at a service. The other <b>checks it</b>, usually minutes before handing over money. This page walks both journeys, screen by screen, and says why each step works the way it does.</p>
    <p style="font-size:15px;line-height:1.55;max-width:62ch;margin:16px 0 0;color:rgba(14,23,38,.68)">Every screenshot below is the real interface, captured from the running product against the compiled circuits. None of it is a drawing of something we intend to build.</p>
    <div style="display:flex;flex-wrap:wrap;gap:12px;margin-top:26px">
      <a href="#create" style="${BTN_SOLID}">CREATING A RECORD</a>
      <a href="#verify" style="${BTN_GHOST}">VERIFYING A RECORD</a>
    </div>
  </section>

  <section id="create" style="padding:14px 0 50px">
    <span style="${SECTAG}">Part one &middot; Creating a record</span>
    <div style="height:1px;background:rgba(0,74,173,.26);margin-bottom:22px"></div>
    <p style="font-size:16px;line-height:1.6;max-width:64ch;margin:0 0 34px;color:rgba(14,23,38,.82)">This is the registrar's path: a manufacturer, a registration authority, a tester or a workshop putting a vehicle on the register. Open <a href="../intake/" style="color:#004AAD">the intake console</a> in another tab and follow along. Eight steps, and the last two produce something you can put on the car.</p>
${CREATE.map((s, i) => step(i + 1, s, 'C')).join('\n')}
    <div style="border:1px solid rgba(0,74,173,.26);background:rgba(0,74,173,.05);padding:18px 20px">
      <span style="${LABEL}">Before you do this for real</span>
      <p style="margin:0;font-size:15px;line-height:1.6;color:rgba(14,23,38,.84)">On a public network these writes cannot be undone. A VIN cannot be registered a second time, and a field is initialised once with its integrity rule fixed at that moment. Run it locally until the record you are entering is the record you mean.</p>
    </div>
  </section>

  <section id="verify" style="padding:14px 0 50px">
    <span style="${SECTAG}">Part two &middot; Verifying a record</span>
    <div style="height:1px;background:rgba(0,74,173,.26);margin-bottom:22px"></div>
    <p style="font-size:16px;line-height:1.6;max-width:64ch;margin:0 0 34px;color:rgba(14,23,38,.82)">This is the buyer's path, and it needs <b>no wallet, no account and no login</b>. Scan a code, or open <a href="../verify/" style="color:#004AAD">the verify page</a>. Ten steps, and the last one is checking the answer without us.</p>
${VERIFY.map((s, i) => step(i + 1, s, 'V')).join('\n')}
  </section>

  <section style="padding:0 0 70px">
    <div style="border:1px solid rgba(0,74,173,.26);padding:clamp(20px,3vw,28px)">
      <h2 style="margin:0;font-size:22px;line-height:1.1;letter-spacing:.02em;text-transform:uppercase">Where to go next</h2>
      <div style="display:flex;flex-wrap:wrap;gap:14px;margin-top:18px">
        <a href="../intake/" style="${BTN_SOLID}">CREATE A RECORD</a>
        <a href="../verify/" style="${BTN_GHOST}">SEE A VERDICT</a>
        <a href="../regulation/" style="${BTN_GHOST}">THE REGULATION</a>
        <a href="../demo/" style="${BTN_GHOST}">A RUN ON PREPROD</a>
      </div>
    </div>
  </section>
  </main>

  <footer style="padding:26px 0 48px;border-top:1px solid rgba(0,74,173,.26);display:flex;flex-wrap:wrap;gap:16px 32px;align-items:center;font-size:13px;color:rgba(14,23,38,.7)">
    <img src="../assets/vinpassport-logo.png" alt="VINPassport" width="546" height="102" style="height:24px;width:auto">
    <span>Proving a vehicle identity.</span>
    <span class="ft-meta" style="margin-left:auto;min-width:0">Apache-2.0 &middot; Reg (EU) 2026/1738 &middot; Midnight Network</span>
  </footer>

</div>
<script type="module" src="../assets/nav.mjs?v=1"></script>
</body>
</html>
`;

writeFileSync(OUT, html);
console.log(`guide written: ${Math.round(html.length / 1024)}KB, ${CREATE.length} create steps, ${VERIFY.length} verify steps`);
