/**
 * Where each mainnet secret is read from, and what makes a tool refuse it.
 *
 * Mainnet secrets have no default location: a deploy that silently fell back
 * to a file beside the repository, or minted a key where a mistyped variable
 * pointed, would hand the contract's authority to a file nobody backed up.
 * And no mainnet secret may sit in a folder a sync client copies to a third
 * party and to every device on the account.
 *
 * These tests run the path rules and the custody tool directly. They open no
 * wallet and touch no network. Tests marked REPOSITORY ASSERTION read source
 * rather than run it, for code that only runs with a wallet or a contract.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import {
    SYNCED_FOLDER, refuseSyncedFolder, registrarFile, custodyKeyFile, secretFileFor, credentialPath
} from '../../scripts/lib/local-credentials.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const src = (...p) => readFileSync(join(ROOT, 'scripts', ...p), 'utf8');
const dir = mkdtempSync(join(tmpdir(), 'vinpassport-secrets-'));

/** Run `fn` with the named variables set (undefined unsets), then restore them. */
function withEnv(vars, fn) {
    const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
    for (const [k, v] of Object.entries(vars)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    try { return fn(); } finally {
        for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    }
}

test('a synced folder is recognised however it is spelled', () => {
    for (const p of ['C:\\Users\\a\\OneDrive\\keys', '/Users/a/Dropbox/k', '/Users/a/Library/iCloud/k', 'G:\\Google Drive\\k', '/home/a/googledrive/k']) {
        assert.ok(SYNCED_FOLDER.test(p), p);
        assert.throws(() => refuseSyncedFolder(p, 'the key'), /synced folder copies the key/);
    }
    assert.equal(refuseSyncedFolder(join(dir, 'k.env')), resolve(join(dir, 'k.env')));
});

test('registrar secrets: mainnet names its file, outside a synced folder; other networks default locally', () => {
    withEnv({ VINPASSPORT_REGISTRAR_FILE: undefined }, () => {
        assert.throws(() => registrarFile('mainnet'), /mainnet needs VINPASSPORT_REGISTRAR_FILE/);
        assert.equal(registrarFile('preview'), resolve(credentialPath('REGISTRAR-SECRETS.env')));
    });
    withEnv({ VINPASSPORT_REGISTRAR_FILE: '/Users/a/OneDrive/regs.env' }, () => {
        assert.throws(() => registrarFile('mainnet'), /refusing .*synced folder/);
    });
    withEnv({ VINPASSPORT_REGISTRAR_FILE: join(dir, 'regs.env') }, () => {
        assert.equal(registrarFile('mainnet'), resolve(join(dir, 'regs.env')));
        assert.equal(registrarFile('preview'), resolve(join(dir, 'regs.env')), 'the variable wins on every network');
    });
});

test('custody key: mainnet names its file, outside a synced folder', () => {
    withEnv({ VINPASSPORT_CUSTODY_KEY_FILE: undefined }, () => {
        assert.throws(() => custodyKeyFile('mainnet'), /mainnet needs VINPASSPORT_CUSTODY_KEY_FILE/);
        assert.equal(custodyKeyFile('preview'), resolve(credentialPath('CUSTODY-KEY.preview.env')));
    });
    withEnv({ VINPASSPORT_CUSTODY_KEY_FILE: 'D:\\Dropbox\\custody.env' }, () => {
        assert.throws(() => custodyKeyFile('mainnet'), /synced folder/);
    });
});

test('a fixed-location secret is refused in a synced folder on mainnet only', () => {
    assert.throws(() => secretFileFor('mainnet', '/Users/a/OneDrive/STATE-PASSWORD.mainnet.env', 'the state password'), /synced folder copies the state password/);
    assert.equal(secretFileFor('preview', '/Users/a/OneDrive/x.env'), resolve('/Users/a/OneDrive/x.env'));
});

const tool = (args, env) => spawnSync(process.execPath, [join(ROOT, 'scripts', 'make-custody-key.mjs'), ...args],
    { encoding: 'utf8', env: { ...process.env, ...env } });

test('make-custody-key writes a mainnet key once, 0600, where the variable says, and never overwrites it', () => {
    const file = join(dir, 'custody.mainnet.env');
    const first = tool(['--network', 'mainnet'], { VINPASSPORT_CUSTODY_KEY_FILE: file });
    assert.equal(first.status, 0, first.stderr);
    const text = readFileSync(file, 'utf8');
    const hex = /^VINPASSPORT_CUSTODY_KEY_HEX=([0-9a-f]{64})$/m.exec(text)?.[1];
    assert.ok(hex, 'the file holds the key in the form custodyKey reads');
    assert.ok(!first.stdout.includes(hex) && !first.stderr.includes(hex), 'the key is never printed');
    assert.match(first.stdout, /verifying key \(schnorr\): [0-9a-f]+/);
    if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o600);

    const again = tool(['--network', 'mainnet'], { VINPASSPORT_CUSTODY_KEY_FILE: file });
    assert.notEqual(again.status, 0);
    assert.match(again.stderr, /exists\. A key file is never overwritten/);
    assert.equal(readFileSync(file, 'utf8'), text);
});

test('make-custody-key refuses mainnet without a named file, or in a synced folder', () => {
    const none = tool(['--network', 'mainnet'], { VINPASSPORT_CUSTODY_KEY_FILE: '' });
    assert.notEqual(none.status, 0);
    assert.match(none.stderr, /mainnet needs VINPASSPORT_CUSTODY_KEY_FILE/);
    const synced = join(dir, 'OneDrive', 'custody.env');
    const r = tool(['--network', 'mainnet'], { VINPASSPORT_CUSTODY_KEY_FILE: synced });
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /synced folder/);
    assert.equal(existsSync(synced), false);
});

test('REPOSITORY ASSERTION: custodyKey never creates a mainnet key, and deploy asks it to create only off mainnet', () => {
    const c = src('lib', 'contract9.mjs');
    assert.match(c, /const path = custodyKeyFile\(network\);/);
    assert.match(c, /if \(!create \|\| network === 'mainnet'\) \{/);
    assert.match(c, /make-custody-key\.mjs --network/);
    const d = src('deploy.mjs');
    assert.match(d, /custodyKey\(NETWORK, \{ create: NETWORK !== 'mainnet' \}\)/);
    assert.ok(!/create: SUBMIT/.test(d), 'a submit can create the key again');
});

test('REPOSITORY ASSERTION: every reader of the registrar file goes through registrarFile', () => {
    for (const f of [['deploy.mjs'], ['govern.mjs'], ['chain-readback.mjs'], ['make-registrar-secrets.mjs'], ['export-bundles.mjs']]) {
        const s = src(...f);
        assert.match(s, /registrarFile\((NETWORK|opts\.network|checkNetwork\()/, `${f.join('/')} does not use registrarFile`);
        assert.ok(!/REGISTRAR-SECRETS\.mainnet\.env/.test(s), `${f.join('/')} still names a fixed mainnet file`);
    }
    assert.match(src('make-registrar-secrets.mjs'), /--network/);
});

test('REPOSITORY ASSERTION: the state password and the vin key are refused in a synced folder on mainnet', () => {
    assert.match(src('lib', 'contract9.mjs'), /secretFileFor\(network, credentialPath\(`STATE-PASSWORD\.\$\{network\}\.env`\)/);
    assert.match(src('lib', 'vin-key.mjs'), /if \(network === 'mainnet'\) refuseSyncedFolder\(KEY_FILE, 'the mainnet vin key'\);/);
    assert.match(src('make-vin-key.mjs'), /refuseSyncedFolder\(OUT, 'the mainnet vin key'\)/);
});

test('REPOSITORY ASSERTION: the deploy checks its network before any path is built from it', () => {
    const d = src('deploy.mjs');
    const check = d.indexOf('requireBuildableNetwork(NETWORK)');
    assert.ok(check !== -1 && check < d.indexOf('recordPath(NETWORK)') && check < d.indexOf('custodyKey(NETWORK'));
    const guard = d.indexOf('\nguardLogs();');
    assert.ok(guard !== -1 && guard < d.indexOf('publicEndpoints(NETWORK).nodeWsUrl'), 'guardLogs is called before the endpoint is printed');
});

test.after(() => rmSync(dir, { recursive: true, force: true }));
