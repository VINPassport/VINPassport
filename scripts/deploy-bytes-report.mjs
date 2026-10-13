/**
 * Everything a sponsor needs to diagnose a transaction we built, in one report.
 *
 * Reads the bytes, prints the serialization header verbatim, says whether the
 * ledger and the builder can each read them, and reports the builder's own
 * configuration. Nothing here touches the network and nothing is submitted.
 *
 *   node scripts/deploy-bytes-report.mjs <file.b64> [more.b64 ...]
 *
 * The header is the part that matters and the part that is easy to paraphrase
 * wrongly, so it is printed exactly as the bytes carry it rather than
 * summarised.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { Transaction } from '@midnight-ntwrk/ledger-v8';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
const files = process.argv.slice(2);
if (!files.length) throw new Error('usage: node scripts/deploy-bytes-report.mjs <file.b64> ...');

const TAG_SETS = [
    ['signature', 'proof', 'binding'],
    ['signature', 'proof', 'pre-binding'],
    ['signature', 'proof-preimage', 'binding'],
    ['signature', 'proof-preimage', 'pre-binding'],
    ['signature', 'proof', 'no-binding']
];

console.log('versions');
for (const p of ['@midnight-ntwrk/ledger-v8', '@odatano/nightgate-tx',
    '@midnight-ntwrk/compact-runtime', '@midnight-ntwrk/compact-js']) {
    let v = null;
    // Some of these do not export ./package.json, so fall back to reading it
    // off disk rather than reporting a version we could not confirm.
    try { v = require(`${p}/package.json`).version; } catch { /* try the path */ }
    if (!v) {
        try { v = JSON.parse(readFileSync(`node_modules/${p}/package.json`, 'utf8')).version; }
        catch { /* genuinely absent */ }
    }
    console.log(`  ${p}  ${v ?? '(not resolvable)'}`);
}

for (const f of files) {
    const b64 = readFileSync(f, 'utf8').trim();
    const bytes = Uint8Array.from(Buffer.from(b64, 'base64'));
    const buf = Buffer.from(bytes);

    // The header is ASCII up to the closing bracket: print it as written.
    const ascii = buf.subarray(0, 120).toString('latin1');
    const header = ascii.slice(0, (ascii.indexOf('):') + 1) || 90);

    console.log(`\n${basename(f)}`);
    // Character count and decoded-byte digest first, because a transit loss
    // shows up here and nowhere else. A sponsor that reports a different byte
    // count from this one received a different string, whatever its error says
    // about tags.
    console.log(`  base64 chars     ${b64.length}`);
    console.log(`  sha256(decoded)  ${createHash('sha256').update(buf).digest('hex')}`);
    console.log(`  bytes            ${bytes.length}`);
    console.log(`  header           ${header}`);
    console.log(`  first 90 raw     ${buf.subarray(0, 90).toString('latin1').replace(/[^\x20-\x7e]/g, '.')}`);
    console.log(`  'proof-preimage' ${/proof-preimage/.test(ascii)}`);
    console.log(`  'proof[v'        ${/proof\[v/.test(ascii)}`);

    for (const tags of TAG_SETS) {
        try {
            const tx = Transaction.deserialize(...tags, bytes);
            console.log(`  ledger reads as  (${tags.join(', ')})`);
            try {
                const s = String(tx);
                console.log(`  ledger says      ${s.slice(0, 200).replace(/\s+/g, ' ')}`);
            } catch { /* opaque wasm */ }
            break;
        } catch (e) {
            const m = String(e.message ?? e).replace(/\s+/g, ' ');
            console.log(`  not (${tags.join(', ')}): ${m.slice(0, 120)}`);
        }
    }

    // What the builder itself makes of the same bytes, in this same process.
    try {
        const { deserializeTransaction } = await import('@odatano/nightgate-tx/txbuilder');
        const tx = await deserializeTransaction(b64);
        console.log(`  builder reads    yes (${tx?.constructor?.name ?? typeof tx})`);
        try { console.log(`  builder says     ${String(tx).slice(0, 200).replace(/\s+/g, ' ')}`); } catch { }
    } catch (e) {
        console.log(`  builder reads    NO: ${String(e.message ?? e).replace(/\s+/g, ' ').slice(0, 160)}`);
    }
}
