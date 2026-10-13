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
 * `registerPassport` is insert-once per VIN, so a redeploy starts from an empty
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
 * `deploy/preprod.json` holds the address and transaction hash only, both public by
 * definition. Commit it: the scan page's live source and every verifier
 * instruction will point at it.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { existsSync, mkdirSync, writeFileSync, readFileSync, renameSync } from 'node:fs';
import { createHash } from 'node:crypto';
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

/**
 * Build, prove and sign, then write the unbound transaction out and stop.
 *
 * Sponsoring is the only step that needs a credential, and it takes nothing
 * but these bytes. Emitting them lets the sponsoring happen wherever the key
 * already lives, so the key never has to be copied anywhere to deploy: the
 * caller's own key still never leaves this machine, exactly as in --submit.
 */
const EMIT = process.argv.includes('--emit-unbound');

/**
 * Build the BOUND (finalized) form instead, for the finalized sponsor channel.
 *
 * The unbound form serialises as transaction(signature, proof, embedded-fr),
 * and a sponsor that deserialises only (signature, proof, binding) or
 * (signature, proof, pre-binding) cannot read it. The bound form is one of
 * the two it does read.
 */
const EMIT_BOUND = process.argv.includes('--emit-bound');

/**
 * Pay the deploy's own fee out of the DUST this wallet generates, and submit
 * it straight to the public node. No sponsor, no gateway, no credential.
 *
 * `@odatano/nightgate-tx` only builds a deploy in the sponsorable, fee-unpaid
 * form, so this builds the bound form and then balances it here, which is
 * exactly what the demo engine already does for every call it makes
 * ([D24](../docs/DECISIONS.md#settled)). It needs a dust snapshot at the tip:
 * see `scripts/sync-dust-until-done.sh`.
 *
 * On its own it stops before submitting. Add --submit to actually deploy.
 */
const SELF_FUND = process.argv.includes('--self-fund');

/**
 * Sponsor a transaction already written out by --emit-unbound, read from the
 * file rather than retyped.
 *
 *   node scripts/deploy-preprod.mjs --sponsor-file <path/to.b64>
 *
 * This exists because of a real failure on 2026-10-13. The emitted bytes were
 * handed to the sponsor by passing the base64 as a literal argument to a tool
 * call, which means something had to reproduce 16,360 characters exactly. One
 * 16-character group went missing from a run of near-identical groups, the
 * sponsor decoded 12,257 bytes instead of 12,269, and the refusal read as a
 * deserialization error, which sent us looking at tag names for two days. The
 * bytes on disk were correct the whole time.
 *
 * A large blob must therefore travel as a PATH, never as a literal argument,
 * and whatever sends it reads the file itself. Both ends print the character
 * count and the sha256 of the decoded bytes so any copy can be checked against
 * the original in one line.
 */
const sponsorFileAt = process.argv.indexOf('--sponsor-file');
const SPONSOR_FILE = sponsorFileAt === -1 ? null : process.argv[sponsorFileAt + 1];

const REDEPLOY = process.argv.includes('--redeploy');
const SECRETS = join(ROOT, '..', '_local-tracking', 'REGISTRAR-SECRETS.env');

const fail = (msg) => { console.error(`\nSTOP: ${msg}`); process.exit(1); };

// ---------------------------------------------------------------- preflight

// --sponsor-file builds nothing and signs nothing, so it needs neither the
// prover keys nor the seed. Demanding them would be asking for a secret the
// work does not use.
const CIRCUITS = ['registerPassport', 'initialiseField', 'recordField', 'proveFieldAtMost', 'proveFieldAtLeast'];
if (!SPONSOR_FILE) {
    for (const c of CIRCUITS) {
        if (!existsSync(join(MANAGED, 'keys', `${c}.prover`))) {
            fail(`missing prover key for ${c}. Keys are gitignored - run \`npm run compile\` in WSL first.`);
        }
    }
}

const seed = process.env.VINPASSPORT_SEED_HEX ?? '';
if (!SPONSOR_FILE && !/^[0-9a-fA-F]{128}$/.test(seed)) {
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

// Only the sponsoring step needs a credential. A dry run and --emit-unbound
// both stop before it, so neither should demand one: requiring a key to prove
// a transaction locally would be asking for a secret that the work does not
// use.
const NEEDS_SPONSOR = (SUBMIT && !EMIT && !SELF_FUND) || Boolean(SPONSOR_FILE);

if (NEEDS_SPONSOR && !gatewayKey && !legacyAgentToken) {
    fail([
        'no sponsor credential.',
        `  Put a gateway key in ${credentialPath('ODATANO.env')}`,
        '  as ODATANO_GATEWAY_KEY=oda_<40 hex>. Get one at https://api.odatano.dev.',
        '  (Or set NIGHTGATE_AGENT_TOKEN to use the legacy host.)',
        '  Or run with --emit-unbound and sponsor the bytes wherever the key already is.'
    ].join('\n'));
}
if (gatewayKey && !/^oda_[0-9a-f]{40}$/.test(gatewayKey)) {
    fail(`ODATANO_GATEWAY_KEY is not shaped like a gateway key (oda_ + 40 hex); got ${gatewayKey.length} characters.`);
}
// `sponsorSessionId` is OPTIONAL and normally absent. A sponsored job runs
// under a session the SERVER picks from the treasury pool, which is why
// `@odatano/nightgate-tx` reads the session id off the job it gets back rather
// than taking one from the caller ("the caller cannot know it", sdk/client.mjs).
// Omitting it uses the pool; setting it pins one session, which is a security
// boundary and stays exact. Requiring it here was wrong: it made a sandbox key,
// which has no session of its own, look unusable.
if (NEEDS_SPONSOR && sponsorSessionId) {
    // Truncated, as everywhere else: a pinned session is an identifier we have
    // no reason to print in full.
    console.log(`sponsor session pinned to ${sponsorSessionId.slice(0, 8)}...`);
}

const baseUrl = process.env.NIGHTGATE_BASE_URL
    ?? (gatewayKey ? 'https://api.preprod.odatano.dev' : 'https://api.nightgate.dev');
const auth = gatewayKey ? { token: gatewayKey } : { agentToken: legacyAgentToken };

/** Character count and decoded-byte fingerprint of a serialized transaction. */
function fingerprint(b64) {
    const bytes = Buffer.from(b64, 'base64');
    return {
        chars: b64.length,
        bytes: bytes.length,
        sha256: createHash('sha256').update(bytes).digest('hex')
    };
}

if (SPONSOR_FILE) {
    if (!existsSync(SPONSOR_FILE)) fail(`no such file: ${SPONSOR_FILE}`);

    // Read, never retyped. `trim()` only removes surrounding whitespace; any
    // whitespace INSIDE the base64 would be skipped silently by the decoder and
    // cost bytes, so it is refused rather than tolerated.
    const raw = readFileSync(SPONSOR_FILE, 'utf8');
    const b64 = raw.trim();
    if (/\s/.test(b64)) fail('the base64 in that file contains whitespace inside it. Re-emit it.');
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64)) fail('that file is not a single base64 string.');
    if (b64.length % 4 !== 0) fail(`base64 length ${b64.length} is not a multiple of 4, so characters are missing.`);

    const fp = fingerprint(b64);
    console.log(`\nsponsoring the bytes in\n  ${SPONSOR_FILE}`);
    console.log(`  ${fp.chars} base64 characters`);
    console.log(`  ${fp.bytes} decoded bytes`);
    console.log(`  sha256(decoded) ${fp.sha256}`);
    console.log('\nQuote all three to the sponsor. If their received counts differ from these,');
    console.log('the string was damaged in transit and the tag names are not the problem.');

    if (!SUBMIT) {
        console.log('\nNothing was sent. Re-run with --submit to hand these bytes to the sponsor.');
        process.exit(0);
    }

    const ngFile = connect({ baseUrl, ...auth });
    // A fresh idempotency key per attempt. Reusing one returns the FIRST job's
    // cached outcome, which on 2026-10-13 made one refused send look like two
    // independent failures and hid that the second form was never tried.
    const idempotencyKey = `vinpassport-sponsor-${fp.sha256.slice(0, 16)}-${Date.now()}`;
    console.log(`\nhanding them to the sponsor (idempotencyKey ${idempotencyKey})...`);
    // sponsorUnbound polls to completion itself and reads the session id off
    // the job, so this does not wait again and does not pin a session unless
    // one was deliberately configured.
    const fileOut = await ngFile.sponsorUnbound({
        unboundTxB64: b64,
        idempotencyKey,
        ...(sponsorSessionId ? { sponsorSessionId } : {})
    });
    console.log(`jobId ${fileOut.jobId ?? '(none reported)'}`);

    const landed = fileOut.deployed?.[0];
    if (!landed || !fileOut.txHash) {
        fail([
            `the sponsor did not report a deploy. jobId ${fileOut.jobId ?? '(none reported)'}`,
            `  status  ${fileOut.status ?? '(none)'}`,
            `  code    ${fileOut.errorCode ?? '(none)'}`,
            `  message ${fileOut.errorMessage ?? '(none)'}`,
            '',
            `  If the message reports a byte count other than ${fp.bytes}, the bytes were`,
            '  damaged in transit, not malformed. Quote the jobId and the three figures above.'
        ].join('\n'));
    }
    await recordConfirmedDeploy(landed, fileOut.txHash);
    console.log(`\nDEPLOYED  ${landed}`);
    console.log(`tx        ${fileOut.txHash}`);
    console.log(`recorded  deploy/preprod.json - commit it.`);
    process.exit(0);
}

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
console.log(`sponsor   ${NEEDS_SPONSOR
    ? `${baseUrl} (${sponsorSessionId ? `session ${sponsorSessionId.slice(0, 8)}...` : 'treasury pool session, chosen by the server'}, ${gatewayKey ? 'gateway key' : 'legacy agent token'})`
    : 'none needed for this mode; nothing is sponsored here'}`);
console.log(`mode      ${EMIT
    ? 'EMIT - build and prove, write the unbound transaction, submit nothing'
    : SELF_FUND
        ? (SUBMIT
            ? 'SELF-FUND + SUBMIT - we pay the fee from our own dust and deploy'
            : 'SELF-FUND dry run - build, prove and pay the fee, submit nothing')
        : SUBMIT
            ? 'SUBMIT - this spends 1 of 2 allowed deploys'
            : 'dry run - nothing leaves this machine'}`);
for (const r of regs) console.log(`registrar ${r.label} ${r.hex}  (${REGISTRAR_ROLES[r.label]})`);
console.log(`          this list is fixed for the contract's lifetime`);
console.log('\nbuilding and proving the deploy locally (wasm, takes a while)…');

/**
 * Write the public record of a deployment, keeping whatever was there before.
 *
 * The previous address has been quoted in a submission and in the README's
 * verification steps, and it stays readable on chain, so losing the file would
 * lose the comparison a reviewer makes between the two contracts.
 */
/**
 * Ask the public indexer which transaction carries the deploy of this address.
 *
 * This exists because the hash a submitter hands back is not necessarily the
 * one a verifier can look up. On 2026-10-13 the sponsor returned a 33-byte
 * identifier (`00e528df...`, which the indexer rejects outright as not a
 * 32-byte hash) while the deploy actually sat in `fe633e69...`. Recording the
 * submitter's value would have published a hash that resolves to nothing,
 * which is worse than publishing none. So the record carries the hash the
 * indexer confirms, and keeps the submitter's identifier beside it, labelled.
 *
 * Returns null when the indexer has not caught up yet; the caller decides.
 */
async function confirmOnIndexer(contractAddress) {
    const query = `query Deploy($address: HexEncoded!) {
      contractAction(address: $address) {
        __typename
        address
        transaction { hash block { height } }
      }
    }`;
    try {
        const r = await fetch(EP.indexerHttpUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ query, variables: { address: contractAddress } })
        });
        const j = await r.json();
        const a = j?.data?.contractAction;
        if (!a || a.address !== contractAddress) return null;
        return {
            kind: a.__typename,
            txHash: a.transaction?.hash ?? null,
            blockHeight: a.transaction?.block?.height ?? null
        };
    } catch {
        return null;
    }
}

/**
 * Wait for the indexer to show the deploy, then record it. A deploy needs a
 * block or two to be indexed, so this polls rather than asking once, and
 * records the submitter's value with `confirmedOnIndexer: false` if the wait
 * runs out. The deploy is on chain either way; only the published hash is in
 * question.
 */
async function recordConfirmedDeploy(contractAddress, submitterTxHash, { tries = 20, waitMs = 6000 } = {}) {
    process.stdout.write('confirming on the public indexer');
    for (let i = 0; i < tries; i++) {
        const confirmed = await confirmOnIndexer(contractAddress);
        if (confirmed?.txHash) {
            console.log(`\nconfirmed  ${confirmed.kind} in block ${confirmed.blockHeight}`);
            if (confirmed.txHash !== submitterTxHash) {
                console.log(`NOTE  the submitter reported ${submitterTxHash}`);
                console.log(`      the indexer resolves   ${confirmed.txHash}`);
                console.log('      the indexer hash is the one recorded and published.');
            }
            recordDeploy(contractAddress, submitterTxHash, confirmed);
            return confirmed;
        }
        process.stdout.write('.');
        await new Promise((r) => setTimeout(r, waitMs));
    }
    console.log('\nthe indexer has not shown this deploy yet.');
    console.log('Recording the submitter identifier and marking it unconfirmed; re-check before publishing it.');
    recordDeploy(contractAddress, submitterTxHash, null);
    return null;
}

function recordDeploy(contractAddress, txHash, confirmed = null) {
    mkdirSync(join(ROOT, 'deploy'), { recursive: true });
    if (existsSync(outPath)) {
        const archived = join(ROOT, 'deploy', `preprod-superseded-${Date.now()}.json`);
        renameSync(outPath, archived);
        console.log(`\narchived the previous record to ${archived}`);
    }
    // The published hash is the one a verifier can resolve. The submitter's
    // identifier is kept for traceability but never presented as the tx hash.
    const published = confirmed?.txHash ?? txHash;
    writeFileSync(outPath, JSON.stringify({
        network: 'preprod',
        contractAddress,
        txHash: published,
        ...(confirmed?.blockHeight ? { blockHeight: confirmed.blockHeight } : {}),
        ...(confirmed?.txHash && confirmed.txHash !== txHash
            ? { submitterReportedId: txHash }
            : {}),
        contract: 'vinpassport',
        confirmedOnIndexer: Boolean(confirmed?.txHash),
        note: 'Public record of the deployment. Address and tx hash are public by definition. '
            + 'txHash is the hash the public indexer resolves for this deploy; '
            + 'submitterReportedId, when present, is the different identifier the submitter returned.'
    }, null, 2) + '\n');
}

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
        // Self-funding balances the fee here, and the balancing path reads the
        // BOUND form, so it builds the same shape --emit-bound does.
        bind: (EMIT_BOUND || SELF_FUND) ? true : false
    });
    console.log(`\ncontract address (known before submission): ${deploy.contractAddress}`);

    if (EMIT || EMIT_BOUND) {
        // Outside the repository: these bytes are not secret, but they are
        // large, single-use and tied to one moment of contract state.
        const emitPath = join(ROOT, '..', '_local-tracking',
            `unbound-deploy-${new Date().toISOString().replace(/[:.]/g, '-')}.b64`);
        const b64 = EMIT_BOUND ? deploy.finalizedTxB64 : deploy.unboundTxB64;
        writeFileSync(emitPath, b64, 'utf8');
        const fp = fingerprint(b64);
        console.log(`\n${EMIT_BOUND ? 'BOUND/finalized' : 'unbound'} transaction written to\n  ${emitPath}`);
        console.log(`  ${fp.chars} base64 characters`);
        console.log(`  ${fp.bytes} decoded bytes`);
        console.log(`  sha256(decoded) ${fp.sha256}`);
        console.log('\nNothing was submitted. Hand those bytes to a sponsor that holds a key:');
        console.log(`  node scripts/deploy-preprod.mjs --sponsor-file ${emitPath} --submit`);
        console.log('\nSend the PATH, never the contents. Reproducing 16 thousand characters by');
        console.log('hand or through a tool argument drops a group out of a repetitive run, and');
        console.log('the sponsor then reports a deserialization error that reads like a tag');
        console.log('mismatch. That cost us two days on 2026-10-13. If a sponsor must receive');
        console.log('the string some other way, quote the three figures above and have them');
        console.log('confirm all three before anyone looks at tag names.');
        console.log('\nThe bytes are valid for the transaction TTL (about 30 minutes) and');
        console.log('against the contract state at build time. If sponsoring fails with');
        console.log('CHAIN_EXECUTION_FAILED, build again rather than resending these.');
        process.exit(0);
    }

    if (SELF_FUND) {
        const { payFromOwnDust } = await import('./lib/self-fund.mjs');
        const paid = await payFromOwnDust({
            finalizedTxB64: deploy.finalizedTxB64,
            seedHex: seed,
            submit: SUBMIT,
            log: (...a) => console.log(...a)
        });
        if (!paid.submitted) {
            console.log('\nSELF-FUND dry run complete. The fee was balanced from our own dust and the');
            console.log('transaction finalized, but NOTHING was submitted. Re-run with --submit to deploy.');
            console.log(`dust before ${paid.dustBefore}`);
            process.exit(0);
        }
        await recordConfirmedDeploy(deploy.contractAddress, paid.txHash);
        console.log(`\nDEPLOYED  ${deploy.contractAddress}`);
        console.log(`tx        ${paid.txHash}`);
        console.log(`fee paid  from our own dust (${paid.dustBefore} before)`);
        console.log(`recorded  deploy/preprod.json - commit it.`);
        process.exit(0);
    }

    if (!SUBMIT) {
        console.log('\nDry run complete. The transaction was proven and signed but NOT submitted.');
        console.log('Re-run with --submit to spend a deploy, --self-fund to pay for it ourselves,');
        console.log('or --emit-unbound to sponsor the bytes elsewhere.');
        process.exit(0);
    }

    const ng = connect({ baseUrl, ...auth });

    // On this path the base64 is never copied: it goes from the builder to the
    // request in one process. The fingerprint is printed anyway, so that a
    // refusal can be compared against what the sponsor says it received before
    // anyone starts reading tag names (see --sponsor-file above).
    const fp = fingerprint(deploy.unboundTxB64);
    console.log(`\nunbound transaction  ${fp.chars} base64 characters, ${fp.bytes} decoded bytes`);
    console.log(`sha256(decoded)      ${fp.sha256}`);

    const idempotencyKey = `vinpassport-deploy-${fp.sha256.slice(0, 16)}-${Date.now()}`;
    console.log('\nhanding the unbound transaction to the sponsor...');
    // sponsorUnbound already polls to completion and returns the finished job,
    // so there is no second waitForJob here. Only pin a session when one was
    // configured; otherwise the server picks from the pool.
    const out = await ng.sponsorUnbound({
        unboundTxB64: deploy.unboundTxB64,
        idempotencyKey,
        ...(sponsorSessionId ? { sponsorSessionId } : {})
    });
    console.log(`jobId ${out.jobId ?? '(none reported)'}  (idempotencyKey ${idempotencyKey})`);

    if (!out.txHash) {
        fail([
            `the sponsor did not submit. jobId ${out.jobId ?? '(none reported)'}`,
            `  status  ${out.status ?? '(none)'}`,
            `  code    ${out.errorCode ?? '(none)'}`,
            `  message ${out.errorMessage ?? '(none)'}`,
            '',
            '  If the message reports a byte count other than '
                + `${fp.bytes}, the bytes were damaged in transit, not malformed.`,
            '  Quote the jobId and the three figures above to the sponsor.'
        ].join('\n'));
    }

    const landedAt = out.deployed?.[0];
    if (landedAt && landedAt !== deploy.contractAddress) {
        fail(`landed address ${landedAt} differs from the locally computed ${deploy.contractAddress} - do not record either; investigate.`);
    }

    await recordConfirmedDeploy(deploy.contractAddress, out.txHash);

    console.log(`\nDEPLOYED  ${deploy.contractAddress}`);
    console.log(`tx        ${out.txHash}`);
    console.log(`recorded  deploy/preprod.json - commit it.`);
} finally {
    await builder.close?.();
}
