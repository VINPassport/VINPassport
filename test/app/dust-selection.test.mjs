/**
 * The two-DUST-spend selection (scripts/lib/dust-selection.mjs), driven the
 * way Wallet SDK 2 drives a selector: one coin per call, the chosen coin
 * filtered out of the pool, until the reported values cover the deficit;
 * then chosen coins are mapped back to the real ones by nonce
 * (wallet-sdk-capabilities Balancer.js doBalance, dust-wallet v2
 * Transacting.js selectForDeficit). Ledger issue #838.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { makeTwoSpendSelection, installTwoSpendSelection } from '../../scripts/lib/dust-selection.mjs';

const coin = (nonce, value) => ({ type: 'dust', value, token: { nonce } });

/** One selection pass as the balancer runs it; returns the REAL coins chosen. */
function pass(select, pool, deficit) {
    let coins = pool.map((c) => ({ ...c }));
    let covered = 0n;
    const chosen = [];
    while (covered < deficit) {
        const c = select(coins);
        if (!c) throw new Error('exhausted');
        covered += c.value;
        chosen.push(pool.find((p) => p.token.nonce === c.token.nonce));
        coins = coins.filter((x) => x.token.nonce !== c.token.nonce);
    }
    return chosen;
}

test('two coins: both are spent even when the smaller alone covers the fee', () => {
    const chosen = pass(makeTwoSpendSelection(), [coin('a', 900n), coin('b', 50n)], 10n);
    assert.deepEqual(chosen.map((c) => c.token.nonce), ['b', 'a']);
});

test('one coin: it is spent alone, since two spends are impossible', () => {
    const chosen = pass(makeTwoSpendSelection(), [coin('a', 900n)], 10n);
    assert.deepEqual(chosen.map((c) => c.token.nonce), ['a']);
});

test('a fee needing three coins still gets them, smallest first', () => {
    const chosen = pass(makeTwoSpendSelection(), [coin('a', 5n), coin('b', 6n), coin('c', 7n), coin('d', 100n)], 12n);
    assert.deepEqual(chosen.map((c) => c.token.nonce), ['a', 'b', 'c']);
});

test('empty coins are never chosen', () => {
    const chosen = pass(makeTwoSpendSelection(), [coin('z', 0n), coin('a', 40n), coin('b', 60n)], 10n);
    assert.deepEqual(chosen.map((c) => c.token.nonce), ['a', 'b']);
});

test('each new pass starts over: the first coin of the next pass is under-reported again', () => {
    const select = makeTwoSpendSelection();
    const pool = [coin('a', 900n), coin('b', 50n), coin('c', 70n)];
    assert.equal(pass(select, pool, 10n).length, 2);
    assert.equal(pass(select, pool, 10n).length, 2);
});

test('the patch reaches the builder DustWallet uses: same module file, and it is idempotent', async () => {
    const main = fileURLToPath(import.meta.resolve('@midnightntwrk/wallet-sdk-dust-wallet'));
    const v2 = fileURLToPath(import.meta.resolve('@midnightntwrk/wallet-sdk-dust-wallet/v2'));
    assert.equal(v2, join(dirname(main), 'v2', 'index.js'));
    await installTwoSpendSelection();
    assert.equal(await installTwoSpendSelection(), false);
    const { V2Builder } = await import('@midnightntwrk/wallet-sdk-dust-wallet/v2');
    assert.ok(V2Builder.prototype.withCoinSelectionDefaults.__twoSpend);
});
