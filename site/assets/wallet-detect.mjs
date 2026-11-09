/**
 * Midnight wallets on this page that speak DApp Connector API 4 (1AM, Lace).
 *
 * Each wallet puts itself under `window.midnight.<key>`, and Lace's key
 * changes on every page load, so wallets are listed, never looked up by a
 * fixed name. Dependency-free and served as written, so a page can list
 * wallets without loading the wallet engine; scripts/lib/wallet-browser.mjs
 * re-exports it, so the engine and the page agree.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
export function listWallets(win = globalThis) {
    const injected = win?.midnight;
    if (!injected || typeof injected !== 'object') return [];
    return Object.entries(injected)
        .map(([key, w]) => ({ key, name: String(w?.name ?? key), icon: w?.icon ?? null, apiVersion: String(w?.apiVersion ?? ''), wallet: w }))
        .filter((w) => /^4\./.test(w.apiVersion) && typeof w.wallet?.connect === 'function');
}

/** Extensions inject after load; wait up to `ms` for at least one. */
export async function waitForWallets(win = globalThis, ms = 2500) {
    const until = Date.now() + ms;
    for (;;) {
        const found = listWallets(win);
        if (found.length || Date.now() > until) return found;
        await new Promise((r) => setTimeout(r, 150));
    }
}
