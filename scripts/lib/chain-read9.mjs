/**
 * Chain reads for deploy, maintenance and governance (DECISIONS D37).
 *
 *   const reads = chainReads('preprod');   // through NIGHTGATE when one is configured
 *   const state = await reads.contractState(address);
 *
 * With a NIGHTGATE server configured (`scripts/lib/sponsor9.mjs`) every read
 * goes to that server, so a sponsored run needs no Blockfrost project id and
 * no synced wallet. Without one the public indexer answers, as before.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { ContractState, LedgerParameters } from '@midnightntwrk/ledger-v9';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { ledgerVersionOfContractState } from '@midnight-ntwrk/midnight-js-utils';
import { connect } from '@odatano/nightgate-tx';
import { waitLanded } from '@odatano/nightgate-tx/txbuilder';
import { networkEndpoints } from './endpoints.mjs';
import { liveLedgerParameters, waitForTransaction } from './deploy-fit.mjs';
import { nightgateConfig } from './sponsor9.mjs';

const LEDGER8 = 'The ledger 8 readback is at the git tag ledger8-preprod.';

/** The contract's state as a ledger 9 state, plus its serialized bytes. */
function decoded(bytes, era) {
    if (era !== 'v9') throw new Error(`the contract's state was written by ledger ${era}; this build reads ledger 9 only. ${LEDGER8}`);
    return { state: ContractState.deserialize(bytes), bytes };
}

export function chainReads(network, { config = nightgateConfig(network) } = {}) {
    return config ? nightgateReads(config) : indexerReads(network);
}

function nightgateReads(config) {
    const ng = connect(config);
    const read = async (address) => {
        try {
            return await ng.contractStateAt({ contractAddress: address });
        } catch (e) {
            // 503 and 429: the server's indexer is behind or busy. A poll asks again.
            if (e?.status === 503 || e?.status === 429) return null;
            throw e;
        }
    };
    return {
        source: `NIGHTGATE at ${config.baseUrl}`,

        async contractState(address) {
            const snap = await read(address);
            if (!snap?.state) return null;
            const bytes = Buffer.from(snap.state, 'base64');
            return decoded(bytes, ledgerVersionOfContractState(bytes));
        },

        async ledgerParameters() {
            const snap = await ng.ledgerParametersAt();
            if (!snap) throw new Error(`the NIGHTGATE server at ${config.baseUrl} knows no ledger parameters at the chain tip`);
            return { height: Number(snap.chainHeight), params: LedgerParameters.deserialize(Buffer.from(snap.ledgerParameters, 'base64')) };
        },

        async waitForTransaction(id, { minutes = 5 } = {}) {
            const landed = await waitLanded(id, { api: ng, timeoutMs: minutes * 60_000 });
            if (!landed) throw new Error(`transaction ${id} not indexed by the NIGHTGATE server after ${minutes} minutes`);
            return { txId: id, txHash: landed.txHash ?? null, blockHeight: Number(landed.height), status: landed.status, fees: null };
        },

        // What the grant behind the token used so far. A failed read only loses the line.
        async sponsorUsage() {
            const u = await ng.getGrantUsage().catch((e) => ({ error: e?.message ?? String(e) }));
            if (u.error) return `grant usage not readable: ${u.error}`;
            const of = (used, max) => `${used ?? 0}${max == null ? '' : ` of ${max}`}`;
            return `${of(u.deploysUsed, u.maxDeploys)} deploys, ${of(u.maintenanceUpdatesUsed, u.maxMaintenanceUpdates)} maintenance updates, ${u.dustPaid ?? '?'} SPECK paid`;
        },

        async deployOf(address) {
            const d = await ng.contractDeploy(address);
            if (!d) throw new Error(`the NIGHTGATE server has no deploy of ${address}`);
            return {
                txId: d.txId ?? null, txHash: d.txHash, blockHeight: d.blockHeight,
                blockTimestamp: d.blockTimestamp, status: d.status, fees: null
            };
        }
    };
}

function indexerReads(network) {
    const ep = networkEndpoints(network);
    const query = async (q) => {
        const res = await fetch(ep.indexerHttpUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: q }) });
        return (await res.json())?.data;
    };
    return {
        source: 'the public indexer',

        async contractState(address) {
            const pdp = indexerPublicDataProvider({ queryURL: ep.indexerHttpUrl, subscriptionURL: ep.indexerWsUrl });
            const r = await pdp.queryContractState(address).catch(() => null);
            return r ? decoded(Buffer.from(r.contractState.serialize()), r.contractState.era) : null;
        },

        ledgerParameters: () => liveLedgerParameters(network),

        waitForTransaction: (id, opts) => waitForTransaction(network, id, opts),

        sponsorUsage: async () => null,

        async deployOf(address) {
            const act = (await query(`{ contractAction(address: "${address}") { __typename ... on ContractDeploy { transaction { hash block { height timestamp } `
                + 'contractActions { address } ... on RegularTransaction { identifiers fees { estimatedFees paidFees } transactionResult { status } } } } } }'))?.contractAction;
            if (act?.__typename !== 'ContractDeploy') {
                throw new Error(`the contract's latest action is ${act?.__typename ?? 'unknown'}, not its deploy; resume expects nothing after the deploy`);
            }
            const t = act.transaction;
            return {
                // The id at the index of this contract's action, as Midnight.js correlates it.
                txId: t.identifiers?.[(t.contractActions ?? []).findIndex((x) => x.address === address)] ?? null,
                txHash: t.hash, blockHeight: t.block.height, blockTimestamp: t.block.timestamp,
                status: t.transactionResult?.status ?? null,
                fees: t.fees ? { estimatedFees: String(t.fees.estimatedFees), paidFees: String(t.fees.paidFees) } : null
            };
        }
    };
}
