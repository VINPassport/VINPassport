/**
 * Hand a verifier ONE field, and nothing else.
 *
 * The problem this closes. A run receipt is the holder's master copy: it
 * carries every field's value and salt. It also used to carry `runSeed`, the
 * 32 bytes every salt in the run derives from, which made it a master key for
 * the whole panel including slots the holder had never claimed about. There
 * was no way to answer "what is the mileage?" without handing over the lot.
 * For a product whose claim is that each party sees what they are entitled to
 * and provably nothing more, that was the gap.
 *
 * A disclosure is the narrow answer. It carries, for each named field only:
 * the value, its salt, the slot it lives in, and the public anchors needed to
 * locate that slot on chain. Nothing about any other field. Nothing that
 * derives another field's salt, because a salt is
 * `blake2b(runSeed || label)` and a hash does not run backwards: holding one
 * salt tells you nothing about the next.
 *
 * WHAT A VERIFIER CAN DO WITH IT, with no key, no account and no proof server:
 *
 *   1. read the VIN off the car and check it hashes to `vinHash`
 *   2. recompute `slot` from (vinHash, fieldKey, contentRoot)
 *   3. recompute `persistentCommit(value, salt)`
 *   4. fetch `fieldCommitment[slot]` from the public indexer and compare
 *
 * If step 4 matches, the value is the one the registrar committed, bound to
 * this document. `verifyDisclosure` does 1 to 3 and checks 4 against whatever
 * the caller fetched, so the fetch stays the caller's business.
 *
 * WHAT IT STILL REVEALS, stated rather than discovered. The slot is on a
 * public ledger, so anyone watching already knows that slot exists and when
 * it changed. A disclosure does not create that. What it adds is the opening,
 * and only for the field named.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { blake2b } from '@noble/hashes/blake2';
import {
    persistentCommit, persistentHash,
    CompactTypeUnsignedInteger, CompactTypeBytes, CompactTypeVector
} from '@midnight-ntwrk/compact-runtime';

export const DISCLOSURE_KIND = 'vinpassport-disclosure/v1';

// The same descriptors the compiled circuit uses. Taken from the generated
// contract rather than guessed: Uint<64> is an 8-byte unsigned with that
// exact bound, and the slot hash is over a 4-vector of Bytes<32>.
const U64 = new CompactTypeUnsignedInteger(18446744073709551615n, 8);
const B32 = new CompactTypeBytes(32);
const VEC4 = new CompactTypeVector(4, B32);

const utf8 = (s) => new TextEncoder().encode(s);
const hex = (u) => Buffer.from(u).toString('hex');
const unhex = (s) => Uint8Array.from(Buffer.from(String(s).replace(/^0x/, ''), 'hex'));
const b2b = (d) => blake2b(d, { dkLen: 32 });

/** `pad(32, s)` as the circuit means it: utf8, right-padded with zeros. */
function pad32(s) {
    const out = new Uint8Array(32);
    out.set(utf8(s));
    return out;
}

/** blake2b-256 of the VIN, which is how the ledger keys a passport. */
export const vinHashOf = (vin) => b2b(utf8(String(vin)));

/** blake2b-256 of the field's name, which is how a slot names its field. */
export const fieldKeyOf = (name) => b2b(utf8(String(name)));

/**
 * Where a field lives on the ledger. Mirrors `slotOf` in the contract exactly,
 * tag included: a mismatch here produces a slot that is simply absent, which
 * looks like "no such field" rather than like a bug.
 */
export function slotOf(vinHash, fieldKey, contentRoot) {
    return persistentHash(VEC4, [
        pad32('vinpassport:field:v2'),
        unhex(vinHash), unhex(fieldKey), unhex(contentRoot)
    ]);
}

/** What the ledger stores for a field: a commitment, never the value. */
export function commitmentOf(value, salt) {
    const s = unhex(salt);
    if (s.length !== 32) throw new Error(`salt must be 32 bytes, got ${s.length}`);
    return persistentCommit(U64, BigInt(value), s);
}

/**
 * Build a disclosure for named fields of one receipt.
 *
 * `writeIndex` defaults to the HIGHEST recorded write, because that is the
 * one the ledger currently holds. Disclosing an earlier write would hand over
 * an opening that no longer matches anything, which reads as a forgery rather
 * than as a stale choice.
 */
export function buildDisclosure(receipt, fieldNames, { writeIndex = 'latest', includeVin = true } = {}) {
    if (!receipt?.vin && !receipt?.vinHash) throw new Error('receipt has no vin or vinHash');
    if (!receipt?.contentRoot) throw new Error('receipt has no contentRoot');
    const wanted = Array.isArray(fieldNames) ? fieldNames : [fieldNames];
    if (!wanted.length) throw new Error('name at least one field to disclose');

    const vinHash = receipt.vinHash ?? hex(vinHashOf(receipt.vin));
    const fields = [];

    for (const name of wanted) {
        const writes = receipt.fields?.[name];
        if (!writes) {
            const had = Object.keys(receipt.fields ?? {}).join(', ') || 'none';
            throw new Error(`receipt has no field '${name}'. It has: ${had}`);
        }
        const list = Array.isArray(writes)
            ? writes
            : Object.entries(writes).map(([k, v]) => ({ writeIndex: Number(k), ...v }));
        const sorted = [...list].sort((a, b) => Number(a.writeIndex) - Number(b.writeIndex));
        const chosen = writeIndex === 'latest'
            ? sorted[sorted.length - 1]
            : sorted.find((w) => Number(w.writeIndex) === Number(writeIndex));
        if (!chosen) throw new Error(`field '${name}' has no write ${writeIndex}`);
        if (chosen.value === undefined || !chosen.salt) {
            throw new Error(`write ${chosen.writeIndex} of '${name}' has no value/salt pair`);
        }

        const fieldKey = hex(fieldKeyOf(name));
        fields.push({
            fieldName: name,
            fieldKey,
            slot: hex(slotOf(vinHash, fieldKey, receipt.contentRoot)),
            writeIndex: Number(chosen.writeIndex),
            value: String(chosen.value),
            salt: chosen.salt
        });
    }

    return {
        kind: DISCLOSURE_KIND,
        note: 'Opens ONLY the fields listed here. Carries no seed, so it cannot '
            + 'open any other field of this vehicle. Check it with '
            + '`node scripts/disclose.mjs --verify`, or by hand: recompute the slot and the '
            + 'commitment and compare against the public indexer.',
        network: receipt.network ?? 'preprod',
        contractAddress: receipt.contractAddress,
        // The hash and the root are public already: the ledger is keyed by one
        // and stores the other against it.
        //
        // The VIN in plaintext is OPTIONAL, and leaving it out is the stronger
        // choice. Included, it lets a verifier standing at the car confirm the
        // document is about the car in front of them. Omitted, the document
        // names no vehicle at all, and the verifier supplies the VIN they read
        // off the windscreen and checks that it hashes to `vinHash`, which
        // proves the same thing without the file itself identifying anyone.
        // Pass `{ includeVin: false }` when the disclosure will travel further
        // than the person who asked for it.
        ...(includeVin && receipt.vin ? { vin: receipt.vin } : {}),
        vinHash,
        contentRoot: receipt.contentRoot,
        fields
    };
}

/**
 * Check a disclosure.
 *
 * `onChain` maps a slot (hex) to the commitment the ledger holds for it, or
 * null when the slot is absent. Fetching is the caller's job: this stays
 * offline and synchronous so it can run in a test, in a CLI, or in a browser
 * that was handed a JSON file.
 *
 * Returns a per-field verdict rather than throwing, because "this one field
 * does not match" is the interesting answer, not an error.
 */
export function verifyDisclosure(disclosure, onChain = () => null) {
    const problems = [];
    if (disclosure?.kind !== DISCLOSURE_KIND) {
        problems.push(`unknown kind '${disclosure?.kind}', expected '${DISCLOSURE_KIND}'`);
    }

    // The disclosure must not have smuggled a master key back in. Cheap to
    // check, and the whole point of the format.
    for (const banned of ['runSeed', 'saltRule', 'seed']) {
        if (disclosure && banned in disclosure) problems.push(`disclosure carries '${banned}', which it must not`);
    }

    const vinOk = disclosure?.vin
        ? hex(vinHashOf(disclosure.vin)) === String(disclosure.vinHash).replace(/^0x/, '')
        : null;
    if (vinOk === false) problems.push('vin does not hash to vinHash');

    const fields = (disclosure?.fields ?? []).map((f) => {
        const out = { fieldName: f.fieldName, writeIndex: f.writeIndex };
        try {
            const expectedKey = hex(fieldKeyOf(f.fieldName));
            if (expectedKey !== String(f.fieldKey).replace(/^0x/, '')) {
                return { ...out, ok: false, why: 'fieldKey is not the hash of fieldName' };
            }
            const expectedSlot = hex(slotOf(disclosure.vinHash, f.fieldKey, disclosure.contentRoot));
            if (expectedSlot !== String(f.slot).replace(/^0x/, '')) {
                return { ...out, ok: false, why: 'slot does not follow from vinHash, fieldKey and contentRoot' };
            }
            const commitment = hex(commitmentOf(f.value, f.salt));
            const stored = onChain(expectedSlot);
            if (!stored) return { ...out, ok: false, why: 'no commitment on chain for this slot', commitment };
            const ok = String(stored).replace(/^0x/, '') === commitment;
            return {
                ...out, ok, commitment,
                why: ok ? 'value opens the commitment the ledger holds' : 'value does not open the stored commitment'
            };
        } catch (e) {
            return { ...out, ok: false, why: String(e?.message ?? e) };
        }
    });

    return {
        ok: problems.length === 0 && fields.length > 0 && fields.every((f) => f.ok),
        vinMatchesHash: vinOk,
        problems,
        fields
    };
}

/**
 * Everything in a receipt that a disclosure must never copy.
 *
 * Exported so the receipt builder and its test agree on one list rather than
 * two that drift.
 */
export const NEVER_DISCLOSE = Object.freeze(['runSeed', 'saltRule', 'seed', 'panel', 'fields']);
