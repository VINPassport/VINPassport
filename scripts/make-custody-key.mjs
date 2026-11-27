#!/usr/bin/env node
/**
 * Create a network's maintenance custody key and print its public verifying key.
 *
 *   node scripts/make-custody-key.mjs --network preview
 *   VINPASSPORT_CUSTODY_KEY_FILE=<path outside any synced folder> node scripts/make-custody-key.mjs --network mainnet
 *
 * The custody key holds the contract's maintenance authority from the deploy
 * until `scripts/maintenance.mjs handover` passes it to the committee
 * (DECISIONS D28). The deploy script reads it from the same place and, on
 * mainnet, never creates it: a mistyped VINPASSPORT_CUSTODY_KEY_FILE then fails
 * instead of silently minting a fresh key nobody has backed up.
 *
 * Guards, because the key file is the authority:
 *   - an existing file is never overwritten (written with flag wx, mode 0600);
 *   - Preview and preprod default to `_local-tracking/CUSTODY-KEY.<network>.env`,
 *     above the repository, where git cannot see it;
 *   - mainnet has no default: VINPASSPORT_CUSTODY_KEY_FILE must name the file,
 *     and a path inside OneDrive, Dropbox, iCloud or Google Drive is refused.
 *
 * Back the mainnet file up before the deploy: losing it before the handover
 * loses the power to insert the circuits a stepped deploy still owes.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { sampleSigningKey, signatureVerifyingKey } from '@midnightntwrk/ledger-v9';
import { requireBuildableNetwork } from './lib/eras.mjs';
import { custodyKeyFile } from './lib/local-credentials.mjs';

const arg = (flag) => {
    const i = process.argv.indexOf(flag);
    return i === -1 ? undefined : process.argv[i + 1];
};
const fail = (msg) => { console.error(`make-custody-key: ${msg}`); process.exit(1); };

const network = arg('--network');
if (!network) fail('name the network: --network preview | mainnet');
try { requireBuildableNetwork(network); } catch (e) { fail(e.message); }

let out;
try { out = custodyKeyFile(network); } catch (e) { fail(e.message); }
if (existsSync(out)) fail(`${out} exists. A key file is never overwritten.`);

const sk = sampleSigningKey('schnorr');
const vk = signatureVerifyingKey(sk);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, [
    `# Maintenance custody key for ${network} (schnorr), created ${new Date().toISOString().slice(0, 10)} by scripts/make-custody-key.mjs.`,
    `# Never print it, never commit it. Verifying key: ${vk.value}`,
    `VINPASSPORT_CUSTODY_KEY_HEX=${sk.value}`,
    ''
].join('\n'), { mode: 0o600, flag: 'wx' });

console.log(`custody key written to ${out}`);
console.log(`verifying key (schnorr): ${vk.value}`);
if (network === 'mainnet') console.log('Back this file up now: the deploy reads it and never creates a mainnet key.');
