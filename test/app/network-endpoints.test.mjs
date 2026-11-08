/**
 * Which network a run reaches, and what may leave the process about it.
 *
 * Three things are held here.
 *
 *  1. Nothing defaults to mainnet. Mainnet must be named, and an unknown name
 *     is refused rather than mapped. Preview is open and takes no credential.
 *  2. Credentials stay per network. Each network reads its own Blockfrost
 *     project id, and the guards that keep an id out of anything we hand over
 *     cover every configured id, not only preprod's.
 *  3. The deploy script's mainnet guards: the network is always named, its own
 *     registrar secrets, no contract before the mainnet vin key exists, and
 *     no mainnet key read from a default location or a synced folder.
 *
 * Every credential used here is a fake set in the environment for one test
 * and restored after it. The real local file is never printed.
 *
 * Tests marked REPOSITORY ASSERTION read source rather than run it, because the
 * deploy script cannot run without a funded wallet.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    NETWORKS, CREDENTIALED, isOpenNetwork, checkNetwork, networkEndpoints, publicEndpoints,
    preprodEndpoints, publicPreprodEndpoints, blockfrostToken, assertNoSecrets
} from '../../scripts/lib/endpoints.mjs';
import { networks } from '@midnight-ntwrk/midnight-js-utils';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FAKE = { preprod: 'preprodFAKEtoken0001', mainnet: 'mainnetFAKEtoken0002' };

/** Run `fn` with fake per-network ids in the environment, then restore. */
function withTokens(tokens, fn) {
    const names = { preprod: 'BLOCKFROST_MIDNIGHT_PREPROD', mainnet: 'BLOCKFROST_MIDNIGHT_MAINNET' };
    const was = Object.fromEntries(Object.values(names).map((n) => [n, process.env[n]]));
    try {
        for (const [net, name] of Object.entries(names)) {
            if (tokens[net] === undefined) delete process.env[name]; else process.env[name] = tokens[net];
        }
        return fn();
    } finally {
        for (const [name, v] of Object.entries(was)) {
            if (v === undefined) delete process.env[name]; else process.env[name] = v;
        }
    }
}

// ---------------------------------------------------------------- 1. no default to mainnet

test('the known networks are preview, preprod and mainnet, and nothing else is accepted', () => {
    assert.deepEqual([...NETWORKS], ['preview', 'preprod', 'mainnet']);
    for (const bad of ['Mainnet', 'MAINNET', 'testnet', 'Preview', 'devnet', '', undefined, null]) {
        assert.throws(() => checkNetwork(bad), /unknown network/, `accepted ${bad}`);
    }
});

test('public endpoints name their own network\'s hosts and carry no credential', () => {
    for (const net of NETWORKS) {
        const ep = publicEndpoints(net);
        assert.equal(ep.networkId, net);
        for (const url of [ep.indexerHttpUrl, ep.indexerWsUrl, ep.nodeHttpUrl, ep.nodeWsUrl]) {
            assert.match(url, isOpenNetwork(net)
                ? new RegExp(`\\.${net}\\.midnight\\.network`)
                : new RegExp(`midnight-${net}\\.blockfrost\\.io`));
            assert.ok(!url.includes('project_id'), `${url} carries a credential`);
        }
    }
});

test('Preview is open: no project id, and the endpoints a run uses are the public ones', () => {
    assert.deepEqual([...CREDENTIALED], ['preprod', 'mainnet']);
    assert.equal(isOpenNetwork('preview'), true);
    withTokens(FAKE, () => {
        assert.deepEqual(networkEndpoints('preview'), publicEndpoints('preview'));
        assert.ok(!JSON.stringify(networkEndpoints('preview')).includes('project_id'));
    });
    assert.throws(() => blockfrostToken({ network: 'preview' }), /takes no Blockfrost project id/);
});

test('every network\'s hosts are the ones Midnight.js 5 ships as presets', () => {
    // midnight-js-utils `networks` is what the SDK itself would connect to. A
    // host moved upstream and not here, or the reverse, fails this test.
    const strip = (u) => u.replace(/\?project_id=.*$/, '').replace(/\/$/, '');
    for (const net of NETWORKS) {
        const sdk = net === 'preview' ? networks.preview() : networks[net]('FAKEprojectid000');
        const ours = publicEndpoints(net);
        assert.equal(strip(ours.indexerHttpUrl), strip(sdk.indexer.queryURL), `${net} indexer`);
        assert.equal(strip(ours.indexerWsUrl), strip(sdk.indexer.subscriptionURL), `${net} indexer socket`);
        assert.equal(strip(ours.nodeHttpUrl), strip(sdk.nodeURL), `${net} node`);
        assert.equal(strip(ours.nodeWsUrl), strip(sdk.nodeWsURL), `${net} node socket`);
    }
});

test('the preprod helpers are the network helpers for preprod', () => {
    assert.deepEqual(publicPreprodEndpoints(), publicEndpoints('preprod'));
    withTokens(FAKE, () => assert.deepEqual(preprodEndpoints(), networkEndpoints('preprod')));
});

// ---------------------------------------------------------------- 2. credentials per network

test('each network reads its own project id, and never the other one\'s', () => {
    withTokens(FAKE, () => {
        const main = networkEndpoints('mainnet');
        assert.equal(main.networkId, 'mainnet');
        assert.ok(main.indexerHttpUrl.includes(FAKE.mainnet));
        assert.ok(!JSON.stringify(main).includes(FAKE.preprod), 'mainnet endpoints carry the preprod id');
        const pre = networkEndpoints('preprod');
        assert.ok(pre.nodeWsUrl.includes(FAKE.preprod));
        assert.ok(!JSON.stringify(pre).includes(FAKE.mainnet), 'preprod endpoints carry the mainnet id');
    });
});

test('a network with no project id is refused, and the error names the variable, not a value', () => {
    withTokens({ preprod: FAKE.preprod }, () => {
        // The local file may hold a mainnet id one day; this test only runs the
        // refusal path when it does not.
        if (blockfrostToken({ required: false, network: 'mainnet' })) return;
        assert.throws(() => networkEndpoints('mainnet'), (e) => {
            assert.match(e.message, /BLOCKFROST_MIDNIGHT_MAINNET/);
            assert.ok(!e.message.includes(FAKE.preprod), 'the error echoed another network\'s id');
            return true;
        });
    });
});

test('assertNoSecrets refuses to hand over any network\'s project id', () => {
    withTokens(FAKE, () => {
        for (const net of CREDENTIALED) {
            assert.throws(() => assertNoSecrets(networkEndpoints(net), 'endpoints'), /project id/);
            assert.doesNotThrow(() => assertNoSecrets(publicEndpoints(net), 'public endpoints'));
        }
        // Preview carries nothing to hide, so its run endpoints pass as they are.
        assert.doesNotThrow(() => assertNoSecrets(networkEndpoints('preview'), 'preview endpoints'));
    });
});

// ---------------------------------------------------------------- 3. the deploy script's mainnet guards

// The ledger 9 deploy (scripts/deploy.mjs) and the libraries it opens the
// wallet and the custody key through. The ledger 8 deploy these assertions
// used to read is at the git tag ledger8-preprod.
const src = (...p) => readFileSync(join(ROOT, 'scripts', ...p), 'utf8');
const deploySrc = () => src('deploy.mjs');

test('REPOSITORY ASSERTION: the deploy script is told its network, with no default', () => {
    const s = deploySrc();
    assert.match(s, /const NETWORK = arg\('--network'\);\s*\n\s*if \(!NETWORK\) fail\(/);
    assert.match(s, /const RECORD = recordPath\(NETWORK\);/);
    assert.match(s, /await openWallet\(NETWORK,/);
    assert.ok(!/networkId: '(preview|preprod|mainnet)'/.test(s), 'a hard-coded network id is back');
});

test('REPOSITORY ASSERTION: a mainnet deploy needs its vin key first', () => {
    const s = deploySrc();
    const at = s.indexOf("if (NETWORK === 'mainnet' && SUBMIT) {");
    assert.notEqual(at, -1, 'the mainnet guard is missing');
    const block = s.slice(at, at + s.slice(at).indexOf('\n}\n') + 2);
    assert.match(block, /loadVinKeys\('mainnet'\)/);
    assert.ok(!/sponsor/i.test(s.replace(/^\s*(\*|\/\/).*$/gm, '')), 'a sponsor path is back in the deploy code');
});

test('REPOSITORY ASSERTION: mainnet pins its own registrars, never the demo secrets', () => {
    assert.match(deploySrc(), /NETWORK === 'mainnet' \? 'REGISTRAR-SECRETS\.mainnet\.env' : 'REGISTRAR-SECRETS\.env'/);
});

test('REPOSITORY ASSERTION: mainnet keys have no default location and never sit in a synced folder', () => {
    for (const [file, envVar] of [[['lib', 'wallet9.mjs'], 'VINPASSPORT_SEED_FILE'], [['lib', 'contract9.mjs'], 'VINPASSPORT_CUSTODY_KEY_FILE']]) {
        const s = src(...file);
        assert.match(s, new RegExp(`mainnet needs ${envVar}`), `${file.join('/')} lets mainnet fall back to a default`);
        assert.match(s, /SYNCED_FOLDER = \/onedrive\|dropbox\|icloud\|google \?drive\/i/);
        assert.match(s, /SYNCED_FOLDER\.test\(resolve\(/);
    }
});

test('REPOSITORY ASSERTION: the wallet reads endpoints for the network it was opened on', () => {
    const s = src('lib', 'wallet9.mjs');
    assert.ok(!s.includes('preprodEndpoints'), 'the wallet connects to preprod whatever the network');
    assert.match(s, /export function walletConfiguration\(network\) \{\s*\n\s*const ep = networkEndpoints\(network\);/);
    assert.match(s, /requireBuildableNetwork\(network\);/);
});
