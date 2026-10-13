/**
 * Deploy `vinpassport` to Midnight preprod, fee paid by ODATANO's
 * sponsor. Implements the onboarding recipe: the transaction is built, proven
 * and signed HERE, with our key and our prover keys; the sponsor receives
 * only the unbound transaction bytes, pays the fee, and submits.
 *
 *   node scripts/deploy-preprod.mjs            build + prove, print the
 *                                              address, submit NOTHING
 *   node scripts/deploy-preprod.mjs --submit   actually spend a deploy
 *
 * Dry-run is the default because the grant allows TWO deploys, ever, and
 * `registerPassport` is insert-once per VIN — a redeploy starts from an empty
 * ledger. Nothing should be able to spend a deploy by accident.
 *
 * The registrar list is pinned by the constructor and can never be added to,
 * so the identities read from `../_local-tracking/REGISTRAR-SECRETS.env` are
 * the whole authority of the contract for its lifetime. A dry run prints them;
 * read them before spending the deploy.
 *
 *   node scripts/deploy-preprod.mjs --submit --redeploy   replace an existing
 *                                              record, archiving the old one
 *
 * Environment (set in the shell, never in a file inside this repo):
 *   VINPASSPORT_SEED_HEX             128 hex chars. Our key. Never leaves the process.
 *   ODATANO_GATEWAY_KEY            a gateway key, `oda_` + 40 hex, from
 *                                  https://api.odatano.dev. This is the
 *                                  current scheme
 *   NIGHTGATE_AGENT_TOKEN          the older `ngat_` grant token, for the
 *                                  legacy host only. Refused by the new one
 *   NIGHTGATE_SPONSOR_SESSION_ID   the sponsor session the grant is pinned to
 *   NIGHTGATE_BASE_URL             optional, defaults to https://api.nightgate.dev
 *
 * On success the public record of the deployment is written to
 * `deploy/preprod.json` — address and transaction hash only, both public by
 * definition. Commit it: the scan page's live source and every verifier
 * instruction will point at it.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { connect, createTxBuilder } from '@odatano/nightgate-tx';
import { Contract } from '../contracts/vinpassport/src/managed/vinpassport/contract/index.js';
import { readRegistrarSlots, REGISTRAR_ROLES } from './lib/registrar-slots.mjs';
import { preprodEndpoints, redacted } from './lib/endpoints.mjs';
import { localCredential, credentialPath } from './lib/local-credentials.mjs';

const EP = preprodEndpoints();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MANAGED = join(ROOT, 'contracts', 'vinpassport', 'src', 'managed', 'vinpassport');
const SUBMIT = process.argv.includes('--submit');
const REDEPLOY = process.argv.includes('--redeploy');
const SECRETS = join(ROOT, '..', '_local-tracking', 'REGISTRAR-SECRETS.env');

const fail = (msg) => { console.error(`\nSTOP: ${msg}`); process.exit(1); };

// ---------------------------------------------------------------- preflight

const CIRCUITS = ['registerPassport', 'initialiseField', 'recordField', 'proveFieldAtMost', 'proveFieldAtLeast'];
for (const c of CIRCUITS) {
    if (!existsSync(join(MANAGED, 'keys', `${c}.prover`))) {
        fail(`missing prover key for ${c}. Keys are gitignored - run \`npm run compile\` in WSL first.`);
    }
}

const seed = process.env.VINPASSPORT_SEED_HEX ?? '';
if (!/^[0-9a-fA-F]{128}$/.test(seed)) {
    fail('VINPASSPORT_SEED_HEX must be 128 hex characters. Set it in the shell; never write it to a file in this repo.');
}
// Two credential schemes, because ODATANO moved.
//
// NIGHTGATE now lives under api.<network>.odatano.dev and authenticates with
// a gateway key, `oda_` plus 40 hex, sent as a Bearer token. The older
// `ngat_` agent token is refused by the new host with
//   {"error":"not a gateway key (expected oda_ followed by 40 hex characters)"}
// A key carries a unit balance; `sponsorUnboundTransaction`, which is what a
// deploy uses, is one of the actions a sandbox key may call.
//
// The legacy path is kept so an older grant still works against the old host
// if ODATANO keeps it alive, but the gateway key wins when both are set.
const gatewayKey = localCredential('ODATANO_GATEWAY_KEY', 'ODATANO.env');
const legacyAgentToken = process.env.NIGHTGATE_AGENT_TOKEN?.trim();
const sponsorSessionId = localCredential('NIGHTGATE_SPONSOR_SESSION_ID', 'ODATANO.env')
    ?? process.env.NIGHTGATE_SPONSOR_SESSION_ID;

if (!gatewayKey && !legacyAgentToken) {
    fail([
        'no sponsor credential.',
        `  Put a gateway key in ${credentialPath('ODATANO.env')}`,
        '  as ODATANO_GATEWAY_KEY=oda_<40 hex>. Get one at https://api.odatano.dev.',
        '  (Or set NIGHTGATE_AGENT_TOKEN to use the legacy host.)'
    ].join('\n'));
}
if (gatewayKey && !/^oda_[0-9a-f]{40}$/.test(gatewayKey)) {
    fail(`ODATANO_GATEWAY_KEY is not shaped like a gateway key (oda_ + 40 hex); got ${gatewayKey.length} characters.`);
}
if (!sponsorSessionId) {
    fail('NIGHTGATE_SPONSOR_SESSION_ID is required. A sandbox key uses the shared pool session; '
        + 'a key of your own reports its session at GET /api/me on the gateway.');
}

const baseUrl = process.env.NIGHTGATE_BASE_URL
    ?? (gatewayKey ? 'https://api.preprod.odatano.dev' : 'https://api.nightgate.dev');
const auth = gatewayKey ? { token: gatewayKey } : { agentToken: legacyAgentToken };

const outPath = join(ROOT, 'deploy', 'preprod.json');
if (existsSync(outPath) && SUBMIT && !REDEPLOY) {
    fail(`deploy/preprod.json already exists - a contract is already deployed. ` +
        `The grant allows 2 deploys total and a redeploy is an EMPTY ledger. ` +
        `Pass --redeploy as well if that is genuinely intended; the existing ` +
        `record is archived rather than lost, so the old address stays quotable.`);
}

// ---------------------------------------------------- the pinned registrars
//
// Four slots on chain, four distinct authorities, read and checked by
// scripts/lib/registrar-slots.mjs so the one irreversible input has tests of
// its own:
//
//   A  the demo registrar, which registers vehicles
//   B  listed, registers nothing, so that "only the registrar that registered
//      a vehicle may write its history" is demonstrable as a refusal on the
//      live contract rather than only in the test suite
//   C  a third distinct authority
//   D  a fourth, held unused
let regs, registrarSlots;
try {
    ({ regs, slots: registrarSlots } = readRegistrarSlots(SECRETS));
} catch (e) {
    fail(e.message);
}

// ---------------------------------------------------------------- build

console.log(`network   preprod`);
console.log(`sponsor   ${baseUrl} (session ${sponsorSessionId.slice(0, 8)}…, ${gatewayKey ? 'gateway key' : 'legacy agent token'})`);
console.log(`mode      ${SUBMIT ? 'SUBMIT - this spends 1 of 2 allowed deploys' : 'dry run - nothing leaves this machine'}`);
for (const r of regs) console.log(`registrar ${r.label} ${r.hex}  (${REGISTRAR_ROLES[r.label]})`);
console.log(`          this list is fixed for the contract's lifetime`);
console.log('\nbuilding and proving the deploy locally (wasm, takes a while)…');

const builder = await createTxBuilder({
    seedHex: seed,
    networkId: 'preprod',
    indexerHttpUrl: EP.indexerHttpUrl,
    indexerWsUrl: EP.indexerWsUrl,
    nodeUrl: EP.nodeWsUrl,
    contractClass: Contract,
    contractName: 'vinpassport',
    privateStateId: 'vinpassport',
    zkConfigDir: MANAGED
});

// The contract declares four witnesses, and the compiled class checks their
// SHAPE at construction even though a deploy never calls one. These stubs
// satisfy the shape and throw if that assumption ever stops holding - a
// deploy that silently invoked a witness would be worth crashing over.
const neverCalled = (name) => () => {
    throw new Error(`witness ${name}() was invoked during deploy - that must never happen`);
};
const witnesses = {
    newValue: neverCalled('newValue'),
    previousValue: neverCalled('previousValue'),
    previousSalt: neverCalled('previousSalt'),
    newSalt: neverCalled('newSalt'),
    // The constructor pins identities that were derived off-chain; it never
    // reads a secret. If a deploy ever asks for one, the shape assumption
    // above has stopped holding and the deploy should die rather than guess.
    registrarSecret: neverCalled('registrarSecret')
};

try {
    const deploy = await builder.buildDeploySponsorable({
        initialPrivateState: {},
        constructorArgs: [registrarSlots],
        witnesses,
        bind: false
    });
    console.log(`\ncontract address (known before submission): ${deploy.contractAddress}`);

    if (!SUBMIT) {
        console.log('\nDry run complete. The transaction was proven and signed but NOT submitted.');
        console.log('Re-run with --submit to spend a deploy.');
        process.exit(0);
    }

    const ng = connect({ baseUrl, ...auth });
    console.log('\nhanding the unbound transaction to the sponsor…');
    const job = await ng.sponsorUnbound({ unboundTxB64: deploy.unboundTxB64, sponsorSessionId });
    const out = await ng.waitForJob({ jobId: job.jobId, sessionId: sponsorSessionId });

    const landedAt = out.deployed?.[0];
    if (landedAt && landedAt !== deploy.contractAddress) {
        fail(`landed address ${landedAt} differs from the locally computed ${deploy.contractAddress} - do not record either; investigate.`);
    }

    mkdirSync(join(ROOT, 'deploy'), { recursive: true });
    if (existsSync(outPath)) {
        // Keep the superseded record. The previous address has been quoted in a
        // submission and in the README's verification steps, and it stays
        // readable on chain, so losing the file would lose the comparison.
        const archived = join(ROOT, 'deploy', `preprod-superseded-${Date.now()}.json`);
        renameSync(outPath, archived);
        console.log(`\narchived the previous record to ${archived}`);
    }
    writeFileSync(outPath, JSON.stringify({
        network: 'preprod',
        contractAddress: deploy.contractAddress,
        txHash: out.txHash,
        contract: 'vinpassport',
        note: 'Public record of the deployment. Address and tx hash are public by definition.'
    }, null, 2) + '\n');

    console.log(`\nDEPLOYED  ${deploy.contractAddress}`);
    console.log(`tx        ${out.txHash}`);
    console.log(`recorded  deploy/preprod.json - commit it.`);
} finally {
    await builder.close?.();
}
