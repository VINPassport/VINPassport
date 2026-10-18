/**
 * `npm run app:preprod` - the app server with the preprod engine switched on.
 *
 * Same process as `npm run app`, with the environment DEMO-MODE.md documents
 * already filled in from the local layout. It exists so that starting the
 * engine is one short, exact command rather than five environment variables
 * typed by hand, each of which is silent when it is wrong: a mistyped
 * VINPASSPORT_PREPROD leaves a server that looks healthy and answers
 * `{"enabled":false}`, and a mistyped path fails minutes later inside warmup.
 *
 * A fixed command is also the only kind a permission rule can usefully name.
 *
 * Every value here is a default, so anything already set in the environment
 * wins and nothing below has to be edited to point somewhere else.
 *
 * The secrets stay where they are: outside the repository, in the sibling
 * _local-tracking directory, which is where preprod-runner.mjs already looks
 * for the registrar file. This script names those paths; it never reads them.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL = join(ROOT, '..', '_local-tracking');

const fallback = (name, value) => { process.env[name] ??= value; };

process.env.VINPASSPORT_PREPROD = '1';
fallback('VINPASSPORT_SEED_FILE', join(LOCAL, 'DEPLOY-SEED.env'));
fallback('VINPASSPORT_STATE_DIR', join(LOCAL, 'dust-state'));
fallback('VINPASSPORT_DEMO_CAP', '20');
// 8790 is the plain server's default and is usually already taken on a
// development machine. A preprod server deliberately will not shift to a free
// port, because two processes on one seed spend the same dust twice, so it
// would refuse to start rather than quietly move.
fallback('PORT', '8798');

// Say what is missing now, by name, instead of failing inside warmup minutes
// later with the wallet half up.
const missing = [
    ['VINPASSPORT_SEED_FILE', process.env.VINPASSPORT_SEED_FILE],
    ['VINPASSPORT_STATE_DIR', process.env.VINPASSPORT_STATE_DIR],
].filter(([, path]) => !existsSync(path));
if (missing.length) {
    for (const [name, path] of missing) console.error(`  ${name} points at ${path}, which does not exist`);
    console.error('\nSet it in the environment, or see docs/DEMO-MODE.md for what belongs there.');
    process.exit(2);
}

console.log(`app:preprod  port ${process.env.PORT}  state ${process.env.VINPASSPORT_STATE_DIR}`);
await import('./app-server.mjs');
