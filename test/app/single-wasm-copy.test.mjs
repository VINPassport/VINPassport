/**
 * One installed copy of each WASM-based Midnight package.
 *
 * Two copies of a WASM package reject each other's objects at run time
 * ("expected instance of StateValue"), and the failure shows up in contract
 * calls, far from the dependency that caused it. It cost a day on Ledger 8.
 * Midnight.js 5 asks for the same pin (migration guide, Step 1), and the
 * Ledger 9 packages publish under two scopes, which makes a silent second
 * copy easier to get. package.json pins them with `overrides`; this test
 * fails the moment an install brings a second copy anyway.
 *
 * `compact-runtime-ledger8` is Midnight.js's own alias for runtime 0.16.0,
 * loaded only for Ledger 8 contracts. It has its own name, so it is not a
 * duplicate of `@midnight-ntwrk/compact-runtime`.
 *
 * `effect` is not WASM but is checked for the same reason: Midnight.js and
 * the wallet SDK both run on it, and with two copies installed (3.22.1 and
 * 3.22.4, 8 Nov) every wallet sync printed a warning per fiber about mixed
 * Effect runtimes.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WASM = /^(?:(?:@midnightntwrk|@midnight-ntwrk)\/(?:ledger-v\d+|onchain-runtime-v\d+|compact-runtime|zkir-v\d+|platform-js)|effect)$/;

function installed() {
    const found = new Map();
    const visit = (pkgDir, name) => {
        if (WASM.test(name)) {
            const { version } = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8'));
            found.set(name, [...(found.get(name) ?? []), `${version} at ${relative(ROOT, pkgDir)}`]);
        }
        const nested = join(pkgDir, 'node_modules');
        if (existsSync(nested)) walk(nested);
    };
    const walk = (dir) => {
        for (const e of readdirSync(dir, { withFileTypes: true })) {
            if (!e.isDirectory() || e.name.startsWith('.')) continue;
            if (e.name.startsWith('@')) {
                for (const s of readdirSync(join(dir, e.name), { withFileTypes: true })) {
                    if (s.isDirectory()) visit(join(dir, e.name, s.name), `${e.name}/${s.name}`);
                }
            } else {
                visit(join(dir, e.name), e.name);
            }
        }
    };
    walk(join(ROOT, 'node_modules'));
    return found;
}

const copies = installed();

test('the Ledger 9 WASM packages are installed', () => {
    for (const name of ['@midnightntwrk/ledger-v9', '@midnightntwrk/onchain-runtime-v4', '@midnight-ntwrk/compact-runtime']) {
        assert.ok(copies.has(name), `${name} is not installed`);
    }
});

test('no WASM package is installed twice', () => {
    const dups = [...copies].filter(([, at]) => at.length > 1);
    assert.deepEqual(dups, [], dups.map(([n, at]) => `${n}: ${at.join(' | ')}`).join('\n'));
});

test('the runtime the contract imports is the one compiled against', () => {
    const info = JSON.parse(readFileSync(join(ROOT,
        'contracts/vinpassport/src/managed/vinpassport/compiler/contract-info.json'), 'utf8'));
    const { version } = JSON.parse(readFileSync(join(ROOT,
        'node_modules/@midnight-ntwrk/compact-runtime/package.json'), 'utf8'));
    assert.equal(version, info['runtime-version']);
});
