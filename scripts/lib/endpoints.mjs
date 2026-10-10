/**
 * Where preprod lives, in one place.
 *
 * Midnight decommissioned `indexer.preprod.midnight.network` on 2026-10-09
 * and moved the preprod and mainnet indexers to Blockfrost. The old host now
 * answers HTTP 410 with a pointer to the migration guide, so every script that
 * had the URL written into it stopped working on the same day. That is the
 * reason this module exists: one place to change, not six.
 *
 * Verified against the live service 2026-10-10:
 *
 *   GraphQL      POST https://midnight-preprod.blockfrost.io/api/v0      -> 200
 *                (/api/v0/graphql is a 404; the GraphQL endpoint is the root)
 *   WebSocket    wss://midnight-preprod.blockfrost.io/api/v0/ws          -> 101
 *   RPC          https://rpc.midnight-preprod.blockfrost.io/             -> ok
 *
 * Auth is a per-network Blockfrost project id, accepted either as a
 * `project_id` header or as `?project_id=`. The query-string form is used here
 * because a WebSocket client cannot set headers, and one form everywhere beats
 * two. The id is a credential: it is read from the environment or from
 * `_local-tracking/`, which sits above the repository root, and it must never
 * reach browser code, where it would be public.
 *
 * The RPC at `rpc.preprod.midnight.network` was still answering when this was
 * written, but it is on the same retirement notice as the indexer, so it is
 * not relied on.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const TOKEN_FILE = join(HERE, '..', '..', '..', '_local-tracking', 'BLOCKFROST.env');
const TOKEN_VAR = 'BLOCKFROST_MIDNIGHT_PREPROD';

const MIGRATION = 'https://docs.midnight.network/guides/networks-and-environments';

/**
 * The Blockfrost project id for Midnight Preprod.
 *
 * A project id is scoped to one network, so the preprod id will not work
 * against mainnet and vice versa.
 */
export function blockfrostToken({ required = true } = {}) {
    const fromEnv = process.env[TOKEN_VAR]?.trim();
    if (fromEnv) return fromEnv;

    if (existsSync(TOKEN_FILE)) {
        const line = readFileSync(TOKEN_FILE, 'utf8')
            .split(/\r?\n/)
            .find((l) => l.startsWith(`${TOKEN_VAR}=`));
        const value = line?.slice(TOKEN_VAR.length + 1).trim();
        if (value) return value;
    }

    if (!required) return null;
    throw new Error(
        `${TOKEN_VAR} is not set, and preprod cannot be reached without it.\n`
        + `  Midnight retired its own preprod indexer on 2026-10-09; access is now through\n`
        + `  Blockfrost, with one project per network. Put the project id in\n`
        + `  ${TOKEN_FILE}\n  as ${TOKEN_VAR}=<id>, or set it in the environment.\n`
        + `  ${MIGRATION}`
    );
}

/**
 * Preprod endpoints, authenticated. Throws if the project id is missing.
 *
 * The RPC host takes a WebSocket upgrade on its root (verified 101) and has
 * no separate `/ws` path, unlike the indexer.
 */
export function preprodEndpoints() {
    const q = `?project_id=${encodeURIComponent(blockfrostToken())}`;
    return {
        networkId: 'preprod',
        indexerHttpUrl: `https://midnight-preprod.blockfrost.io/api/v0${q}`,
        indexerWsUrl: `wss://midnight-preprod.blockfrost.io/api/v0/ws${q}`,
        nodeHttpUrl: `https://rpc.midnight-preprod.blockfrost.io/${q}`,
        nodeWsUrl: `wss://rpc.midnight-preprod.blockfrost.io/${q}`
    };
}

/**
 * The same, with the credential replaced, for anything that gets printed.
 * A URL with a project id in it should never reach a log or a transcript.
 */
export function redacted(url) {
    return String(url).replace(/project_id=[^&]*/g, 'project_id=…');
}
