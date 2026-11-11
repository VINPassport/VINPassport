# jsQR

The scan page's QR reader where the browser has none of its own (Safari on an iPhone, for one).
Served from this site so no visitor's browser asks a third party for it, and fetched only when
someone presses Scan with your camera. Apache-2.0; the licence sits beside it.

| File | Package | sha256 |
|---|---|---|
| jsQR.js | jsqr@1.4.0 (`npm pack jsqr@1.4.0`, `dist/jsQR.js`, unchanged) | bc40c8a15196236b2314db0856f72ca0b49980cd5413b8c852a7349f5fee0859 |

Re-check it with `sha256sum`. It reads pixels and returns text: no network, no page access.
