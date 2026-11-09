/**
 * Node globals the Midnight.js browser path still expects, set before any of
 * it loads. Imported first by scripts/lib/wallet-browser.mjs: ES modules run
 * their imports in order, so this body runs before the modules after it.
 *
 * Midnight.js 5 decodes a wallet's bech32m keys with `Buffer.from`
 * (midnight-js-utils parseEncPublicKeyToHex), and browsers have no `Buffer`.
 * In Node this changes nothing.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { Buffer } from 'buffer';

if (typeof globalThis.Buffer === 'undefined') globalThis.Buffer = Buffer;
