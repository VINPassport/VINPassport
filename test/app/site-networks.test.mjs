/**
 * The site names its chains in one place, site/assets/networks.mjs.
 *
 * A page that hard-codes a network says the wrong thing the day the network
 * changes, and a page that links an explorer which does not follow the chain
 * hands a reader a 404 as if it were evidence. Both happened in spirit on
 * 8 November 2026, when the main line moved from preprod to Preview and the
 * Preview explorer showed no Preview data. These tests hold the rule: pages
 * read the network from the run, the recording or the snapshot, and link only
 * where networks.mjs has an explorer.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative, extname } from 'node:path';
import { NETWORKS, DEFAULT_NETWORK, networkOf, explorerUrl, indexerCurlLines } from '../../site/assets/networks.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SITE = join(ROOT, 'site');

function walk(dir) {
    return readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? walk(p) : [p];
    });
}
const CODE = walk(SITE).filter((p) => ['.html', '.js', '.mjs', '.css'].includes(extname(p)))
    .filter((p) => !p.includes(join('assets', 'intake-engine')));
const rel = (p) => relative(ROOT, p).split('\\').join('/');

test('every network has a name, a label, and an indexer a reader can query', () => {
    for (const [id, net] of Object.entries(NETWORKS)) {
        assert.equal(net.id, id);
        assert.ok(net.name.startsWith('Midnight '), `${id} name`);
        assert.ok(net.label.length > 0, `${id} label`);
        assert.match(net.indexer.url, /^https:\/\//, `${id} indexer`);
        if (net.explorer !== null) assert.match(net.explorer, /^https:\/\/[^/]+$/, `${id} explorer is an origin, no trailing slash`);
    }
    assert.ok(DEFAULT_NETWORK in NETWORKS);
});

test('an unknown network is not relabelled as the default one', () => {
    const net = networkOf('stagenet');
    assert.equal(net.name, 'Midnight stagenet');
    assert.equal(net.explorer, null);
    assert.equal(explorerUrl(net, 'transactions', 'ab'), null);
    assert.deepEqual(indexerCurlLines(net, 'ab'), []);
});

test('no explorer, no link: explorerUrl returns null rather than a URL that 404s', () => {
    for (const net of Object.values(NETWORKS)) {
        const url = explorerUrl(net, 'transactions', 'ab'.repeat(32));
        if (net.explorer) assert.equal(url, `${net.explorer}/transactions/${'ab'.repeat(32)}`);
        else assert.equal(url, null);
    }
    assert.throws(() => explorerUrl(networkOf('preprod'), 'accounts', 'x'), /unknown explorer path/);
});

test('the indexer query carries a header only where the indexer needs one, and never a real id', () => {
    for (const net of Object.values(NETWORKS)) {
        const lines = indexerCurlLines(net, 'ab'.repeat(32));
        const header = lines.find((l) => l.startsWith(`-H '`) && !l.includes('Content-Type'));
        if (net.indexer.header) assert.equal(header, `-H '${net.indexer.header}'`);
        else assert.equal(header, undefined, `${net.id} needs no key, so the curl shows none`);
        const body = JSON.parse(lines.at(-1).slice(4, -1));
        assert.match(body.query, new RegExp(`contractAction\\(address: "${'ab'.repeat(32)}"\\)`));
    }
    assert.match(networkOf('preprod').indexer.header, /YOUR_PROJECT_ID/);
});

test('REPOSITORY ASSERTION: only networks.mjs names an explorer host in site code', () => {
    const offenders = CODE.filter((p) => !p.endsWith(join('assets', 'networks.mjs')))
        .filter((p) => /midnightexplorer\.com/.test(readFileSync(p, 'utf8')))
        .map(rel);
    assert.deepEqual(offenders, []);
});

test('REPOSITORY ASSERTION: no page imports the retired preprod run client', () => {
    const offenders = CODE.filter((p) => /preprod-run\.mjs/.test(readFileSync(p, 'utf8'))).map(rel);
    assert.deepEqual(offenders, []);
});

test('REPOSITORY ASSERTION: no Blockfrost project id anywhere in the site', () => {
    const offenders = walk(SITE).filter((p) => ['.html', '.js', '.mjs', '.json', '.css'].includes(extname(p)))
        .filter((p) => /\b(preprod|mainnet|preview)[A-Za-z0-9]{32}\b/.test(readFileSync(p, 'utf8')))
        .map(rel);
    assert.deepEqual(offenders, []);
});

// -- the run client renders whatever network the job names

async function render(network) {
    globalThis.document ??= { querySelectorAll: () => [] };
    const { renderJob } = await import('../../site/assets/chain-run.mjs');
    const host = { innerHTML: '' };
    const hash = 'ab'.repeat(32);
    renderJob(host, {
        id: 'abcdef123456', kind: 'guided', network, status: 'done', ms: 1000,
        steps: [{ status: 'done', label: 'registerPassport', ms: 900, detail: `tx ${hash} in block 17890` }],
        receipt: {
            network, onChain: [{ label: 'registerPassport', txHash: hash, blockHeight: 17890 }],
            claims: [], refused: [], vin: 'DEMO', vinHash: 'cd'.repeat(32), contentRoot: 'ef'.repeat(32)
        }
    }, 'http://localhost:8790');
    return host.innerHTML;
}

test('a Preview run renders its hashes without explorer links, and says Preview', async () => {
    const html = await render('preview');
    assert.doesNotMatch(html, /midnightexplorer/);
    assert.match(html, /public Midnight Preview chain/);
    assert.match(html, /· Preview<\/span>/);
});

test('a preprod run links every hash and block to the preprod explorer', async () => {
    const html = await render('preprod');
    const links = html.match(/https:\/\/preprod\.midnightexplorer\.com\/(transactions|blocks)\/[0-9a-f]+/g) ?? [];
    assert.equal(links.length, 4, 'step tx and block, receipt tx and block');
    assert.match(html, /public Midnight preprod chain/);
});
