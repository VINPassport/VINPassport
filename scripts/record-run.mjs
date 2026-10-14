/**
 * Turn a guided-run receipt into the recording the /demo/ page publishes.
 *
 *   node scripts/record-run.mjs ../_local-tracking/receipt.json
 *   node scripts/record-run.mjs receipt.json site/demo/recorded-run.json
 *
 * The receipt is written for the operator who ran it, so it carries the VIN,
 * the field values and the declaration panel. None of that may be published:
 * the whole design is that values stay with whoever holds them, and the page
 * says so. This copies only what the preprod chain already holds, strips the
 * readings out of the stage labels, and refuses to write if anything private
 * survived.
 *
 * It exists because the recording used to be sanitised by hand. That worked
 * until it did not: a regenerated recording published `odometerKm -> 37097`
 * in a stage label, and only the repository's own test caught it. A hand step
 * that must not be forgotten is a step that belongs in a script.
 *
 * Get a receipt by running the guided run and asking for its report:
 *
 *   VINPASSPORT_PREPROD=1 ... npm run app
 *   curl -s -X POST localhost:8790/api/demo/run -d '{}' -H 'content-type: application/json'
 *   curl -s "localhost:8790/api/demo/report?id=<jobId>" > receipt.json
 *
 * Keep the receipt outside the repository: it holds the values.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_OUT = join(ROOT, 'site', 'demo', 'recorded-run.json');
const EXPLORER = 'https://preprod.midnightexplorer.com';

const receiptPath = process.argv[2];
const outPath = process.argv[3] ?? DEFAULT_OUT;
if (!receiptPath) {
    console.error('usage: node scripts/record-run.mjs <receipt.json> [out.json]');
    process.exit(1);
}

const r = JSON.parse(readFileSync(receiptPath, 'utf8'));

/**
 * The runner writes stage labels for the operator, who is entitled to read
 * their own values: `update 1: odometerKm -> 37097`. Published, that is a
 * field reading on a page whose entire claim is that readings are not
 * published. The arrow is the tell.
 */
const readingFree = (s) => String(s).replace(/([A-Za-z]\w*)\s*->\s*[\d,.]+/g, '$1, new value committed');

const day = new Date(r.finishedAt ?? Date.now()).toLocaleDateString('en-GB', {
    day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC'
});

const out = {
    note: `A recording of the guided run of ${day}, kept so the page can still show a real run while no `
        + 'circuit server is answering. Every field below is already public on the preprod chain: the claims '
        + 'and their bounds are on the ledger, and no field reading appears here, because none was published.',
    network: r.network,
    contractAddress: r.contractAddress,
    vinHash: r.vinHash,
    registrarId: r.registrar?.id,
    contentRoot: r.contentRoot,
    finishedAt: r.finishedAt,
    stages: (r.onChain ?? []).map((s) => ({
        stage: s.stage,
        label: readingFree(s.label),
        calls: (s.calls ?? []).map(readingFree),
        txHash: s.txHash,
        blockHeight: s.blockHeight,
        explorer: `${EXPLORER}/transactions/${s.txHash}`
    })),
    claims: r.claims ?? [],
    refused: r.refused ?? []
};

const text = JSON.stringify(out);
const problems = [];
if (r.vin && text.includes(r.vin)) problems.push(`the VIN ${r.vin} is in the output`);
for (const key of ['fields', 'panel', 'vin']) {
    if (key in out) problems.push(`"${key}" must not be published`);
}
for (const [name, value] of Object.entries(r.fields ?? {})) {
    if (String(value).length > 3 && text.includes(String(value))) {
        problems.push(`the value of ${name} (${value}) appears in the output`);
    }
}
// Update values never appear in `fields`, which is how a reading got through
// once: the opening values were checked and a stage label carried a later
// one. Any surviving arrow is a reading, whatever its source.
for (const s of out.stages) {
    if (s.label.includes('->')) problems.push(`stage ${s.stage} label still carries a reading: ${s.label}`);
    for (const c of s.calls) if (c.includes('->')) problems.push(`a call still carries a reading: ${c}`);
}
if (!out.stages.length) problems.push('the receipt has no on-chain stages, so there is nothing to record');

if (problems.length) {
    console.error('REFUSING to write:');
    for (const p of problems) console.error('  ' + p);
    process.exit(1);
}

writeFileSync(outPath, JSON.stringify(out, null, 2) + '\n');
console.log(`wrote ${outPath}`);
console.log(`  contract ${out.contractAddress}`);
console.log(`  ${out.stages.length} stages, blocks ${out.stages[0].blockHeight} to ${out.stages.at(-1).blockHeight}`);
console.log(`  ${out.claims.length} claims, ${out.refused.length} refused`);
