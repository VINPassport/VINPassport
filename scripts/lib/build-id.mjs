/**
 * Which build of the contract is this, and is it the one on chain?
 *
 * A circuit's verifier key is fixed at deployment. Change the contract, and
 * calls built from the new circuits are rejected by a node that is still
 * holding the old keys. The rejection says nothing useful: it looks like a
 * proving failure, or a malformed transaction, or bad luck.
 *
 * So the deploy record carries the fingerprint of the build it put on chain,
 * and anything about to submit compares. The comparison is cheap, it runs
 * before a fee is spent, and it turns a confusing network error into one
 * sentence.
 *
 * The fingerprint covers the compiled artefacts rather than the source,
 * because the artefacts are what the chain verifies: a compiler upgrade that
 * leaves the source untouched still produces a different contract. Compact
 * builds reproducibly, so the same source and the same compiler give the same
 * fingerprint on any machine.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const MANAGED = join(ROOT, 'contracts', 'vinpassport', 'src', 'managed', 'vinpassport');

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');

/**
 * The files that decide what a node will accept: the compiled contract and
 * every circuit's binary intermediate representation. Prover and verifier keys
 * are deliberately not committed, so they are not part of this.
 */
export function buildFiles(managed = MANAGED) {
    const files = [['contract/index.js', join(managed, 'contract', 'index.js')]];
    const zkir = join(managed, 'zkir');
    if (existsSync(zkir)) {
        for (const name of readdirSync(zkir).sort()) {
            if (name.endsWith('.bzkir')) files.push([`zkir/${name}`, join(zkir, name)]);
        }
    }
    return files;
}

/**
 * @returns {string} 16 hex characters: enough to identify a build in an error
 *   message, and short enough to read out loud.
 */
export function buildId(managed = MANAGED) {
    const lines = buildFiles(managed).map(([name, path]) => `${name} ${sha(readFileSync(path))}`);
    if (lines.length < 2) throw new Error('no compiled contract found; run npm run compile');
    return sha(lines.join('\n')).slice(0, 16);
}

/**
 * Compare this build against what a deploy record says is on chain.
 *
 * @param {{buildId?: string, contractAddress: string}} record
 * @returns {{ok: true} | {ok: false, reason: string}}
 */
export function matchesDeployed(record) {
    const here = buildId();
    if (!record.buildId) {
        // An older record from before this check existed. Say so rather than
        // passing silently, because silence here is the thing being fixed.
        return {
            ok: false,
            reason: `the deploy record carries no buildId, so this cannot be checked. `
                + `The local build is ${here}. Re-record the deployment, or deploy.`,
        };
    }
    if (record.buildId === here) return { ok: true };
    return {
        ok: false,
        reason: `the contract in this working tree is not the one at `
            + `${record.contractAddress.slice(0, 12)}...\n`
            + `   on chain: ${record.buildId}\n`
            + `   here:     ${here}\n`
            + `A circuit's verifier key is fixed when it is deployed, so calls built from this\n`
            + `build would be rejected. Deploy this contract, or check out the commit that\n`
            + `matches the address.`,
    };
}
