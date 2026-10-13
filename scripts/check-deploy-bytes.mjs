/**
 * Can the ledger read the deploy transaction we build?
 *
 * The demo engine already balances and submits its own transactions, and it
 * deserializes them with `('signature', 'proof', 'binding')` or
 * `('signature', 'proof', 'pre-binding')`. Those are the same two the sponsor
 * tried on our deploy and could read with neither. Either our deploy really is
 * a shape the ledger cannot read, in which case the demo path cannot carry it
 * either, or the sponsor was refusing it for some other reason.
 *
 * This answers that locally, with no network and nothing submitted.
 *
 *   node scripts/check-deploy-bytes.mjs <file.b64> [more.b64 ...]
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { Transaction } from '@midnight-ntwrk/ledger-v8';

const files = process.argv.slice(2);
if (!files.length) throw new Error('usage: node scripts/check-deploy-bytes.mjs <file.b64> ...');

const TAG_SETS = [
    ['signature', 'proof', 'binding'],
    ['signature', 'proof', 'pre-binding'],
    ['signature', 'proof', 'no-binding']
];

for (const f of files) {
    const b64 = readFileSync(f, 'utf8').trim();
    const bytes = Uint8Array.from(Buffer.from(b64, 'base64'));
    // The serialized form names itself: the tags are written into the bytes.
    const header = [...new Set(
        [...Buffer.from(bytes).toString('latin1').matchAll(/[a-z][a-z0-9-]{3,30}\[v[0-9]+\]/g)]
            .map((m) => m[0])
    )].join(' ');

    console.log(`\n${basename(f)}  ${bytes.length} bytes`);
    console.log(`  header tags: ${header}`);

    let read = false;
    for (const tags of TAG_SETS) {
        try {
            const tx = Transaction.deserialize(...tags, bytes);
            if (!tx) continue;
            read = true;
            console.log(`  READS as (${tags.join(', ')})`);
            // What the ledger thinks it is, which is the part that matters for
            // balancing it afterwards.
            for (const k of ['identifiers', 'contractCalls', 'intents', 'guaranteedCoins', 'fallibleCoins']) {
                try {
                    const v = tx[k];
                    if (v === undefined) continue;
                    const n = typeof v === 'function' ? '(method)' : (v?.length ?? v?.size ?? String(v).slice(0, 60));
                    console.log(`    ${k}: ${n}`);
                } catch { /* opaque wasm accessor */ }
            }
            try { console.log(`    toString: ${String(tx).slice(0, 160).replace(/\s+/g, ' ')}`); } catch { }
            break;
        } catch (e) {
            console.log(`  not (${tags.join(', ')}): ${String(e.message ?? e).slice(0, 90)}`);
        }
    }
    if (!read) console.log('  NOTHING read these bytes');
}
