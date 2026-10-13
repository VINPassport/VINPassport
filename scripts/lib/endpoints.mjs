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
 * because every client in this repo takes a URL string and offers no way to
 * pass a header: the wallet SDK's `indexerClientConnection`, `createTxBuilder`
 * and the Polkadot providers all want URLs. So the credential rides in the URL
 * whether we like it or not.
 *
 * The consequence is that any library which logs a URL logs the credential, and
 * `@polkadot/api` does exactly that when a socket closes. `guardLogs()` at the
 * bottom of this file is the answer, and it has to be called before anything
 * connects. Storing the id outside the repository was never the weak point; the
 * output was.
 *
 * The id is a credential: it is read from the environment or from
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
import { inspect } from 'node:util';

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

/**
 * Redact the project id from everything this process writes, including what
 * libraries write.
 *
 * `redacted()` only helps where WE do the printing. The credential travels in
 * the URL because every client here takes a URL string and gives us no way to
 * send a header instead, and `@polkadot/api` prints the whole URL when a socket
 * closes:
 *
 *   RPC-CORE: subscribeRuntimeVersion(): disconnected from
 *   wss://rpc.midnight-preprod.blockfrost.io/?project_id=<the credential>
 *
 * That is not configurable, so on 2026-10-13 a deploy run printed the project
 * id in full and it had to be rotated. Wrapping the two output streams catches
 * it wherever it comes from.
 *
 * Call this BEFORE anything connects. Returns a function that restores the
 * original streams.
 *
 * A stream wrapper alone is NOT enough, and the gap is the one that matters.
 * Node prints an uncaught exception through an internal fatal-error printer
 * that never calls `process.stderr.write`, so the wrapper cannot see it, and
 * that dump inspects the whole error including any `Response` object holding
 * the request URL. Measured on 2026-10-13: with the wrapper alone, five
 * occurrences were redacted and one still got through, from exactly there. So
 * the fatal handlers below print the error themselves, through the guarded
 * stream, and keep exit code 1.
 *
 * Honest about the remaining limit: this replaces the secret in each chunk as
 * it is written, so a secret split across two separate writes would slip
 * through. In practice a log line is one write. It is a backstop, not a licence
 * to print credentials.
 */
export function guardLogs({ alsoRedact = [], fatal = true } = {}) {
    const secrets = [blockfrostToken({ required: false }), ...alsoRedact]
        // A short or empty needle would match everywhere and rewrite the stream
        // character by character. Refuse rather than mangle: that exact mistake
        // destroyed a run log on 2026-10-13.
        .filter((s) => typeof s === 'string' && s.trim().length >= 8)
        .map((s) => s.trim());

    if (!secrets.length) return () => { };

    const restorers = [];
    for (const stream of [process.stdout, process.stderr]) {
        const original = stream.write;
        restorers.push(() => { stream.write = original; });
        stream.write = function (chunk, encoding, callback) {
            let out = chunk;
            if (typeof out === 'string') {
                for (const s of secrets) if (out.includes(s)) out = out.split(s).join('<redacted>');
            } else if (Buffer.isBuffer(out)) {
                const text = out.toString('utf8');
                let replaced = text;
                for (const s of secrets) if (replaced.includes(s)) replaced = replaced.split(s).join('<redacted>');
                if (replaced !== text) out = Buffer.from(replaced, 'utf8');
            }
            return original.call(this, out, encoding, callback);
        };
    }

    if (fatal) {
        // Print the error ourselves so it goes through the wrapper above, then
        // exit 1, which is what an uncaught exception does anyway. Nothing is
        // swallowed: the whole error is inspected deeply enough to show the
        // cause chain the default dump would have shown.
        const onFatal = (label) => (err) => {
            try {
                console.error(`${label}: ${inspect(err, { depth: 8, colors: false })}`);
            } catch {
                console.error(`${label}: <the error could not be formatted>`);
            }
            process.exit(1);
        };
        // Do not clobber a handler something else installed deliberately.
        for (const [event, label] of [['uncaughtException', 'uncaught exception'],
            ['unhandledRejection', 'unhandled rejection']]) {
            if (process.listenerCount(event) === 0) {
                const h = onFatal(label);
                process.on(event, h);
                restorers.push(() => process.removeListener(event, h));
            }
        }
    }

    return () => restorers.forEach((r) => r());
}
