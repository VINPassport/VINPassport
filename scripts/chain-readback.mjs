/**
 * Read the deployed contract back from the public indexer and say what the
 * chain holds, decoded with the contract's own `ledger()` reader.
 *
 *   node scripts/chain-readback.mjs                      what is on chain (Preview)
 *   node scripts/chain-readback.mjs --receipt <file>     and check it against a receipt
 *   node scripts/chain-readback.mjs --network mainnet    another network's record
 *
 * Why it exists: a green simulator run does not show what a public chain
 * exposes, so the ledger is read from the indexer, as anyone can read it, and
 * not from our own process. Preview's indexer is open; mainnet needs a
 * Blockfrost project id (scripts/lib/endpoints.mjs). It signs and spends
 * nothing. The state is read era-aware (scripts/lib/chain-state.mjs): this
 * build decodes ledger 9 states, and the ledger 8 preprod readback is at the
 * git tag ledger8-preprod.
 *
 * With a receipt it checks, and prints only yes or no and counts:
 *   - the receipt's vehicle key is a passport on chain, under the scheme it names
 *   - no passport is keyed by the plain hash of the receipt's VIN
 *   - every field's latest commitment is the one the ledger holds
 *   - the plaintext VIN and every salt are absent from the serialized state
 *   - the registrar set on chain is the one pinned at deploy, with every change
 *     the deploy record says was carried out applied (DECISIONS D32)
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
import { Tier } from '../contracts/vinpassport/src/managed/vinpassport/contract/index.js';
import { checkNetwork, guardLogs } from './lib/endpoints.mjs';
import { deployRecord, readContract, readContractEvents } from './lib/chain-state.mjs';
import { decodeIndexerEvent, CIRCUIT_KIND, VEHICLE_KINDS, GOVERNANCE_KINDS } from './lib/events.mjs';
import { slotOf, fieldKeyOf, commitmentOf, grantKeyOf, vinHashOf, PLAIN_VIN_SCHEME } from './lib/disclosure.mjs';
import { readRegistrarSlots } from './lib/registrar-slots.mjs';
import { expectedRegistrars, sameMembers } from './lib/governance.mjs';

guardLogs();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name) => { const i = process.argv.indexOf(name); return i === -1 ? null : process.argv[i + 1]; };
const NETWORK = checkNetwork(arg('--network') ?? 'preview');
const RECEIPT = arg('--receipt');
const hex = (u) => Buffer.from(u).toString('hex');
const fail = (m) => { console.error(`\nSTOP: ${m}`); process.exit(1); };

let record, chain;
try {
    record = deployRecord(NETWORK);
    chain = await readContract(NETWORK, record.contractAddress);
} catch (e) { fail(e.message); }
const address = record.contractAddress;
const stateBytes = chain.bytes;
const L = chain.ledger;

console.log(`network      ${NETWORK} (ledger ${chain.era})`);
console.log(`contract     ${address}`);
console.log(`latest       ${chain.latest.kind} in block ${chain.latest.blockHeight}, tx ${chain.latest.txHash}`);
console.log(`state        ${stateBytes.length} bytes\n`);

const maps = ['passports', 'registrar', 'fieldCommitment', 'fieldRule', 'claims', 'relClaims', 'allowedRegistrars', 'writers', 'fieldWriter', 'grants', 'registrarApprovals', 'registrarBallots'];
for (const m of maps) console.log(`${m.padEnd(18)} ${L[m].size()}`);
console.log(`${'registrarEpoch'.padEnd(18)} ${L.registrarEpoch}`);

const passportKeys = [...L.passports].map(([k]) => hex(k));
const grants = new Map([...L.grants].map(([k, t]) => [hex(k), Number(t)]));
console.log('\npassport keys (vehicle keys, as published):');
for (const k of passportKeys) console.log(`  ${k}`);
console.log('grants (key: tier):');
for (const [k, t] of grants) console.log(`  ${k}: ${Tier[t] ?? t}`);

// Events (D29), from the indexer: one per state change, naming only a record.
let rawEvents = [];
try { rawEvents = await readContractEvents(NETWORK, address); } catch (e) { console.log(`\nevents       could not be read: ${e.message}`); }
const events = rawEvents.map((e) => ({ ...e, decoded: decodeIndexerEvent(e) }));
const byKind = {};
for (const e of events) byKind[e.decoded?.kind ?? `(not a VINPassport event: ${e.type})`] = (byKind[e.decoded?.kind ?? `(not a VINPassport event: ${e.type})`] ?? 0) + 1;
console.log(`\nevents       ${events.length}, naming ${new Set(events.map((e) => e.decoded?.subject)).size} distinct record(s)`);
for (const [k, n] of Object.entries(byKind)) console.log(`  ${k.padEnd(18)} ${n}`);

// process.exit() while a fetch socket is still closing aborts Node on Windows
// (libuv UV_HANDLE_CLOSING, exit 127) even after READBACK OK; let it settle.
const settle = () => new Promise((res) => setTimeout(res, 250));
if (!RECEIPT) { await settle(); process.exit(0); }

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
const pinnedIds = (record.registrars ?? regs.map((g) => ({ id: g.hex }))).map((g) => g.id);
check('the local registrar file names the identities the deploy record pinned',
    sameMembers(new Set(pinnedIds), new Set(regs.map((g) => g.hex))));
const changes = record.registrarChanges ?? [];
const expected = expectedRegistrars(pinnedIds, changes);
check(`the registrar set on chain is the pinned set with ${changes.filter((c) => c.executed).length} recorded change(s) applied (${expected.size})`,
    sameMembers(expected, onChainAllow));
check('the receipt\'s registrar is one of the pinned ones', regs.some((g) => g.hex === r.registrar?.id));

const made = (r.onChain ?? []).flatMap((st) => [...String(st.label).matchAll(/grantDisclosure (\w+): (\w+)/g)]);
for (const [, label, tier] of made) {
    const id = regs.find((g) => g.label === GRANTEE_SLOT[label])?.hex;
    const t = id && grants.get(grantKeyOf(r.vinHash, id));
    check(`grant to the ${label} is on chain at ${tier}`, t !== undefined && Tier[t] === tier);
}
if (!made.length) console.log('     (the run made no grant)');

// Events against the receipt and the record. An event may name only a record
// the ledger or the deploy record holds (D29), and each call the receipt lists
// announces itself once, with the kind its circuit emits, in its transaction.
const known = new Set([...VEHICLE_KINDS, ...GOVERNANCE_KINDS]);
check(`every event is a VINPassport event of a known kind (${events.length})`,
    events.length > 0 && events.every((e) => e.decoded && known.has(e.decoded.kind)));
const proposals = new Set((record.registrarChanges ?? []).map((c) => c.proposal));
check('every event names a vehicle on chain or a recorded registrar proposal, and nothing else',
    events.every((e) => e.decoded && (passportKeys.includes(e.decoded.subject) || proposals.has(e.decoded.subject))));
const vehicleKey = String(r.vinHash).replace(/^0x/, '');
const mine = events.filter((e) => e.decoded?.subject === vehicleKey);
const expectedPerTx = (r.onChain ?? []).map((c) => ({ txHash: c.txHash, kind: CIRCUIT_KIND[c.circuit] }));
const matched = expectedPerTx.filter((x) => mine.filter((e) => e.txHash === x.txHash && e.decoded.kind === x.kind).length === 1);
check(`each of the receipt's calls announced itself once, with its kind, in its own transaction (${matched.length} of ${expectedPerTx.length})`,
    expectedPerTx.length > 0 && matched.length === expectedPerTx.length && mine.length === expectedPerTx.length);

console.log(checks.every(Boolean) ? '\nREADBACK OK' : '\nREADBACK FOUND A MISMATCH');
await settle();
process.exit(checks.every(Boolean) ? 0 : 1);
