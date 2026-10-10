/**
 * The registrar allowlist that gets pinned into the contract at deploy.
 *
 * Separate from the deploy script on purpose. `allowedRegistrars` is written
 * in the constructor and nowhere else, so this list is fixed for the
 * contract's lifetime: there is no circuit that adds to it and no second
 * chance. That makes it the one input worth testing on its own, away from
 * anything that needs a network, a seed or a sponsor.
 *
 * Identities only. The secrets behind them are never read here, because a
 * deploy does not act as a registrar; it only states which registrars will be
 * allowed to.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, existsSync } from 'node:fs';

export const REGISTRAR_LABELS = ['A', 'B', 'C', 'D'];

export const REGISTRAR_ROLES = {
    A: 'the demo registrar',
    B: 'listed, registers nothing',
    C: 'a third distinct authority',
    D: 'a fourth, held unused'
};

/**
 * Read the pinned identities, in slot order.
 *
 * Throws rather than exiting, so a caller can report it however it likes and
 * a test can assert on it.
 *
 * @param {string} secretsPath  the env file, which lives above the repo root
 * @param {string[]} labels     slot order; defaults to A, B, C, D
 * @returns {{regs: {label: string, hex: string, bytes: Uint8Array}[], slots: Uint8Array[]}}
 */
export function readRegistrarSlots(secretsPath, labels = REGISTRAR_LABELS) {
    if (!existsSync(secretsPath)) {
        throw new Error(`no registrar identities at ${secretsPath}. `
            + 'Run `node scripts/make-registrar-secrets.mjs` first. The list is fixed '
            + 'at deploy and cannot be added to later, so it has to be right now.');
    }
    const text = readFileSync(secretsPath, 'utf8');
    const lines = text.split(/\r?\n/);

    const regs = labels.map((label) => {
        const key = `VINPASSPORT_REGISTRAR_${label}_ID_HEX=`;
        const line = lines.find((l) => l.startsWith(key));
        const hex = line?.slice(key.length).trim();
        if (!/^[0-9a-f]{64}$/.test(hex ?? '')) {
            throw new Error(`${key}<64 hex> missing or malformed in ${secretsPath}`);
        }
        return { label, hex, bytes: Uint8Array.from(Buffer.from(hex, 'hex')) };
    });

    // The ledger holds the allowlist in a Set, so a repeated id is kept once
    // and the duplicate slot is spent for nothing. Since the list can never be
    // added to, a slot filled with a duplicate is a slot given away.
    const distinct = new Set(regs.map((r) => r.hex));
    if (distinct.size !== labels.length) {
        throw new Error('two registrars share an identity, which would silently shrink '
            + `the allowlist to ${distinct.size} of ${labels.length}; check ${secretsPath}`);
    }

    return { regs, slots: regs.map((r) => r.bytes) };
}
