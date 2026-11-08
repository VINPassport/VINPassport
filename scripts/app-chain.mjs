/**
 * `npm run app:chain` - the app server with the chain demo switched on: the
 * site's "run it on chain" buttons submit real transactions to the contract
 * deployed on VINPASSPORT_NETWORK_ID (default preview), through the ledger 9
 * runner (scripts/lib/runner9.mjs).
 *
 * Every value here is a default; anything already set in the environment
 * wins. The secrets stay where they are, in the sibling _local-tracking
 * directory, and this script names no secret: the wallet library finds the
 * deploy seed for the network itself (scripts/lib/wallet9.mjs).
 *
 * Replaces app-preprod.mjs (ledger 8, at the git tag ledger8-preprod).
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { requireBuildableNetwork } from './lib/eras.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fallback = (name, value) => { process.env[name] ??= value; };

process.env.VINPASSPORT_CHAIN = '1';
fallback('VINPASSPORT_NETWORK_ID', 'preview');
fallback('VINPASSPORT_DEMO_CAP', '20');
// Not the plain server's 8790: two processes on one seed spend the same DUST
// twice, so this one refuses a taken port rather than shifting to another.
fallback('PORT', '8798');

const network = process.env.VINPASSPORT_NETWORK_ID;
try { requireBuildableNetwork(network); } catch (e) { console.error(e.message); process.exit(2); }
const record = join(ROOT, 'deploy', `${network}.json`);
if (!existsSync(record)) {
    console.error(`no contract deployed on ${network} yet (${record} is missing). Deploy first: node scripts/deploy.mjs --network ${network}`);
    process.exit(2);
}

console.log(`app:chain  network ${network}  port ${process.env.PORT}`);
await import('./app-server.mjs');
