/**
 * A network's half of /disclose/: a public snapshot of the deployed contract,
 * read from the indexer, and sample bundles from a guided run checked against
 * it. The ledger 9 counterpart of export-preprod-bundles.mjs.
 *
 *   node scripts/export-bundles.mjs --network preview                     the snapshot only
 *   node scripts/export-bundles.mjs --network preview --receipt <file>    and the bundles
 *
 * Writes, for network N:
 *   site/disclose/N/ledger.json          fieldCommitment, claims and grants, as the chain holds them
 *   site/disclose/N/run.json             the run's blocks and its grant transaction
 *   site/disclose/bundles/N/public.json  the buyer's file: proven claims, no value
 *   site/disclose/bundles/N/trade.json   the dealer's file: the run's readings
 *
 * The preprod files (site/disclose/preprod/) are never touched from here:
 * they are a ledger 8 snapshot, regenerated only from the tag ledger8-preprod.
 *
 * Without a receipt it needs no secret at all on Preview, so anyone can
 * regenerate the snapshot and diff it. The bundles need the run's receipt,
 * which holds the salts and stays outside the repository. Each bundle is
 * checked against the snapshot before it is written, and the script refuses
 * one that carries the VIN or the salt of a reading the bundle does not open.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { checkNetwork, guardLogs, assertNoSecrets } from './lib/endpoints.mjs';
import { deployRecord, readContract } from './lib/chain-state.mjs';
import { buildBundle, verifyBundle } from './lib/disclosure.mjs';
import { readRegistrarSlots } from './lib/registrar-slots.mjs';
import { credentialPath } from './lib/local-credentials.mjs';

guardLogs();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => { const i = process.argv.indexOf(name); return i === -1 ? null : process.argv[i + 1]; };
const NETWORK = checkNetwork(arg('--network') ?? 'preview');
if (NETWORK === 'preprod') { console.error('preprod is a ledger 8 snapshot: export it from the tag ledger8-preprod.'); process.exit(1); }
const OUT = join(ROOT, 'site', 'disclose', NETWORK);
const BUNDLES = join(ROOT, 'site', 'disclose', 'bundles', NETWORK);
const hex = (u) => Buffer.from(u).toString('hex');
const write = (path, obj) => {
    const text = JSON.stringify(obj, null, 2) + '\n';
    assertNoSecrets(text);
    writeFileSync(path, text);
};

const { contractAddress } = deployRecord(NETWORK);
const chain = await readContract(NETWORK, contractAddress);
const L = chain.ledger;

const snapshot = {
    source: `the Midnight ${NETWORK} indexer, decoded with the contract's own ledger() reader (ledger ${chain.era})`,
    note: 'Public chain state only: commitments, claims and grants. Regenerate it with '
        + `node scripts/export-bundles.mjs --network ${NETWORK} and compare.`,
    network: NETWORK,
    contractAddress,
    readAtBlock: chain.latest.blockHeight,
    latestTransaction: chain.latest.txHash,
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
    + `${snapshot.claims.length} claims, ${Object.keys(snapshot.grants).length} grants -> site/disclose/${NETWORK}/`);

const RECEIPT = arg('--receipt');
if (!RECEIPT) process.exit(0);

const receipt = JSON.parse(readFileSync(RECEIPT, 'utf8'));
if (receipt.contractAddress !== contractAddress) throw new Error('the receipt is for another contract address');
const secrets = credentialPath(NETWORK === 'mainnet' ? 'REGISTRAR-SECRETS.mainnet.env' : 'REGISTRAR-SECRETS.env');
const dealer = readRegistrarSlots(secrets).regs.find((r) => r.label === 'C');
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
        + `${check.grant ? `, grant held: ${check.grant.held}` : ''} -> site/disclose/bundles/${NETWORK}/`);
}

const blocks = receipt.onChain.map((s) => s.blockHeight ?? s.block);
const grant = receipt.onChain.find((s) => /grantDisclosure/.test(s.label));
write(join(OUT, 'run.json'), {
    note: `The guided run these bundles come from. Every transaction is on the public ${NETWORK} chain.`,
    contractAddress,
    firstBlock: Math.min(...blocks),
    lastBlock: Math.max(...blocks),
    date: String(receipt.finishedAt).slice(0, 10),
    transactions: receipt.onChain.length,
    grant: grant ? { block: grant.blockHeight ?? grant.block, txHash: grant.txHash } : null
});
console.log(`run: blocks ${Math.min(...blocks)} to ${Math.max(...blocks)}, grant in block ${grant?.blockHeight ?? grant?.block}`);
