#!/usr/bin/env node
/**
 * The contract's maintenance authority on ledger 9 (DECISIONS D28).
 *
 *   node scripts/maintenance.mjs status   --network preview              read only
 *   node scripts/maintenance.mjs handover --network preview [--submit]   custody key -> committee
 *
 *   node scripts/maintenance.mjs propose  --network preview --insert passportOf,hasClaim [--build <dir>] [--title "..."]
 *   node scripts/maintenance.mjs propose  --network preview --replace-authority deploy/committee.preview.json
 *   node scripts/maintenance.mjs sign     --proposal <file> --key <member key file> [--check-chain]
 *   node scripts/maintenance.mjs submit   --proposal <file> [--submit]
 *
 * The authority decides who may insert or replace verifier keys, which is
 * what lets the contract take new circuits, or a new toolchain's keys, in
 * place instead of a redeploy that would start an empty ledger.
 *
 * HANDOVER. Midnight.js deploys with one key at threshold 1 and can only ever
 * replace it with another single key, so the handover to the committee is
 * built here with the ledger's own types:
 *
 *   MaintenanceUpdate(address, [ReplaceAuthority(Authority(committee, 2, counter + 1))], counter)
 *
 * signed by the custody key (the sole member, index 0). The new authority's
 * counter is the current one plus one, and the update is valid against the
 * current one, which is how Midnight.js's own single-key replacement builds
 * it (compact-js executable, createMaintenanceAuthority).
 *
 * PROPOSE, SIGN, SUBMIT. After the handover every update needs a threshold
 * of the committee, who sit on different machines. `propose` reads the
 * authority from the chain and writes a proposal file stating the update in
 * readable parts (scripts/lib/maintenance9.mjs). Each member runs `sign` on
 * their own machine with their own key file: the tool rebuilds the update
 * from the parts, prints what it does and its fingerprint, and adds the
 * member's signature over the ledger's `dataToSign`. Anyone holding the file
 * runs `submit`, which checks the chain's authority is still the one the
 * proposal was made against, that enough signatures verify, and that no key
 * being inserted is already there; then the deploy wallet pays the fee in
 * DUST. The executed proposal, signatures included, is written to
 * deploy/maintenance/<network>/ so anyone can re-verify it.
 *
 * Proposals are public: they hold the address, the counter, public keys,
 * verifier keys and signatures, never a signing key.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
    ContractState, ContractMaintenanceAuthority, Intent, MaintenanceUpdate, ReplaceAuthority, Transaction, signData
} from '@midnightntwrk/ledger-v9';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { networkEndpoints, guardLogs } from './lib/endpoints.mjs';
import { requireBuildableNetwork } from './lib/eras.mjs';
import { openWallet, describe as describeWallet } from './lib/wallet9.mjs';
import { custodyKey, recordPath, BUILD_DIR, PROVABLE, buildFacts } from './lib/contract9.mjs';
import { LOCAL_DIR } from './lib/local-credentials.mjs';
import { buildId } from './lib/build-id.mjs';
import {
    makeProposal, insertVerifierKey, removeVerifierKey, replaceAuthority, validateProposal, describe,
    signProposal, checkSignatures, signedUpdate, fingerprint, REMOVE_BLOCKED
} from './lib/maintenance9.mjs';

const arg = (flag) => {
    const i = process.argv.indexOf(flag);
    return i === -1 ? undefined : process.argv[i + 1];
};
const log = (...a) => console.log(...a);
const fail = (msg) => { console.error(`\nSTOP: ${msg}`); process.exit(1); };
const SYNCED = /onedrive|dropbox|icloud|google ?drive/i;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SUBMIT = process.argv.includes('--submit');
const COMMANDS = ['status', 'handover', 'propose', 'sign', 'submit'];

const command = process.argv[2];
if (!COMMANDS.includes(command)) {
    fail(`usage: node scripts/maintenance.mjs ${COMMANDS.join('|')} ... (see the header of this file)`);
}

// ------------------------------------------------------------------ sign
// Offline unless --check-chain: a member needs the proposal and their own key
// file, nothing else. The key is read once, redacted from all output, and
// never written anywhere.
if (command === 'sign') {
    const proposalPath = arg('--proposal');
    const keyPath = arg('--key');
    if (!proposalPath || !keyPath) fail('usage: sign --proposal <file> --key <member key file> [--check-chain]');
    const p = JSON.parse(readFileSync(proposalPath, 'utf8'));
    try { validateProposal(p); } catch (e) { fail(e.message); }
    if (p.network === 'mainnet' && SYNCED.test(resolve(keyPath))) {
        fail(`refusing a mainnet key in ${resolve(keyPath)}: a synced folder copies it off this machine.`);
    }
    const env = Object.fromEntries(readFileSync(keyPath, 'utf8').split(/\r?\n/)
        .map((l) => /^([A-Z0-9_]+)=(.*)$/.exec(l.trim())).filter(Boolean).map((m) => [m[1], m[2].trim()]));
    const hex = env.VINPASSPORT_COMMITTEE_KEY_HEX;
    const kind = env.VINPASSPORT_COMMITTEE_KEY_KIND ?? 'schnorr';
    if (!hex) fail(`${keyPath} holds no VINPASSPORT_COMMITTEE_KEY_HEX`);
    guardLogs({ alsoRedact: [hex] });
    if (p.dataToSignSha256 && p.dataToSignSha256 !== fingerprint(p)) {
        fail('the fingerprint recorded at proposal time does not match the proposal as it stands: it was edited. Do not sign.');
    }
    log(describe(p));
    if (process.argv.includes('--check-chain')) {
        const a = await chainAuthority(p.network, p.contractAddress);
        if (String(a.counter) !== p.counter) fail(`the chain's counter is ${a.counter}; this proposal was made against ${p.counter}. Do not sign.`);
        log('chain     authority counter matches');
    }
    let signed;
    try { signed = signProposal(p, { tag: kind, value: hex }, env.VINPASSPORT_COMMITTEE_MEMBER); } catch (e) { fail(e.message); }
    writeFileSync(proposalPath, JSON.stringify(signed, null, 2) + '\n');
    const { valid, threshold } = checkSignatures(signed);
    log(`\nsigned as member ${env.VINPASSPORT_COMMITTEE_MEMBER ?? '?'}; ${valid.length} of ${threshold} needed signatures now verify`);
    log(`written   ${proposalPath}`);
    process.exit(0);
}

// ------------------------------------------------------------------ everything else reads the chain
let proposal = null;
let network = arg('--network');
if (command === 'submit') {
    const proposalPath = arg('--proposal');
    if (!proposalPath) fail('usage: submit --proposal <file> [--submit]');
    proposal = JSON.parse(readFileSync(proposalPath, 'utf8'));
    try { validateProposal(proposal); } catch (e) { fail(e.message); }
    if (network && network !== proposal.network) fail(`--network ${network}, but the proposal is for ${proposal.network}`);
    network = proposal.network;
}
if (!network) fail(`${command} needs --network preview|mainnet`);
try { requireBuildableNetwork(network); } catch (e) { fail(e.message); }
guardLogs();

const RECORD = recordPath(network);
const COMMITTEE = join(ROOT, 'deploy', `committee.${network}.json`);
if (!existsSync(RECORD)) fail(`no deploy record at ${RECORD}: deploy first (scripts/deploy.mjs).`);
const record = JSON.parse(readFileSync(RECORD, 'utf8'));
const address = record.contractAddress;
if (proposal && proposal.contractAddress !== address) fail(`the proposal is for ${proposal.contractAddress}, the deploy record for ${address}`);

/** The contract state the indexer holds now. */
async function chainState(net, addr) {
    const ep = networkEndpoints(net);
    const pdp = indexerPublicDataProvider({ queryURL: ep.indexerHttpUrl, subscriptionURL: ep.indexerWsUrl });
    const read = await pdp.queryContractState(addr);
    if (!read) throw new Error(`the indexer has no contract at ${addr}`);
    return read.contractState.deserialize({ v9: ContractState });
}
async function chainAuthority(net, addr) {
    const a = (await chainState(net, addr)).maintenanceAuthority;
    return { committee: a.committee.map((k) => ({ tag: k.tag, value: k.value })), threshold: a.threshold, counter: a.counter };
}
const opName = (o) => (typeof o === 'string' ? o : Buffer.from(o).toString('hex'));

const short = (vk) => `${vk.tag} ${vk.value.slice(0, 16)}...`;
const show = (a) => [
    `threshold ${a.threshold} of ${a.committee.length}, counter ${a.counter}`,
    ...a.committee.map((k, i) => `  [${i}] ${short(k)}`)
].join('\n');

const current = await chainAuthority(network, address);
log(`contract  ${address} (${network})`);
log(`authority ${show(current)}`);

if (command === 'status') {
    const recorded = record.authority?.committee?.map((k) => k.value) ?? [];
    const same = recorded.length === current.committee.length && recorded.every((v, i) => v === current.committee[i].value)
        && record.authority?.threshold === current.threshold
        && (record.authority?.counter == null || BigInt(record.authority.counter) === current.counter);
    const ops = (await chainState(network, address)).operations().map(opName).sort();
    log(`circuits  ${ops.length} on chain: ${ops.join(', ')}`);
    log(same ? 'record    matches the chain' : 'record    DIFFERS from the chain: update deploy record before relying on it');
    process.exit(same ? 0 : 1);
}

// ------------------------------------------------------------------ propose
if (command === 'propose') {
    if (current.threshold < 2) fail('the authority is not a committee yet; run handover first (D28: never a single key).');
    const updates = [];
    const buildDir = resolve(arg('--build') ?? BUILD_DIR);
    let build;
    const ops = new Set((await chainState(network, address)).operations().map(opName));
    for (const circuit of (arg('--insert') ?? '').split(',').filter(Boolean)) {
        if (ops.has(circuit)) fail(`${circuit} already has a verifier key on chain. Replacing one needs a removal first, which ledger 9 refuses today (${REMOVE_BLOCKED}).`);
        const file = join(buildDir, 'keys', `${circuit}.verifier`);
        if (!existsSync(file)) fail(`no verifier key at ${file}`);
        updates.push(insertVerifierKey(circuit, readFileSync(file)));
    }
    if (updates.length) {
        const manifest = join(buildDir, 'compiler', 'contract-manifest.json');
        build = {
            dir: buildDir.startsWith(ROOT) ? buildDir.slice(ROOT.length + 1).split('\\').join('/') : basename(buildDir),
            manifestSha256: existsSync(manifest) ? createHash('sha256').update(readFileSync(manifest)).digest('hex') : null
        };
    }
    for (const circuit of (arg('--remove') ?? '').split(',').filter(Boolean)) {
        if (!ops.has(circuit)) fail(`${circuit} has no verifier key on chain to remove`);
        updates.push(removeVerifierKey(circuit));
    }
    const authorityFile = arg('--replace-authority');
    if (authorityFile) {
        const list = JSON.parse(readFileSync(authorityFile, 'utf8'));
        updates.push(replaceAuthority(list.members.map((m) => m.verifyingKey), list.threshold));
    }
    if (!updates.length) fail('nothing to propose: give --insert, --remove or --replace-authority');
    let p;
    try {
        p = makeProposal({ network, contractAddress: address, authority: current, updates, build, title: arg('--title') ?? updates.map((u) => `${u.op} ${u.circuit ?? ''}`.trim()).join(', ') });
    } catch (e) { fail(e.message); }
    const out = resolve(arg('--out') ?? join(LOCAL_DIR, 'proposals', network, `counter-${p.counter}-${Date.now()}.json`));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, JSON.stringify(p, null, 2) + '\n', { flag: 'wx' });
    log(`\n${describe(p)}`);
    log(`\nwritten   ${out}`);
    log(`next      each member: node scripts/maintenance.mjs sign --proposal "${out}" --key <their key file>`);
    process.exit(0);
}

// ------------------------------------------------------------------ build the transaction
let update;
let expect;
if (command === 'handover') {
    const custody = custodyKey(network);
    if (current.threshold !== 1 || current.committee.length !== 1 || current.committee[0].value !== custody.verifyingKey.value) {
        fail('the chain\'s authority is not the custody key alone, so it has already been handed over (or the custody key file is not the one this contract was deployed with).');
    }
    if (!existsSync(COMMITTEE)) fail(`no committee list at ${COMMITTEE}. Create members with scripts/make-committee-key.mjs.`);
    const list = JSON.parse(readFileSync(COMMITTEE, 'utf8'));
    const vks = list.members.map((m) => m.verifyingKey);
    if (vks.length < 2 || list.threshold < 2 || list.threshold > vks.length) {
        fail(`${COMMITTEE} lists ${vks.length} member(s) at threshold ${list.threshold}; D28 asks for at least 2 of 3.`);
    }
    if (new Set(vks.map((k) => k.value)).size !== vks.length) fail('the committee lists the same key twice.');
    if (vks.some((k) => k.value === custody.verifyingKey.value)) fail('the custody key is listed as a committee member; it is meant to retire.');
    const next = new ContractMaintenanceAuthority(vks, list.threshold, current.counter + 1n);
    log(`\nhandover  to ${show({ committee: vks, threshold: list.threshold, counter: current.counter + 1n })}`);
    const unsigned = new MaintenanceUpdate(address, [new ReplaceAuthority(next)], current.counter);
    update = unsigned.addSignature(0n, signData(custody.key, unsigned.dataToSign));
    expect = { list };
} else {
    // submit
    log(`\n${describe(proposal)}`);
    const { valid, invalid, threshold } = checkSignatures(proposal);
    for (const s of invalid) log(`  ignored signature at index ${s.index}: ${s.why}`);
    log(`signatures ${valid.length} valid of ${threshold} needed (${valid.map((s) => s.member ?? `#${s.index}`).join(', ')})`);
    if (proposal.updates.some((u) => u.op === 'removeVerifierKey')) {
        fail(`the proposal removes a verifier key, which ledger 9 refuses at submission today (${REMOVE_BLOCKED}). Not submitting.`);
    }
    const ops = new Set((await chainState(network, address)).operations().map(opName));
    for (const u of proposal.updates) {
        if (u.op === 'insertVerifierKey' && ops.has(u.circuit)) fail(`${u.circuit} already has a verifier key on chain; the insert would be refused.`);
    }
    try { update = signedUpdate(proposal, current); } catch (e) { fail(e.message); }
    expect = { proposal };
}
log(SUBMIT ? 'mode      SUBMIT: submits and pays the fee from the deploy wallet' : 'mode      dry run: builds and signs, submits nothing');

const ttl = new Date(Date.now() + 30 * 60_000);
const tx = Transaction.fromParts(network, undefined, undefined, Intent.new(ttl).addMaintenanceUpdate(update));

const w = await openWallet(network, { log });
let code = 0;
try {
    const state = await w.synced();
    log(describeWallet(state));
    const handle = w.wallet.adoptTransaction(tx.serialize(), 'Unproven');
    if (!SUBMIT) {
        let fee, scope = 'with balancing';
        try { fee = await w.wallet.estimateTransactionFee(handle); } catch {
            fee = await w.wallet.calculateTransactionFee(handle);
            scope = 'update only; balancing adds a little';
        }
        log(`\nestimated fee ${fee} SPECK (${scope}). Dry run complete; re-run with --submit.`);
    } else {
        const recipe = await w.wallet.balanceUnprovenTransaction(handle, { ttl });
        const signed = await w.wallet.signRecipe(recipe, w.sign);
        const finalized = await w.wallet.finalizeRecipe(signed);
        const id = await w.wallet.submitTransaction(finalized);
        log(`\nsubmitted, transaction id ${id}`);
        log('waiting for the indexer to show the new counter...');
        let seen = null;
        for (let i = 0; i < 50 && !seen; i++) {
            await new Promise((r) => setTimeout(r, 6000));
            const a = await chainAuthority(network, address).catch(() => null);
            if (a && a.counter === current.counter + 1n) seen = a;
        }
        if (!seen) throw new Error(`not visible after 5 minutes; check transaction ${id}, then run status`);
        log(`authority ${show(seen)}`);
        if (expect.list) {
            record.authority = {
                holder: 'committee',
                threshold: seen.threshold,
                counter: Number(seen.counter),
                committee: seen.committee,
                members: expect.list.members.map((m) => m.name),
                handoverTxId: id,
                handedOverAt: new Date().toISOString(),
                note: 'Committee per DECISIONS D28. The custody key no longer has any power over this contract.'
            };
        } else {
            // Every inserted key must now be on chain, byte for byte.
            const after = await chainState(network, address);
            for (const u of proposal.updates.filter((x) => x.op === 'insertVerifierKey')) {
                const onChain = after.operation(u.circuit)?.verifierKey;
                const ok = onChain && Buffer.from(onChain).toString('hex') === u.vkHex;
                log(`  ${u.circuit}: ${ok ? 'verifier key on chain, bytes match' : 'NOT FOUND or different'}`);
                if (!ok) code = 1;
            }
            // When the chain now carries every circuit of the build on disk,
            // byte for byte, the contract IS that build: move the deploy
            // record to it, so the runner (which refuses a build that is not
            // the deployed one) runs the new circuits. Otherwise leave the
            // record's build alone and say why.
            if (code === 0 && proposal.updates.some((x) => x.op === 'insertVerifierKey')) {
                const facts = buildFacts();
                const missing = PROVABLE.filter((c) => {
                    const onChain = after.operation(c)?.verifierKey;
                    return !onChain || !Buffer.from(onChain).equals(readFileSync(join(BUILD_DIR, 'keys', `${c}.verifier`)));
                });
                if (missing.length) {
                    log(`build     record unchanged: the chain does not carry ${missing.join(', ')} from the build on disk`);
                } else {
                    record.build = {
                        ...facts,
                        upgradedAt: new Date().toISOString(),
                        upgradedBy: `maintenance counter ${proposal.counter}`,
                        previousManifestSha256: record.build?.manifestSha256 ?? null,
                        previousBuildId: record.buildId ?? null
                    };
                    record.buildId = buildId();
                    log(`build     record moved to the build on disk: all ${PROVABLE.length} circuits on chain match it`);
                }
            }
            const replaced = proposal.updates.find((x) => x.op === 'replaceAuthority');
            record.authority = { ...record.authority, threshold: seen.threshold, counter: Number(seen.counter), committee: seen.committee };
            if (replaced) record.authority.note = `Replaced by committee proposal at counter ${proposal.counter}.`;
            record.maintenance = [...(record.maintenance ?? []), {
                counter: Number(proposal.counter),
                txId: id,
                at: new Date().toISOString(),
                fingerprint: fingerprint(proposal),
                signedBy: checkSignatures(proposal).valid.map((s) => s.member ?? `#${s.index}`),
                updates: proposal.updates.map(({ op, circuit, version, vkSha256, threshold }) => ({ op, circuit, version, vkSha256, threshold }))
            }];
            const auditDir = join(ROOT, 'deploy', 'maintenance', network);
            mkdirSync(auditDir, { recursive: true });
            const audit = join(auditDir, `counter-${proposal.counter}.json`);
            writeFileSync(audit, JSON.stringify({ ...proposal, executed: { txId: id, at: new Date().toISOString(), newCounter: Number(seen.counter) } }, null, 2) + '\n');
            log(`audit     ${audit}`);
        }
        writeFileSync(RECORD, JSON.stringify(record, null, 2) + '\n');
        log(`recorded  ${RECORD}`);
    }
} catch (e) {
    console.error(`\nmaintenance: ${e?.message ?? e}`);
    code = 1;
} finally {
    await w.close();
}
process.exit(code);
