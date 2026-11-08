#!/usr/bin/env node
/**
 * Create one maintenance committee member's signing key, and add its public
 * verifying key to the committee list (DECISIONS D28: 2 of 3).
 *
 *   node scripts/make-committee-key.mjs --network preview --member rehearsal-1
 *   node scripts/make-committee-key.mjs --network mainnet --member <name> --out <path outside synced folders> [--kind ecdsa]
 *
 * Each member runs this on their own machine. The signing key stays in the
 * member's file; only the verifying key, which is public, goes into
 * `deploy/committee.<network>.json`, the list `scripts/maintenance.mjs
 * handover` installs on the contract. For the Preview rehearsal one machine
 * may hold all three; for mainnet, three holders and three machines.
 *
 * `--kind ecdsa` makes a secp256k1 key, which the ledger 9 maintenance
 * authority accepts alongside Schnorr, so a member can later sign from an HSM
 * or a cloud KMS that speaks secp256k1.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sampleSigningKey, signatureVerifyingKey } from '@midnightntwrk/ledger-v9';
import { requireBuildableNetwork } from './lib/eras.mjs';
import { credentialPath } from './lib/local-credentials.mjs';

const arg = (flag) => {
    const i = process.argv.indexOf(flag);
    return i === -1 ? undefined : process.argv[i + 1];
};
const fail = (msg) => { console.error(`make-committee-key: ${msg}`); process.exit(1); };

const network = arg('--network');
const member = arg('--member');
const kind = arg('--kind') ?? 'schnorr';
if (!network || !member) fail('usage: --network preview|mainnet --member <name> [--out <path>] [--kind schnorr|ecdsa]');
try { requireBuildableNetwork(network); } catch (e) { fail(e.message); }
if (!/^[a-z0-9-]{1,32}$/.test(member)) fail('--member is a short name: lower case letters, digits and hyphens');
if (!['schnorr', 'ecdsa'].includes(kind)) fail('--kind is schnorr or ecdsa');

const SYNCED = /onedrive|dropbox|icloud|google ?drive/i;
let out = arg('--out');
if (network === 'mainnet') {
    if (!out) fail('mainnet has no default location. Pass --out with a path outside any synced folder.');
    if (SYNCED.test(resolve(out))) fail(`refusing ${resolve(out)}: a synced folder copies the key off this machine.`);
}
out = resolve(out ?? credentialPath(`COMMITTEE-KEY.${network}.${member}.env`));
if (existsSync(out)) fail(`${out} exists. A key file is never overwritten.`);

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const listPath = join(ROOT, 'deploy', `committee.${network}.json`);
const list = existsSync(listPath)
    ? JSON.parse(readFileSync(listPath, 'utf8'))
    : { network, threshold: 2, members: [], note: 'Public verifying keys of the maintenance committee (DECISIONS D28). Signing keys stay with each member.' };
if (list.members.some((m) => m.name === member)) fail(`${listPath} already lists a member named ${member}`);

const sk = sampleSigningKey(kind);
const vk = signatureVerifyingKey(sk);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, [
    `# Maintenance committee key for ${network}, member ${member} (${kind}), created ${new Date().toISOString().slice(0, 10)}.`,
    `# Never print it, never commit it. Verifying key: ${vk.value}`,
    `VINPASSPORT_COMMITTEE_MEMBER=${member}`,
    `VINPASSPORT_COMMITTEE_KEY_KIND=${kind}`,
    `VINPASSPORT_COMMITTEE_KEY_HEX=${sk.value}`,
    ''
].join('\n'), { mode: 0o600, flag: 'wx' });

list.members.push({ name: member, verifyingKey: vk, addedAt: new Date().toISOString().slice(0, 10) });
mkdirSync(dirname(listPath), { recursive: true });
writeFileSync(listPath, JSON.stringify(list, null, 2) + '\n');

console.log(`key written to ${out}`);
console.log(`verifying key (${kind}): ${vk.value}`);
console.log(`${listPath} now lists ${list.members.length} member(s), threshold ${list.threshold}`);
