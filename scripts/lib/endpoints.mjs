/**
 * Where each network lives, in one place: Preview, preprod, and mainnet when
 * it is chosen explicitly. Nothing defaults to mainnet.
 *
 * Preview is open: Midnight hosts it and it takes no credential (relaunched on
 * Ledger 9 on 7 Nov 2026). Preprod and mainnet are behind Blockfrost, one
 * project id per network. The hosts below match the presets Midnight.js 5
 * ships (`networks.preview()` and friends in midnight-js-utils), and a test
 * holds them equal, so a moved endpoint shows up as a failing test here.
 * Which ledger each network runs, and so which of them this tree can deploy
 * to, is in eras.mjs.
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

const MIGRATION = 'https://docs.midnight.network/guides/networks-and-environments';

/**
 * The networks this repository can reach. The network id string is the one
 * the wallet SDK and Midnight.js expect (wallet-sdk-address-format maps
 * 'mainnet' to its mainnet symbol).
 */
export const NETWORKS = Object.freeze(['preview', 'preprod', 'mainnet']);

/** Networks behind Blockfrost, each with its own project id. Preview needs none. */
export const CREDENTIALED = Object.freeze(['preprod', 'mainnet']);

/** True for a network reached without any credential. */
export const isOpenNetwork = (network) => !CREDENTIALED.includes(checkNetwork(network));

/** Throws on anything but a known network, so a typo cannot pick a default. */
export function checkNetwork(network) {
    if (!NETWORKS.includes(network)) {
        throw new Error(`unknown network "${network}", expected one of ${NETWORKS.join(', ')}`);
    }
    return network;
}

const tokenVar = (network) => {
    if (isOpenNetwork(network)) throw new Error(`${network} is open and takes no Blockfrost project id`);
    return `BLOCKFROST_MIDNIGHT_${network.toUpperCase()}`;
};

/**
 * The Blockfrost project id for one Midnight network, preprod by default.
 *
 * A project id is scoped to one network, so the preprod id will not work
 * against mainnet and vice versa, and each is read from its own variable.
 */
export function blockfrostToken({ required = true, network = 'preprod' } = {}) {
    const name = tokenVar(network);
    const fromEnv = process.env[name]?.trim();
    if (fromEnv) return fromEnv;

    if (existsSync(TOKEN_FILE)) {
        const line = readFileSync(TOKEN_FILE, 'utf8')
            .split(/\r?\n/)
            .find((l) => l.startsWith(`${name}=`));
        const value = line?.slice(name.length + 1).trim();
        if (value) return value;
    }

    if (!required) return null;
    throw new Error(
        `${name} is not set, and ${network} cannot be reached without it.\n`
        + `  Midnight retired its own indexers on 2026-10-09; access is now through\n`
        + `  Blockfrost, with one project per network. Put the project id in\n`
        + `  ${TOKEN_FILE}\n  as ${name}=<id>, or set it in the environment.\n`
        + `  ${MIGRATION}`
    );
}

/** Every configured project id, whichever network it belongs to. */
const allTokens = () => CREDENTIALED.map((network) => blockfrostToken({ required: false, network }))
    .filter((t) => typeof t === 'string' && t.trim().length >= 8)
    .map((t) => t.trim());

/**
 * Hosts per network, before the project id is attached.
 *
 * The RPC host takes a WebSocket upgrade on its root (verified 101 on
 * preprod) and has no separate `/ws` path, unlike the indexer. The mainnet
 * hosts follow the same Blockfrost naming; nothing here has reached them yet.
 */
const HOSTS = {
    preview: {
        indexerHttpUrl: 'https://indexer.preview.midnight.network/api/v4/graphql',
        indexerWsUrl: 'wss://indexer.preview.midnight.network/api/v4/graphql/ws',
        nodeHttpUrl: 'https://rpc.preview.midnight.network',
        nodeWsUrl: 'wss://rpc.preview.midnight.network'
    },
    preprod: {
        indexerHttpUrl: 'https://midnight-preprod.blockfrost.io/api/v0',
        indexerWsUrl: 'wss://midnight-preprod.blockfrost.io/api/v0/ws',
        nodeHttpUrl: 'https://rpc.midnight-preprod.blockfrost.io/',
        nodeWsUrl: 'wss://rpc.midnight-preprod.blockfrost.io/'
    },
    mainnet: {
        indexerHttpUrl: 'https://midnight-mainnet.blockfrost.io/api/v0',
        indexerWsUrl: 'wss://midnight-mainnet.blockfrost.io/api/v0/ws',
        nodeHttpUrl: 'https://rpc.midnight-mainnet.blockfrost.io/',
        nodeWsUrl: 'wss://rpc.midnight-mainnet.blockfrost.io/'
    }
};

/**
 * A network's endpoints, authenticated where the network needs it. Throws if
 * a credentialed network's project id is missing. Preview comes back as is.
 */
export function networkEndpoints(network) {
    const hosts = HOSTS[checkNetwork(network)];
    if (isOpenNetwork(network)) return { networkId: network, ...hosts };
    const q = `?project_id=${encodeURIComponent(blockfrostToken({ network }))}`;
    return {
        networkId: network,
        indexerHttpUrl: `${hosts.indexerHttpUrl}${q}`,
        indexerWsUrl: `${hosts.indexerWsUrl}${q}`,
        nodeHttpUrl: `${hosts.nodeHttpUrl}${q}`,
        nodeWsUrl: `${hosts.nodeWsUrl}${q}`
    };
}

/** Preprod endpoints, authenticated: what every script used before mainnet. */
export const preprodEndpoints = () => networkEndpoints('preprod');

/**
 * The same endpoints with no credential attached.
 *
 * The authenticated form above exists because every client here takes a URL
 * and offers no way to send a header. That is fine for a socket we open. It is
 * wrong for anything we HAND SOMEONE: a receipt a visitor downloads, a command
 * printed on a page. Those get this, and the reader supplies their own project
 * id. The endpoint is public; the credential is ours.
 */
export function publicEndpoints(network) {
    return { networkId: checkNetwork(network), ...HOSTS[network] };
}

export const publicPreprodEndpoints = () => publicEndpoints('preprod');

/**
 * Refuse to let a value carrying the project id leave this process.
 *
 * `guardLogs()` covers what we PRINT. This covers what we HAND OVER: anything
 * assembled for a reader, such as a receipt a visitor downloads or a command
 * shown on a page. The rule is that reader-facing strings come from
 * `publicPreprodEndpoints()` and the reader brings their own project id. This
 * makes that rule enforced rather than remembered.
 *
 * It throws instead of scrubbing. A value that needs scrubbing on its way out
 * is a bug where it was built, and silently cleaning it hides the bug while
 * keeping the habit that produced it.
 */
export function assertNoSecrets(value, what = 'value') {
    const tokens = allTokens();
    if (!tokens.length) return value;
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (text && tokens.some((t) => text.includes(t))) {
        throw new Error(
            `refusing to release ${what}: it contains a Blockfrost project id. `
            + 'Build reader-facing strings from publicEndpoints(), not networkEndpoints().'
        );
    }
    return value;
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
    const secrets = [...allTokens(), ...alsoRedact]
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
