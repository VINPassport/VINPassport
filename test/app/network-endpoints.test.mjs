/**
 * Which network a run reaches, and what may leave the process about it.
 *
 * Three things are held here.
 *
 *  1. Nothing defaults to mainnet. Preprod is the default everywhere, mainnet
 *     must be named, and an unknown name is refused rather than mapped.
 *  2. Credentials stay per network. Each network reads its own Blockfrost
 *     project id, and the guards that keep an id out of anything we hand over
 *     cover every configured id, not only preprod's.
 *  3. The deploy script's mainnet guards: self-funded only, its own registrar
 *     secrets, and no contract before the mainnet vin key exists.
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
    NETWORKS, checkNetwork, networkEndpoints, publicEndpoints, preprodEndpoints,
    publicPreprodEndpoints, blockfrostToken, assertNoSecrets
} from '../../scripts/lib/endpoints.mjs';

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

test('the known networks are preprod and mainnet, and nothing else is accepted', () => {
    assert.deepEqual([...NETWORKS], ['preprod', 'mainnet']);
    for (const bad of ['Mainnet', 'MAINNET', 'testnet', 'preview', '', undefined, null]) {
        assert.throws(() => checkNetwork(bad), /unknown network/, `accepted ${bad}`);
    }
});

test('public endpoints name their own network\'s hosts and carry no credential', () => {
    for (const net of NETWORKS) {
        const ep = publicEndpoints(net);
        assert.equal(ep.networkId, net);
        for (const url of [ep.indexerHttpUrl, ep.indexerWsUrl, ep.nodeHttpUrl, ep.nodeWsUrl]) {
            assert.match(url, new RegExp(`midnight-${net}\\.blockfrost\\.io`));
            assert.ok(!url.includes('project_id'), `${url} carries a credential`);
        }
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
        for (const net of NETWORKS) {
            assert.throws(() => assertNoSecrets(networkEndpoints(net), 'endpoints'), /project id/);
            assert.doesNotThrow(() => assertNoSecrets(publicEndpoints(net), 'public endpoints'));
        }
    });
});

// ---------------------------------------------------------------- 3. the deploy script's mainnet guards

const deploySrc = () => readFileSync(join(ROOT, 'scripts', 'deploy-preprod.mjs'), 'utf8');

test('REPOSITORY ASSERTION: the deploy script takes its network from one place and defaults to preprod', () => {
    const src = deploySrc();
    assert.match(src, /process\.env\.VINPASSPORT_NETWORK_ID \?\? 'preprod'/);
    assert.match(src, /const EP = networkEndpoints\(NETWORK\)/);
    assert.match(src, /networkId: NETWORK,/);
    assert.match(src, /join\(ROOT, 'deploy', `\$\{NETWORK\}\.json`\)/);
    assert.ok(!/networkId: 'preprod'/.test(src), 'a hard-coded preprod network id is back');
});

test('REPOSITORY ASSERTION: mainnet is self-funded only and needs its vin key before a deploy', () => {
    const src = deploySrc();
    const guard = src.slice(src.indexOf("if (NETWORK === 'mainnet') {"));
    assert.ok(guard.length > 0, 'the mainnet guard is missing');
    const block = guard.slice(0, guard.indexOf('\n}\n') + 2);
    assert.match(block, /NEEDS_SPONSOR \|\| EMIT \|\| EMIT_BOUND/);
    assert.match(block, /self-funded only/);
    assert.match(block, /loadVinKeys\('mainnet'\)/);
});

test('REPOSITORY ASSERTION: mainnet pins its own registrars, never the preprod demo secrets', () => {
    assert.match(deploySrc(), /NETWORK === 'mainnet' \? 'REGISTRAR-SECRETS\.mainnet\.env' : 'REGISTRAR-SECRETS\.env'/);
});

test('REPOSITORY ASSERTION: self-fund reads endpoints for the same network as its wallet', () => {
    const src = readFileSync(join(ROOT, 'scripts', 'lib', 'self-fund.mjs'), 'utf8');
    assert.ok(!src.includes('preprodEndpoints'), 'self-fund still connects to preprod whatever the network');
    assert.match(src, /const NETWORK_ID = runNetwork\(\);\s*\n\s*const EP = networkEndpoints\(NETWORK_ID\);/);
});
