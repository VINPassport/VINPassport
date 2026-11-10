/**
 * The chains this site can point at, and how a reader checks each one
 * without us.
 *
 * One table, so no page hard-codes a network name, an explorer or an indexer.
 * A run, a recording or a snapshot names its network; the page looks the rest
 * up here. Pure data and string builders: no DOM, so scripts/record-run.mjs
 * and the tests import it too.
 *
 * `explorer` is null where no block explorer follows the chain. On 8 November
 * 2026 preview.midnightexplorer.com answered, but its Preview pages showed no
 * blocks or transactions, and our deploy transaction, contract and block 17102
 * all came back "not found" (Preview restarted for ledger 9 on 7 November).
 * A link that resolves is evidence and a link that 404s is the opposite, so
 * Preview pages print the indexer query instead. Set the URL here once the
 * explorer shows Preview again, after checking real paths against it, and
 * every page links.
 *
 * Preprod paths were checked against a real run on 2026-08-31:
 * /transactions/<hash>, /blocks/<height> and /contracts/<address> resolve,
 * and all three 404 on a value that does not exist.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

export const NETWORKS = Object.freeze({
    preview: Object.freeze({
        id: 'preview',
        label: 'Preview',
        name: 'Midnight Preview',
        ledger: 'ledger 9',
        explorer: null,
        indexer: Object.freeze({ url: 'https://indexer.preview.midnight.network/api/v4/graphql', header: null })
    }),
    preprod: Object.freeze({
        id: 'preprod',
        label: 'preprod',
        name: 'Midnight preprod',
        // The ledger the site's preprod recording and snapshot were made on (1 Nov 2026). Preprod
        // itself moved to ledger 9 on 9 Nov 2026 (block 3348434); change this only with a new run.
        ledger: 'ledger 8',
        explorer: 'https://preprod.midnightexplorer.com',
        // Blockfrost since 2026-10-09: a free project id goes in this header.
        // The placeholder is printed, never a real id.
        indexer: Object.freeze({ url: 'https://midnight-preprod.blockfrost.io/api/v0', header: 'project_id: YOUR_PROJECT_ID' })
    })
});

/** The network a page assumes before anything has named one. */
export const DEFAULT_NETWORK = 'preview';

/**
 * The entry for `id`. An unknown id is not quietly relabelled as Preview:
 * it gets a bare entry under its own name, with nothing to link to.
 */
export function networkOf(id = DEFAULT_NETWORK) {
    return NETWORKS[id ?? DEFAULT_NETWORK]
        ?? Object.freeze({ id: String(id), label: String(id), name: `Midnight ${id}`, ledger: '', explorer: null, indexer: null });
}

const KINDS = new Set(['transactions', 'blocks', 'contracts']);

/** An explorer URL, or null when this network has no explorer to send anyone to. */
export function explorerUrl(net, kind, value) {
    if (!net?.explorer || value == null || value === '') return null;
    if (!KINDS.has(kind)) throw new Error(`unknown explorer path ${kind}`);
    return `${net.explorer}/${kind}/${encodeURIComponent(value)}`;
}

/**
 * The curl that asks the network's indexer for a contract's latest action,
 * as lines of plain text (escape them before putting them in a page). The
 * header line appears only where the indexer needs one.
 */
export function indexerCurlLines(net, address) {
    if (!net?.indexer) return [];
    const query = JSON.stringify({ query: `{ contractAction(address: "${address}") { __typename transaction { hash block { height } } } }` });
    return [
        `curl -s -X POST ${net.indexer.url}`,
        `-H 'Content-Type: application/json'`,
        ...(net.indexer.header ? [`-H '${net.indexer.header}'`] : []),
        `-d '${query}'`
    ];
}
