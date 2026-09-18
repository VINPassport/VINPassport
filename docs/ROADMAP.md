# Roadmap

Two orderings, both binding.

**Phases** order the work by dependency — what has to exist before what. They are the product, and
they do not care about deadlines.

**The [wave plan](#wave-plan)** orders the same work by what the Buildathon rubric pays for. Inside
a wave window it wins, because a phase that is half finished on the deadline scores as half
finished. Between windows the phases win.

[Q3](DECISIONS.md#resolved) settled 2026-09-18: enter every wave, starting at Wave 1. The
[Midnight Buildathon](https://midnight.network/hackathon/buildathon) runs three separately judged
waves — **Wave 1** built 27 Aug – 16 Sep (submitted 9 Sep), **Wave 2** 27 Sep – 17 Oct, **Wave 3**
27 Oct – 16 Nov. Each is scored fresh on progress made inside its own window, so a weak wave is not
a handicap and a strong one is not credit carried forward.

---

## Wave plan

### What the rubric pays for

| Weight | Criterion | What moves it here |
|---:|---|---|
| **40%** | Engineering & implementation | Circuits that close a named weakness; a contract deployed to a network a judge can query; private state handled properly |
| **15%** | Quality assurance & reliability | Tests against compiled circuits, not mocks. Every guard has a test that asserts its refusal. Mutation coverage stated as *N of N* |
| **15%** | Product & vision | A realistic scope and roadmap, and a privacy claim the contract actually enforces |
| **15%** | User experience & design | A stranger can reach a verdict from the live site without help |
| **10%** | Communication | Deck and video that describe the deployed contract, not an earlier plan |
| **5%** | Business development | Named buyer, named adoption path |

Gate, checked before any of the above is scored: a Compact contract that compiles, the
`midnightntwrk` GitHub label, a public repo under Apache-2.0, a slide deck, a demo video.

**The rule this plan exists to enforce:** work the 55% first and the 10% last. Wave 1 did the
reverse in its final week. Readiness is not "is the gate met" — the gate was met in Wave 1 — it is
"where is the next point, and which band is it in."

### Wave 1 — submitted, judged to 26 Sep

Shipped: 5 circuits, preprod deploy `72e52488…d553a`, 141 tests, three live surfaces, the
[D23](DECISIONS.md#settled) limits published before a judge could find them. D23 is the part to
keep doing — stating your own gaps is what separates the strongest submissions in this field from
the rest.

What Wave 2 adds is listed below. The reasoning about what Wave 1 left open is tracked locally in
`SECURITY-NOTES.local.md`, not here — in this repo we state the rule, not the gap it guards.
[D23](DECISIONS.md#settled) remains the deliberate, curated statement of the contract's limits.

### 18 – 26 Sep — between waves

Wave 2 requires functionality *newly developed or materially extended inside its window*, so
contract changes wait for the 27th. This week takes the work that is not contract functionality.

- [x] **Toolchain drift closed.** The tree had artifacts built at 0.34.0 / language 0.26.0 /
      runtime 0.19.0 while the committed set, the deployed contract and the Wave 1 text all say
      0.31.1 / 0.23.0 / 0.16.0 — and ledger 9 output will not deploy to preprod, which runs
      ledger 8. Restored, recompiled at 0.31.1, and the output is identical to the committed
      artifacts including all ten `zkir` files. `.gitattributes` now pins the generated output to
      LF so a Windows checkout and a Linux checkout hold the same bytes
- [ ] **Measure `proveFieldAtMost` / `proveFieldAtLeast`.** The 8 Sep blocker was that they assert
      `fieldCommitment.member(slot)` and so need an initialised field on-chain; five are now wired,
      so it is unblocked. These are the circuits a verifier actually waits on
- [ ] **Close the DUST number** by decoding `DustSpendProcessed` rather than diffing balances —
      the reason the balance diff gives a 2.4x spread is written up under Phase 0 below
- [ ] **Build the mutation harness** — a script that reverts each guard in turn and records which
      tests die, so Wave 2 can report *N of N* instead of a worked example on two

### Wave 2 — 27 Sep – 17 Oct

Engineering first, communication last.

| Days | Band | Work |
|---|---|---|
| 27 Sep – 8 Oct | **Eng 40%** | Registrar identity derived in-circuit from a witness secret, never `ownPublicKey()`, with an allowlist pinned at deploy ([D23](DECISIONS.md#settled) item 1, shares its mechanism with Phase 2) · bind field commitments to the content root · widen from 5 wired fields toward 16 · redeploy to preprod, keeping the Wave 1 address quotable so the delta is demonstrable |
| 6 – 13 Oct | **QA 15%** | Run the mutation harness across every guard and publish the kill table · every new guard gets a test that asserts the circuit refuses, with the refusal checked by message so it cannot pass by accident |
| 10 – 15 Oct | **UX 15%** | Submission from the page beyond the current 5-runs-a-day path · the what-the-chain-sees panel |
| 15 – 17 Oct | **Comms 10%, Product 15%, BD 5%** | Deck rebuilt against the deployed v2 contract rather than the earlier three-chip story · new video · submission text with an explicit *what changed since Wave 1* section, which is a stated requirement |

**On widening the fields.** "One predicate working beats six wired up" (below) was written when
nothing worked end to end yet, and it was right then. The path now works, so widening is no longer
scaffolding — it is the difference between a demo and a lifecycle. The principle still holds for
anything *new*: do not wire a field whose predicate has never run.

### Wave 3 — 27 Oct – 16 Nov

Not planned in detail; it depends on what Wave 2 judging says. The candidates are Phase 1 tiered
disclosure and the first authoritative writer from Phase 2 — the differentiator, and the one thing
no other submission in this field has.

### Standing check

Every Friday, score the current state against the six weights above and name where the next point
is. That scorecard replaces "are we good to submit?" as the pre-deadline check.

---

## Phase 0 — A working vehicle passport

**Done when:** a vehicle passport can be registered on Midnight preprod, panel fields recorded as
private state, and threshold and integrity claims proved in-circuit without any value ever being
disclosed — reachable end-to-end from a browser.

The centrepiece is `contracts/vinpassport_passport.compact` (D16). Readings are witnesses; only
commitments reach the ledger. **Compile in WSL2** — Compact has no native Windows binary.

### Contract surface

| Circuit | Does | Private state |
|---|---|---|
| `registerPassport` | Anchor a vehicle's content root | — |
| `initialiseField` | Create a panel field and fix its integrity rule for good | The opening value |
| `recordField` | Write a new value, proving the caller knows the current one and that the change respects the field's rule | Both values |
| `proveFieldAtMost` | Prove a hidden value is at or below a bound | The value |
| `proveFieldAtLeast` | Prove a hidden value is at or above a bound | The value |

Role-scoped disclosure is Phase 1, in the service layer and NIGHTGATE's on-chain grants — not a
circuit here.

> **Rewritten 2026-08-31.** This list was the CAP-era plan and had drifted badly: it still called
> for scaffolding that [D20](DECISIONS.md#settled) removed, and left items unticked that shipped
> weeks ago. Ticks below are verified against the repository, not remembered.

- [x] Verify the [FIELDS.md](FIELDS.md) checklist against installed `@odatano/*` packages —
      24 assertions in `test/sdk-assumptions.mjs`, run by `npm test`
- [x] ~~CAP scaffold~~, ~~`nightgate-fetch-keys attestation-vault-32`~~, ~~`db/vehicle-schema.cds`~~
      — **dropped by [D20](DECISIONS.md#settled)**: no CAP application, and we deployed our own
      contract rather than registering a vault. Returns as Phase 1 service-layer work
- [x] `PROVABLE_FIELDS` registry, 32 slots per FIELDS.md — layout settled (26 used, 6 reserved);
      5 wired end to end, the rest documented but not yet exercised
- [x] Canonicalisation and anchoring path — `contentRoot` over the salted panel
- [x] Predicates end to end — `proveFieldAtMost` / `proveFieldAtLeast` land on preprod, and a
      claim that cannot hold is refused in-circuit and reported rather than hidden
- [x] The verification surface — `site/verify/`, QR to verdict, mobile, no login. (Built at
      `site/verify/`, not the planned `app/scan/`)
- [x] Seed data and a demo scenario — `npm run demo:export` regenerates `site/verify/` from the
      real compiled circuits, so the committed fixture cannot drift from the contract
- [x] Fee funding — **not** the planned treasury pool. [D24](DECISIONS.md#settled): one wallet,
      self-renewing DUST from registered NIGHT. Per-organisation sessions, and the attribution that
      comes with them, are Phase 1
- [ ] **Measure DUST cost** per anchor and per proof, batched versus unbatched, width 32 versus 16 —
      gates all pricing; see [BUILD-SCOPE.md](BUILD-SCOPE.md). **Not yet measured to a number worth
      pricing from**, and the reason is worth writing down so the next attempt does not repeat it:
      the wallet balance either side of a fee measures the dust *note* the balancer consumed, not
      the fee, and the change returns a stage later. Within one run that reads as a convincingly
      tight spread — under 2% across five stages — while two runs of the identical five-stage
      workload differ by 2.4x (2.89e17 vs 7.02e17 per stage) purely because the balancer picked
      differently sized notes. The whole-run delta is no better: DUST regenerates faster than an
      idle sample predicts, so one of those runs ended with *more* dust than it started with. The
      indexer's `fee` field is a placeholder (it reports 1). A run consumes notes totalling
      1.4e18-3.5e18 SPECKs and the true fee is somewhere below that; closing this needs the
      per-transaction spend decoded from the `DustSpendProcessed` ledger event, not a balance diff.
      Fees are charged per *transaction*, not per call, so batching two calls into one still halves
      the per-call cost whatever the absolute number turns out to be
- [ ] `contentSaltSeed` persistence **with a tested restore path** — a run seeds its salts per run
      and hands them to the holder in the receipt; there is no long-lived seed to restore yet

**Explicitly not in Phase 0:** billing, hardware, tiered disclosure UI, the console beyond a rough
form, Cardano, mainnet.

Sponsoring and cost measurement come **before** polished UI. If the unit economics do not work, the
UI is wasted effort.

One predicate working end to end demonstrates more than six half-wired ones. Start with the claims
a buyer actually asks — never written off, no reported accidents — because they are a single circuit
call each and they exercise the whole path: canonicalise, anchor, prove, submit, verify.

## Phase 1 — Tiered disclosure and a real audience

**Done when:** three distinct viewers see three genuinely different views of the same vehicle, and a
grant can elevate a viewer's tier on-chain.

- [ ] Tier redaction in `passport-service.ts`
- [ ] **Query guard** — reject `$filter`/`$orderby`/`$apply` that probe invisible columns. Redaction
      alone is bypassable; see [ARCHITECTURE.md](ARCHITECTURE.md)
- [ ] Disclosure grant issue and revoke
- [ ] Grantee identity binding — `sha256(did)`
- [ ] Consumer viewer — the buyer-facing scan
- [ ] Remaining predicates: accident count, recycled content, battery health
- [ ] Auth strategy and HTTP security middleware (NIGHTGATE provides neither)

## Phase 2 — Provenance of the writer

**Done when:** a reading written by an accountable source can be distinguished from a self-declared
one, and the difference is visible to a verifier.

> **Rewritten 2026-09-09 by [R5](DECISIONS.md#reversed).** This section previously scheduled a
> simulated secure element, a curve-agile hardware signature spec, and an in-circuit verification
> design against ledger 9. On-device chip proving is out of scope with no timeline, so those items
> are removed rather than deferred. What remains is the half that was never about hardware.

- [ ] Writer identity in-circuit — derived from a witness secret and compared to pinned ledger
      state, never `ownPublicKey()`. Shares its mechanism with [D23](DECISIONS.md#settled) item 1
- [ ] Provenance marking — an authoritative-source write distinguishable from a self-declared one,
      and rendered as such on the verification surface rather than left in the data
- [ ] One authoritative source actually writing — a registry, a tester or an insurer, under an
      identity a verifier can hold accountable

This is the differentiator, and it is deliberately last because Phases 0 and 1 must stand alone
first. It is a data-relationship problem before it is a cryptographic one: the hard part is finding
a source willing to write, not a circuit that checks a signature.

## Phase 3 — Interoperability

- [ ] Battery passport join via slots 17 and 29 — the regulation's interoperability clause, working
- [ ] NIGHTPASS composition demo
- [ ] EU DPP Registry enrolment path
- [ ] Dealer workflow — manufacturer dealerships and the second-hand trade, stages two and three
      of the cascade ([R6](DECISIONS.md#reversed))

---

## Ordering principles

**Verify before building.** Every architectural claim in these docs comes from reading ODATANO's
public repositories, not from running them. Phase 0's first task is confirming the assumptions.

**One predicate working beats six wired up.** A single end-to-end proof exercises canonicalisation,
anchoring, proving, submission and verification. Breadth without that is scaffolding.

**Do not claim fraud prevention.** Not in Phase 0, not in Phase 1, and not as something a later
phase delivers — no phase on this roadmap prevents fraud. What they do is make it *attributable* and
make rollbacks *detectable*. That is a real and defensible claim. Prevention is not, and overclaiming
to a judge or a partner is how credibility is lost.
