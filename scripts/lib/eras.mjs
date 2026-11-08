/**
 * Which ledger each network runs, and what this tree builds for it.
 *
 * WHY THIS EXISTS. Midnight moves networks to a new ledger one at a time, and
 * a contract built for one ledger cannot be deployed on another: Midnight.js 5
 * refuses it before proving (`EraMismatchError`). On 8 Nov 2026 the networks
 * stood like this:
 *
 *   mainnet   ledger 9 since 6 Nov 2026
 *   preview   ledger 9, relaunched as a new chain on 7 Nov 2026
 *   preprod   ledger 8 until a later upgrade, no date announced
 *
 * Source: https://docs.midnight.network/relnotes/ledger/ledger-9-1-0-1
 *
 * This tree builds for ledger 9 only. The ledger 8 build, the nightgate-tx
 * runner and the preprod deployment they made are frozen at the git tag
 * `ledger8-preprod`; running a 0.31.1 contract next to a 0.36.0 one needs two
 * runtime copies in one install, for which Midnight.js has "no official
 * recipe for this yet" (v5.0.0 migration guide, Dependencies of a ledger 8
 * contract).
 *
 * THE NEXT UPGRADE is a change here: a new BUILD row, and a network's
 * `ledger` moved on when Midnight moves it. When preprod reaches ledger 9,
 * set it to 'v9' and this tree deploys there too.
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
    preprod: 'v8',
    mainnet: 'v9'
});

const FROZEN = 'The ledger 8 build and its tooling are at the git tag ledger8-preprod.';

/**
 * Throw unless this tree's build can deploy to and transact on `network`.
 * Called before anything connects, so a wrong network fails in a sentence
 * rather than after a wallet sync and a proof.
 */
export function requireBuildableNetwork(network) {
    checkNetwork(network);
    const ledger = NETWORK_LEDGER[network];
    if (ledger !== BUILD.ledger) {
        throw new Error(
            `${network} runs ledger ${ledger.slice(1)}, and this tree builds for ledger ${BUILD.ledger.slice(1)} `
            + `(Compact ${BUILD.compiler}). ${FROZEN}`
        );
    }
    return network;
}

/** The networks this tree can deploy to, in the order a run should prefer them. */
export const BUILDABLE = Object.freeze(Object.keys(NETWORK_LEDGER).filter((n) => NETWORK_LEDGER[n] === BUILD.ledger));
