# Deck fonts

The deck's Montserrat is served from here, so opening the deck sends no request to a font
service. It used to load from fonts.googleapis.com, which hands every visitor's IP address to
Google before they have read anything; the site's own fonts already avoid that
(`site/assets/fonts/SOURCES.md`). Montserrat is under the SIL Open Font License 1.1
(`OFL-Montserrat.txt`).

One variable file per subset covers every weight the deck uses (300 to 800). Latin and Latin
Extended only, the same subsets the Google stylesheet would have sent for the deck's text; the
`@font-face` rules in `deck/index.html` carry each file's `unicode-range`, so a browser
downloads a file only when the deck uses a character in it.

Taken unchanged from the npm tarball (`npm pack @fontsource-variable/montserrat@5.3.0`, the
`files/` folder), with the family renamed from `Montserrat Variable` to `Montserrat` so the
deck's styles need no change. Re-check a file with `sha256sum`.

| File | Package | sha256 |
|---|---|---|
| montserrat-latin-ext-wght-normal.woff2 | @fontsource-variable/montserrat@5.3.0 | 54d9a78b7ff60b689ad9f3017ffac8547b5d871afec733f6c1c3ae36577ee504 |
| montserrat-latin-wght-normal.woff2 | @fontsource-variable/montserrat@5.3.0 | 06b16db7a969135d48d38c49183be7fb88d4452e2a3011957c7851941f4e4879 |
