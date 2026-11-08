#!/usr/bin/env node
/**
 * The deploy wallet's NIGHT and DUST on ledger 9, and DUST registration.
 *
 *   node scripts/dust.mjs --network preview              # report only, read-only
 *   node scripts/dust.mjs --network preview --register   # register NIGHT for DUST (writes a transaction)
 *   node scripts/dust.mjs --network preview --split 3    # split the NIGHT into 3 UTXOs (writes a transaction)
 *
 * Why split: every fee should be paid with at least two DUST spends (ledger
 * issue #838, see lib/dust-selection.mjs), and each generating NIGHT UTXO
 * backs one DUST coin, so the wallet needs at least two NIGHT UTXOs. The
 * split pays its fee in DUST, so it comes after the first registration.
 *
 * DUST pays every fee and is not a balance you top up: it generates from NIGHT
 * UTXOs that are registered for generation, up to a cap per NIGHT, and decays
 * when the NIGHT moves. The registration pays its own fee from the DUST the
 * unregistered NIGHT has generated so far, so on a fresh wallet this waits for
 * that to cover the fee (Wallet SDK 2, estimateRegistration and
 * waitForGeneratedDust) and only then builds the transaction.
 *
 * Replaces the ledger 8 register-dust, check-dust and sync-dust scripts, which
 * remain at the git tag ledger8-preprod.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { isInsufficientDustForFeeError } from '@midnightntwrk/wallet-sdk-dust-wallet';
import { Token } from '@midnightntwrk/wallet-sdk-abstractions';
import { openWallet, describe, summarize } from './lib/wallet9.mjs';

const arg = (flag) => {
    const i = process.argv.indexOf(flag);
    return i === -1 ? undefined : process.argv[i + 1];
};
const network = arg('--network');
if (!network) { console.error('dust: name the network: --network preview | mainnet'); process.exit(1); }
const REGISTER = process.argv.includes('--register');
const SPLIT = arg('--split') === undefined ? 0 : Number(arg('--split'));
if (SPLIT && (!Number.isInteger(SPLIT) || SPLIT < 2 || SPLIT > 10)) {
    console.error('dust: --split takes a whole number from 2 to 10'); process.exit(1);
}
if (SPLIT && REGISTER) { console.error('dust: run --split and --register separately'); process.exit(1); }
const WAIT_MS = Number(arg('--wait-minutes') ?? 60) * 60_000;
const log = (...a) => console.log(...a);

const w = await openWallet(network, { log });
let code = 0;
try {
    log(REGISTER ? 'mode     REGISTER (writes one transaction)'
        : SPLIT ? `mode     SPLIT into ${SPLIT} UTXOs (writes one transaction)`
            : 'mode     report only (pass --register or --split N to write)');
    const t0 = Date.now();
    const state = await w.synced();
    log(`synced in ${Math.round((Date.now() - t0) / 1000)} s`);
    log(describe(state));

    const s = summarize(state);
    const unregistered = s.utxos.filter((u) => !u.meta?.registeredForDustGeneration);
    if (s.utxos.length && s.utxos.length < 2) {
        log('\nnote     one NIGHT UTXO backs one DUST coin, so every fee is a single DUST spend, which a');
        log('         contract call can be refused for (ledger issue #838). After registering, run --split 3.');
    }
    if (SPLIT) {
        if (!s.utxos.length) throw new Error('no NIGHT to split');
        if (s.dust === 0n) throw new Error('no DUST to pay the split fee yet: register first and let it generate');
        const share = s.night / BigInt(SPLIT);
        const me = await w.wallet.unshielded.getAddress();
        const outputs = Array.from({ length: SPLIT - 1 }, () => ({ amount: share, receiverAddress: me, type: Token.night }));
        log(`\nsplitting: ${SPLIT - 1} output(s) of ${share} STAR to this wallet, the rest returns as change`);
        const recipe = await w.wallet.transferTransaction([{ type: 'unshielded', outputs }],
            { ttl: new Date(Date.now() + 30 * 60_000) });
        const signed = await w.wallet.signRecipe(recipe, w.sign);
        const txId = await w.wallet.submitTransaction(await w.wallet.finalizeRecipe(signed));
        log(`submitted: ${txId}`);
        log('Re-run without flags in a minute: register any new UTXO that shows as unregistered.');
    } else if (!s.utxos.length) {
        log(`\nNo NIGHT yet. Fund ${w.address} first (Preview: https://faucet.preview.midnight.network/).`);
        code = 1;
    } else if (!unregistered.length) {
        log('\nEvery NIGHT UTXO already generates DUST. Nothing to register.');
    } else {
        const est = await w.wallet.estimateRegistration(unregistered);
        log(`\nunregistered UTXOs  ${unregistered.length}`);
        log(`registration fee    ${est.fee} SPECK (live parameters)`);
        if (!REGISTER) {
            log('\nReport only. Re-run with --register to register them.');
        } else {
            if (est.fee > s.dust) {
                log(`waiting up to ${WAIT_MS / 60_000} min for generated DUST to cover the fee...`);
                await w.wallet.waitForGeneratedDust(unregistered, est.fee, { timeoutMs: WAIT_MS });
            }
            const register = () => w.wallet.registerNightUtxosForDustGeneration(
                unregistered, w.keystore.getPublicKey(), w.sign);
            const recipe = await register().catch(async (error) => {
                // Short after all: wait for the reachable estimate, once, then retry.
                if (!isInsufficientDustForFeeError(error) || error.estimate?._tag !== 'Reachable') throw error;
                const ms = Number(error.estimate.seconds) * 1000 + 60_000;
                log(`fee not covered yet; waiting ${Math.round(ms / 1000)} s and retrying once`);
                await w.wallet.waitForGeneratedDust(unregistered, error.fee, { timeoutMs: ms });
                return register();
            });
            log('proving and submitting the registration...');
            const finalized = await w.wallet.finalizeRecipe(recipe);
            const txId = await w.wallet.submitTransaction(finalized);
            log(`submitted: ${txId}`);
            log('DUST now generates from this NIGHT. It fills towards its cap over about a week;');
            log('a deploy needs only a small part of that. Re-run without --register to watch it.');
        }
    }
} catch (e) {
    console.error(`dust: ${e?.message ?? e}`);
    code = 1;
} finally {
    await w.close();
}
process.exit(code);
