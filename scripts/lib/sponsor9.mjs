/**
 * Contract calls paid by a NIGHTGATE fee sponsor (DECISIONS D37).
 *
 *   const sponsor = await openSponsor('preprod', { log });   // null when not configured
 *   const r = await sponsor.call({ contractAddress, call, witnesses, idempotencyKey });
 *   await sponsor.close();
 *
 * Each call, and each deploy step or maintenance update, is built, proven and signed here with @odatano/nightgate-tx and
 * handed over without a fee. The sponsor adds its DUST spend, binds and
 * submits. It sees no witness, no value and no salt: those stay in this
 * process, exactly as with a self-paid call.
 *
 * WHEN THE OWN WALLET MAY PAY INSTEAD. Only when the call cannot have changed
 * the contract: the build failed before anything was sent, the server refused
 * the start with an answer, the job failed, or the call failed in its block. A start without an answer, or a job
 * the server has to reconcile, may still land, so the run stops there with
 * `outcome: 'unknown'` rather than send a second transaction.
 *
 * Configuration, per network, from the environment or
 * `_local-tracking/NIGHTGATE.<network>.env`:
 *   VINPASSPORT_NIGHTGATE_URL     the server, for example https://api.preprod.odatano.dev
 *   VINPASSPORT_NIGHTGATE_TOKEN   an agent token (ngat_...) or a gateway key (oda_...)
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { connect, NightgateApiError, NightgateJobError } from '@odatano/nightgate-tx';
import { createTxBuilder, waitLanded } from '@odatano/nightgate-tx/txbuilder';
import { ContractDeploy, MaintenanceUpdate } from '@midnightntwrk/ledger-v9';
import { Contract } from '../../contracts/vinpassport/src/managed/vinpassport/contract/index.js';
import { guardLogs } from './endpoints.mjs';
import { credentialPath } from './local-credentials.mjs';
import { BUILD_DIR } from './contract9.mjs';

const LANDED_WAIT_MS = 5 * 60_000;

/** The server and token for `network`, or null when none is configured. */
export function nightgateConfig(network, { env = process.env, file = credentialPath(`NIGHTGATE.${network}.env`) } = {}) {
    const lines = existsSync(file) ? readFileSync(file, 'utf8').split(/\r?\n/) : [];
    const read = (name) => env[name]?.trim() || lines.find((l) => l.startsWith(`${name}=`))?.slice(name.length + 1).trim() || '';
    const baseUrl = read('VINPASSPORT_NIGHTGATE_URL');
    const token = read('VINPASSPORT_NIGHTGATE_TOKEN');
    if (!baseUrl && !token) return null;
    if (!baseUrl || !token) throw new Error('VINPASSPORT_NIGHTGATE_URL and VINPASSPORT_NIGHTGATE_TOKEN go together: set both or neither');
    if (!/^https:\/\//.test(baseUrl) && !/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(baseUrl)) {
        throw new Error(`VINPASSPORT_NIGHTGATE_URL must be https (or a loopback http address): ${baseUrl}`);
    }
    guardLogs({ alsoRedact: [token] });
    return { baseUrl: baseUrl.replace(/\/+$/, ''), ...(token.startsWith('ngat_') ? { agentToken: token } : { token }) };
}

/**
 * What a failed sponsored call means for the chain.
 *   'not-applied'  the call cannot have changed the contract, so the own wallet may pay instead;
 *   'unknown'   it may still land, so nothing else may be sent for this call.
 */
export function failureOutcome(err) {
    if (err?.stage === 'build') return 'not-applied';
    if (err instanceof NightgateJobError) return err.job?.status === 'failed' ? 'not-applied' : 'unknown';
    if (err instanceof NightgateApiError && err.status && err.status !== 409) return 'not-applied';
    return 'unknown';
}

/** The one action of a deploy step or maintenance update this process built: a deploy or an update, nothing else. */
export function preparedAction(tx) {
    const actions = [...tx.intents.values()].flatMap((intent) => intent.actions);
    if (actions.length !== 1) throw new Error(`a sponsored deploy step or update carries one action, this one ${actions.length}`);
    const [action] = actions;
    if (action instanceof ContractDeploy) return { kind: 'deploy', action };
    if (action instanceof MaintenanceUpdate) return { kind: 'update', action };
    throw new Error(`a sponsored step is a deploy or a maintenance update, not ${action?.constructor?.name ?? typeof action}`);
}

/** A sponsor for `network`, or null when no NIGHTGATE is configured. */
export async function openSponsor(network, { log = () => { }, config = nightgateConfig(network), contractClass = Contract, zkConfigDir = BUILD_DIR } = {}) {
    if (!config) return null;
    const ng = connect(config);
    // The builder's own wallet never pays and holds nothing: the calls move no
    // coins and the contract knows its callers by their registrar secrets.
    const seedHex = randomBytes(64).toString('hex');
    const builder = await createTxBuilder({
        seedHex, networkId: network, api: config, walletSync: false,
        contractClass, contractName: 'vinpassport', zkConfigDir
    });
    log(`fees paid by the NIGHTGATE sponsor at ${config.baseUrl}`);
    return {
        baseUrl: config.baseUrl,
        /**
         * Build one call and have the sponsor pay and submit it. Resolves with
         * the transaction once it is in a block; rejects with `outcome` set.
         */
        async call({ contractAddress, call, witnesses, idempotencyKey }) {
            let built;
            try {
                built = await builder.buildSponsorable({ contractAddress, call, witnesses, bind: false });
            } catch (e) {
                throw Object.assign(e, { stage: 'build', outcome: 'not-applied' });
            }
            return handOver(built, idempotencyKey);
        },
        /**
         * Have the sponsor pay a deploy or a signed maintenance update this
         * process built itself, as the one action of `tx` (an unproven
         * ledger transaction). Resolves with the transaction once it is in a block.
         */
        async prepared({ tx, idempotencyKey }) {
            let built;
            try {
                const { kind, action } = preparedAction(tx);
                built = kind === 'deploy'
                    ? await builder.buildDeploySponsorable({ deploy: action, bind: false })
                    : await builder.buildMaintenanceSponsorable({ update: action, bind: false });
            } catch (e) {
                throw Object.assign(e, { stage: 'build', outcome: 'not-applied' });
            }
            return handOver(built, idempotencyKey);
        },
        close: () => builder.close()
    };

    async function handOver(built, idempotencyKey) {
        let job;
        try {
            job = await ng.sponsorUnbound({ unboundTxB64: built.unboundTxB64, idempotencyKey });
        } catch (e) {
            throw Object.assign(e, { stage: 'sponsor', outcome: failureOutcome(e) });
        }
        if (!job.txId) throw Object.assign(new Error(`sponsor job ${job.jobId} succeeded without a transaction id`), { outcome: 'unknown' });
        let blockHeight = job.blockHeight;
        if (blockHeight == null) {
            const landed = await waitLanded(job.txId, { api: config, timeoutMs: LANDED_WAIT_MS });
            if (!landed) throw Object.assign(new Error(`transaction ${job.txId} is not in a block after ${LANDED_WAIT_MS / 60_000} min`), { outcome: 'unknown', txId: job.txId });
            if (!landed.applied) throw Object.assign(new Error(`transaction ${job.txId} is in block ${landed.height} but failed`), { outcome: 'not-applied', txId: job.txId });
            blockHeight = landed.height;
        }
        return { txId: job.txId, txHash: job.txHash, blockHeight, jobId: job.jobId, bytes: built.serializedBytes };
    }
}
