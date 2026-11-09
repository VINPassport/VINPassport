#!/usr/bin/env node
/**
 * A guided run against the deployed contract on ledger 9: one fresh demo
 * vehicle through every circuit the contract has, one call per transaction.
 *
 *   node scripts/run.mjs --network preview             dry run: plan and simulate, submit nothing
 *   node scripts/run.mjs --network preview --submit    run it on chain, paying fees in DUST
 *
 * The receipt (values and salts: the private half of the passport) is written
 * under _local-tracking/receipts/<network>/, outside the repository. Check it
 * against the chain afterwards with:
 *
 *   node scripts/chain-readback.mjs --network preview --receipt <that file>
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { openChain, executeRun, guidedIntake } from './lib/runner9.mjs';
import { describe } from './lib/wallet9.mjs';

const arg = (flag) => {
    const i = process.argv.indexOf(flag);
    return i === -1 ? undefined : process.argv[i + 1];
};
const log = (...a) => console.log(...a);
const network = arg('--network');
if (!network) { console.error('run: name the network: --network preview | mainnet'); process.exit(1); }
const SUBMIT = process.argv.includes('--submit');

let chain;
let code = 0;
try {
    chain = await openChain(network, { log });
    log(`contract  ${chain.record.contractAddress} (${network})`);
    log(describe(await chain.w.wallet.waitForSyncedState()));
    log(`dealer    ${chain.dealer ? 'registrar C, so the run delegates, grants and withdraws' : 'none configured: no delegation in this run'}`);
    log(`mode      ${SUBMIT ? 'SUBMIT: real transactions, fees in DUST' : 'dry run: plan and simulate, submit nothing'}\n`);
    const intake = { ...guidedIntake(chain.dealer), kind: 'guided' };
    const t0 = Date.now();
    const out = await executeRun(chain, intake, { log, submit: SUBMIT });
    if (!SUBMIT) {
        log(`\nplanned calls (${out.stages.length}):`);
        out.stages.forEach((l, i) => log(`  ${String(i + 1).padStart(2)} ${l}`));
        log('\nDry run complete. Re-run with --submit to put it on chain.');
    } else {
        const fees = out.onChain.reduce((a, c) => a + BigInt(c.fees?.paidFees ?? 0), 0n);
        log(`\nRUN COMPLETE  ${out.onChain.length} transaction(s) in ${Math.round((Date.now() - t0) / 60_000)} min, fees ${fees} SPECK (${(Number(fees) / 1e15).toFixed(4)} DUST)`);
        log(`receipt       ${out.savedTo}`);
        log(`check it:     node scripts/chain-readback.mjs --network ${network} --receipt "${out.savedTo}"`);
    }
} catch (e) {
    console.error(`\nrun: ${e?.message ?? e}`);
    if (e?.partial?.onChain?.length) {
        console.error(`landed before the failure (${e.partial.onChain.length}), vehicle ${e.partial.vin}:`);
        for (const c of e.partial.onChain) console.error(`  ${c.label}: ${c.txHash} block ${c.blockHeight}`);
        if (e.partial.savedTo) console.error(`receipt (incomplete run, holds only what landed): ${e.partial.savedTo}`);
        if (e.partial.saveError) console.error(`the receipt could NOT be saved: ${e.partial.saveError}`);
    }
    code = 1;
} finally {
    await chain?.close();
}
process.exit(code);
