# Site design rules (passport.vin front door)

The site in `site/` was hand-designed and delivered as a finished artifact on
2026-08-28. The rules below are the designer's handoff and they bind every
future edit. Status of the handoff's open items, as integrated:

- Placeholder links: wired. Nav and hero go to `/verify/`; the three surface
  cards go to `/intake/`, `/proofs/`, `/verify/`; contract and repo links
  point at VINPassport/VINPassport. Still pending: the 90-second walkthrough
  link (waits for the video).
- Repo links: updated for the VINPassport rename.
- Prose was converted to the project's no-em-dash convention and vehicle
  dropdowns were aligned to the exact names in `site/assets/demo-vehicles.mjs`.
  The not-proven badge glyph stays: it is an icon, not wording.
- The published layout: `site/` IS the app. The designed `/verify/`, `/intake/`
  and `/proofs/` pages are wired to the real logic by `verify.js`, `intake.js`
  and `proofs.js` (each added as a separate module script, markup untouched, per
  the rule above). Shared logic lives in `site/assets/` (`verdict.mjs`,
  `sources.mjs`, `demo-vehicles.mjs`); the demo ledger export lives in
  `site/verify/`. `/console/` is a redirect stub to `/intake/` for old links.
  See `.github/workflows/pages.yml`.

The original handoff text follows.

---

# CLAUDE.md: VINPassport site (passport.vin)

Read this before touching any file in `site/`.

## What this is

`site/` is a finished, hand-designed static site. It is not scaffolding, not a
draft, and not generated output. Three pages:

| Path | File | Audience |
| --- | --- | --- |
| `/` | `site/index.html` | Overview: what VINPassport is, how privacy works, the three surfaces |
| `/regulation/` | `site/regulation/index.html` | Reader's summary of Reg (EU) 2026/1738 and the 32-slot field registry |

## The one rule

**Do not change the visual design.** Not the colours, type sizes, weights,
letter-spacing, padding, gaps, border widths, opacity values, wording, or the
order of anything. If a change you are asked to make would alter what the page
looks like, stop and ask first.

This includes changes that would normally count as improvements:

- Do not "clean up" the inline styles into classes or a utility framework.
  The inline styles are the design. Converting them will drift the layout.
- Do not add Tailwind, Bootstrap, a CSS reset, or any framework.
- Do not introduce a build step, bundler, npm dependency, or template engine.
- Do not reformat or re-indent the HTML. Diffs should stay small and readable.
- Do not swap the fonts. Barlow Condensed for headings, Barlow for body, a
  monospace stack for hashes and field names. Nothing else.
- Do not round any corners. Every box in this design is square by intent.
- Do not add shadows, gradients, blur, or hover animations.
- Do not add emoji, icons, or illustrations that are not already there.
- Do not "modernise" the copy. It was written carefully and deliberately
  avoids marketing tone, em dashes, and overclaiming.

## What you may change freely

- Wiring links to real destinations (see "Placeholder links" below).
- Adding pages, following the existing grammar exactly.
- Analytics, meta tags, Open Graph tags, favicon variants, `robots.txt`,
  `sitemap.xml`.
- Deployment configuration, CI, GitHub Actions.
- Accessibility fixes that do not change appearance: `alt` text, `aria-label`,
  landmark elements, heading order, `lang`, focus order. If an a11y fix would
  change appearance, propose it rather than applying it.
- Fixing a genuine bug (broken layout at some width, a typo in a URL, an
  invalid attribute). Describe what you changed and why.

## Design system in one screen

Colours, and where each belongs:

| Token | Value | Use |
| --- | --- | --- |
| Ground | `#EDE4D8` | Page background. Taken from the logo's cream |
| Recessed | `#E6DCCE` | Input fills, the command-line block |
| Ink | `#0E1726` | Body text |
| Brand blue | `#004AAD` | Headings' accent lines, ticks, primary buttons, the full-bleed statement panels |
| Deep blue | `#002E6E` | Section kickers and small text on the cream ground, for contrast |
| Periwinkle | `#8B95FF` | Reserved for exactly three meanings: demo data, a refusal, and "not proven" |
| Hairline | `rgba(0,74,173,.26)` | Every border and rule |

Type: `Barlow Condensed` 600 for headings, uppercase with light positive
letter-spacing. `Barlow` 400/500/700 for body. `ui-monospace` for hashes, field
names, slot numbers, dates in the timeline and anything a machine produced.

Structure: square corners everywhere. Hairline borders. Section headers are a
numbered uppercase kicker (`01 ·`, `02 ·`) above a full-width 1px rule. Cards
carry the blueprint frame: `class="blueprint"` plus four
`<i class="corner tl|tr|bl|br"></i>` children that draw the registration marks.
**Never delete those `<i>` elements**: they are the marks, not decoration.

Only two things live in `site/assets/site.css`: the blueprint frame rules and
the page-level tokens and resets. Everything else is inline on purpose, so a
component's full appearance is visible where it is used.

## Responsive behaviour

The pages carry **no media queries** and must keep working without them. Layout
reflows intrinsically:

- Rows are `display:flex; flex-wrap:wrap` with `flex:1 1 <basis>px; min-width:0`
  on each child, so columns collapse to one when the basis no longer fits.
- Card grids are `grid-template-columns:repeat(auto-fit,minmax(<n>px,1fr))`.
- Type and padding scale with `clamp()`.
- Ruled rows put the border on the row wrapper, never on individual cells. Two
  cells with their own bottom borders draw the rule at two different heights.
  This bug was already found and fixed once; do not reintroduce it.
- **No horizontal scrolling regions.** A table that would need one is
  linearised into wrap-flex rows instead. Verify at 320px, 390px, 768px and
  1440px after any change.

## Placeholder links: all wired up

This section used to list links pointing at the interface mockups. Every one of
them now points at a real surface: `SEE A LIVE PASSPORT` and `SCAN A VEHICLE` at
`/verify/`, the three surface cards at `/intake/`, `/proofs/` and `/verify/`,
and the explainer button at the video on the page rather than at a section
heading. The mockups themselves were deleted on 14 October 2026: they were
unlinked, noindexed, and still described a six-circuit contract that has not
existed since Wave 1. They are in the history if anyone wants them back.

EUR-Lex links on `/regulation/` are real and correct. Do not change them.

## Content accuracy rules

The regulation page is deliberately careful, and that carefulness is the point.
Preserve it:

- Keep the "plain language, not legal advice" notice.
- The dates are no longer secondary. As of 2026-09-08 entry-into-force
  (Art. 59(1)), general application (Art. 59(2)), the circularity strategy
  (Art. 9(1)) and the 2032 passport deadline (Art. 13(1)) were all read from the
  Official Journal text. Keep the provision citations next to the dates; do not
  reinstate the old "secondary legal analysis" caveat.
- Keep the ESPR panel, and keep **both halves** of it. Regulation 2024/1781
  excludes vehicles at Art. 1(2), so citing it as the *basis* for a vehicle
  passport is a factual error. But Art. 13(1) of 2026/1738 makes alignment with
  ESPR-established passports mandatory, so it is not merely irrelevant. Do not
  resolve the tension by deleting either half. The panel is there because the
  distinction is easy to get wrong in both directions.
- Do not soften the "what this does not prove" panel on `/`. A valid proof of a
  falsely committed value is a real limitation and the site says so on purpose.
- Section 6 on `/` states precisely which parts are ours and which two ODATANO
  libraries are used, each for one narrow job. Do not broaden either claim.

## Deploying to passport.vin on GitHub Pages

`site/CNAME` already contains `passport.vin`, and `.nojekyll` is present so
Jekyll does not process the folder.

Option A, the simplest, serves from a folder on the default branch:

1. Copy the contents of `site/` to the repo root (or to `docs/`).
2. Settings → Pages → Source: *Deploy from a branch*, branch `main`,
   folder `/` (or `/docs`).
3. Settings → Pages → Custom domain: `passport.vin`. Save. Tick
   *Enforce HTTPS* once the certificate is issued.
4. At the DNS registrar for `passport.vin`, add four `A` records for the apex:
   `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
   (and the matching `AAAA` records if you want IPv6). Add a `CNAME` for `www`
   pointing at `<owner>.github.io`.
5. Verify: `https://passport.vin/`, `/regulation/`, `/verify/` all load and the
   pages look identical to the files in this bundle.

Option B, GitHub Actions, if you want `site/` to stay a subfolder:

```yaml
name: Deploy site
on:
  push:
    branches: [main]
permissions:
  contents: read
  pages: write
  id-token: write
concurrency:
  group: pages
  cancel-in-progress: true
jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v3
        with:
          path: site
      - id: deployment
        uses: actions/deploy-pages@v4
```

Then set Settings → Pages → Source: *GitHub Actions*, and keep the custom
domain configured as in step 3 above.

Notes: there is no build step, so nothing to install and nothing to compile.
`CNAME` must end up at the root of whatever is published. Keep `.nojekyll`.

## Large media does not go in git

The explainer cuts are 28 MB and 27 MB. A git repository keeps every version of
a binary for ever, so each new cut adds its full size to every clone of this
repository permanently, and the files are already 95% of what anyone downloads.
Serving them from Pages also puts that bandwidth on the Pages allowance, which
is the same shape of problem that took the demo host down on 10 October 2026.

So media lives in a GitHub release and the pages reference it by URL.

To publish or replace a cut:

```sh
# once, to create the holder
gh release create site-media-2026-10 --title "Site media" \
  --notes "Large media for passport.vin, kept out of the git history."

# every time, from wherever the file is
gh release upload site-media-2026-10 vinpassport-explainer.mp4 --clobber
gh release upload site-media-2026-10 vinpassport-explainer-vertical.mp4 --clobber
```

The URL is stable, so replacing a cut needs no page edit:

```
https://github.com/VINPassport/VINPassport/releases/download/site-media-2026-10/vinpassport-explainer.mp4
```

Then the file leaves the repository without leaving the machine:

```sh
git rm --cached site/assets/vinpassport-explainer.mp4
git rm --cached site/assets/vinpassport-explainer-vertical.mp4
```

`.gitignore` carries `site/assets/*.mp4` so a later `git add -A` cannot put
them back.

**Play it before removing the local files.** A release asset is served from
another host, as a 302 to `release-assets.githubusercontent.com`, and two of
its headers look wrong at a glance:

```sh
curl -sIL "https://github.com/VINPassport/VINPassport/releases/download/\
site-media-2026-10/vinpassport-explainer.mp4" | grep -iE "content-type|accept-ranges"
```

- `Content-Type: application/octet-stream`, **even though the asset is stored
  as `video/mp4`**: the signed URL forces the response type. Measured 14 October
  2026 on both cuts. It plays anyway, because the final response carries no
  `X-Content-Type-Options: nosniff`, so the browser sniffs the container. If
  GitHub ever adds that header this breaks, and the symptom will be a video
  element that loads nothing with no console error worth reading.
- `Content-Disposition: attachment`, which applies to navigation and not to a
  media subresource.

What does have to hold is `Accept-Ranges: bytes`, or the viewer cannot seek.

Then play it, which is one command:

```sh
npm run check:video                               # against passport.vin
npm run check:video -- http://127.0.0.1:5178      # against a local copy
```

It loads the page in Brave, waits for metadata, decodes a frame and seeks to
the middle, for both the desktop and the vertical cut. Measured 14 October
2026 from the release: 1920x1080 and 1080x1920, 60s each, seek to 30s landed
at 30s. Pointed at a filename that does not exist it reports *no metadata
after timeout, readyState 0, and the element reported no error*, which is
exactly how this fails in the wild and why reading the markup is not enough.

This does not shrink the existing history. Removing what is already in there
means rewriting every commit that touched it, which breaks every clone and
every commit link a judge might hold, so it is not done during a submission
window. The point of the rule is that the next cut does not add to the pile.

## Before you commit

Check all four, every time:

1. The three pages render identically to the files as delivered. Compare
   against `design-source/` if you are unsure what a section should look like.
2. No horizontal scrollbar at 320px, 390px, 768px or 1440px on any page.
3. No console errors, no 404s on assets.
4. Every link resolves. No `href="#"` anywhere.
