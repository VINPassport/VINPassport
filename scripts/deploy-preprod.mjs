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
 *   NIGHTGATE_AGENT_TOKEN          the grant token, sent to us privately
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
const token = process.env.NIGHTGATE_AGENT_TOKEN;
const sponsorSessionId = process.env.NIGHTGATE_SPONSOR_SESSION_ID;
if (!token || !sponsorSessionId) {
    fail('NIGHTGATE_AGENT_TOKEN and NIGHTGATE_SPONSOR_SESSION_ID are required (from the onboarding note).');
}
const baseUrl = process.env.NIGHTGATE_BASE_URL ?? 'https://api.nightgate.dev';

const outPath = join(ROOT, 'deploy', 'preprod.json');
if (existsSync(outPath) && SUBMIT && !REDEPLOY) {
    fail(`deploy/preprod.json already exists - a contract is already deployed. ` +
        `The grant allows 2 deploys total and a redeploy is an EMPTY ledger. ` +
        `Pass --redeploy as well if that is genuinely intended; the existing ` +
        `record is archived rather than lost, so the old address stays quotable.`);
}

// ---------------------------------------------------- the pinned registrars
//
// Identities only. The secrets behind them stay in the file and are never read
// here, because a deploy does not act as a registrar; it only states which
// registrars will be allowed to.
if (!existsSync(SECRETS)) {
    fail(`no registrar identities at ${SECRETS}. ` +
        `Run \`node scripts/make-registrar-secrets.mjs\` first. The list is fixed ` +
        `at deploy and cannot be added to later, so it has to be right now.`);
}
const idOf = (label) => {
    const key = `VINPASSPORT_REGISTRAR_${label}_ID_HEX=`;
    const line = readFileSync(SECRETS, 'utf8').split(/\r?\n/).find((l) => l.startsWith(key));
    const hex = line?.slice(key.length).trim();
    if (!/^[0-9a-f]{64}$/.test(hex ?? '')) fail(`${key}<64 hex> missing or malformed in ${SECRETS}`);
    return { hex, bytes: Uint8Array.from(Buffer.from(hex, 'hex')) };
};
const regA = idOf('A');
const regB = idOf('B');
if (regA.hex === regB.hex) fail('registrar A and B have the same identity; regenerate the secrets');

// Four slots on chain. Two distinct authorities, and the remainder repeats B:
// a set keeps one copy, so repetition fills the vector without widening who is
// authorised. B registers nothing, and exists so that "only the registrar that
// registered a vehicle may write its history" is demonstrable as a refusal on
// the live contract rather than only in the test suite.
const registrarSlots = [regA.bytes, regB.bytes, regB.bytes, regB.bytes];

// ---------------------------------------------------------------- build

console.log(`network   preprod`);
console.log(`sponsor   ${baseUrl} (session ${sponsorSessionId.slice(0, 8)}…)`);
console.log(`mode      ${SUBMIT ? 'SUBMIT - this spends 1 of 2 allowed deploys' : 'dry run - nothing leaves this machine'}`);
console.log(`registrar A ${regA.hex}  (the demo registrar)`);
console.log(`registrar B ${regB.hex}  (listed, registers nothing)`);
console.log(`          this list is fixed for the contract's lifetime`);
console.log('\nbuilding and proving the deploy locally (wasm, takes a while)…');

const builder = await createTxBuilder({
    seedHex: seed,
    networkId: 'preprod',
    indexerHttpUrl: 'https://indexer.preprod.midnight.network/api/v4/graphql',
    indexerWsUrl: 'wss://indexer.preprod.midnight.network/api/v4/graphql/ws',
    nodeUrl: 'wss://rpc.preprod.midnight.network/',
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

    const ng = connect({ baseUrl, agentToken: token });
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
