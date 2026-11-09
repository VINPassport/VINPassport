/**
 * Registrar governance (DECISIONS D32): the parts with no network in them, so
 * they are tested on their own (test/app/governance.test.mjs).
 *
 * The contract pins a registrar set at deploy and changes it only when two
 * current registrars approve the same change, each in their own transaction.
 * The deploy record keeps the set pinned at deploy (`registrars`) and every
 * approval submitted since (`registrarChanges`), so a reader can work out
 * which set the chain should hold now without trusting the chain to say.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

const HEX64 = /^[0-9a-f]{64}$/;

/**
 * A registrar named by its label in the deploy record (A, B, ...) or by its
 * identity as 64 hex characters. An identity nobody has a label for is
 * allowed, because adding a registrar means naming one the record does not
 * know yet.
 */
export function resolveRegistrar(nameOrHex, registrars = []) {
    const s = String(nameOrHex ?? '').trim();
    if (/^[A-Za-z]$/.test(s)) {
        const r = registrars.find((x) => x.label === s.toUpperCase());
        if (!r) throw new Error(`no registrar labelled ${s.toUpperCase()} in the deploy record (${registrars.map((x) => x.label).join(', ') || 'none'})`);
        return { label: r.label, id: r.id };
    }
    const hex = s.toLowerCase().replace(/^0x/, '');
    if (HEX64.test(hex)) return { label: registrars.find((x) => x.id === hex)?.label ?? null, id: hex };
    throw new Error(`"${s}" is neither a registrar label nor 64 hex characters`);
}

/**
 * The registrar set the chain should hold: the identities pinned at deploy,
 * with every executed change applied in the order it was recorded. An
 * approval that did not carry its change is history, not state.
 */
export function expectedRegistrars(pinned = [], changes = []) {
    const set = new Set(pinned.map((r) => (typeof r === 'string' ? r : r.id)));
    for (const c of changes) {
        if (!c.executed) continue;
        if (c.add) set.add(c.id);
        else set.delete(c.id);
    }
    return set;
}

/** Two sets of identities hold the same members. */
export const sameMembers = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/**
 * `--network <n>`, exactly one of `--add <who>` / `--remove <who>`, `--as <label>`,
 * and optionally `--submit`. Anything else is refused rather than ignored,
 * because a mistyped flag on a governance call should stop it, not change it.
 */
export function parseGovernArgs(argv) {
    const args = [...argv];
    const out = { network: null, add: null, target: null, as: null, submit: false };
    while (args.length) {
        const a = args.shift();
        if (a === '--submit') { out.submit = true; continue; }
        if (!['--network', '--add', '--remove', '--as'].includes(a)) throw new Error(`unknown argument ${a}`);
        const v = args.shift();
        if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
        if (a === '--network') out.network = v;
        else if (a === '--as') out.as = v;
        else {
            if (out.target !== null) throw new Error('one change per call: give --add or --remove once');
            out.add = a === '--add';
            out.target = v;
        }
    }
    if (!out.network) throw new Error('--network is required');
    if (out.target === null) throw new Error('say what to change: --add <who> or --remove <who>');
    if (!out.as || !/^[A-Za-z]$/.test(out.as)) throw new Error('--as names the approving registrar by its label (A, B, ...)');
    out.as = out.as.toUpperCase();
    return out;
}
