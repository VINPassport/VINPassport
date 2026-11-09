#!/usr/bin/env node
/**
 * Ask the deployed contract one of its read circuits (DECISIONS: build plan 2.2).
 *
 *   node scripts/ask.mjs --network preview holdsAtMost <vinHash> odometerKm 150000
 *   node scripts/ask.mjs --network preview holdsAtMost <vinHash> odometerKm 150000 --submit
 *
 *   circuits   isRegistered <vinHash>
 *              registrarOf  <vinHash>
 *              commitmentOf <vinHash> <field>
 *              holdsAtMost  <vinHash> <field> <bound>
 *              holdsAtLeast <vinHash> <field> <bound>
 *              holdsGrant   <vinHash> <granteeId> trade|authority
 *              isRegistrar  <registrarId>
 *
 * Without --submit it runs the compiled circuit here, against the contract
 * state the public indexer holds now, and prints the answer: no wallet, no
 * fee, nothing sent. With --submit the same call goes to the chain as a
 * transaction through Midnight.js, so the node checks every ledger read the
 * answer depends on; the answer printed then is the one the chain accepted.
 *
 * These circuits exist for other contracts to call in the same transaction.
 * Calling one on its own is how to show it works on a live chain.
 *
 * `<field>` is a field name (odometerKm, accidentCount, ...) or 64 hex
 * characters. Only the JS result is taken from the call's private half; the
 * rest of it is never printed.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync } from 'node:fs';
import { createCircuitContext, ContractState as RuntimeState } from '@midnight-ntwrk/compact-runtime';
import { ContractState } from '@midnightntwrk/ledger-v9';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { Contract, Tier } from '../contracts/vinpassport/src/managed/vinpassport/contract/index.js';
import { networkEndpoints, guardLogs } from './lib/endpoints.mjs';
import { requireBuildableNetwork } from './lib/eras.mjs';
import { recordPath, refusingWitnesses } from './lib/contract9.mjs';
import { K } from './lib/scenario.mjs';
import { openChain } from './lib/runner9.mjs';

const fail = (msg) => { console.error(`\nSTOP: ${msg}`); process.exit(1); };
const argv = process.argv.slice(2);
const flag = (f) => { const i = argv.indexOf(f); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const SUBMIT = argv.includes('--submit');
if (SUBMIT) argv.splice(argv.indexOf('--submit'), 1);
const network = flag('--network');
const [circuit, ...raw] = argv;

const bytes32 = (s, what) => {
    if (!/^[0-9a-f]{64}$/i.test(s ?? '')) fail(`${what} must be 64 hex characters`);
    return new Uint8Array(Buffer.from(s, 'hex'));
};
const field = (s) => (K[s] ?? bytes32(s, `field "${s}" is not a known field name, and`));
const uint = (s) => { if (!/^\d+$/.test(s ?? '')) fail(`bound must be a whole number, got ${s}`); return BigInt(s); };
const tier = (s) => { if (!(s in Tier) || typeof Tier[s] !== 'number') fail('tier is trade or authority'); return Tier[s]; };
const SHAPES = {
    isRegistered: (a) => [bytes32(a[0], 'vinHash')],
    registrarOf: (a) => [bytes32(a[0], 'vinHash')],
    commitmentOf: (a) => [bytes32(a[0], 'vinHash'), field(a[1])],
    holdsAtMost: (a) => [bytes32(a[0], 'vinHash'), field(a[1]), uint(a[2])],
    holdsAtLeast: (a) => [bytes32(a[0], 'vinHash'), field(a[1]), uint(a[2])],
    holdsGrant: (a) => [bytes32(a[0], 'vinHash'), bytes32(a[1], 'granteeId'), tier(a[2])],
    isRegistrar: (a) => [bytes32(a[0], 'registrarId')]
};
if (!network || !SHAPES[circuit]) fail(`usage: node scripts/ask.mjs --network preview <${Object.keys(SHAPES).join('|')}> <args> [--submit]`);
try { requireBuildableNetwork(network); } catch (e) { fail(e.message); }
guardLogs();
const args = SHAPES[circuit](raw);
if (!existsSync(recordPath(network))) fail(`no deploy record for ${network}`);
const record = JSON.parse(readFileSync(recordPath(network), 'utf8'));
const show = (v) => (v instanceof Uint8Array ? Buffer.from(v).toString('hex') : String(v));

console.log(`contract  ${record.contractAddress} (${network})`);
console.log(`ask       ${circuit}(${raw.join(', ')})`);

if (!SUBMIT) {
    const ep = networkEndpoints(network);
    const pdp = indexerPublicDataProvider({ queryURL: ep.indexerHttpUrl, subscriptionURL: ep.indexerWsUrl });
    const read = await pdp.queryContractState(record.contractAddress);
    if (!read) fail('the indexer has no state for this contract');
    const onChain = read.contractState.deserialize({ v9: ContractState });
    if (!onChain.operation(circuit)) fail(`${circuit} has no verifier key on chain, so the chain would refuse the call`);
    const state = RuntimeState.deserialize(read.contractState.serialize());
    const contract = new Contract(refusingWitnesses());
    const ctx = createCircuitContext({
        circuitId: circuit, contractAddress: record.contractAddress, coinPublicKeyOrZswapState: '0'.repeat(64),
        contractState: state, privateState: {}
    });
    const r = await contract.impureCircuits[circuit](ctx, ...args);
    console.log(`answer    ${show(r.result)}   (computed here against the indexer's state; nothing sent)`);
    console.log('dry run complete; re-run with --submit to have the chain check it');
    process.exit(0);
}

const chain = await openChain(network, { log: () => { } });
let code = 0;
try {
    const t0 = Date.now();
    const r = await chain.found.callTx[circuit](...args);
    const pub = r.public;
    console.log(`answer    ${show(r.private.result)}   (accepted by the chain)`);
    console.log(`tx        ${pub.txHash} (id ${pub.txId}) in block ${pub.blockHeight}`);
    console.log(`fee       ${pub.fees?.paidFees ?? '?'} SPECK paid, ${pub.fees?.estimatedFees ?? '?'} estimated; ${Math.round((Date.now() - t0) / 1000)} s`);
} catch (e) {
    console.error(`ask: ${e?.message ?? e}`);
    code = 1;
} finally {
    await chain.close();
}
process.exit(code);
