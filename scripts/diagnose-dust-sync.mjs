/**
 * Reproduce the dust wallet's indexer subscription and print what the SDK hides.
 *
 * The dust wallet reports sync failures as `Wallet.Sync: [object ErrorEvent]`.
 * That string is all there is: WsSubscriptionClient classifies anything that is
 * not an array of GraphQLErrors as a ServerError built with
 * `String(err)`, and `String(someErrorEvent)` is `[object ErrorEvent]`. The
 * message, the close code and the reason are all discarded before the error
 * reaches us, so the wallet cannot tell us whether the handshake was refused,
 * the stream was cut mid-flight, or the query was rejected.
 *
 * This script opens the same subscription the wallet opens, with the same
 * client options and the same document, and keeps every field of whatever
 * comes back. It changes nothing and holds no keys: the dust event stream is
 * public chain data, and the only secret involved is the indexer token, which
 * is redacted before anything is printed.
 *
 *   node scripts/diagnose-dust-sync.mjs           # from the start, as a fresh wallet does
 *   node scripts/diagnose-dust-sync.mjs 1500000   # resume from an event id
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { createClient } from 'graphql-ws';
import { preprodEndpoints, redacted, guardLogs } from './lib/endpoints.mjs';

// Before anything connects: the indexer credential travels in every URL,
// and a library that logs a URL logs the credential.
guardLogs();

const EP = preprodEndpoints();

// Exactly the document in wallet-sdk-indexer-client's generated
// subscriptions/DustLedgerEvents.js. Written out rather than imported so a
// change on their side shows up here as a difference rather than silently
// moving the thing under test.
const QUERY = `subscription DustLedgerEvents($id: Int) {
      dustLedgerEvents(id: $id) {
        type: __typename
        id
        raw
        maxId
      }
    }`;

// `null` is what the wallet sends when `appliedIndex` is 0: stream from the
// very beginning. See the cursor comment in the dust wallet's Sync.js.
const fromArg = process.argv[2];
const id = fromArg == null ? null : Number(fromArg);

const started = Date.now();
const since = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;
const log = (...a) => console.log(`[${since()}]`, ...a);

/**
 * Keep every property an event carries. `ErrorEvent` and `CloseEvent` hold
 * their useful content on own and inherited properties that neither
 * `String(e)` nor `JSON.stringify(e)` reaches, which is the whole reason the
 * wallet's error is empty.
 */
function describe(e) {
    if (e == null) return String(e);
    if (Array.isArray(e)) return e.map((x) => x?.message ?? String(x)).join('; ');
    const out = { kind: e.constructor?.name ?? typeof e };
    for (const k of ['type', 'message', 'code', 'reason', 'wasClean', 'errno', 'syscall', 'cause']) {
        if (e[k] !== undefined) out[k] = e[k] instanceof Error ? `${e[k].name}: ${e[k].message}` : e[k];
    }
    if (e.error) out.error = e.error instanceof Error ? `${e.error.name}: ${e.error.message}` : String(e.error);
    if (e instanceof Error && e.stack) out.stack = e.stack.split('\n').slice(0, 4).join(' | ');
    return JSON.stringify(out, (k, v) => (typeof v === 'bigint' ? String(v) : v));
}

log(`url   ${redacted(EP.indexerWsUrl)}`);
log(`id    ${id === null ? 'null (from the start, as a fresh wallet)' : id}`);

let events = 0;
let firstId = null;
let lastId = null;
let maxId = null;
let bytes = 0;

const report = (why) => {
    console.log(`\n-- ${why} --`);
    console.log(`events      ${events}`);
    console.log(`first id    ${firstId ?? '(none)'}`);
    console.log(`last id     ${lastId ?? '(none)'}`);
    console.log(`tip (maxId) ${maxId ?? '(none)'}`);
    console.log(`raw bytes   ${bytes}`);
    console.log(`elapsed     ${since()}`);
    if (events && maxId != null && lastId != null) {
        console.log(`behind tip  ${Number(maxId) - Number(lastId)} event(s)`);
    }
};

// The same options WsSubscriptionClient.layer passes, including the retry
// refusal: one transport error there ends sync for the life of the wallet.
const client = createClient({
    url: EP.indexerWsUrl,
    shouldRetry: () => false,
    keepAlive: 15_000,
    on: {
        connecting: () => log('connecting'),
        opened: () => log('socket opened'),
        connected: () => log('connection_ack received'),
        ping: () => log('ping'),
        pong: () => log('pong'),
        closed: (e) => log(`closed ${describe(e)}`),
        error: (e) => log(`client error ${describe(e)}`)
    }
});

const runFor = Number(process.env.DUST_DIAGNOSE_MS ?? 120_000);
const stop = setTimeout(() => {
    report(`stopped after ${Math.round(runFor / 1000)}s without a terminal message`);
    client.dispose();
    process.exit(0);
}, runFor);

let lastPrinted = 0;
await new Promise((resolve) => {
    client.subscribe({ query: QUERY, variables: { id } }, {
        next: (data) => {
            if (data.errors) {
                log(`graphql errors ${describe(data.errors)}`);
                return;
            }
            const e = data.data?.dustLedgerEvents;
            if (!e) return;
            events += 1;
            firstId ??= e.id;
            lastId = e.id;
            maxId = e.maxId;
            bytes += (e.raw?.length ?? 0) / 2;
            // One line a second at most: the point is the shape of the stream,
            // not a transcript of it.
            if (Date.now() - lastPrinted > 1000) {
                lastPrinted = Date.now();
                log(`event id=${e.id} type=${e.type} maxId=${e.maxId} raw=${(e.raw?.length ?? 0) / 2}B (${events} so far)`);
            }
        },
        error: (err) => {
            clearTimeout(stop);
            console.log(`\n[${since()}] SINK ERROR`);
            console.log(`  String(err)  ${String(err)}   <- all the wallet keeps`);
            console.log(`  actual       ${describe(err)}`);
            report('failed');
            resolve();
        },
        complete: () => {
            clearTimeout(stop);
            report('server completed the subscription');
            resolve();
        }
    });
});

client.dispose();
process.exit(events > 0 ? 0 : 1);
