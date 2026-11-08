#!/usr/bin/env node
/**
 * Create a deploy wallet's master seed and print the address to fund it at.
 *
 *   node scripts/make-deploy-seed.mjs --network preview
 *   node scripts/make-deploy-seed.mjs --network mainnet --out <path outside any synced folder>
 *
 * The seed is 64 random bytes, written as VINPASSPORT_SEED_HEX=<128 hex> to a
 * file the runner and deploy script read through VINPASSPORT_SEED_FILE. It is
 * never printed. What is printed is the unshielded address, which is public:
 * the faucet (Preview) or a NIGHT transfer pays to it, and DUST registration
 * starts from the NIGHT that arrives there.
 *
 * Guards, because a seed file is the wallet:
 *   - an existing file is never overwritten;
 *   - Preview and preprod default to `_local-tracking/`, above the repository,
 *     where git cannot see it;
 *   - mainnet has no default and refuses a path inside OneDrive, Dropbox,
 *     iCloud or Google Drive: a synced folder copies the key to a third party
 *     and to every device on the account.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WalletSeeds } from '@midnightntwrk/wallet-sdk-hd';
import { createKeystore } from '@midnightntwrk/wallet-sdk-unshielded-wallet';
import { checkNetwork } from './lib/endpoints.mjs';
import { credentialPath } from './lib/local-credentials.mjs';

const arg = (flag) => {
    const i = process.argv.indexOf(flag);
    return i === -1 ? undefined : process.argv[i + 1];
};
const fail = (msg) => { console.error(`make-deploy-seed: ${msg}`); process.exit(1); };

const network = arg('--network');
if (!network) fail('name the network: --network preview | mainnet');
try { checkNetwork(network); } catch (e) { fail(e.message); }

const SYNCED = /onedrive|dropbox|icloud|google ?drive/i;
let out = arg('--out');
if (network === 'mainnet') {
    if (!out) fail('mainnet has no default location. Pass --out with a path outside any synced folder.');
    if (SYNCED.test(resolve(out))) fail(`refusing ${resolve(out)}: a synced folder copies the mainnet key off this machine.`);
} else {
    out ??= credentialPath(`DEPLOY-SEED.${network}.env`);
}
out = resolve(out);
if (existsSync(out)) fail(`${out} exists. A seed file is a wallet; this never overwrites one.`);

const seed = randomBytes(64);
const seeds = WalletSeeds.fromMasterSeed(seed);
const address = createKeystore({ kind: 'schnorr', secret: seeds.unshielded }, network).getBech32Address().asString();

writeFileSync(out, [
    `# Deploy wallet for ${network}, created ${new Date().toISOString().slice(0, 10)} by scripts/make-deploy-seed.mjs.`,
    `# The master seed. Never print it, never commit it. Unshielded address: ${address}`,
    `VINPASSPORT_SEED_HEX=${seed.toString('hex')}`,
    ''
].join('\n'), { mode: 0o600, flag: 'wx' });
seed.fill(0);

console.log(`seed written to ${out}`);
console.log(`unshielded address (${network}): ${address}`);
