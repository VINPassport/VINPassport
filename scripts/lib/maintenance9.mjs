/**
 * Maintenance proposals for a committee-held contract (DECISIONS D28).
 *
 * A ledger 9 maintenance update needs signatures from a threshold of the
 * committee, and the members sit on different machines. `MaintenanceUpdate`
 * has no serialised form, so what travels between them is a proposal: a JSON
 * file that states the update in readable parts (the contract, the counter it
 * is valid against, each instruction and, for a verifier key, the key bytes
 * and their SHA-256). Every member's tool rebuilds the update from those
 * parts and signs the ledger's own `dataToSign`. Nobody signs a blob someone
 * else computed; a member who reads the summary signs exactly what it says,
 * and an edit to any part after signing invalidates every signature.
 *
 * `dataToSign` covers the address, the counter and every instruction in
 * full, including the verifier key bytes. A proposal is therefore valid
 * against one authority counter only: once any update lands, the counter
 * moves and older proposals die.
 *
 * Pure functions over ledger-v9 types: no chain, no wallet, no files.
 * scripts/maintenance.mjs does the reading, signing and submitting.
 *
 * Known limit, ledger 9: removing a verifier key fails at submission
 * (midnight-node issue 2375). Proposals may say `removeVerifierKey`, and the
 * submit step refuses until the node is fixed (see REMOVE_BLOCKED).
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash } from 'node:crypto';
import {
    ContractMaintenanceAuthority, ContractOperationVersion, ContractOperationVersionedVerifierKey,
    MaintenanceUpdate, ReplaceAuthority, VerifierKeyInsert, VerifierKeyRemove, signData, signatureVerifyingKey, verifySignature
} from '@midnightntwrk/ledger-v9';

export const PROPOSAL_KIND = 'vinpassport.maintenance-proposal.v1';
/** Ledger 9 operation version for keys from Compact 0.36 (header `verifier-key[v7]`). */
export const VK_VERSION = 'v4';
/** midnight-node issue 2375: a removal is refused with BalanceCheckOverspend. */
export const REMOVE_BLOCKED = 'https://github.com/midnightntwrk/midnight-node/issues/2375';

const HEX = /^[0-9a-f]*$/;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hexBytes = (hex) => new Uint8Array(Buffer.from(hex, 'hex'));
const sameKey = (a, b) => a.tag === b.tag && a.value === b.value;

/** An instruction to insert a circuit's verifier key, from the key file's bytes. */
export function insertVerifierKey(circuit, vkBytes, version = VK_VERSION) {
    const hex = Buffer.from(vkBytes).toString('hex');
    return { op: 'insertVerifierKey', circuit, version, vkSha256: sha256(vkBytes), vkHex: hex };
}

export const removeVerifierKey = (circuit, version = VK_VERSION) => ({ op: 'removeVerifierKey', circuit, version });

export const replaceAuthority = (committee, threshold) => ({
    op: 'replaceAuthority', committee: committee.map((k) => ({ tag: k.tag, value: k.value })), threshold
});

/**
 * A proposal against the authority the chain holds now. `authority` is what
 * the contract state reports: committee, threshold and counter.
 */
export function makeProposal({ network, contractAddress, authority, updates, title, build }) {
    const p = {
        kind: PROPOSAL_KIND,
        title,
        network,
        contractAddress,
        counter: String(authority.counter),
        authority: {
            threshold: authority.threshold,
            committee: authority.committee.map((k) => ({ tag: k.tag, value: k.value }))
        },
        updates,
        ...(build ? { build } : {}),
        createdAt: new Date().toISOString(),
        signatures: []
    };
    p.dataToSignSha256 = fingerprint(p);
    return p;
}

/** Structural checks; throws with the first problem found. */
export function validateProposal(p) {
    const no = (why) => { throw new Error(`proposal: ${why}`); };
    if (p?.kind !== PROPOSAL_KIND) no(`kind is ${p?.kind}, expected ${PROPOSAL_KIND}`);
    if (!/^[0-9a-f]{64}$/.test(p.contractAddress ?? '')) no('contractAddress is not 64 hex characters');
    if (!/^\d+$/.test(p.counter ?? '')) no('counter is not a whole number');
    const { committee, threshold } = p.authority ?? {};
    if (!Array.isArray(committee) || !committee.length) no('authority.committee is empty');
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > committee.length) no('authority.threshold is out of range');
    if (!Array.isArray(p.updates) || !p.updates.length) no('it changes nothing');
    const circuits = new Set();
    for (const [i, u] of p.updates.entries()) {
        if (u.op === 'insertVerifierKey' || u.op === 'removeVerifierKey') {
            if (!/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(u.circuit ?? '')) no(`update ${i}: circuit name ${u.circuit}`);
            if (!['v3', 'v4'].includes(u.version)) no(`update ${i}: version ${u.version}`);
            const key = `${u.circuit}/${u.version}`;
            if (circuits.has(key)) no(`update ${i}: ${key} appears twice`);
            circuits.add(key);
        }
        if (u.op === 'insertVerifierKey') {
            if (!HEX.test(u.vkHex ?? '') || !u.vkHex.length || u.vkHex.length % 2) no(`update ${i}: vkHex is not hex`);
            if (sha256(hexBytes(u.vkHex)) !== u.vkSha256) no(`update ${i}: ${u.circuit} key bytes do not match vkSha256`);
        } else if (u.op === 'replaceAuthority') {
            if (!Array.isArray(u.committee) || u.committee.length < 1) no(`update ${i}: empty committee`);
            if (!Number.isInteger(u.threshold) || u.threshold < 1 || u.threshold > u.committee.length) no(`update ${i}: threshold out of range`);
            if (new Set(u.committee.map((k) => k.value)).size !== u.committee.length) no(`update ${i}: a key is listed twice`);
        } else if (u.op !== 'removeVerifierKey') {
            no(`update ${i}: unknown op ${u.op}`);
        }
    }
    return true;
}

/** The ledger update the proposal describes, rebuilt from its parts. Unsigned. */
export function buildUpdate(p) {
    validateProposal(p);
    const counter = BigInt(p.counter);
    const singles = p.updates.map((u) => {
        if (u.op === 'insertVerifierKey') {
            return new VerifierKeyInsert(u.circuit, new ContractOperationVersionedVerifierKey(u.version, hexBytes(u.vkHex)));
        }
        if (u.op === 'removeVerifierKey') return new VerifierKeyRemove(u.circuit, new ContractOperationVersion(u.version));
        return new ReplaceAuthority(new ContractMaintenanceAuthority(u.committee, u.threshold, counter + 1n));
    });
    return new MaintenanceUpdate(p.contractAddress, singles, counter);
}

/** SHA-256 of what every signature is over: a fingerprint to compare out of band. */
export function fingerprint(p) {
    return sha256(buildUpdate(p).dataToSign);
}

/** One line per instruction, for a member to read before signing. */
export function describe(p) {
    const lines = [
        `contract ${p.contractAddress} on ${p.network}`,
        `valid against authority counter ${p.counter} (threshold ${p.authority.threshold} of ${p.authority.committee.length})`
    ];
    for (const u of p.updates) {
        if (u.op === 'insertVerifierKey') lines.push(`  insert verifier key  ${u.circuit} (${u.version}), ${u.vkHex.length / 2} bytes, sha256 ${u.vkSha256}`);
        else if (u.op === 'removeVerifierKey') lines.push(`  remove verifier key  ${u.circuit} (${u.version})`);
        else lines.push(`  replace authority    ${u.threshold} of ${u.committee.length}: ${u.committee.map((k) => `${k.tag} ${k.value.slice(0, 12)}...`).join(', ')}`);
    }
    lines.push(`fingerprint ${fingerprint(p)}`);
    return lines.join('\n');
}

/**
 * Sign as one member. The member's index is found by their verifying key, so
 * a key that is not on the committee cannot sign. Returns a new proposal with
 * the signature added (replacing any earlier one from the same member).
 */
export function signProposal(p, signingKey, member = undefined) {
    const vk = signatureVerifyingKey(signingKey);
    const index = p.authority.committee.findIndex((k) => sameKey(k, vk));
    if (index < 0) throw new Error('this key is not a member of the authority the proposal was made against');
    const update = buildUpdate(p);
    const signature = signData(signingKey, update.dataToSign);
    if (!verifySignature(vk, update.dataToSign, signature)) throw new Error('the signature does not verify; refusing to record it');
    const entry = { index, ...(member ? { member } : {}), signature, signedAt: new Date().toISOString() };
    return { ...p, signatures: [...p.signatures.filter((s) => s.index !== index), entry].sort((a, b) => a.index - b.index) };
}

/**
 * Which recorded signatures verify, against the proposal's own committee and
 * its rebuilt update. Invalid ones are reported, not silently dropped.
 */
export function checkSignatures(p) {
    const data = buildUpdate(p).dataToSign;
    const valid = [];
    const invalid = [];
    const seen = new Set();
    for (const s of p.signatures ?? []) {
        const vk = p.authority.committee[s.index];
        if (!vk) { invalid.push({ ...s, why: 'no member at that index' }); continue; }
        if (seen.has(s.index)) { invalid.push({ ...s, why: 'a second signature from the same member' }); continue; }
        if (!verifySignature(vk, data, s.signature)) { invalid.push({ ...s, why: 'does not verify over this proposal' }); continue; }
        seen.add(s.index);
        valid.push(s);
    }
    return { valid, invalid, enough: valid.length >= p.authority.threshold, threshold: p.authority.threshold };
}

/**
 * The signed update, ready for an intent. Refuses below threshold, and when
 * the chain's authority is no longer the one the proposal was made against.
 */
export function signedUpdate(p, chainAuthority = undefined) {
    if (chainAuthority) {
        if (String(chainAuthority.counter) !== p.counter) {
            throw new Error(`the chain's authority counter is ${chainAuthority.counter}, the proposal was made against ${p.counter}: make a new proposal`);
        }
        const same = chainAuthority.threshold === p.authority.threshold
            && chainAuthority.committee.length === p.authority.committee.length
            && chainAuthority.committee.every((k, i) => sameKey(k, p.authority.committee[i]));
        if (!same) throw new Error('the chain\'s committee is not the one the proposal was made against');
    }
    const { valid, enough, threshold } = checkSignatures(p);
    if (!enough) throw new Error(`${valid.length} valid signature(s), ${threshold} needed`);
    let update = buildUpdate(p);
    for (const s of valid.slice(0, threshold)) update = update.addSignature(BigInt(s.index), s.signature);
    return update;
}
