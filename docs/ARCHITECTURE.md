# Architecture

The legal basis for everything below is
**[Regulation (EU) 2026/1738](https://eur-lex.europa.eu/eli/reg/2026/1738/oj)**, Article 13: see
[REGULATION.md](REGULATION.md) for primary sources and the scope boundaries that constrain what we
may claim.

## Shape

> **What actually ships is smaller than the diagram below.** Per
> [D20](DECISIONS.md#settled), the submission deploys and calls `vinpassport` through
> **`@odatano/nightgate-tx`**: transactions are built, batched, proven and signed locally.
> Per [D24](DECISIONS.md#settled), the fee is then balanced from **our own DUST** and submitted
> straight to the public preprod node. ODATANO's hosted NIGHTGATE sponsored the Wave 1 deployment
> and is in no path now: the contract deployed on 14 October 2026 paid its own fee as well. Either way no witness ever leaves the process. There is no CAP
> application. The `@odatano/nightgate` *plugin* below is not built, in Wave 1 or Wave 2.
> The target architecture is unchanged; this note exists so nobody reads the diagram as a
> description of what is running today.

The target: VINPassport is a **SAP CAP application** that installs `@odatano/nightgate` as a plugin.
NIGHTGATE supplies the chain integration; VINPassport supplies the vehicle domain and the user-facing
surfaces.

```
┌─────────────────────────────────────────────────────────┐
│  VINPassport (this repo)                                  │
│                                                         │
│  db/passport-schema.cds   vehicle domain model          │
│  srv/passport-service.ts  read side; tiers per D26      │
│  srv/lib/vehicle-anchor   canonicalise → hash → anchor  │
│  app/                     producer cockpit, viewer      │
└────────────────────────┬────────────────────────────────┘
                         │ CAP plugin
┌────────────────────────▼────────────────────────────────┐
│  @odatano/nightgate                                     │
│  anchoring · ZK predicates · disclosure grants · jobs   │
│  attestation-vault (Compact, shipped precompiled)       │
└────────────────────────┬────────────────────────────────┘
                         │
┌────────────────────────▼────────────────────────────────┐
│  Midnight - preprod (ledger 8)                          │
└─────────────────────────────────────────────────────────┘
```

We do **not** fork NIGHTGATE. Where a need is general rather than vehicle-specific, it goes upstream
as a request or a PR.

## What we get, and what we must build

NIGHTGATE ships the `attestation-vault` contract **precompiled**, and an earlier revision of this
document recorded "no Compact toolchain required" as a benefit of that. **[D16](DECISIONS.md#settled)
reversed it.** The passport's distinguishing logic is ours and lives in
[`contracts/vinpassport`](../contracts/vinpassport), so Compact is on the critical
path. Compiled artifacts are committed, so only contributors *changing* the contract need the
toolchain, but they need WSL2, macOS or Linux, because Compact has no native Windows binary.

**Provided by NIGHTGATE (not in this submission, see [D20](DECISIONS.md#settled)):** document anchoring,
salted-Merkle field proofs, six predicate kinds,
three-level on-chain disclosure grants, async job orchestration, wallet and proving infrastructure,
OData V4 query semantics over all of it, and transaction fee sponsoring.

**Ours to build:** the passport contract itself, the vehicle domain model, the provable-field
registry, the disclosure tiers ([D26](DECISIONS.md#settled)), both UIs, document storage, the auth strategy,
and all HTTP security middleware. NIGHTGATE deliberately installs no global middleware: CORS, CSP
and HSTS are the host's problem.

## Disclosure tiers

NIGHTGATE's three levels map onto vehicle stakeholders cleanly:

| Level | Tier | Audience | Sees |
|---|---|---|---|
| 0 | `public` | Buyer scanning a listing | Make, model, year, category, type approval, environmental declarations |
| 1 | `trade` | Dealer, recycler, insurer, lender | + write-off category, accident count, owner count, service count, mileage |
| 2 | `authority` | DMV, police, notified body, ELV facility | + VIN, supplier identities, full lineage, dismantling data |

**The table is the policy. Enforcement is not a server.** Until 2026-10-31 this section planned a
service that shaped each answer to the caller's tier and refused queries probing hidden columns, as
NIGHTPASS does. That was reversed before it was built ([R7](DECISIONS.md#reversed)): to redact a
value a service must hold it, for every vehicle, in the clear. Instead a tier is **a bundle the
holder hands over** and the reader checks against the ledger ([D26](DECISIONS.md#settled)). A
`public` bundle carries only references to claims already on the ledger; a `trade` or `authority`
bundle carries openings for the fields its tier allows, and nothing that opens any other.

EVP content sits in `public` and stays there: Annex V 4.2.3 of Reg (EU) 2025/1707 forbids asking
for anything beyond the VIN to read it.

An on-chain grant records that a vehicle's registrar entitled a grantee to a tier. It makes a
disclosure auditable; it does not deliver data and cannot recall it. Grantee identities are
pseudonyms derived from the grantee's own secret, never PII.

## Predicates worth demonstrating

| Claim | Mechanism | Why it lands |
|---|---|---|
| Never written off | `proveFieldAtMost`, `writeOffCategory ≤ 0` | The costliest lie in the used market, and the one a buyer cannot check today |
| Never had a reported accident | `proveFieldAtMost`, `accidentCount ≤ 0` | A clean-history claim that discloses nothing about incidents |
| One keeper from new | `proveFieldAtMost`, `ownerCount ≤ 1` | Provenance, without naming anybody |
| Mileage has never decreased | `recordField` under `neverFalls` | The fraud everyone recognises, proven without revealing a reading |
| Nothing changed but the service fields | `documentComparison` across anchor versions | The general detector: catches the frauds nobody thought to ask about. **Not buildable yet: it needs two or more anchored roots per vehicle, and the contract stores one immutable `contentRoot`** |
| Recycled content meets threshold | `proveFieldAtMost` / `AtLeast` on slots 8 to 11 | Compliance proof that does not leak supplier economics |

**Build the write-off and accident claims first.** They are one circuit call each, they are what a
buyer actually asks, and they demonstrate the whole mechanism: a claim answered against an anchored
record with nothing disclosed. The mileage case is the same machinery on a field people already have
intuitions about, which makes it the better *explanation* but not the better first build.

A false claim **aborts during local proving, before submission**, so it never reaches the chain. A
successful transaction *is* the proof.

A successful proof also **records the claim**: which vehicle, which field, which direction, which
bound, and the commitment it was proven against. That is what gives a verifier something to read
afterwards rather than requiring them to be handed a transaction hash. See
[D19](DECISIONS.md#settled). The claim names its field, deliberately; it never carries the value.
Binding it to the commitment is what stops a claim outliving the value it was made about.

## The trust gap

**This is the most important section in this document, and the easiest to gloss over.**

NIGHTGATE's own architecture notes state the limit plainly: a fully trustless binding between the
anchored content root and the payload hash would need in-circuit blake2b, which is impractical. The
same attester builds both from the same content at anchor time.

So:

> **The producer is trusted to input truthful values.** A ZK proof shows a value *opens the
> commitment previously recorded for that vehicle and field* and satisfies a bound. Two things it
> does **not** show. First, nothing about whether that value matches physical reality. Second (and
> this is a property of the contract, not of physics), the per-field commitments and the anchored
> `contentRoot` are written by independent circuit calls, and no circuit cross-checks them; so a
> proof binds a value to its field commitment, not to the anchored document. Consistency between the
> two is the producer's responsibility in Wave 1, not a property the contract enforces (see
> [D23](DECISIONS.md#settled)).

> **What Wave 2 changed, 14 October 2026.** The quote above is the Wave 1 statement. Two halves of
> it are no longer open, and leaving it unqualified would understate the contract that is deployed.
>
> *Binding.* A field's slot is derived from the vehicle's content root, which every circuit reads
> from `passports` and no caller may pass in (`slotOf`, domain tag `vinpassport:field:v2`). A claim
> about a different document lands on a different slot, so a proof no longer floats free of the
> payload the verifier is holding. Anyone handed the document can recompute the slot and check it.
>
> *Attribution.* Every write is gated on an identity derived in-circuit from a registrar secret and
> checked against `allowedRegistrars`, a set fixed in the constructor with no circuit that adds to
> it. The ledger records which identity registered a vehicle, and which identity last wrote each
> of its fields.
>
> *Custody.* A vehicle outlives the party that registered it, so the registrar may authorise
> another identity to write **one** vehicle, and withdraw it again
> ([D25](DECISIONS.md#settled)). Delegation hands over the pen and nothing else: the integrity
> rule was fixed when the field was created and the circuit applies it to every writer, so an
> authorised dealership can record a higher odometer reading and still cannot record a lower one.
>
> Neither makes a value true. Mapping one of those on-chain identities to a legal person is an
> off-chain admission step, and the first value written for a vehicle that joins the system
> mid-life is only as good as the party that entered it. Response 3 below is therefore half
> delivered in-circuit and half still a relationship problem.
>
> **Added 14 October 2026:** attribution is now per write rather than per vehicle. A vehicle's
> registrar may authorise other identities to write that one vehicle, each field records which
> identity last wrote it, and the integrity rules apply to an authorised writer exactly as they
> apply to the registrar. That is what lets a dealership and a garage write a car's history
> without either of them being trusted with the rest of it. [D25](DECISIONS.md#settled) has the
> design, including the privacy it spends: who wrote a field is public, deliberately.

For batteries this is tolerable: a manufacturer declaring its own carbon footprint is the assumed
model, and the regulation is built around accountable self-declaration.

**For self-declared history and VIN integrity it is the entire problem.** A garage that anchors a
false accident count, or a rolled-back reading, produces proofs that are cryptographically perfect
and factually false. Anchoring
makes the lie *immutable and attributable*; it does not make it detectable.

Three honest responses, and we intend all three:

1. **Attribute every anchor.** Tamper-evidence and a named attester is a real improvement on a paper
   service book, even without hardware. Fraud becomes traceable rather than deniable.
2. **Prove consistency, not truth.** Monotonicity across versions catches the common rollback case
   without any trust assumption, because it compares the producer's own prior commitments.
3. **Close the gap at the writer, not the sensor.** A proof inherits the trust of whoever wrote the
   value, so the gap closes when the value is committed by a party already accountable for it:
   registries, testers, insurers writing under an accountable identity, with marking that lets a
   verifier tell such a write from a self-declared one. That is a data-relationship problem before
   it is a cryptographic one, and it is precisely the gap NIGHTGATE documents and does not attempt
   to fill. **Attestation at the sensor would also close it, but on-device hardware is out of scope
   with no timeline and must not be presented as a dated phase**. See the scope notice below.

Nothing shipped should be described as preventing fraud. It makes fraud attributable and rollbacks
detectable. That is a real claim; the stronger one would be false.

> **Scope notice, 9 September 2026.** On-device chip proving is **out of scope with no timeline**.
> It is not a phase, not a milestone, and must not appear as one: here, in the roadmap, in the
> deck, or in a conversation. Recorded formally as [R5](DECISIONS.md#reversed) on 9 September 2026,
> which amends the hardware half of **D6** and rewrites the Phase 2 section of `ROADMAP.md`.
> Chip-free with no hardware root of trust (the rest of D6) stands.

## Hard constraints

| Constraint | Consequence |
|---|---|
| **No in-circuit signature verification on mainnet.** Compact 0.31.x / ledger 8 has none. `jubjubSchnorrVerify` exists only on the ledger-9 RC line (0.33+), undocumented and deployed nowhere public. | No signature of any kind can be verified in-circuit on a public network today, so nothing in the design may depend on one. This is a constraint on Compact, not a scheduling note: [R5](DECISIONS.md#reversed) removed the hardware work, so there is no signature spec left to write. |
| **NIGHTGATE hard-gates mainnet off** (`allowMainnetSubmission: false`). | Preprod is the target. Plan no mainnet demo. |
| **32 provable slots** via `attestation-vault-32` (NIGHTGATE 0.19.0). Width is effectively permanent: cross-root proofs relate same-width documents only. | 26 in use, 6 reserved. See [FIELDS.md](FIELDS.md). The width choice is one-way. **Updated 18 Oct: the reserve is not enough.** Appendix 1 to Annex V needs about 18 further values for a conventional M1 and nearer 40 for a plug-in hybrid, against 6 free slots, so the EVP cannot sit beside the circularity panel. The answer is **section roots**, several same-width trees under one top root, which is also what the vault maintainer recommends for width beyond 32. One section each for the EVP, the circularity panel and history. |
| **Proving time is the real throughput ceiling**, not wallets and not treasury. Measured 16 Oct: `initialiseField` 37.4 s, `registerPassport` 17.5 s. | A 68-field vehicle is **42.7 minutes of proving**, and batching cannot reduce it because batching removes block confirmations, not proofs. With one dust spend in flight per wallet that is **16 to 34 vehicles a day per pipeline**. Size-to-time is linear in prover key: about **11.2 s fixed plus 2.83 s per MB**, refitted 18 Oct after a logarithmic fit mispredicted an external 76 MB circuit by 8.6x. |
| **Sponsor throughput scales with wallet count**, not balance: one dust spend in flight per wallet. | Treasury is a pool. See [BUILD-SCOPE.md](BUILD-SCOPE.md). |
| **`setNetworkId()` is process-global.** | One network per process. No multi-network single deployment. |
| **NIGHTGATE is 0.x, shipping breaking changes roughly weekly.** A whole attestation lane was removed at 0.16.0; salting at 0.16.0 broke every older client. | **Pin exact versions.** Never use `^` on `@odatano/*`. Upgrade deliberately, with a re-anchor plan. |
| **Bus factor of one** across the entire ODATANO org. | Apache-2.0 makes a fork legally trivial. Keep a vendored copy of the exact version in use, and do not accrete dependencies on unreleased behaviour. |
| **Losing `contentSaltSeed` makes an anchored root permanently unprovable.** | Seed backup is an operational requirement with a tested restore path, not a nicety. |

## Verification status

This document is derived from reading public ODATANO repositories and Midnight release notes. It has
**not** been validated by running the stack. Before building on any specific claim here, confirm it
against the installed packages: the checklist in [FIELDS.md](FIELDS.md) is the starting point.
