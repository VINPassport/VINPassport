/**
 * Read the deployed contract back from the public indexer and say what the
 * chain holds, decoded with the contract's own `ledger()` reader.
 *
 *   node scripts/chain-readback.mjs                      what is on chain
 *   node scripts/chain-readback.mjs --receipt <file>     and check it against a receipt
 *   node scripts/chain-readback.mjs --network mainnet    another network's record
 *
 * Why it exists: a green simulator run does not show what a public chain
 * exposes, so the ledger is read from the indexer, as anyone can read it, and
 * not from our own process. It needs a Blockfrost project id for the network
 * (scripts/lib/endpoints.mjs) and nothing else; it signs and spends nothing.
 *
 * With a receipt it checks, and prints only yes or no and counts:
 *   - the receipt's vehicle key is a passport on chain, under the scheme it names
 *   - no passport is keyed by the plain hash of the receipt's VIN
 *   - every field's latest commitment is the one the ledger holds
 *   - the plaintext VIN and every salt are absent from the serialized state
 *   - the registrar identities pinned at deploy are the allowlist on chain
 *   - each grant the run made is on chain at the tier it names
 * The receipt never leaves this process and none of its values are printed.
 * Registrar identities are read from the local registrar file; the secrets
 * beside them are never read.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ContractState } from '@midnight-ntwrk/compact-runtime';
import { ledger, Tier } from '../contracts/vinpassport/src/managed/vinpassport/contract/index.js';
import { networkEndpoints, checkNetwork, guardLogs } from './lib/endpoints.mjs';
import { slotOf, fieldKeyOf, commitmentOf, grantKeyOf, vinHashOf, PLAIN_VIN_SCHEME } from './lib/disclosure.mjs';
import { readRegistrarSlots } from './lib/registrar-slots.mjs';

guardLogs();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => { const i = process.argv.indexOf(name); return i === -1 ? null : process.argv[i + 1]; };
const NETWORK = checkNetwork(arg('--network') ?? 'preprod');
const RECEIPT = arg('--receipt');
const hex = (u) => Buffer.from(u).toString('hex');
const fail = (m) => { console.error(`\nSTOP: ${m}`); process.exit(1); };

const record = JSON.parse(readFileSync(join(ROOT, 'deploy', `${NETWORK}.json`), 'utf8'));
const address = record.contractAddress;

// -- the chain, as anyone can read it
const res = await fetch(networkEndpoints(NETWORK).indexerHttpUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: `{ contractAction(address: "${address}") { __typename state transaction { hash block { height } } } }` })
});
const body = await res.json();
const action = body?.data?.contractAction;
if (!action?.state) fail(`the indexer returned no state for ${address}: ${JSON.stringify(body?.errors ?? body).slice(0, 300)}`);

const stateBytes = Buffer.from(action.state, 'hex');
const L = ledger(ContractState.deserialize(stateBytes).data);

console.log(`network      ${NETWORK}`);
console.log(`contract     ${address}`);
console.log(`latest       ${action.__typename} in block ${action.transaction?.block?.height}, tx ${action.transaction?.hash}`);
console.log(`state        ${stateBytes.length} bytes\n`);

const maps = ['passports', 'registrar', 'fieldCommitment', 'fieldRule', 'claims', 'relClaims', 'allowedRegistrars', 'writers', 'fieldWriter', 'grants'];
for (const m of maps) console.log(`${m.padEnd(18)} ${L[m].size()}`);

const passportKeys = [...L.passports].map(([k]) => hex(k));
const grants = new Map([...L.grants].map(([k, t]) => [hex(k), Number(t)]));
console.log('\npassport keys (vehicle keys, as published):');
for (const k of passportKeys) console.log(`  ${k}`);
console.log('grants (key: tier):');
for (const [k, t] of grants) console.log(`  ${k}: ${Tier[t] ?? t}`);

if (!RECEIPT) process.exit(0);

// -- against a receipt, printing only verdicts
const r = JSON.parse(readFileSync(RECEIPT, 'utf8'));
if (r.contractAddress && r.contractAddress !== address) fail('the receipt is for another contract address');
const checks = [];
const check = (label, ok) => { checks.push(ok); console.log(`${ok ? 'yes' : 'NO '}  ${label}`); };
console.log('\nagainst the receipt:');

const scheme = r.vinHashScheme ?? PLAIN_VIN_SCHEME;
check(`the receipt names a keyed scheme (${scheme})`, scheme !== PLAIN_VIN_SCHEME);
check('the receipt\'s vehicle key is a passport on chain', passportKeys.includes(String(r.vinHash).replace(/^0x/, '')));
check('no passport is keyed by the plain hash of the VIN', !passportKeys.includes(hex(vinHashOf(r.vin))));

const commitments = new Map([...L.fieldCommitment].map(([k, v]) => [hex(k), hex(v)]));
let fieldsOk = 0, fieldsTotal = 0;
for (const [name, writes] of Object.entries(r.fields ?? {})) {
    if (!writes.length) continue;
    fieldsTotal += 1;
    const latest = writes[writes.length - 1];
    const slot = hex(slotOf(r.vinHash, hex(fieldKeyOf(name)), r.contentRoot));
    if (commitments.get(slot) === hex(commitmentOf(latest.value, latest.salt))) fieldsOk += 1;
}
check(`every field's latest commitment is on chain (${fieldsOk} of ${fieldsTotal})`, fieldsTotal > 0 && fieldsOk === fieldsTotal);

const vinBytes = Buffer.from(String(r.vin), 'utf8');
check('the plaintext VIN is absent from the serialized state', stateBytes.indexOf(vinBytes) === -1);
const salts = Object.values(r.fields ?? {}).flat().map((w) => Buffer.from(w.salt, 'hex'));
check(`no salt appears in the serialized state (${salts.length} checked)`, salts.every((s) => stateBytes.indexOf(s) === -1));

// The receipt names grantees by label only, in its stage labels. The guided
// run's dealership is registrar C (scripts/lib/preprod-runner.mjs, `dealer`).
const GRANTEE_SLOT = { dealership: 'C' };
const registrarFile = process.env.VINPASSPORT_REGISTRAR_FILE
    ?? join(ROOT, '..', '_local-tracking', NETWORK === 'mainnet' ? 'REGISTRAR-SECRETS.mainnet.env' : 'REGISTRAR-SECRETS.env');
const { regs } = readRegistrarSlots(registrarFile);
const onChainAllow = new Set([...L.allowedRegistrars].map(hex));
check(`the pinned registrar identities are the allowlist on chain (${regs.length})`,
    onChainAllow.size === regs.length && regs.every((g) => onChainAllow.has(g.hex)));
check('the receipt\'s registrar is one of them', regs.some((g) => g.hex === r.registrar?.id));

const made = (r.onChain ?? []).flatMap((st) => [...String(st.label).matchAll(/grantDisclosure (\w+): (\w+)/g)]);
for (const [, label, tier] of made) {
    const id = regs.find((g) => g.label === GRANTEE_SLOT[label])?.hex;
    const t = id && grants.get(grantKeyOf(r.vinHash, id));
    check(`grant to the ${label} is on chain at ${tier}`, t !== undefined && Tier[t] === tier);
}
if (!made.length) console.log('     (the run made no grant)');

console.log(checks.every(Boolean) ? '\nREADBACK OK' : '\nREADBACK FOUND A MISMATCH');
process.exit(checks.every(Boolean) ? 0 : 1);
