# Deck fonts and logos

The deck wears the site's 2026 design, so it uses the site's own fonts, served from here: opening
the deck sends no request to a font service, as the site's privacy notice says of every font.
The deck once loaded Montserrat from fonts.googleapis.com, which hands every visitor's IP address
to Google before they have read anything.

The files here are byte-for-byte copies of the site's (`site/assets/fonts/`, where
`SOURCES.md` records how each was taken from its npm tarball). The deck keeps its own copies
because `scripts/check-deck.mjs` serves `deck/` on its own, so a path into `site/` would not
resolve there. All four families are under the SIL Open Font License 1.1; each licence sits
beside its files.

| Family | Weights the deck uses | Licence |
|---|---|---|
| Montserrat (headings, the logo's typeface) | 600 | OFL-Montserrat.txt |
| IBM Plex Sans | 400, 500, 600 | OFL-IBM-Plex-Sans.txt |
| IBM Plex Mono | 400 | OFL-IBM-Plex-Mono.txt |
| Barlow Condensed | 600 | OFL-Barlow.txt |

Latin and Latin Extended subsets only; the `@font-face` rules in `deck/index.html` carry each
file's `unicode-range`, so a browser downloads a file only when the deck uses a character in it.
Re-check a file with `sha256sum`.

| File | Package | sha256 |
|---|---|---|
| montserrat-latin-ext-600-normal.woff2 | @fontsource/montserrat@5.3.0 | 1d8a4af6a50cc4f7561e8484d5bff39acda90016b8e8cbb5cee69c253bb02750 |
| montserrat-latin-600-normal.woff2 | @fontsource/montserrat@5.3.0 | d857325c360f7128b347ca924c1974967aaa886ba47dad22e4042d6c38b26a83 |
| ibm-plex-sans-latin-ext-400-normal.woff2 | @fontsource/ibm-plex-sans@5.3.0 | c93d2a12aaa280f68b9ab7b726ff8dfedda67c99ef9abed047c1847a1cc6d583 |
| ibm-plex-sans-latin-400-normal.woff2 | @fontsource/ibm-plex-sans@5.3.0 | 3b646991d30055a93a4ecc499713d4347953a74a947ecab435ab72070cbdab0e |
| ibm-plex-sans-latin-ext-500-normal.woff2 | @fontsource/ibm-plex-sans@5.3.0 | 2846035d85100f84c79393f80f1442d4ee720129ab8b3ffa8969aae281db8c6c |
| ibm-plex-sans-latin-500-normal.woff2 | @fontsource/ibm-plex-sans@5.3.0 | 0717336fb31fcdcde4b8deb3675bb4a0f7f6d484864afcd6751ac29975962203 |
| ibm-plex-sans-latin-ext-600-normal.woff2 | @fontsource/ibm-plex-sans@5.3.0 | b25dfd4f979e442ae1e25cd0894463434cf01ba21ac1a35d39f4a82bd4cc060e |
| ibm-plex-sans-latin-600-normal.woff2 | @fontsource/ibm-plex-sans@5.3.0 | 8960851d691c054ed38e259bdcf1a6190d157b4203ed5bb32c632a863fb8ec2f |
| ibm-plex-mono-latin-ext-400-normal.woff2 | @fontsource/ibm-plex-mono@5.3.0 | 6bc0f226a5b7884a8170e3f62c63d7675609d4631bdc5931b5cdab81821f00eb |
| ibm-plex-mono-latin-400-normal.woff2 | @fontsource/ibm-plex-mono@5.3.0 | 08949f728dc52d528e69b1667d15c89a5686a4ee9a296ff90983985f99c380f7 |
| barlow-condensed-latin-ext-600-normal.woff2 | @fontsource/barlow-condensed@5.3.0 | aef7edf54f79a5329fbca9c065b56dcec3852c680d58cf89a9ef2db6940ca4b3 |
| barlow-condensed-latin-600-normal.woff2 | @fontsource/barlow-condensed@5.3.0 | 215a93c696f442034a46fbb382958f753fda60e30490683aeea6b235fcbb2b66 |

## Logos

`../brand/` holds two files from the brand kit, unchanged copies of the site's
`site/assets/brand/vinpassport-logo-stacked-primary.svg` (the title slide) and
`vinpassport-logo-horizontal-primary.svg` (every slide's footer).
