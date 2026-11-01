/**
 * The preprod half of /disclose/: a public snapshot of the deployed contract,
 * read from the indexer, and sample bundles from a guided run checked against it.
 *
 *   node scripts/export-preprod-bundles.mjs                      the snapshot only
 *   node scripts/export-preprod-bundles.mjs --receipt <file>     and the bundles
 *
 * Writes:
 *   site/disclose/preprod/ledger.json        fieldCommitment, claims and grants, as
 *                                            the chain holds them, and the block read
 *   site/disclose/preprod/run.json           the run's blocks and its grant transaction
 *   site/disclose/bundles/preprod/public.json   the buyer's file: proven claims, no value
 *   site/disclose/bundles/preprod/trade.json    the dealer's file: the run's five readings
 *
 * Without a receipt it needs only a Blockfrost project id, so anyone can
 * regenerate the snapshot and diff it against the committed copy. The bundles
 * need the run's receipt, which holds the salts and stays outside the
 * repository. No authority bundle: the run granted the dealership the trade
 * view and nobody the authority view, so an authority file could only report
 * a grant that is not there.
 *
 * Each bundle is checked against the snapshot before it is written, and the
 * script refuses to write one that carries the VIN or the salt of a reading
 * the bundle does not open.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ContractState } from '@midnight-ntwrk/compact-runtime';
import { ledger } from '../contracts/vinpassport/src/managed/vinpassport/contract/index.js';
import { networkEndpoints, guardLogs, assertNoSecrets } from './lib/endpoints.mjs';
import { buildBundle, verifyBundle } from './lib/disclosure.mjs';
import { readRegistrarSlots } from './lib/registrar-slots.mjs';

guardLogs();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'site', 'disclose', 'preprod');
const BUNDLES = join(ROOT, 'site', 'disclose', 'bundles', 'preprod');
const EXPLORER = 'https://preprod.midnightexplorer.com/transactions/';
const arg = (name) => { const i = process.argv.indexOf(name); return i === -1 ? null : process.argv[i + 1]; };
const hex = (u) => Buffer.from(u).toString('hex');
const write = (path, obj) => {
    const text = JSON.stringify(obj, null, 2) + '\n';
    assertNoSecrets(text);
    writeFileSync(path, text);
};

const { contractAddress } = JSON.parse(readFileSync(join(ROOT, 'deploy', 'preprod.json'), 'utf8'));

// -- the chain, as anyone can read it
const res = await fetch(networkEndpoints('preprod').indexerHttpUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: `{ contractAction(address: "${contractAddress}") { state transaction { hash block { height } } } }` })
});
const action = (await res.json())?.data?.contractAction;
if (!action?.state) throw new Error(`the indexer returned no state for ${contractAddress}`);
const L = ledger(ContractState.deserialize(Buffer.from(action.state, 'hex')).data);

const snapshot = {
    source: 'the Midnight preprod indexer (Blockfrost), decoded with the contract\'s own ledger() reader',
    note: 'Public chain state only: commitments, claims and grants. Regenerate it with '
        + 'node scripts/export-preprod-bundles.mjs and compare.',
    network: 'preprod',
    contractAddress,
    readAtBlock: action.transaction.block.height,
    latestTransaction: action.transaction.hash,
    fieldCommitment: Object.fromEntries([...L.fieldCommitment].map(([k, v]) => [hex(k), hex(v)])),
    claims: [...L.claims].map(([k, c]) => ({
        key: hex(k), slot: hex(c.slot), vinHash: hex(c.vinHash), fieldKey: hex(c.fieldKey),
        commitment: hex(c.commitment), bound: c.bound.toString(), atMost: c.atMost
    })),
    grants: Object.fromEntries([...L.grants].map(([k, t]) => [hex(k), Number(t)]))
};
mkdirSync(OUT, { recursive: true });
write(join(OUT, 'ledger.json'), snapshot);
console.log(`ledger snapshot: block ${snapshot.readAtBlock}, ${Object.keys(snapshot.fieldCommitment).length} commitments, `
    + `${snapshot.claims.length} claims, ${Object.keys(snapshot.grants).length} grants -> site/disclose/preprod/`);

const RECEIPT = arg('--receipt');
if (!RECEIPT) process.exit(0);

// -- the bundles, from the run's receipt
const receipt = JSON.parse(readFileSync(RECEIPT, 'utf8'));
if (receipt.contractAddress !== contractAddress) throw new Error('the receipt is for another contract address');
const dealer = readRegistrarSlots(join(ROOT, '..', '_local-tracking', 'REGISTRAR-SECRETS.env')).regs.find((r) => r.label === 'C');
const proven = snapshot.claims.filter((c) => c.vinHash === receipt.vinHash).map((c) => c.key);
const audiences = {
    public: { audience: 'a buyer', claims: proven },
    trade: { audience: 'the dealership the run granted the trade view', audienceId: dealer.hex }
};
const commitmentAt = (slot) => snapshot.fieldCommitment[slot] ?? null;
const claimAt = (key) => snapshot.claims.find((c) => c.key === key) ?? null;
const grantAt = (key) => snapshot.grants[key] ?? null;

mkdirSync(BUNDLES, { recursive: true });
for (const [tier, options] of Object.entries(audiences)) {
    const bundle = buildBundle(receipt, tier, options);
    const check = verifyBundle(bundle, { commitmentAt, claimAt, grantAt });
    if (!check.ok || check.overDisclosed.length || (tier !== 'public' && !check.grant?.covers)) {
        throw new Error(`the ${tier} bundle does not check against the chain: ${JSON.stringify(check)}`);
    }
    const text = JSON.stringify(bundle);
    if (text.includes(receipt.vin)) throw new Error(`the ${tier} bundle carries the VIN`);
    const openedSalts = new Set(bundle.fields.map((f) => f.salt));
    for (const w of Object.values(receipt.fields).flat()) {
        if (!openedSalts.has(w.salt) && text.includes(w.salt)) throw new Error(`the ${tier} bundle carries a salt it does not open`);
    }
    write(join(BUNDLES, `${tier}.json`), bundle);
    console.log(`${tier} bundle: opens ${check.opened.length} fields, cites ${check.claims.length} claims`
        + `${check.grant ? `, grant held: ${check.grant.held}` : ''} -> site/disclose/bundles/preprod/`);
}

const blocks = receipt.onChain.map((s) => s.block ?? s.blockHeight);
const grant = receipt.onChain.find((s) => /grantDisclosure/.test(s.label));
write(join(OUT, 'run.json'), {
    note: 'The guided run these bundles come from. Every transaction is on the public preprod chain.',
    contractAddress,
    firstBlock: Math.min(...blocks),
    lastBlock: Math.max(...blocks),
    date: String(receipt.finishedAt).slice(0, 10),
    transactions: receipt.onChain.length,
    grant: grant ? { block: grant.block ?? grant.blockHeight, txHash: grant.txHash, explorer: EXPLORER + grant.txHash } : null
});
console.log(`run: blocks ${Math.min(...blocks)} to ${Math.max(...blocks)}, grant in block ${grant?.block ?? grant?.blockHeight}`);
