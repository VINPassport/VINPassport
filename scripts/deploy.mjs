#!/usr/bin/env node
/**
 * Deploy VINPassport on ledger 9 (Preview, later mainnet) with Midnight.js 5.
 *
 *   node scripts/deploy.mjs --network preview             dry run: build the deploy, estimate
 *                                                         its fee from live parameters, submit nothing
 *   node scripts/deploy.mjs --network preview --submit    deploy, paying the fee from our own DUST
 *   ... --submit --redeploy                               replace an existing record (archived, not lost)
 *
 * What a deploy fixes for the contract's lifetime, printed before anything is
 * built so it can be read first:
 *   - the initial registrar allowlist (constructor argument; afterwards it changes
 *     only when two current registrars approve, `scripts/govern.mjs`, D32);
 *   - the verifier keys of this build (pinned in the record by hash, with the
 *     integrity manifest's own hash);
 *   - the maintenance authority: the custody key, at threshold 1, until
 *     `scripts/maintenance.mjs handover` replaces it with the 2-of-3 committee
 *     (DECISIONS D28). Midnight.js registers a single key at deploy; the
 *     ledger accepts a committee only through a later ReplaceAuthority.
 *
 * Proving is in this process (zkir-v3), the fee is paid in DUST by the deploy
 * wallet (`scripts/dust.mjs` registers its NIGHT), and nothing here needs a
 * sponsor or a credential: Preview's endpoints are open.
 *
 * The ledger 8 deploy (`deploy-preprod.mjs`, sponsored through nightgate-tx)
 * is at the git tag ledger8-preprod.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { deployContract, createLedger9UnprovenDeployTx } from '@midnight-ntwrk/midnight-js-contracts';
import { BUILD } from './lib/eras.mjs';
import { networkEndpoints } from './lib/endpoints.mjs';
import { openWallet, describe, summarize } from './lib/wallet9.mjs';
import {
    buildFacts, compiledContract, refusingWitnesses, contractProviders, custodyKey, recordPath, PROVABLE
} from './lib/contract9.mjs';
import { buildId } from './lib/build-id.mjs';
import { readRegistrarSlots, REGISTRAR_ROLES } from './lib/registrar-slots.mjs';
import { loadVinKeys } from './lib/vin-key.mjs';
import { credentialPath } from './lib/local-credentials.mjs';

const arg = (flag) => {
    const i = process.argv.indexOf(flag);
    return i === -1 ? undefined : process.argv[i + 1];
};
const log = (...a) => console.log(...a);
const fail = (msg) => { console.error(`\nSTOP: ${msg}`); process.exit(1); };

const NETWORK = arg('--network');
if (!NETWORK) fail('name the network: --network preview | mainnet');
const SUBMIT = process.argv.includes('--submit');
const REDEPLOY = process.argv.includes('--redeploy');
const RECORD = recordPath(NETWORK);

// ---------------------------------------------------------------- preflight
// Everything that can refuse without a wallet refuses before one is opened.
let facts;
try { facts = buildFacts(); } catch (e) { fail(e.message); }
if (facts.compiler !== BUILD.compiler || facts.runtime !== BUILD.runtime) {
    fail(`the build on disk is compiler ${facts.compiler} / runtime ${facts.runtime}; this branch expects ${BUILD.compiler} / ${BUILD.runtime}.`);
}
if (existsSync(RECORD) && SUBMIT && !REDEPLOY) {
    fail(`${RECORD} exists: a contract is already deployed on ${NETWORK}. A redeploy starts an EMPTY ledger. `
        + 'Pass --redeploy as well if that is intended; the old record is archived, not lost.');
}
if (NETWORK === 'mainnet' && SUBMIT) {
    // A public ledger cannot unpublish: the first write must already be keyed.
    try { loadVinKeys('mainnet'); } catch (e) { fail(`mainnet needs its vin key before a contract exists. ${e.message}`); }
}
const secrets = credentialPath(NETWORK === 'mainnet' ? 'REGISTRAR-SECRETS.mainnet.env' : 'REGISTRAR-SECRETS.env');
let regs, slots;
try { ({ regs, slots } = readRegistrarSlots(secrets)); } catch (e) { fail(e.message); }
let custody;
try { custody = custodyKey(NETWORK, { create: SUBMIT || NETWORK !== 'mainnet' }); } catch (e) { fail(e.message); }

log(`network    ${NETWORK} (${networkEndpoints(NETWORK).nodeWsUrl})`);
log(`build      compactc ${facts.compiler}, runtime ${facts.runtime}, build id ${buildId()}, manifest ${facts.manifestSha256.slice(0, 16)}`);
log(`circuits   ${PROVABLE.length} with keys: ${PROVABLE.join(', ')}`);
for (const r of regs) log(`registrar  ${r.label} ${r.hex}  (${REGISTRAR_ROLES[r.label]})`);
log('           this list is fixed for the contract\'s lifetime');
log(`authority  custody key ${custody.verifyingKey.value.slice(0, 16)}... (threshold 1) until handed to the committee`);
log(`mode       ${SUBMIT ? 'SUBMIT: deploys and pays the fee in DUST' : 'dry run: builds and estimates, submits nothing'}\n`);

// ---------------------------------------------------------------- wallet
const w = await openWallet(NETWORK, { log });
let code = 0;
try {
    const state = await w.synced();
    log(describe(state));
    const providers = await contractProviders(w, state, { log });
    const compiled = compiledContract(refusingWitnesses());
    const s = summarize(state);

    if (!SUBMIT) {
        const unproven = await createLedger9UnprovenDeployTx(providers, {
            compiledContract: compiled, args: [slots], signingKey: custody.key
        });
        const bytes = unproven.private.unprovenTx.serialize();
        const handle = w.wallet.adoptTransaction(bytes, 'Unproven');
        // The full estimate simulates the balancing transaction, which needs
        // DUST to spend; without any, report the deploy's own fee and say so.
        let fee, scope = 'deploy plus balancing';
        try { fee = await w.wallet.estimateTransactionFee(handle); } catch {
            fee = await w.wallet.calculateTransactionFee(handle);
            scope = 'deploy only; balancing adds a little';
        }
        log(`\ndeploy transaction  ${bytes.length} bytes unproven`);
        log(`example address     ${unproven.public.contractAddress} (a real deploy gets its own)`);
        log(`estimated fee       ${fee} SPECK (${(Number(fee) / 1e15).toFixed(6)} DUST), ${scope}, live parameters`);
        log(`DUST available      ${s.dust} SPECK`);
        if (s.dust < fee) {
            log('\nNot enough DUST yet. Register the NIGHT and let it generate:');
            log(`  node scripts/dust.mjs --network ${NETWORK} --register`);
            code = 2;
        } else {
            log('\nDry run complete: enough DUST. Re-run with --submit to deploy.');
        }
    } else {
        log('\nbuilding, balancing and submitting the deploy...');
        const t0 = Date.now();
        const deployed = await deployContract(providers, {
            compiledContract: compiled, args: [slots], signingKey: custody.key
        });
        const pub = deployed.deployTxData.public;
        log(`\nDEPLOYED   ${pub.contractAddress}`);
        log(`tx hash    ${pub.txHash}  block ${pub.blockHeight}`);
        log(`fees       paid ${pub.fees?.paidFees ?? '?'} SPECK (estimated ${pub.fees?.estimatedFees ?? '?'})`);
        log(`took       ${Math.round((Date.now() - t0) / 1000)} s`);
        writeRecord({
            network: NETWORK,
            contract: 'vinpassport',
            contractAddress: pub.contractAddress,
            txHash: pub.txHash,
            txId: pub.txId,
            blockHeight: pub.blockHeight,
            deployedAt: new Date(pub.blockTimestamp ?? Date.now()).toISOString(),
            fees: pub.fees ?? null,
            ledger: BUILD.ledger,
            buildId: buildId(),
            build: facts,
            registrars: regs.map((r) => ({ label: r.label, id: r.hex })),
            authority: {
                holder: 'custody',
                threshold: 1,
                counter: 0,
                committee: [custody.verifyingKey],
                note: 'Custody key until `scripts/maintenance.mjs handover` replaces it with the committee (DECISIONS D28).'
            },
            note: 'Public record of the deployment. Address, hashes and verifying keys are public by definition. '
                + 'build.manifestSha256 pins the compiler integrity manifest; build.verifierKeys are the SHA-256 '
                + 'hashes of the verifier keys this address holds.'
        });
        log(`recorded   ${RECORD}`);
    }
} catch (e) {
    console.error(`\ndeploy: ${e?.message ?? e}`);
    if (e?.code) console.error(`code: ${e.code}`);
    code = 1;
} finally {
    await w.close();
}
process.exit(code);

function writeRecord(record) {
    mkdirSync(dirname(RECORD), { recursive: true });
    if (existsSync(RECORD)) {
        const archived = join(dirname(RECORD), `${NETWORK}-superseded-${Date.now()}.json`);
        renameSync(RECORD, archived);
        log(`archived the previous record to ${archived}`);
    }
    writeFileSync(RECORD, JSON.stringify(record, null, 2) + '\n');
}
