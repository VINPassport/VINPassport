# Fonts

Served from this site so no visitor's browser asks a third party for them. All four families
are under the SIL Open Font License 1.1; each licence sits beside its files.

| Family | Weights | Licence |
|---|---|---|
| Fraunces (variable: optical size and weight) | 100 to 900 | OFL-Fraunces.txt |
| IBM Plex Sans | 400, 500, 600 | OFL-IBM-Plex-Sans.txt |
| IBM Plex Mono | 400, 500 | OFL-IBM-Plex-Mono.txt |
| Barlow Condensed | 500, 600, 700 | OFL-Barlow.txt |

Latin and Latin Extended subsets only; `unicode-range` in `site/assets/vp.css` means a page
downloads a file only when it uses a character in that range.

## Where each file came from

Taken unchanged from the npm tarballs (`npm pack <package>@<version>`, the `files/` folder), with
the `@font-face` rules adapted from each package's CSS (family renamed for Fraunces, woff2 only).
Re-check a file with `sha256sum`.

| File | Package | sha256 |
|---|---|---|
| fraunces-latin-ext-opsz-normal.woff2 | @fontsource-variable/fraunces@5.3.0 | a2930b27d13a228bd9ab6a49269b5f800237892ad560cb9dd7fab01b1620f88e |
| fraunces-latin-opsz-normal.woff2 | @fontsource-variable/fraunces@5.3.0 | 7234ed860a9cc83045413c4faee63c960a8f2d1917adcf728119307d56e0d783 |
| ibm-plex-sans-latin-ext-400-normal.woff2 | @fontsource/ibm-plex-sans@5.3.0 | c93d2a12aaa280f68b9ab7b726ff8dfedda67c99ef9abed047c1847a1cc6d583 |
| ibm-plex-sans-latin-400-normal.woff2 | @fontsource/ibm-plex-sans@5.3.0 | 3b646991d30055a93a4ecc499713d4347953a74a947ecab435ab72070cbdab0e |
| ibm-plex-sans-latin-ext-500-normal.woff2 | @fontsource/ibm-plex-sans@5.3.0 | 2846035d85100f84c79393f80f1442d4ee720129ab8b3ffa8969aae281db8c6c |
| ibm-plex-sans-latin-500-normal.woff2 | @fontsource/ibm-plex-sans@5.3.0 | 0717336fb31fcdcde4b8deb3675bb4a0f7f6d484864afcd6751ac29975962203 |
| ibm-plex-sans-latin-ext-600-normal.woff2 | @fontsource/ibm-plex-sans@5.3.0 | b25dfd4f979e442ae1e25cd0894463434cf01ba21ac1a35d39f4a82bd4cc060e |
| ibm-plex-sans-latin-600-normal.woff2 | @fontsource/ibm-plex-sans@5.3.0 | 8960851d691c054ed38e259bdcf1a6190d157b4203ed5bb32c632a863fb8ec2f |
| ibm-plex-mono-latin-ext-400-normal.woff2 | @fontsource/ibm-plex-mono@5.3.0 | 6bc0f226a5b7884a8170e3f62c63d7675609d4631bdc5931b5cdab81821f00eb |
| ibm-plex-mono-latin-400-normal.woff2 | @fontsource/ibm-plex-mono@5.3.0 | 08949f728dc52d528e69b1667d15c89a5686a4ee9a296ff90983985f99c380f7 |
| ibm-plex-mono-latin-ext-500-normal.woff2 | @fontsource/ibm-plex-mono@5.3.0 | 6bb06407c97584b0867a959e05e8874693bfeb8c317de190811c51598f2d99ea |
| ibm-plex-mono-latin-500-normal.woff2 | @fontsource/ibm-plex-mono@5.3.0 | 01d285447409c8a588692162439a038b8cbd7871309ee20267b0d2d91c6e8e22 |
| barlow-condensed-latin-ext-500-normal.woff2 | @fontsource/barlow-condensed@5.3.0 | a6ff9214bfa7832cb91d246454fd48b10ef921e8af052d479fdf1f0ecb903504 |
| barlow-condensed-latin-500-normal.woff2 | @fontsource/barlow-condensed@5.3.0 | 460f141ec8f6c9a1516bfd2bd9fe71656246d7a9d04a0955faf53158d8970c4c |
| barlow-condensed-latin-ext-600-normal.woff2 | @fontsource/barlow-condensed@5.3.0 | aef7edf54f79a5329fbca9c065b56dcec3852c680d58cf89a9ef2db6940ca4b3 |
| barlow-condensed-latin-600-normal.woff2 | @fontsource/barlow-condensed@5.3.0 | 215a93c696f442034a46fbb382958f753fda60e30490683aeea6b235fcbb2b66 |
| barlow-condensed-latin-ext-700-normal.woff2 | @fontsource/barlow-condensed@5.3.0 | 9d351bd9222bfab90f943850f8039aa73cdb40e0a6cfe4127308a48bef59d5f5 |
| barlow-condensed-latin-700-normal.woff2 | @fontsource/barlow-condensed@5.3.0 | 3787a5a419171630e6890cfa47c4da067474d005cd0ff8dc11ec090fdc3ee2b8 |
