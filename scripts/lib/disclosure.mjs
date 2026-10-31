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
import { TIERS, POLICY_VERSION, FIELD_TIERS, tierOf, allows, vinAllowed } from './tiers.mjs';

export const DISCLOSURE_KIND = 'vinpassport-disclosure/v1';

// The same descriptors the compiled circuit uses. Taken from the generated
// contract rather than guessed: Uint<64> is an 8-byte unsigned with that
// exact bound, and the slot hash is over a 4-vector of Bytes<32>.
const U64 = new CompactTypeUnsignedInteger(18446744073709551615n, 8);
const B32 = new CompactTypeBytes(32);
const VEC4 = new CompactTypeVector(4, B32);
const VEC3 = new CompactTypeVector(3, B32);

// Web APIs only, no Buffer: /disclose/ runs this file in a browser, bundled
// into the intake engine, and a stray Buffer would only fail there.
const utf8 = (s) => new TextEncoder().encode(s);
const hex = (u) => Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('');
const unhex = (s) => Uint8Array.from(
    String(s).replace(/^0x/, '').match(/../g) ?? [], (b) => parseInt(b, 16));
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

/**
 * Where a (vehicle, grantee) pair lives in the contract's `grants` map.
 * Mirrors `grantKeyOf` in the contract, tag included; a contract test holds
 * the two equal.
 */
export function grantKeyOf(vinHash, granteeId) {
    return hex(persistentHash(VEC3, [pad32('vinpassport:grant:v1'), unhex(vinHash), unhex(granteeId)]));
}

/** The contract's `Tier` enum, in declaration order. It has no public member. */
export const GRANT_TIERS = Object.freeze(['trade', 'authority']);

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
 * One field's opening against the ledger: the key follows from the name, the
 * slot from the anchors, and the value and salt open the commitment stored
 * there. Shared by both formats so they cannot disagree about what "opens"
 * means.
 */
function checkOpening(f, vinHash, contentRoot, onChain) {
    const out = { fieldName: f.fieldName, writeIndex: f.writeIndex };
    try {
        const expectedKey = hex(fieldKeyOf(f.fieldName));
        if (expectedKey !== String(f.fieldKey).replace(/^0x/, '')) {
            return { ...out, ok: false, why: 'fieldKey is not the hash of fieldName' };
        }
        const expectedSlot = hex(slotOf(vinHash, f.fieldKey, contentRoot));
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

    const fields = (disclosure?.fields ?? [])
        .map((f) => checkOpening(f, disclosure.vinHash, disclosure.contentRoot, onChain));

    return {
        ok: problems.length === 0 && fields.length > 0 && fields.every((f) => f.ok),
        vinMatchesHash: vinOk,
        problems,
        fields
    };
}

// ------------------------------------------------------------------ bundles (v2)
//
// A BUNDLE is a disclosure addressed to one audience, per D26 in
// docs/DECISIONS.md. It names its tier, and its contents are bounded by the
// tier policy in ./tiers.mjs: a public bundle opens public fields, a trade
// bundle public and trade fields, an authority bundle every field plus the
// VIN. Any bundle may also reference claims already proven on the ledger,
// which reveal a bound and never a value.
//
// The builder REFUSES a field above the tier. The reader does not trust the
// builder: it recomputes every field's tier from its own copy of the policy
// and reports what the bundle actually opens, flagging anything above the
// tier it declares. Such a bundle still verifies, because a holder may choose
// to hand over more, but the reader is told.
//
// A bundle may name its audience by identity (`audienceId`). The reader then
// asks the ledger whether the vehicle's registrar granted that identity this
// tier (`grantDisclosure` in the contract) and reports the answer. A missing
// grant does not fail the bundle, for the same reason: the values still open
// their commitments, and the grant makes a disclosure auditable rather than
// possible. The public tier needs no grant and is never looked up.

export const BUNDLE_KIND = 'vinpassport-disclosure/v2';

const HEX32 = /^(0x)?[0-9a-f]{64}$/i;
const bare = (h) => String(h).replace(/^0x/, '').toLowerCase();

/** The name behind a field key, for every field the policy knows. */
const NAME_OF_KEY = new Map(Object.keys(FIELD_TIERS).map((n) => [hex(fieldKeyOf(n)), n]));

/**
 * Build the bundle a holder hands one audience.
 *
 * `fields` defaults to every field of the receipt the tier allows; name them
 * to hand over fewer. `claims` are claim keys from the ledger, for the holder
 * to point at what has already been proven. The builder checks names, not
 * claims: it is offline and holds no ledger.
 */
export function buildBundle(receipt, tier, { fields: named, claims = [], audience, audienceId } = {}) {
    if (!TIERS.includes(tier)) throw new Error(`unknown tier '${tier}', expected one of ${TIERS.join(', ')}`);
    if (!receipt?.vin && !receipt?.vinHash) throw new Error('receipt has no vin or vinHash');
    if (!receipt?.contentRoot) throw new Error('receipt has no contentRoot');

    const held = Object.keys(receipt.fields ?? {});
    const chosen = named ?? held.filter((n) => n in FIELD_TIERS && allows(tier, tierOf(n)));
    for (const name of chosen) {
        const fieldTier = tierOf(name);
        if (!allows(tier, fieldTier)) {
            throw new Error(`'${name}' is a ${fieldTier} field and cannot go in a ${tier} bundle`);
        }
    }
    const keys = claims.map(bare);
    for (const k of keys) if (!HEX32.test(k)) throw new Error(`'${k}' is not a claim key`);
    if (!chosen.length && !keys.length) throw new Error('a bundle must open a field or reference a claim');
    if (audienceId !== undefined && !HEX32.test(String(audienceId))) throw new Error(`'${audienceId}' is not an identity`);

    const opened = chosen.length ? buildDisclosure(receipt, chosen, { includeVin: false }).fields : [];
    const vinHash = receipt.vinHash ?? hex(vinHashOf(receipt.vin));
    return {
        kind: BUNDLE_KIND,
        policy: POLICY_VERSION,
        tier,
        ...(audience ? { audience: String(audience) } : {}),
        ...(audienceId !== undefined ? { audienceId: bare(audienceId) } : {}),
        note: `A ${tier} disclosure. It opens only the fields listed here and carries no seed, `
            + 'so it cannot open any other field of this vehicle. Each claim listed was proven on the '
            + 'public ledger and reveals a bound, never a value.',
        network: receipt.network ?? 'preprod',
        contractAddress: receipt.contractAddress,
        vinHashScheme: 'blake2b-256',
        ...(vinAllowed(tier) && receipt.vin ? { vin: receipt.vin } : {}),
        vinHash,
        contentRoot: receipt.contentRoot,
        fields: opened,
        claims: keys
    };
}

/**
 * Read a bundle against the ledger.
 *
 * `commitmentAt(slot)` returns the commitment the ledger holds for a slot, or
 * null; `claimAt(key)` returns the ledger's claim record for a key, or null;
 * `grantAt(key)` returns the `Tier` index the ledger holds for a grant key,
 * or null.
 * Both are the caller's to supply, so this stays offline and synchronous: the
 * same code runs in a test, in the CLI and in a browser handed a file.
 *
 * `ok` means every opening opens what the ledger holds, and every claim
 * exists, is about this vehicle, and was proven against the value the ledger
 * holds NOW. A claim proven against an earlier value is reported as
 * superseded and does not count: under a rule like neverFalls, an old bound
 * can mislead about the current value.
 */
export function verifyBundle(bundle, { commitmentAt = () => null, claimAt = () => null, grantAt = () => null } = {}) {
    const problems = [];
    if (bundle?.kind !== BUNDLE_KIND) problems.push(`unknown kind '${bundle?.kind}', expected '${BUNDLE_KIND}'`);
    if (bundle?.policy !== POLICY_VERSION) problems.push(`unknown policy '${bundle?.policy}', expected '${POLICY_VERSION}'`);
    const tier = TIERS.includes(bundle?.tier) ? bundle.tier : null;
    if (!tier) problems.push(`unknown tier '${bundle?.tier}'`);
    for (const banned of ['runSeed', 'saltRule', 'seed']) {
        if (bundle && banned in bundle) problems.push(`bundle carries '${banned}', which it must not`);
    }

    const overDisclosed = [];
    let vinMatchesHash = null;
    if (bundle?.vin) {
        if (tier && !vinAllowed(tier)) overDisclosed.push('VIN');
        // A scheme this reader cannot compute offline is reported, not guessed.
        if (bundle.vinHashScheme === 'blake2b-256') {
            vinMatchesHash = hex(vinHashOf(bundle.vin)) === bare(bundle.vinHash);
            if (!vinMatchesHash) problems.push('vin does not hash to vinHash');
        }
    }

    const fields = (bundle?.fields ?? []).map((f) => {
        const fieldTier = FIELD_TIERS[f.fieldName] ?? null;
        if (!fieldTier) return { fieldName: f.fieldName, writeIndex: f.writeIndex, ok: false, tier: null, why: 'field is not in the tier policy' };
        const checked = checkOpening(f, bundle.vinHash, bundle.contentRoot, commitmentAt);
        if (tier && !allows(tier, fieldTier)) overDisclosed.push(f.fieldName);
        return { ...checked, tier: fieldTier };
    });

    const claims = (bundle?.claims ?? []).map((key) => {
        const k = bare(key);
        const c = claimAt(k);
        if (!c) return { key: k, ok: false, why: 'no such claim on the ledger' };
        const fieldName = NAME_OF_KEY.get(bare(c.fieldKey)) ?? null;
        const about = { key: k, fieldName, bound: c.bound, atMost: c.atMost };
        if (bare(c.vinHash) !== bare(bundle.vinHash)) return { ...about, ok: false, why: 'claim is about a different vehicle' };
        const now = commitmentAt(bare(c.slot));
        const current = now != null && bare(now) === bare(c.commitment);
        return {
            ...about, ok: current, current,
            why: current ? 'proven against the value the ledger holds now'
                : 'proven against an earlier value, since superseded'
        };
    });

    // Reported, never counted against `ok`; see the note above buildBundle.
    let grant = null;
    if (bundle?.audienceId && tier && tier !== 'public') {
        const key = grantKeyOf(bundle.vinHash, bundle.audienceId);
        const at = grantAt(key);
        const held = at == null ? null : (GRANT_TIERS[Number(at)] ?? null);
        grant = { key, audienceId: bare(bundle.audienceId), held, covers: held !== null && allows(held, tier) };
    }

    return {
        ok: problems.length === 0 && fields.length + claims.length > 0
            && fields.every((f) => f.ok) && claims.every((c) => c.ok),
        tier,
        problems,
        opened: fields.filter((f) => f.ok).map((f) => f.fieldName),
        overDisclosed,
        vinMatchesHash,
        grant,
        fields,
        claims
    };
}

/**
 * Which policy fields this vehicle has on the ledger, found from public
 * anchors alone: each field's slot follows from (vinHash, fieldKey,
 * contentRoot), so a reader can list what a bundle left closed without being
 * handed anything. Presence was never private; values are.
 */
export function fieldsOnLedger(vinHash, contentRoot, commitmentAt = () => null) {
    return Object.keys(FIELD_TIERS).filter((name) =>
        commitmentAt(hex(slotOf(vinHash, hex(fieldKeyOf(name)), contentRoot))) != null);
}

/**
 * Everything in a receipt that a disclosure must never copy.
 *
 * Exported so the receipt builder and its test agree on one list rather than
 * two that drift.
 */
export const NEVER_DISCLOSE = Object.freeze(['runSeed', 'saltRule', 'seed', 'panel', 'fields']);
