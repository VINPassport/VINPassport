/**
 * Which ledger each network runs, and what this tree builds for it.
 *
 * WHY THIS EXISTS. Midnight moves networks to a new ledger one at a time, and
 * a contract built for one ledger cannot be deployed on another: Midnight.js 5
 * refuses it before proving (`EraMismatchError`). On 10 Nov 2026 the networks
 * stood like this:
 *
 *   mainnet   ledger 9 since 6 Nov 2026
 *   preview   ledger 9, relaunched as a new chain on 7 Nov 2026
 *   preprod   ledger 9 since 9 Nov 2026, block 3348434 (12:04:12 UTC), where the
 *             node's runtime specVersion moves from 1000300 to 2001100, the
 *             version Preview runs; read from the preprod node on 10 Nov
 *
 * Source: https://docs.midnight.network/relnotes/ledger/ledger-9-1-0-1
 *
 * Preprod's ledger 8 contract of 1 Nov 2026 is still served by the indexer
 * after the fork, with its state written by ledger 8, so this build refuses to
 * read it (scripts/lib/chain-state.mjs) and deploy/preprod.json stays the
 * ledger 8 record until a ledger 9 deploy supersedes it.
 *
 * This tree builds for ledger 9 only. The ledger 8 build, the nightgate-tx
 * runner and the preprod deployment they made are frozen at the git tag
 * `ledger8-preprod`; running a 0.31.1 contract next to a 0.36.0 one needs two
 * runtime copies in one install, for which Midnight.js has "no official
 * recipe for this yet" (v5.0.0 migration guide, Dependencies of a ledger 8
 * contract).
 *
 * THE NEXT UPGRADE is a change here: a new BUILD row, and a network's
 * `ledger` moved on when Midnight moves it, read from the chain rather than
 * assumed from an announcement.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { checkNetwork } from './endpoints.mjs';

/** What `npm run compile` produces, and what the runtime and SDK must match. */
export const BUILD = Object.freeze({
    ledger: 'v9',
    compiler: '0.36.0',
    language: '0.28.0',
    runtime: '0.21.0',
    midnightJs: '5.0.0',
    walletSdk: '2.0.0'
});

/** The ledger each network runs today. */
export const NETWORK_LEDGER = Object.freeze({
    preview: 'v9',
    preprod: 'v9',
    mainnet: 'v9'
});

const FROZEN = 'The ledger 8 build and its tooling are at the git tag ledger8-preprod.';

/**
 * Throw unless this tree's build can deploy to and transact on `network`.
 * Called before anything connects, so a wrong network fails in a sentence
 * rather than after a wallet sync and a proof.
 */
export function requireBuildableNetwork(network, table = NETWORK_LEDGER) {
    checkNetwork(network);
    const ledger = table[network];
    if (ledger !== BUILD.ledger) {
        throw new Error(
            `${network} runs ledger ${ledger.slice(1)}, and this tree builds for ledger ${BUILD.ledger.slice(1)} `
            + `(Compact ${BUILD.compiler}). ${FROZEN}`
        );
    }
    return network;
}

/**
 * Throw unless a deploy record was written by this build's ledger. Ledger 9
 * records carry `ledger: 'v9'`; the ledger 8 records (preprod, 1 Nov 2026 and
 * before) carry none, so a network that moved to ledger 9 does not make its old
 * record look like a contract this build can call.
 */
export function requireRecordLedger(record, path) {
    const ledger = record?.ledger ?? 'v8';
    if (ledger !== BUILD.ledger) {
        throw new Error(`${path} records a ledger ${ledger.slice(1)} deployment, and this tree calls ledger `
            + `${BUILD.ledger.slice(1)} contracts only. Deploy this build there first (scripts/deploy.mjs --redeploy keeps `
            + `the old record as superseded). ${FROZEN}`);
    }
    return record;
}

/** The networks this tree can deploy to, in the order a run should prefer them. */
export const BUILDABLE = Object.freeze(Object.keys(NETWORK_LEDGER).filter((n) => NETWORK_LEDGER[n] === BUILD.ledger));
