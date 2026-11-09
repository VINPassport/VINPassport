#!/usr/bin/env node
/**
 * The listing demo on a chain (build plan 2.5, DECISIONS D33): a second
 * contract that lists a vehicle only if VINPassport holds a current claim for
 * it, asked through a cross-contract call in the same transaction.
 *
 *   node scripts/listing.mjs deploy --network preview            dry run
 *   node scripts/listing.mjs deploy --network preview --submit   deploy, trusting deploy/<network>.json's contract
 *   node scripts/listing.mjs list   --network preview <vinHash>  dry run
 *   node scripts/listing.mjs list   --network preview <vinHash> --submit
 *
 * The rule is fixed at deploy: a current VINPassport claim that the odometer
 * is at most 150 000 km (the claim the guided run proves).
 *
 * A `list` dry run runs the whole call tree here: the listing's circuit, and
 * VINPassport's `holdsAtMost` through the Compact runtime's cross-contract
 * call, against the states the public indexer holds now, including the
 * verifier keys VINPassport has on chain, which the runtime checks against
 * the module it is given. Before the listing exists, the dry run uses the
 * state its deploy would create. Nothing is sent.
 *
 * With --submit the call goes through Midnight.js 5, which resolves the callee
 * through `contractModuleProvider`, proves both circuits (each from its own
 * build) and submits one transaction holding both calls.
 *
 * The listing's maintenance key is the one Midnight.js generates and keeps in
 * the encrypted local state store. It is a demo with nothing to upgrade, so
 * it does not get VINPassport's committee (D28).
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    createConstructorContext, createCircuitContext, encodeContractAddress, ContractState as RuntimeState
} from '@midnight-ntwrk/compact-runtime';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/v9/compact-js';
import { deployContract, findDeployedContract, createLedger9UnprovenDeployTx } from '@midnight-ntwrk/midnight-js-contracts';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { Contract as Listing, ledger as listingLedger } from '../contracts/listing/src/managed/listing/contract/index.js';
import { networkEndpoints, guardLogs } from './lib/endpoints.mjs';
import { requireBuildableNetwork } from './lib/eras.mjs';
import { openWallet, describe } from './lib/wallet9.mjs';
import { BUILD_DIR, recordPath, contractProviders, sha256File } from './lib/contract9.mjs';
import { K } from './lib/scenario.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LISTING_DIR = join(ROOT, 'contracts', 'listing', 'src', 'managed', 'listing');
const VP_MODULE = '../contracts/vinpassport/src/managed/vinpassport/contract/index.js';
const RULE = { field: 'odometerKm', bound: 150_000n };

const fail = (msg) => { console.error(`\nSTOP: ${msg}`); process.exit(1); };
const log = (...a) => console.log(...a);
const argv = process.argv.slice(2);
const SUBMIT = argv.includes('--submit');
const flag = (f) => { const i = argv.indexOf(f); return i < 0 ? undefined : argv[i + 1]; };
const positional = argv.filter((x, i) => x !== '--submit' && x !== '--network' && argv[i - 1] !== '--network');
const command = positional[0];
const network = flag('--network');
if (!['deploy', 'list'].includes(command) || !network) fail('usage: node scripts/listing.mjs deploy|list --network preview [<vinHash>] [--submit]');
try { requireBuildableNetwork(network); } catch (e) { fail(e.message); }
guardLogs();

if (!existsSync(recordPath(network))) fail(`no VINPassport deploy record for ${network}`);
const passport = JSON.parse(readFileSync(recordPath(network), 'utf8')).contractAddress;
const LISTING_RECORD = join(ROOT, 'deploy', `listing.${network}.json`);
const recorded = existsSync(LISTING_RECORD) ? JSON.parse(readFileSync(LISTING_RECORD, 'utf8')) : null;
// A listing trusts one VINPassport address, fixed at its deploy. One recorded
// for a superseded VINPassport is history: it is ignored here, and archived
// when a listing for the current contract is deployed.
const listingRecord = recorded && recorded.trusts === passport ? recorded : null;
const staleListing = recorded && !listingRecord ? recorded : null;
const MANIFEST = join(LISTING_DIR, 'compiler', 'contract-manifest.json');
if (!existsSync(join(LISTING_DIR, 'keys', 'list.prover'))) fail('no keys for the listing: run `npm run compile:listing` in WSL (see contracts/README.md)');

const constructorArgs = () => [{ bytes: encodeContractAddress(passport) }, K[RULE.field], RULE.bound];
const compiled = () => CompiledContract.make('listing', Listing).pipe(
    CompiledContract.withWitnesses({}),
    CompiledContract.withCompiledFileAssets(LISTING_DIR)
);
/** Only VINPassport's address resolves, to VINPassport's generated module. */
const moduleProvider = {
    resolve: (address) => (String(address).toLowerCase() === passport.toLowerCase() ? () => import(VP_MODULE) : undefined)
};

log(`VINPassport  ${passport} (${network})`);
log(`rule         a current claim that ${RULE.field} is at most ${RULE.bound}`);
if (staleListing) log(`note         the recorded listing ${staleListing.contractAddress.slice(0, 16)}... trusts a superseded VINPassport (${String(staleListing.trusts).slice(0, 16)}...); a deploy archives it`);

// ------------------------------------------------------------------ list, dry run
if (command === 'list' && !SUBMIT) {
    const vin = positional[1];
    if (!/^[0-9a-f]{64}$/i.test(vin ?? '')) fail('list needs a VIN hash: 64 hex characters');
    const ep = networkEndpoints(network);
    const pdp = indexerPublicDataProvider({ queryURL: ep.indexerHttpUrl, subscriptionURL: ep.indexerWsUrl });
    const asRuntime = async (address) => {
        const read = await pdp.queryContractState(address);
        return read ? RuntimeState.deserialize(read.contractState.serialize()) : undefined;
    };
    let listingAddress, listingState;
    if (listingRecord) {
        listingAddress = listingRecord.contractAddress;
        listingState = await asRuntime(listingAddress);
        log(`listing      ${listingAddress} (state from the indexer)`);
    } else {
        const init = await new Listing({}).initialState(createConstructorContext({}, '0'.repeat(64)), ...constructorArgs());
        listingAddress = '00'.repeat(32);
        listingState = init.currentContractState;
        log('listing      not deployed yet: using the state its deploy would create');
    }
    const ctx = createCircuitContext({
        circuitId: 'list', contractAddress: listingAddress, coinPublicKeyOrZswapState: '0'.repeat(64),
        contractState: listingState, privateState: {}, parentBlockHash: '00'.repeat(32),
        crossContract: { stateProvider: { getContractState: async (_b, a) => asRuntime(a) }, moduleProvider }
    });
    try {
        const r = await new Listing({}).impureCircuits.list(ctx, new Uint8Array(Buffer.from(vin, 'hex')));
        const listed = listingLedger(r.context.callContext.currentQueryContext.state).listed.member(new Uint8Array(Buffer.from(vin, 'hex')));
        log(`result       accepted: ${r.context.callProofDataTrace.length} calls in the tree (VINPassport holdsAtMost, then list); listed afterwards: ${listed}`);
        log('dry run complete, nothing sent; re-run with --submit');
    } catch (e) {
        log(`result       refused: ${e.constructor.name}: ${e.message}`);
        process.exit(2);
    }
    process.exit(0);
}

// ------------------------------------------------------------------ everything else needs the wallet
if (command === 'deploy' && listingRecord && SUBMIT) fail(`a listing is already recorded at ${LISTING_RECORD}`);
if (command === 'list' && !listingRecord) fail('deploy the listing first');
const w = await openWallet(network, { log });
let code = 0;
try {
    const state = await w.synced();
    log(describe(state));
    const providers = await contractProviders(w, state, {
        log, buildDir: LISTING_DIR, expectedManifestHash: sha256File(MANIFEST),
        proveFrom: [LISTING_DIR, BUILD_DIR], contractModuleProvider: moduleProvider
    });
    if (command === 'deploy') {
        if (!SUBMIT) {
            const unproven = await createLedger9UnprovenDeployTx(providers, { compiledContract: compiled(), args: constructorArgs() });
            const handle = w.wallet.adoptTransaction(unproven.private.unprovenTx.serialize(), 'Unproven');
            let fee;
            try { fee = await w.wallet.estimateTransactionFee(handle); } catch { fee = await w.wallet.calculateTransactionFee(handle); }
            log(`\nestimated fee ${fee} SPECK (${(Number(fee) / 1e15).toFixed(3)} DUST). Dry run complete; re-run with --submit.`);
        } else {
            const t0 = Date.now();
            const deployed = await deployContract(providers, { compiledContract: compiled(), args: constructorArgs() });
            const pub = deployed.deployTxData.public;
            log(`\nDEPLOYED   ${pub.contractAddress}\ntx hash    ${pub.txHash}  block ${pub.blockHeight}\nfees       paid ${pub.fees?.paidFees ?? '?'} SPECK; ${Math.round((Date.now() - t0) / 1000)} s`);
            if (staleListing) {
                const archived = join(ROOT, 'deploy', `listing.${network}-superseded-${Date.now()}.json`);
                renameSync(LISTING_RECORD, archived);
                log(`archived   the previous listing record to ${archived}`);
            }
            writeFileSync(LISTING_RECORD, JSON.stringify({
                network, contract: 'listing', contractAddress: pub.contractAddress, txHash: pub.txHash, txId: pub.txId,
                blockHeight: pub.blockHeight, deployedAt: new Date().toISOString(), fees: pub.fees ?? null,
                trusts: passport, rule: { field: RULE.field, atMost: String(RULE.bound) },
                manifestSha256: sha256File(MANIFEST),
                note: 'Composability demo (build plan 2.5). Lists a vehicle only if the VINPassport contract it trusts holds a '
                    + 'current claim meeting the rule, asked by a cross-contract call. Maintenance key: generated by Midnight.js '
                    + 'and kept in the local encrypted state store; nothing to upgrade.'
            }, null, 2) + '\n');
            log(`recorded   ${LISTING_RECORD}`);
        }
    } else {
        const vin = new Uint8Array(Buffer.from(positional[1], 'hex'));
        const found = await findDeployedContract(providers, { contractAddress: listingRecord.contractAddress, compiledContract: compiled() });
        const t0 = Date.now();
        const r = await found.callTx.list(vin);
        const pub = r.public;
        log(`\nLISTED     ${positional[1]}\ntx hash    ${pub.txHash} (id ${pub.txId}) block ${pub.blockHeight}\nfees       paid ${pub.fees?.paidFees ?? '?'} SPECK, estimated ${pub.fees?.estimatedFees ?? '?'}; ${Math.round((Date.now() - t0) / 1000)} s`);
        listingRecord.listings = [...(listingRecord.listings ?? []), { vinHash: positional[1], txHash: pub.txHash, txId: pub.txId, blockHeight: pub.blockHeight, fees: pub.fees ?? null }];
        writeFileSync(LISTING_RECORD, JSON.stringify(listingRecord, null, 2) + '\n');
    }
} catch (e) {
    console.error(`\nlisting: ${e?.message ?? e}`);
    if (e?.cause?.message) console.error(`cause: ${e.cause.message}`);
    code = 1;
} finally {
    await w.close();
}
process.exit(code);
