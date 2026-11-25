/**
 * Records are replaced whole, and one seed is opened by one process.
 *
 * A deploy record, an audit entry, a committee list or a signed proposal is
 * the only copy of what the chain was told. Written in place, a run stopped
 * halfway leaves half a file; written from a copy read at start, it drops a
 * change another tool made meanwhile. Two processes on one seed spend the
 * same DUST twice. These tests hold scripts/lib/files.mjs and
 * scripts/lib/deploy-record.mjs to that, and check that every tool that
 * writes a record or opens the wallet uses them.
 *
 * Tests marked REPOSITORY ASSERTION read source rather than run it: those
 * tools need a wallet and a chain.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { writeFileAtomic, writeJsonAtomic, takeSeedLock } from '../../scripts/lib/files.mjs';
import { applyRecordChange, rewriteRecord } from '../../scripts/lib/deploy-record.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (...p) => readFileSync(join(ROOT, 'scripts', ...p), 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'vinpassport-files-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

test('an atomic write replaces the whole file and leaves no temporary file behind', () => {
    const path = join(dir, 'sub', 'record.json');
    writeJsonAtomic(path, { a: 1 });
    writeJsonAtomic(path, { a: 2, b: [1, 2] });
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { a: 2, b: [1, 2] });
    assert.match(readFileSync(path, 'utf8'), /\n$/);
    assert.deepEqual(readdirSync(join(dir, 'sub')), ['record.json']);
});

test('a write that cannot complete leaves the old file as it was', () => {
    const path = join(dir, 'keep.json');
    writeFileAtomic(path, 'old\n');
    assert.throws(() => writeFileAtomic(path, { not: 'bytes' }));
    assert.equal(readFileSync(path, 'utf8'), 'old\n');
    assert.deepEqual(readdirSync(dir).filter((f) => f.endsWith('.tmp')), []);
});

test('a record change applies to the file as it is now, so a change made meanwhile survives', () => {
    const path = join(dir, 'preview.json');
    writeJsonAtomic(path, { contractAddress: 'ab', authority: { counter: 1, note: 'x' }, maintenance: [{ counter: 0 }] });
    // Read at start by one tool...
    const change = {
        set: { authority: (prev) => ({ ...prev.authority, counter: 2 }) },
        append: { maintenance: { counter: 1 } }
    };
    // ...while another appends its own entry.
    const other = JSON.parse(readFileSync(path, 'utf8'));
    other.registrarChanges = [{ id: 'cd' }];
    writeJsonAtomic(path, other);

    const out = rewriteRecord(path, change, { contractAddress: 'ab' });
    assert.deepEqual(out.registrarChanges, [{ id: 'cd' }], 'the other tool\'s change was dropped');
    assert.deepEqual(out.authority, { counter: 2, note: 'x' });
    assert.deepEqual(out.maintenance, [{ counter: 0 }, { counter: 1 }]);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), out);
});

test('a record that names another contract by now is not written', () => {
    const path = join(dir, 'redeployed.json');
    writeJsonAtomic(path, { contractAddress: 'ef' });
    assert.throws(() => rewriteRecord(path, { set: { x: 1 } }, { contractAddress: 'ab' }), /redeploy happened meanwhile/);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), { contractAddress: 'ef' });
    assert.deepEqual(applyRecordChange({ a: [1] }, { append: { a: 2, b: 3 } }), { a: [1, 2], b: [3] });
});

test('the seed lock refuses a second holder, names a dead one, and is shared within a process', () => {
    const locks = join(dir, 'locks');
    const first = takeSeedLock('preview', { dir: locks, what: 'test' });
    const again = takeSeedLock('preview', { dir: locks });
    assert.equal(again.path, first.path, 'a second take in one process shares the lock');
    again.release();
    assert.ok(existsSync(first.path), 'releasing the shared take keeps the first one');
    const held = JSON.parse(readFileSync(first.path, 'utf8'));
    assert.equal(held.pid, process.pid);
    assert.match(held.startedAt, /^\d{4}-\d\d-\d\dT/);
    first.release();
    assert.equal(existsSync(first.path), false, 'the last release removes the file');

    // Another process holds it.
    writeFileSync(join(locks, 'preprod.lock'), JSON.stringify({ pid: 4242, startedAt: '2026-11-24T00:00:00Z', what: 'deploy.mjs' }));
    assert.throws(() => takeSeedLock('preprod', { dir: locks, alive: () => true }), /held by pid 4242 \(deploy\.mjs.*Wait for it/);
    // It died: reported with the command, never taken over.
    assert.throws(() => takeSeedLock('preprod', { dir: locks, alive: () => false }), /no longer running.*rm "/s);
    assert.equal(JSON.parse(readFileSync(join(locks, 'preprod.lock'), 'utf8')).pid, 4242);
    assert.throws(() => takeSeedLock('../x', { dir: locks }), /not a network name/);
});

test('the seed lock is removed when the process exits', () => {
    const locks = join(dir, 'exit-locks');
    const lib = new URL('../../scripts/lib/files.mjs', import.meta.url).href;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e',
        `const { takeSeedLock } = await import(${JSON.stringify(lib)}); takeSeedLock('preview', { dir: ${JSON.stringify(locks)} }); process.exit(3);`],
    { encoding: 'utf8' });
    assert.equal(r.status, 3, r.stderr);
    assert.equal(existsSync(join(locks, 'preview.lock')), false);
});

test('REPOSITORY ASSERTION: every record write goes through the atomic helpers', () => {
    for (const f of [['deploy.mjs'], ['maintenance.mjs'], ['govern.mjs'], ['listing.mjs'], ['make-committee-key.mjs']]) {
        const s = src(...f);
        assert.ok(!/writeFileSync\((RECORD|LISTING_RECORD|listPath|proposalPath|audit\b|join\(auditDir)/.test(s), `${f.join('/')} writes a record in place`);
        assert.match(s, /writeJsonAtomic|rewriteRecord/, `${f.join('/')} does not use the atomic helpers`);
    }
    const m = src('maintenance.mjs');
    assert.match(m, /rewriteRecord\(RECORD, change, \{ contractAddress: address \}\)/, 'maintenance writes back the record it read at start');
    assert.match(m, /writeJsonAtomic\(proposalPath, signed\)/);
});

test('REPOSITORY ASSERTION: every entry point that opens the wallet takes the seed lock first', () => {
    for (const [file, open] of [['deploy.mjs', 'openWallet('], ['maintenance.mjs', 'openWallet('], ['dust.mjs', 'openWallet('],
        ['listing.mjs', 'openWallet('], ['govern.mjs', 'openChain('], ['app-server.mjs', "import('./lib/runner9.mjs')"]]) {
        const s = src(file);
        const lock = s.indexOf('takeSeedLock(');
        assert.ok(lock !== -1, `${file} takes no seed lock`);
        assert.ok(lock < s.lastIndexOf(open), `${file} opens the wallet before the lock`);
    }
});
