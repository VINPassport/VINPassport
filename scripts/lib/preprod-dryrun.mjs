/**
 * The dry run: a planned intake put through the REAL compiled circuits before
 * anything is proven, paid for or submitted.
 *
 * It lives in its own module for one reason. It is the only place where a
 * delegated write is checked against the authority rule the chain will apply,
 * and the preprod runner that used to hold it inline pulls in the whole wallet
 * SDK, so nothing could test it without a wallet. A test that re-implemented
 * the loop instead would be testing its own copy: the bug this guards against
 * is precisely a second code path that looks right and behaves differently.
 *
 * What it does and does not prove:
 *
 *   DOES    every call the plan makes is accepted by the compiled contract,
 *           acting as whoever the step says acts, so an update `by` a writer
 *           that was never authorised is refused here exactly as the chain
 *           would refuse it.
 *   DOES    the ledger that results - who registered the vehicle, which
 *           identity is recorded against each field, who may still write.
 *   NOT     that a ZK proof can be produced, that the fee can be paid, or
 *           that the node accepts the transaction. Those cost real money and
 *           belong to the runner.
 *
 * Refusals are RESULTS. A refused step is dropped from its stage rather than
 * aborting the run, and anything that would have opened its commitment then
 * refuses in turn, which is what the demo is meant to show.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { FIELDS, K } from './scenario.mjs';
import { makeStage, stepLabel } from './preprod-plan.mjs';

/**
 * Run `stages` through `sim`, dropping the steps the circuits refuse.
 *
 * Mutates `stages` the way the runner needs it to: each surviving step gains
 * the `writeIndex` that fixes which of a field's writes it opens, so a stage
 * that has to be re-planned later rebuilds identical calls.
 *
 * @param stages   from planCalls()
 * @param sim      a PassportSimulator, already pinned to the deploy list
 * @param o.registrarSecret  the identity that registers and proves
 * @param o.dealer           { label, secret } or null; the only delegate
 * @param o.vinBytes         vinHash of the vehicle
 * @param o.croot            its content root
 * @param o.saltOf           (name, seq) => salt, deterministic per run
 * @param o.writes           per-field write log, filled in as it goes
 * @returns { stages, refused, writes }
 */
export function dryRunStages(stages, { sim, registrarSecret, dealer, vinBytes, croot, saltOf, writes = {} }) {
    const refused = [];
    const saltFor = (name) => saltOf(name, writes[name]?.length ?? 0);
    for (const stage of stages) {
        stage.steps = stage.steps.filter((s) => {
            try {
                // Act as whoever this step acts as, then put the registrar
                // back. A delegated write that the chain would refuse must be
                // refused here too, and a registrar-only call that followed a
                // delegated one must not inherit the delegate's identity.
                //
                // `dealer &&` is load-bearing. Without it, a runner holding no
                // dealership compares `undefined === undefined` on every
                // ordinary step, takes the delegate branch and reads `.secret`
                // off null - so EVERY step is refused and the run dies as
                // "nothing survived the dry-run", with no hint that the cause
                // is a missing writer identity rather than the intake.
                sim.actAs(dealer && s.by === dealer.label ? dealer.secret : registrarSecret);
                if (s.kind === 'register') sim.registerPassport(vinBytes, croot);
                else if (s.kind === 'authorise') sim.authoriseWriter(vinBytes, s.writerId);
                else if (s.kind === 'withdraw') sim.withdrawWriter(vinBytes, s.writerId);
                else if (s.kind === 'init') {
                    if (!(s.name in FIELDS)) throw new Error('unknown field');
                    const salt = saltOf(s.name, 0);
                    sim.initialiseField(vinBytes, K[s.name], FIELDS[s.name].rule, s.value, salt);
                    writes[s.name] = [{ value: s.value, salt }];
                    s.writeIndex = 0;
                } else if (s.kind === 'update') {
                    if (!(s.name in FIELDS)) throw new Error('unknown field');
                    const salt = saltFor(s.name);
                    sim.recordField(vinBytes, K[s.name], s.value, salt);
                    s.writeIndex = ((writes[s.name] ??= []).push({ value: s.value, salt })) - 1;
                } else if (s.kind === 'claim') {
                    // Direction comes from the catalogue: a floor is a
                    // different circuit, not a different bound.
                    if (s.circuit === 'proveFieldAtMostField') {
                        if (!(s.against in FIELDS)) throw new Error('unknown field');
                        sim.proveFieldAtMostField(vinBytes, K[s.name], K[s.against], s.bound);
                        s.writeIndexAgainst = (writes[s.against]?.length ?? 0) - 1;
                    } else if (s.circuit === 'proveFieldAtLeast') {
                        sim.proveFieldAtLeast(vinBytes, K[s.name], s.bound);
                    } else {
                        sim.proveFieldAtMost(vinBytes, K[s.name], s.bound);
                    }
                    // Claims run last, so the write they open is the field's
                    // final one - fixed here, not at call time.
                    s.writeIndex = (writes[s.name]?.length ?? 0) - 1;
                }
                return true;
            } catch (e) {
                refused.push({ step: stepLabel(s), reason: String(e?.message ?? e).replace(/^.*failed assert: /, '') });
                return false;
            }
        });
    }
    // Relabel from what SURVIVED. A stage keeps the label it was planned with
    // otherwise, and would go on naming a claim the dry run refused and never
    // submitted.
    return {
        stages: stages.filter((st) => st.steps.length > 0).map((st) => makeStage(st.steps)),
        refused, writes
    };
}
