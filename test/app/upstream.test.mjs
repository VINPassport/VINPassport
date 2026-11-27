/**
 * check:upstream reads every Midnight pin, overrides included, and fails when
 * an installed package missed a patch of its own line (scripts/lib/upstream.mjs).
 *
 * The overrides are where the WASM packages are held to one copy, so a missed
 * ledger patch would hide there if only `dependencies` were read. A newer
 * minor or major is an upgrade and is reported only. The registry and
 * node_modules are injected, so this runs offline.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { midnightPins, newestPatch, checkPins, cmp } from '../../scripts/lib/upstream.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

const PKG = {
    dependencies: { '@midnight-ntwrk/midnight-js-contracts': '5.0.1', '@noble/curves': '2.4.0', '@midnightntwrk/ledger-v9': '1.0.2' },
    devDependencies: { vitest: '^4.1.11' },
    overrides: {
        '@midnightntwrk/ledger-v9': '1.0.2',
        '@midnightntwrk/onchain-runtime-v4': '4.0.2',
        effect: '3.22.4',
        '@some/parent': { '@midnight-ntwrk/platform-js': '3.0.0', '.': '1.0.0' },
        '@midnight-ntwrk/linked': '$@midnight-ntwrk/midnight-js-contracts'
    }
};

test('pins come from dependencies and from overrides, nested ones too, and nothing else', () => {
    const pins = Object.fromEntries(midnightPins(PKG).map((p) => [p.name, p]));
    assert.deepEqual(Object.keys(pins).sort(), [
        '@midnight-ntwrk/midnight-js-contracts', '@midnight-ntwrk/platform-js',
        '@midnightntwrk/ledger-v9', '@midnightntwrk/onchain-runtime-v4'
    ]);
    assert.deepEqual(pins['@midnightntwrk/ledger-v9'].sources, ['dependencies', 'overrides']);
    assert.deepEqual(pins['@midnightntwrk/onchain-runtime-v4'].sources, ['overrides']);
});

test('the newest patch is taken within the pinned minor, releases only', () => {
    const versions = ['1.0.0', '1.0.2', '1.0.3', '1.0.4-rc.1', '1.1.0', '2.0.0'];
    assert.equal(newestPatch('1.0.2', versions), '1.0.3');
    assert.equal(newestPatch('1.1.0', versions), '1.1.0');
    assert.equal(newestPatch('3.0.0', versions), null);
    assert.equal(cmp('1.0.0', '1.0.0-rc.1'), 1);
});

test('an installed package behind its line is a finding; a newer line is only reported', async () => {
    const registry = {
        '@midnightntwrk/ledger-v9': ['1.0.0', '1.0.2', '1.0.3', '1.1.0'],
        '@midnightntwrk/onchain-runtime-v4': ['4.0.2', '4.1.0'],
        '@midnight-ntwrk/midnight-js-contracts': ['5.0.0', '5.0.1'],
        '@midnight-ntwrk/platform-js': ['3.0.0']
    };
    const installed = { '@midnightntwrk/ledger-v9': '1.0.2', '@midnightntwrk/onchain-runtime-v4': '4.0.2', '@midnight-ntwrk/midnight-js-contracts': '5.0.1' };
    const rows = Object.fromEntries((await checkPins(midnightPins(PKG), {
        installed: (n) => installed[n] ?? null,
        versions: async (n) => registry[n]
    })).map((r) => [r.name, r]));
    assert.equal(rows['@midnightntwrk/ledger-v9'].behind, true, 'an override pinned behind its newest patch passed');
    assert.equal(rows['@midnightntwrk/ledger-v9'].newestPatch, '1.0.3');
    assert.equal(rows['@midnightntwrk/onchain-runtime-v4'].behind, false);
    assert.equal(rows['@midnightntwrk/onchain-runtime-v4'].newerLine, true);
    assert.equal(rows['@midnight-ntwrk/midnight-js-contracts'].behind, false);
    assert.equal(rows['@midnight-ntwrk/platform-js'].missing, true);
    assert.equal(rows['@midnight-ntwrk/platform-js'].behind, false, 'a package that is not installed is not behind');
});

test('a registry that cannot be read is reported per package, not thrown', async () => {
    const [row] = await checkPins([{ name: '@midnightntwrk/ledger-v9', pinned: '1.0.2', sources: ['overrides'] }], {
        installed: () => '1.0.2', versions: async () => { throw new Error('offline'); }
    });
    assert.equal(row.error, 'offline');
});

test('REPOSITORY ASSERTION: check-upstream exits non-zero for a package behind its line', () => {
    const s = readFileSync(join(ROOT, 'scripts', 'check-upstream.mjs'), 'utf8');
    assert.match(s, /checkPins\(midnightPins\(pkg\), \{ installed, versions \}\)/);
    assert.match(s, /process\.exit\(behind \|\| \(STRICT && failures\) \? 1 : 0\);/);
});
