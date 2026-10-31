/**
 * Generate `site/verify/demo-data.json` and `site/verify/fields.json`.
 *
 * The demo data is NOT hand-written. It is the public ledger of the real
 * compiled contract after a scripted history, exported as JSON, so the scan
 * page renders exactly what an observer of the chain would see, nothing more.
 * Values and salts live only in this process and are not exported.
 *
 * The scenario itself lives in `lib/scenario.mjs`, shared with the intake
 * runner: a vehicle added through the console is built by exactly the code
 * that builds these two.
 *
 *   Vehicle A: a clean history with claims to show for it.
 *   Vehicle B: a passport whose clean-history proofs would abort in-circuit,
 *               so no such claims exist and the page must say "not proven".
 *
 * Run: npm run demo:export
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PassportSimulator, buildDemoVehicles, exportLedger, vocabulary, saltStream } from './lib/scenario.mjs';
import { buildBundle, verifyBundle, vinHashOf } from './lib/disclosure.mjs';

const SITE = join(dirname(fileURLToPath(import.meta.url)), '..', 'site');
const OUT = join(SITE, 'verify');
const BUNDLES = join(SITE, 'disclose', 'bundles');

// Vehicle A's VIN, as buildDemoVehicles registers it. Checked against the
// hash below, so a change there fails here instead of shipping bundles for a
// vehicle the ledger does not hold.
const VIN_A = 'WVWZZZ1JZXW000001';

const sim = new PassportSimulator();
const { a, b } = buildDemoVehicles(sim, saltStream(), { keepOpenings: true });

for (const [name, r] of [['A', a], ['B', b]]) {
    if (name === 'A' && r.refused.length) {
        throw new Error(`vehicle A must apply cleanly, refused: ${JSON.stringify(r.refused)}`);
    }
    console.log(`vehicle ${name}: ${r.applied.length} steps applied, ${r.refused.length} refused`);
}

const ledger = exportLedger(sim,
    'vinpassport, compiled circuits run locally by scripts/export-demo-state.mjs');

writeFileSync(join(OUT, 'demo-data.json'), JSON.stringify(ledger, null, 2) + '\n');
writeFileSync(join(OUT, 'fields.json'), JSON.stringify(vocabulary([
    { vinHash: a.vinHex, title: '2019 Golf, silver', battery: 'not an EV', blurb: 'Full service history, claims proven' },
    { vinHash: b.vinHex, title: '2018 320d, grey', battery: 'not an EV', blurb: 'A record it cannot prove clean' }
]), null, 2) + '\n');

console.log(`exported ${ledger.claims.length} claims, ${Object.keys(ledger.passports).length} passports -> site/verify/`);

// ------------------------------------------------------------ sample bundles
//
// What vehicle A's holder would hand three audiences (D26), for /disclose/ to
// check in the browser. They can only be made HERE: the salts that open the
// commitments exist in this process and nowhere else, so bundles built from
// any other run would open nothing on this ledger. Writing them in the same
// run as demo-data.json is what keeps the two in step.
//
// The buyer's bundle opens the declared values and cites the claims already
// proven; the dealer's opens the history as well; the authority's opens
// everything and names the VIN.
if (Buffer.from(vinHashOf(VIN_A)).toString('hex') !== a.vinHex) {
    throw new Error('VIN_A no longer matches vehicle A; update it to the VIN buildDemoVehicles registers');
}
const receipt = {
    vin: VIN_A,
    vinHash: a.vinHex,
    contentRoot: ledger.passports[a.vinHex],
    network: 'local-simulator',
    fields: a.openings
};
const proven = ledger.claims.filter((c) => c.vinHash === a.vinHex).map((c) => c.key);
const audiences = {
    public: { audience: 'a buyer', claims: proven },
    trade: { audience: 'a dealer taking the car in part exchange' },
    authority: { audience: 'a registration authority' }
};
const claimAt = (key) => ledger.claims.find((c) => c.key === key) ?? null;
const commitmentAt = (slot) => ledger.fieldCommitment[slot] ?? null;

mkdirSync(BUNDLES, { recursive: true });
for (const [tier, options] of Object.entries(audiences)) {
    const bundle = buildBundle(receipt, tier, options);
    const check = verifyBundle(bundle, { commitmentAt, claimAt });
    if (!check.ok || check.overDisclosed.length) {
        throw new Error(`the ${tier} bundle does not check against the ledger just written: ${JSON.stringify(check)}`);
    }
    writeFileSync(join(BUNDLES, `${tier}.json`), JSON.stringify(bundle, null, 2) + '\n');
    console.log(`${tier} bundle: opens ${check.opened.length} fields, cites ${check.claims.length} claims -> site/disclose/bundles/`);
}
