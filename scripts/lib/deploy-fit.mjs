/**
 * Fitting a deploy into a block (ledger 9).
 *
 * A block has a hard limit on the bytes it writes to state: 50,000 modelled
 * bytes on Preview (`LedgerParameters` block_limits.bytes_written, read live
 * from the indexer). A deploy writes every verifier key it carries into the
 * contract's state, and the fee the wallet adds writes more. On 9 November
 * 2026 the 18-circuit build measured 92.6% of the limit before balancing, and
 * the node refused the balanced transaction as larger than a block allows
 * (error 1010). The 10-circuit deploy that landed on 8 November measured
 * about 58%. The rule: no transaction is sent above the budget below.
 *
 * So a deploy that does not fit goes in two steps: the contract with the
 * circuits that fit under a budget, then the rest as verifier-key inserts by
 * the maintenance authority, which is the custody key from deploy until the
 * handover (DECISIONS D28). The circuits that write go first and the read
 * circuits last, so the contract works for writes from its first block, and
 * the reads arrive the way the first six did on the previous contract (D33).
 *
 * Everything here builds and measures; nothing submits. `submitLedgerTx` hands
 * a built transaction to the wallet, and is only called by a script that was
 * run with --submit.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ContractState, ContractDeploy, Intent, Transaction, LedgerParameters } from '@midnightntwrk/ledger-v9';
import { insertVerifierKey, makeProposal, signProposal, signedUpdate } from './maintenance9.mjs';
import { networkEndpoints } from './endpoints.mjs';

/**
 * The share of any block limit a deploy or update may use before balancing.
 * Measured: 58% landed, 92.6% did not once the fee was added. 65% keeps the
 * margin the fee needs (two DUST spends, ledger issue #838) with room to spare.
 */
export const BLOCK_BUDGET = 0.65;

/** The read circuits: they write nothing, so a contract works without them until they are inserted. */
export const READ_CIRCUITS = Object.freeze(['isRegistered', 'registrarOf', 'commitmentOf', 'holdsAtMost', 'holdsAtLeast', 'holdsGrant', 'isRegistrar']);

/** Writing circuits first, in source order, then the read circuits. */
export function deployOrder(provable) {
    const reads = READ_CIRCUITS.filter((c) => provable.includes(c));
    return [...provable.filter((c) => !READ_CIRCUITS.includes(c)), ...reads];
}

/** The ledger parameters at the indexer's latest block. */
export async function liveLedgerParameters(network) {
    const ep = networkEndpoints(network);
    const res = await fetch(ep.indexerHttpUrl, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ block { height ledgerParameters } }' })
    });
    const b = (await res.json())?.data?.block;
    if (!b?.ledgerParameters) throw new Error('the indexer returned no ledger parameters');
    return { height: b.height, params: LedgerParameters.deserialize(Buffer.from(b.ledgerParameters, 'hex')) };
}

/**
 * The largest share of any one block limit this transaction uses, before
 * balancing; Infinity when it already exceeds one. Proofs are mocked, which
 * does not change what a deploy or a maintenance update writes.
 */
export function blockShare(tx, params) {
    const cost = tx.mockProve().cost(params);
    try {
        const n = params.normalizeFullness(cost);
        return { share: Math.max(...Object.values(n)), bytesWritten: cost.bytesWritten };
    } catch {
        return { share: Infinity, bytesWritten: cost.bytesWritten };
    }
}

/** A copy of a deploy's initial state carrying only the named circuits. */
export function subsetState(full, circuits) {
    const s = new ContractState();
    s.data = full.data;
    s.maintenanceAuthority = full.maintenanceAuthority;
    for (const c of circuits) {
        const op = full.operation(c);
        if (!op) throw new Error(`the deploy state has no operation ${c}`);
        s.setOperation(c, op);
    }
    return s;
}

export function deployTx(network, state, ttl) {
    const deploy = new ContractDeploy(state);
    return { deploy, tx: Transaction.fromParts(network, undefined, undefined, Intent.new(ttl).addDeploy(deploy)) };
}

/**
 * Which circuits the deploy carries, and which follow as inserts. `full` is
 * the initial state with every verifier key set (what Midnight.js builds).
 */
export function planDeploy(full, provable, params, { network, ttl = new Date(Date.now() + 30 * 60_000), budget = BLOCK_BUDGET } = {}) {
    const order = deployOrder(provable);
    const whole = blockShare(deployTx(network, subsetState(full, order), ttl).tx, params);
    if (whole.share <= budget) return { first: order, rest: [], share: whole.share, wholeShare: whole.share };
    let k = 0;
    let share = 0;
    while (k < order.length) {
        const next = blockShare(deployTx(network, subsetState(full, order.slice(0, k + 1)), ttl).tx, params).share;
        if (next > budget) break;
        k += 1;
        share = next;
    }
    if (k === 0) throw new Error('not even one circuit fits a deploy under the block budget');
    return { first: order.slice(0, k), rest: order.slice(k), share, wholeShare: whole.share };
}

/**
 * Verifier-key inserts for `circuits`, signed by a single-key authority (the
 * custody key), in as many updates as the block budget needs. Each update is
 * valid against the counter the previous one leaves, so they go in order.
 * Returns the signed proposals (kept as the audit trail) and their transactions.
 */
export function custodyInserts({ network, contractAddress, circuits, keysDir, custody, counter, params, ttl, budget = BLOCK_BUDGET }) {
    const authorityAt = (c) => ({ committee: [custody.verifyingKey], threshold: 1, counter: c });
    const build = (list, c) => {
        const updates = list.map((name) => insertVerifierKey(name, readFileSync(join(keysDir, `${name}.verifier`))));
        let p = makeProposal({
            network, contractAddress, authority: authorityAt(c), updates,
            title: `deploy, step 2: insert ${list.join(', ')} (custody key, before handover)`
        });
        p = signProposal(p, custody.key, 'custody');
        const update = signedUpdate(p, authorityAt(c));
        return { proposal: p, tx: Transaction.fromParts(network, undefined, undefined, Intent.new(ttl).addMaintenanceUpdate(update)) };
    };
    const steps = [];
    let remaining = [...circuits];
    let c = BigInt(counter);
    while (remaining.length) {
        let k = remaining.length;
        let step = build(remaining.slice(0, k), c);
        let share = blockShare(step.tx, params).share;
        while (share > budget && k > 1) {
            k -= 1;
            step = build(remaining.slice(0, k), c);
            share = blockShare(step.tx, params).share;
        }
        if (share > budget) throw new Error(`the verifier key for ${remaining[0]} alone does not fit an update under the block budget`);
        steps.push({ circuits: remaining.slice(0, k), counter: c, share, ...step });
        remaining = remaining.slice(k);
        c += 1n;
    }
    return steps;
}

/** Balance, sign, prove and submit a built transaction through the wallet. Returns the transaction id. */
export async function submitLedgerTx(w, tx, ttl) {
    const handle = w.wallet.adoptTransaction(tx.serialize(), 'Unproven');
    const recipe = await w.wallet.balanceUnprovenTransaction(handle, { ttl });
    const signed = await w.wallet.signRecipe(recipe, w.sign);
    const finalized = await w.wallet.finalizeRecipe(signed);
    return w.wallet.submitTransaction(finalized);
}

/**
 * Wait for the indexer to show a transaction, by the id the wallet returned:
 * its hash, block, status and fees. Throws after `minutes`.
 */
export async function waitForTransaction(network, id, { minutes = 5 } = {}) {
    const ep = networkEndpoints(network);
    const query = `{ transactions(offset: { identifier: "${id}" }) { hash block { height timestamp } contractActions { address } `
        + '... on RegularTransaction { identifiers fees { estimatedFees paidFees } transactionResult { status } } } }';
    const until = Date.now() + minutes * 60_000;
    while (Date.now() < until) {
        await new Promise((r) => setTimeout(r, 6000));
        try {
            const res = await fetch(ep.indexerHttpUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query }) });
            const t = (await res.json())?.data?.transactions?.[0];
            if (t?.block?.height != null) {
                return {
                    txId: id, txHash: t.hash, blockHeight: t.block.height,
                    // The wallet's id is one of the transaction's identifiers; Midnight.js names a
                    // contract action by the identifier at that action's index.
                    actionTxId: (address) => t.identifiers?.[(t.contractActions ?? []).findIndex((x) => x.address === address)] ?? id,
                    blockTimestamp: t.block.timestamp ?? null,
                    status: t.transactionResult?.status ?? null,
                    fees: t.fees ? { estimatedFees: String(t.fees.estimatedFees), paidFees: String(t.fees.paidFees) } : null
                };
            }
        } catch { /* the indexer is catching up; ask again */ }
    }
    throw new Error(`transaction ${id} not visible on the indexer after ${minutes} minutes`);
}
