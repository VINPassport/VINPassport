/**
 * DUST coin selection that pays every fee with at least two DUST spends,
 * whenever the wallet holds two coins.
 *
 * WHY: listed in the Ledger 9 release notes as ledger issue #838 (section
 * "Known issues", https://docs.midnight.network/relnotes/ledger-9): "A
 * contract call whose fee is paid with exactly one DUST spend can be rejected
 * with `OutsideTimeToDismiss`. The same call is accepted with zero, two, or
 * more DUST spends. ... Pay the fee with two or more DUST spends."
 *
 * REMOVE when the ledger fix for #838 ships: delete this module and the
 * `installTwoSpendSelection()` call in wallet9.mjs, after confirming the fix
 * in the ledger release notes (the planned upstream check, build plan 3.5,
 * will watch for it).
 *
 * HOW: Wallet SDK 2's DUST wallet asks its selector for one coin at a time,
 * adding coins until their value covers the fee, smallest first. It does not
 * tell the selector the fee. So the first coin of each selection pass is
 * handed back reporting a value of 1, which can never cover a fee, and the
 * balancer asks again; the second coin goes back at its real value. The
 * wallet maps chosen coins back to the real ones by nonce before it prices
 * and builds the spends (Transacting.js, selectForDeficit), so the fee is
 * charged against real values: the smaller coin is drained first and the
 * second spend carries what is left, possibly nothing. With one coin only,
 * that coin is returned as it is: two spends are impossible, and dust.mjs
 * says so.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

const nonceOf = (coin) => coin?.token?.nonce;

/**
 * A stateful selector. State only links the calls of one selection pass: a
 * call continues the previous pass when its pool is the previous pool minus
 * the coin returned last, which is exactly how the balancer shrinks it.
 */
export function makeTwoSpendSelection() {
    let previous = null;     // { nonces: Set, returned: nonce }
    return (coins) => {
        const pool = coins.filter((c) => c.value > 0n).toSorted((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));
        const nonces = new Set(pool.map(nonceOf));
        const continues = previous != null
            && nonces.size === previous.nonces.size - 1
            && !nonces.has(previous.returned)
            && [...nonces].every((n) => previous.nonces.has(n));
        const first = pool.at(0);
        if (!first) { previous = null; return undefined; }
        const chosen = !continues && pool.length >= 2 ? { ...first, value: 1n } : first;
        previous = { nonces, returned: nonceOf(first) };
        return chosen;
    };
}

/**
 * Make every DUST wallet built from here on use the two-spend selection.
 *
 * DustWallet() builds its ledger 9 variant with
 * `new V2Builder().withDefaults()`, and withDefaults installs the selector
 * through withCoinSelectionDefaults. Replacing that one method on the
 * builder's prototype is the narrowest change that reaches it; the builder
 * class is the one DustWallet imports, since both come from the same module.
 * Idempotent.
 */
export async function installTwoSpendSelection() {
    const { V2Builder } = await import('@midnightntwrk/wallet-sdk-dust-wallet/v2');
    if (V2Builder.prototype.withCoinSelectionDefaults.__twoSpend) return false;
    const patched = function withCoinSelectionDefaults() {
        return this.withCoinSelection(() => makeTwoSpendSelection());
    };
    patched.__twoSpend = true;
    V2Builder.prototype.withCoinSelectionDefaults = patched;
    return true;
}
