/**
 * Answer one question about a vehicle without handing over the rest.
 *
 *   node scripts/disclose.mjs <receipt.json> <field> [field...]   emit
 *   node scripts/disclose.mjs --verify <disclosure.json> --against <ledger.json>
 *
 * A run receipt opens every field of a vehicle. A verifier who asked about
 * the mileage should not receive the accident history as well, so this emits
 * a document carrying only the fields named: their value, their salt, and the
 * public anchors needed to find the right slot. Holding one field's salt
 * reveals nothing about the next, because a salt is blake2b(seed || label) and
 * that does not run backwards.
 *
 * Pass --anonymous to leave the plaintext VIN out. The document then names no
 * vehicle at all: a verifier reads the VIN off the car and checks it hashes
 * to the `vinHash` inside. Use it whenever the disclosure may travel further
 * than the person who asked for it.
 *
 * VERIFYING. `--against` takes a JSON file holding public ledger state as a
 * `fieldCommitment` map of slot to commitment, which is exactly the shape of
 * `site/verify/demo-data.json`. There is deliberately no live-chain mode: this
 * repository has no decoder for the indexer's serialized contract state, and a
 * flag that pretended otherwise would be worse than its absence. Fetching is
 * the caller's business; the checking is here.
 *
 * Nothing here touches the network and nothing is written unless you redirect
 * it.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { buildDisclosure, verifyDisclosure, buildBundle, verifyBundle, BUNDLE_KIND } from './lib/disclosure.mjs';

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const valueOf = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : undefined;
};
const TAKES_VALUE = new Set(['--against', '--write-index', '--tier', '--claims', '--audience']);
const positional = argv.filter((a, i) => !a.startsWith('--') && !TAKES_VALUE.has(argv[i - 1]));

const usage = () => {
    console.error(`
Answer one question about a vehicle without handing over the rest.

  emit    node scripts/disclose.mjs <receipt.json> <field> [field...]
                                    [--anonymous] [--write-index N]

  tier    node scripts/disclose.mjs <receipt.json> --tier <public|trade|authority>
                                    [field...] [--claims <key,key>] [--audience <text>]

  verify  node scripts/disclose.mjs --verify <disclosure.json>
                                    --against <ledger.json>

  --anonymous     leave the plaintext VIN out; the verifier supplies it
  --write-index   disclose a specific write instead of the latest
  --tier          build a bundle for one audience (D26): every field the tier
                  allows, or only those named; a field above the tier is refused
  --claims        claim keys already proven on the ledger, for the bundle to cite

A receipt opens every field. A disclosure opens only the ones you name, and a
tiered bundle only what its audience is entitled to see.
`.trimStart());
    process.exit(2);
};

/* ----------------------------------------------------------------- verify -- */

if (flag('--verify')) {
    const path = valueOf('--verify') ?? positional[0];
    const against = valueOf('--against');
    if (!path) usage();

    const disclosure = JSON.parse(readFileSync(path, 'utf8'));

    let lookup = () => null;
    let claimAt = () => null;
    if (against) {
        const state = JSON.parse(readFileSync(against, 'utf8'));
        const map = state.fieldCommitment ?? state;
        lookup = (slot) => map[slot] ?? map[`0x${slot}`] ?? null;
        const claims = new Map((state.claims ?? []).map((c) => [String(c.key).replace(/^0x/, ''), c]));
        claimAt = (key) => claims.get(key) ?? null;
    }

    if (disclosure.kind === BUNDLE_KIND) {
        const r = verifyBundle(disclosure, { commitmentAt: lookup, claimAt });
        console.log(`bundle    : ${disclosure.kind}, ${disclosure.policy ?? '(no policy)'}`);
        console.log(`tier      : ${r.tier ?? '(unknown)'}${disclosure.audience ? `, for ${disclosure.audience}` : ''}`);
        console.log(`contract  : ${disclosure.contractAddress ?? '(none)'} on ${disclosure.network ?? '?'}`);
        console.log(`vin       : ${disclosure.vin ?? '(not named)'}${r.vinMatchesHash === null ? '' : `, hashes to vinHash: ${r.vinMatchesHash}`}`);
        if (!against) console.log('\nNo --against given, so nothing was checked against any ledger.');
        console.log('');
        for (const f of r.fields) {
            console.log(`  ${f.ok ? 'OPENS ' : 'FAILED'}  ${f.fieldName} [${f.tier ?? 'no tier'}]: ${f.why ?? ''}`);
        }
        for (const c of r.claims) {
            const what = c.fieldName ? `${c.fieldName} ${c.atMost ? '<=' : '>='} ${c.bound}` : c.key.slice(0, 16);
            console.log(`  ${c.ok ? 'CLAIM ' : 'FAILED'}  ${what}: ${c.why}`);
        }
        if (r.overDisclosed.length) {
            console.log(`\n  MORE THAN A ${String(r.tier).toUpperCase()} BUNDLE SHOULD CARRY: ${r.overDisclosed.join(', ')}`);
        }
        for (const p of r.problems) console.log(`  PROBLEM  ${p}`);
        console.log(`\n${r.ok ? 'VERIFIED' : 'NOT VERIFIED'}`);
        process.exit(r.ok ? 0 : 1);
    }

    const r = verifyDisclosure(disclosure, lookup);

    console.log(`disclosure: ${disclosure.kind ?? '(no kind)'}`);
    console.log(`contract  : ${disclosure.contractAddress ?? '(none)'} on ${disclosure.network ?? '?'}`);
    console.log(`vin       : ${disclosure.vin ?? '(not named, which is the stronger form)'}`);
    console.log(`vin hashes to vinHash: ${r.vinMatchesHash === null ? 'not checked, no VIN in the document' : r.vinMatchesHash}`);
    if (!against) {
        console.log('\nNo --against given, so the slots were NOT checked against any ledger.');
        console.log('Shape and derivation are checked; the openings are not.');
    }
    console.log('');
    for (const f of r.fields) {
        console.log(`  ${f.ok ? 'OK    ' : 'FAILED'}  ${f.fieldName} (write ${f.writeIndex}): ${f.why ?? ''}`);
    }
    for (const p of r.problems) console.log(`  PROBLEM  ${p}`);

    console.log(`\n${r.ok ? 'VERIFIED' : 'NOT VERIFIED'}`);
    process.exit(r.ok ? 0 : 1);
}

/* ------------------------------------------------------------------- emit -- */

const [receiptPath, ...fields] = positional;
const tier = valueOf('--tier');
if (!receiptPath || (!fields.length && !tier)) usage();

const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));

if (tier) {
    const claims = (valueOf('--claims') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    const bundle = buildBundle(receipt, tier, {
        ...(fields.length ? { fields } : {}),
        claims,
        audience: valueOf('--audience')
    });
    console.log(JSON.stringify(bundle, null, 2));
    console.error(`\n${tier} bundle: opens ${bundle.fields.length} field(s)`
        + `${bundle.fields.length ? `: ${bundle.fields.map((f) => f.fieldName).join(', ')}` : ''}; `
        + `cites ${bundle.claims.length} claim(s); VIN ${bundle.vin ? 'included' : 'not included'}`);
    process.exit(0);
}
const wi = valueOf('--write-index');

const disclosure = buildDisclosure(receipt, fields, {
    includeVin: !flag('--anonymous'),
    ...(wi === undefined ? {} : { writeIndex: Number(wi) })
});

// To stdout, so it can be piped or redirected. Anything the operator should
// read goes to stderr and stays out of the document.
console.log(JSON.stringify(disclosure, null, 2));

const held = Object.keys(receipt.fields ?? {}).length;
console.error(
    `\ndisclosed ${disclosure.fields.length} of ${held} field(s) the receipt holds: `
    + `${disclosure.fields.map((f) => f.fieldName).join(', ')}`
);
console.error(flag('--anonymous')
    ? 'the VIN is NOT in this document; the verifier supplies it'
    : 'the VIN is in this document; pass --anonymous to leave it out');
