/**
 * The scan page's camera (site/scan/camera.mjs): what a scanned code may lead to, what the visitor is
 * told when the camera does not start, and that the reader comes from this site.
 *
 * The camera itself is driven in a browser by scripts/check-camera.mjs (a fake camera showing the
 * sample passport's QR code); this file holds the rules that need no browser.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readScanned, cameraTrouble } from '../../site/scan/camera.mjs';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'site');
const KEY = '391ce048e0feacde85e7978c2c8320b3763a6c5ed5b2aacc7ca524469bafe357';

test('a scanned passport link leads to this site\'s verdict page, whatever host the code names', () => {
    assert.deepEqual(readScanned(`https://passport.vin/v/?v=${KEY}`), { href: `../v/?v=${KEY}` });
    assert.deepEqual(readScanned('https://passport.vin/v/?c=VP-74EE-0J74'), { href: '../v/?c=VP-74EE-0J74' });
    assert.deepEqual(readScanned(`https://passport.vin/verify/?v=${KEY}`), { href: `../v/?v=${KEY}` });
    // A code printed by someone else can carry a passport key, but it cannot take the visitor away.
    assert.deepEqual(readScanned(`https://elsewhere.example/phish?v=${KEY}`), { href: `../v/?v=${KEY}` });
    assert.deepEqual(readScanned('VP-74EE-0J74'), { href: '../v/?c=VP-74EE-0J74' });
});

test('a code that is not a passport\'s is turned away with one plain sentence', () => {
    for (const text of ['https://elsewhere.example/', 'WIFI:S:cafe;T:WPA;P:secret;;', 'hello', '']) {
        const got = readScanned(text);
        assert.equal(got.href, undefined, `${JSON.stringify(text)} must lead nowhere`);
        assert.match(got.error, /not a VINPassport code/);
    }
});

test('the visitor is told why the camera did not start, and what to do instead', () => {
    assert.match(cameraTrouble('NotAllowedError'), /not allowed.*browser settings.*camera app.*type the code/);
    assert.match(cameraTrouble('SecurityError'), /not allowed/);
    assert.match(cameraTrouble('NotFoundError'), /No camera was found/);
    assert.match(cameraTrouble('OverconstrainedError'), /No camera was found/);
    assert.match(cameraTrouble('NotReadableError'), /Another app is using the camera/);
    assert.match(cameraTrouble(undefined), /could not start.*Type the passport code/);
});

test('the camera navigates only to the address readEntry built, and reads with this site\'s own decoder', () => {
    const js = readFileSync(join(SITE, 'scan', 'camera.mjs'), 'utf8');
    const navigations = [...js.matchAll(/location\.(?:href|search|assign|replace)\s*(?:=|\()\s*([^;)]+)/g)].map((m) => m[1].trim());
    assert.deepEqual(navigations, ['got.href'], 'the camera navigates only to what readScanned returned');
    assert.doesNotMatch(js, /https?:\/\//, 'the camera module fetches nothing from another host');
    assert.match(js, /const JSQR = '\.\.\/assets\/vendor\/jsqr\/jsQR\.js'/);
    // The camera starts on a press, never on load.
    assert.match(js, /button\.addEventListener\('click', async \(\) => \{[\s\S]*getUserMedia/);
    assert.equal((js.match(/getUserMedia\(/g) ?? []).length, 1, 'one place asks for the camera');
});

test('the vendored decoder is the hashed, licensed jsqr 1.4.0 file', () => {
    const dir = join(SITE, 'assets', 'vendor', 'jsqr');
    const sha = createHash('sha256').update(readFileSync(join(dir, 'jsQR.js'))).digest('hex');
    assert.match(readFileSync(join(dir, 'SOURCES.md'), 'utf8'), new RegExp(`\\| jsQR\\.js \\| jsqr@1\\.4\\.0 [^|]*\\| ${sha} \\|`));
    assert.match(readFileSync(join(dir, 'LICENSE.txt'), 'utf8'), /Apache License\s+Version 2\.0/);
    assert.doesNotMatch(readFileSync(join(dir, 'jsQR.js'), 'utf8'), /fetch\(|XMLHttpRequest|new Function|eval\(/);
});

test('the scan page offers the camera, says so in the privacy notice, and keeps the typed box', () => {
    const html = readFileSync(join(SITE, 'scan', 'index.html'), 'utf8');
    assert.match(html, /<script type="module" src="camera\.mjs"><\/script>/);
    assert.match(html, /data-camera-start hidden>Scan with your camera</, 'the button waits for the script to find a camera');
    assert.match(html, /role="status" data-camera-status/);
    assert.match(html, /data-scan-form/, 'typing a code still works');
    const privacy = readFileSync(join(SITE, 'privacy', 'index.html'), 'utf8');
    assert.match(privacy, /uses your camera only when you press Scan with your camera[^<]*nothing of it is stored or sent anywhere/);
});
