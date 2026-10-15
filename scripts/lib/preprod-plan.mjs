/**
 * How an intake becomes transactions, and how a call's private state is armed.
 *
 * Kept apart from preprod-runner.mjs, which pulls in the whole wallet SDK, so
 * these two rules can be tested in milliseconds without a chain, a wallet or
 * a proof. Both were learned from rejected transactions rather than from a
 * type signature, which is exactly why they live somewhere testable.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { webcrypto } from 'node:crypto';
import { CLAIM_CATALOGUE, boundFor } from '../../site/assets/claim-catalogue.mjs';

/**
 * Circuits that write a cell the ledger already holds.
 *
 * The ledger's sequencing check refuses a call that updates an
 * already-populated cell when any later intent follows it in the same
 * transaction (the node reports it as a bare 1010/188). Reading the contract:
 *
 *   registerPassport   inserts a fresh vinHash into passports + registrar
 *   initialiseField    inserts a fresh slot, then updateCount.increment()
 *   recordField        OVERWRITES the slot, then updateCount.increment()
 *   proveFieldAtMost   inserts a fresh claimKey into claims
 *
 * updateCount is a Counter - one cell, always populated - so initialiseField
 * and recordField are the cell-updating pair. Registration and the proof
 * circuits touch nothing that already exists, which is why "anchor first,
 * then proofs" is the shape that batches.
 */
export const CELL_UPDATING = new Set(['initialiseField', 'recordField']);

export const MAX_CALLS_PER_TX = 8;      // nightgate-tx batch ceiling
export const MAX_CALLS_PER_RUN = 12;    // bounds a run's wall clock

/**
 * The claims a console can request, mapped onto circuit calls.
 *
 * DERIVED FROM THE ONE CATALOGUE, not restated here. This list, the questions
 * the verify page renders and the claims the simulator runs were three
 * separate hardcoded fours that agreed by luck; they are now the same data.
 * See site/assets/claim-catalogue.mjs.
 *
 *   atMost     which circuit proves it. A floor is proveFieldAtLeast, and
 *              before this existed every requested claim was a ceiling, which
 *              is why proveFieldAtLeast had never been submitted on chain.
 *   openBound  the question names no rung, so the asker supplies the bound
 *              ("under a ceiling you state"). Everything else uses the
 *              catalogue's standard rung, which is what stops a bespoke bound
 *              per enquiry narrowing the hidden value.
 */
export const CLAIM_DEFS = Object.fromEntries(CLAIM_CATALOGUE.map((q) => [q.id, {
    field: q.field,
    atMost: q.atMost,
    openBound: q.bound === null,
    openLabel: q.openLabel,
    bound: (v) => (q.bound === null ? BigInt(v) : boundFor(q)),
    label: q.label
}]));

/** Units for the questions whose bound the asker supplies. */
const UNIT = { km: ' km', kg: ' kg', pct: '%', minutes: ' min', cc: ' cc', kw: ' kW' };

/**
 * A receipt label for a requested claim. An open-bound question has to carry
 * the bound the asker named, because "Mileage under" says nothing on its own.
 * `kind` comes from the field registry, which this module does not import.
 */
export const claimLabel = (def, wanted, kind) =>
    def.openBound
        ? `${def.openLabel ?? def.label} ${wanted}${UNIT[kind] ?? ''}`
        : def.label;

// Random demo VIN: real 17-char shape, VPD prefix marks it as a demo unit.
const VIN_ALPHABET = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789'; // no I/O/Q
export const randomDemoVin = () => {
    const u = new Uint8Array(14);
    webcrypto.getRandomValues(u);
    return 'VPD' + Array.from(u, (b) => VIN_ALPHABET[b % VIN_ALPHABET.length]).join('');
};

export const stepLabel = (s) =>
    s.kind === 'register' ? 'registerPassport'
        : s.kind === 'authorise' ? `authoriseWriter ${s.writerLabel}`
            : s.kind === 'init' ? `initialiseField ${s.name}`
                : s.kind === 'update' ? `update ${s.round}: ${s.name} -> ${s.value}${s.by ? ` (by ${s.by})` : ''}`
                    : `prove ${s.claim}${s.claim === 'mileageUnder' ? ' ' + s.bound : ''}`;

export const makeStage = (steps) => ({
    label: steps.length === 1 ? stepLabel(steps[0])
        : `${steps.length} calls: ${steps.map(stepLabel).join(' + ')}`,
    steps
});

/**
 * The calls an intake needs, in dependency order, packed into as few
 * transactions as the sequencing rule allows: a transaction accumulates
 * freely-batchable calls and is closed by the first cell-updating call it
 * meets. Apply order inside a transaction is call order (nightgate-tx sorts
 * the randomized segment ids ascending before proving), so a batch may carry
 * dependent calls - a registration and the initialisation that needs it.
 *
 * One batch here holds several identically-named calls: the claims. The
 * builder cannot tell same-named intents apart, so their relative apply order
 * is not guaranteed - which is fine precisely because claims are independent.
 * Each opens its own field's commitment and inserts its own fresh claimKey,
 * so no claim can observe another. Never batch same-named calls that DO
 * depend on each other; give them their own transactions instead.
 */
export function planCalls(intake) {
    const steps = [{ kind: 'register', circuit: 'registerPassport' }];
    for (const [name, value] of Object.entries(intake.fields ?? {})) {
        steps.push({ kind: 'init', circuit: 'initialiseField', name, value: BigInt(value) });
    }
    // Delegation comes after the fields exist. `authoriseWriter` asserts the
    // passport is known and that the caller is ITS registrar, so it cannot
    // lead the run, and a writer that is going to update a field needs the
    // field initialised first. It only inserts a fresh key, so unlike a
    // field write it does not close a transaction.
    for (const w of intake.authorise ?? []) {
        steps.push({ kind: 'authorise', circuit: 'authoriseWriter', writerLabel: w.label, writerId: w.id });
    }
    (intake.updates ?? []).forEach((round, i) => {
        // `by` names an authorised writer instead of the registrar. It is not
        // a field, so it never becomes a value.
        const { by, ...values } = round;
        for (const [name, value] of Object.entries(values)) {
            steps.push({ kind: 'update', circuit: 'recordField', name, value: BigInt(value), round: i + 1, by });
        }
    });
    for (const [claim, def] of Object.entries(CLAIM_DEFS)) {
        const wanted = intake.prove?.[claim];
        if (!wanted) continue;
        steps.push({
            kind: 'claim',
            circuit: def.atMost ? 'proveFieldAtMost' : 'proveFieldAtLeast',
            claim, name: def.field, bound: def.bound(wanted)
        });
    }
    if (steps.length > MAX_CALLS_PER_RUN) {
        throw Object.assign(
            new Error(`intake needs ${steps.length} on-chain calls; the demo caps at ${MAX_CALLS_PER_RUN} - fewer fields, updates or claims, please`),
            { code: 'TOO_LARGE' });
    }

    const stages = [];
    let cur = [];
    const close = () => { if (cur.length) { stages.push(makeStage(cur)); cur = []; } };
    for (const s of steps) {
        cur.push(s);
        if (CELL_UPDATING.has(s.circuit) || cur.length >= MAX_CALLS_PER_TX) close();
    }
    close();
    return stages;
}

const zero32 = () => new Uint8Array(32);

/**
 * The shared witness holder, and the only sanctioned way to fill it.
 *
 * ARMING IS NOT OPTIONAL. nightgate-tx runs per-call `before` hooks only for
 * a BATCH; a single call is proven with the witnesses exactly as they stand.
 * An unarmed holder would read as value 0 with a zero salt - and because
 * initialiseField asserts nothing about prior state, that PROVES and LANDS,
 * writing a commitment nobody can ever open. The damage only surfaces later,
 * when recordField or a claim tries to open it.
 *
 * So the holder refuses to be read until a hook has armed it for the call in
 * flight. A missed arming is a loud build error instead of a quiet zero on
 * the public chain.
 */
export function makeWitnessHolder(registrarSecret) {
    const holder = {
        pending: { value: 0n, salt: zero32() }, prev: { value: 0n, salt: zero32() },
        // Who the call in flight acts as. A run used to act as one registrar
        // throughout; a vehicle that changes hands does not. The registrar
        // still authorises, but the dealership writes under its OWN identity,
        // so the secret has to be armed per call like the value pair.
        secret: registrarSecret, armed: null
    };
    const armedRead = (what, pick) => (ctx) => {
        if (!holder.armed) {
            throw new Error(`witness ${what}() was read before any call armed it; refusing to prove a zero value`);
        }
        return [ctx.privateState, pick()];
    };
    return {
        holder,
        witnesses: {
            newValue: armedRead('newValue', () => holder.pending.value),
            newSalt: armedRead('newSalt', () => holder.pending.salt),
            previousValue: armedRead('previousValue', () => holder.prev.value),
            previousSalt: armedRead('previousSalt', () => holder.prev.salt),
            // Armed per call like the rest, because a delegated write acts as
            // a different identity. Refuses to read when absent for the same
            // reason the value reads do: proving against a zero secret would
            // derive an identity nobody holds and fail on chain for a
            // confusing reason instead of here for a clear one.
            registrarSecret: armedRead('registrarSecret', () => {
                if (!holder.secret) {
                    throw new Error('witness registrarSecret() was read, but no secret is armed');
                }
                return holder.secret;
            })
        },
        arm: (label, state) => () => {
            holder.pending = state.pending ?? { value: 0n, salt: zero32() };
            holder.prev = state.prev ?? { value: 0n, salt: zero32() };
            // Unstated means the run's own registrar, so every existing call
            // site keeps the behaviour it had.
            holder.secret = state.secret ?? registrarSecret;
            holder.armed = label;
        }
    };
}
