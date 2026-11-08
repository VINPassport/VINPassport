/**
 * Read the deployed contract's public state, as anyone can, era-aware.
 *
 * Midnight.js 5 hands back a state as the bytes the ledger wrote, tagged with
 * the era of the ledger that wrote them, and the caller decodes it with its
 * own runtime (`read.contractState.deserialize({ v9: ContractState })`). This
 * build carries the ledger 9 runtime only, so a ledger 8 state (the preprod
 * contract) is refused by name, with the place its tooling lives, instead of
 * being misread.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, existsSync } from 'node:fs';
import { ContractState } from '@midnight-ntwrk/compact-runtime';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { ledger } from '../../contracts/vinpassport/src/managed/vinpassport/contract/index.js';
import { networkEndpoints } from './endpoints.mjs';
import { requireBuildableNetwork } from './eras.mjs';
import { recordPath } from './contract9.mjs';

/** The deploy record for a network this build serves. */
export function deployRecord(network) {
    requireBuildableNetwork(network);
    const path = recordPath(network);
    if (!existsSync(path)) throw new Error(`no deploy record at ${path}`);
    return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * The contract's state now: decoded ledger, raw bytes (for absence checks),
 * and the latest action, from the public indexer.
 */
export async function readContract(network, address) {
    const ep = networkEndpoints(network);
    const pdp = indexerPublicDataProvider({ queryURL: ep.indexerHttpUrl, subscriptionURL: ep.indexerWsUrl });
    const read = await pdp.queryContractState(address);
    if (!read) throw new Error(`the ${network} indexer has no contract at ${address}`);
    const era = read.contractState.era;
    if (era !== 'v9') {
        throw new Error(`the contract's state was written by ledger ${era}; this build reads ledger 9 only. `
            + 'The ledger 8 readback is at the git tag ledger8-preprod.');
    }
    const bytes = Buffer.from(read.contractState.serialize());
    const state = read.contractState.deserialize({ v9: ContractState });

    // The latest action, for the block and transaction a reader can look up.
    const res = await fetch(ep.indexerHttpUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: `{ contractAction(address: "${address}") { __typename transaction { hash block { height } } } }` })
    });
    const action = (await res.json())?.data?.contractAction;
    return {
        era,
        bytes,
        ledger: ledger(state.data),
        latest: {
            kind: action?.__typename ?? null,
            txHash: action?.transaction?.hash ?? null,
            blockHeight: action?.transaction?.block?.height ?? null
        }
    };
}
