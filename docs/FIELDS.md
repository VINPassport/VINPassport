# Provable field registry

**Target: `attestation-vault-32`, 32 slots, depth 5.** 26 fields in use, 6 reserved.

**That cap applies to the anchored document, not to the number of provable fields.** The two are
different budgets and only one is scarce: see [Two budgets](#two-budgets-and-only-one-is-scarce).
The registry holds **68 fields** today, of which 26 are panel slots and the rest are history.

> This document was rewritten on 2026-08-23. NIGHTGATE 0.19.0 (22 Aug) introduced a 32-slot vault
> lineage, lifting what had been this project's tightest constraint. The previous revision described
> a 16-slot panel filled to capacity.

## Slot widths

`@odatano/dpp-sdk@0.2.0` exposes `VAULT_SLOT_WIDTHS = [8, 16, 32]`, with `MERKLE_DEPTH = 4`
documented as *"DEFAULT tree depth (16-slot panel), **not a limit**"*. Width maps to depth via
`depthForWidth()`: 16 → 4, 32 → 5.

NIGHTGATE's own note on why the menu stops at 32:

> Widths were measured before the choice: prover keys scale linearly and wasm proving hits its
> memory ceiling at 64, so the menu is 16 and 32.

**Width is effectively permanent.** Cross-root proofs relate documents of the same width only, so a
document family picks a width and keeps it. Changing later means re-anchoring every passport onto a
different contract lineage. We choose 32 now, while we have nothing anchored and the choice is free.

## Two rules that constrain the layout

**Numerics must precede all strings.** `provableFieldKind()` returns `'numeric' | 'string'`, and the
registry ordering is frozen shared vocabulary.

**Reserved slots must be typed by position.** A slot reserved *after* the strings can only ever hold
a string. Adding a numeric later would mean reordering, which changes every root. So the reserve is
split: four numeric slots before the strings, two string slots after.

**Overflow is loud, not silent.** `padToWidth` throws rather than dropping the tail, *"a registry
that outgrew its width would otherwise silently stop anchoring its last fields."*

---

## The panel

Numerics scale ×1000 into Uint64 (`VALUE_SCALE = 1000`). Strings commit to the blake2b-256 digest of
the exact string. Public label is `fieldKeyHex(name)` = blake2b-256 of the field name.

### Numeric: slots 0 to 17

| # | Field | Serves | Note |
|---|---|---|---|
| 0 | `odometerKm` | Fraud | The headline claim; monotonicity across versions is the demo |
| 1 | `accidentCount` | Fraud | "Never written off" without disclosing incidents |
| 2 | `ownerCount` | Fraud | Title-washing signal |
| 3 | `serviceCount` | Fraud | Maintenance evidence without the service book |
| 4 | `writeOffCategory` | Fraud | 0 = none; category codes above |
| 5 | `firstRegistrationDate` | Identity | Epoch days |
| 6 | `lastInspectionDate` | Identity | Epoch days |
| 7 | `co2FootprintKgCO2e` | Art 13 | Environmental declaration |
| 8 | `recycledPlasticPct` | Art 6(1) / 10 | 15 % from 2032, 25 % from 2036; declared under Art. 10 |
| 9 | `recycledPlasticFromELVPct` | Art 6(2) | At least 20 % of the Art. 6(1) target, from end-of-life vehicles |
| 10 | `recycledSteelPct` | Recital 33 | **No target yet**: delegated act empowered, slot held ready |
| 11 | `recycledAluminiumPct` | Recital 34 | **No target yet**: delegated act empowered, slot held ready |
| 12 | `criticalRawMaterialPct` | Art 13 | CRM declaration |
| 13 | `reusabilityPct` | 3R | Inherited from Directive 2005/64/EC |
| 14 | `recyclabilityPct` | 3R | Inherited from Directive 2005/64/EC |
| 15 | `recoverabilityPct` | 3R | Inherited from Directive 2005/64/EC |
| 16 | `dismantlingTimeMinutes` | Art 13 | Design-for-dismantling evidence |

### Reserved numeric: slots 17 to 21

Deliberately empty. Absent leaves are still salted and still anchored, so occupying one later costs
a re-anchor but no reordering.

### String: slots 22 to 29

| # | Field | Serves | Note |
|---|---|---|---|
| 22 | `vinHash` | Fraud | Identity. **Public on-chain and VIN-reversible**: `vinHash = blake2b(VIN)`, unsalted, and a VIN is on the windscreen. It is the passport's public address, not a confidential field, and tiered disclosure applies to the *values*, not to the VIN key. See [D23](DECISIONS.md#settled) |
| 23 | `vehicleCategory` | Art 13 | M1 / N1 / etc. |
| 24 | `euTypeApprovalNumber` | Art 13 | Binds to type approval |
| 25 | `manufacturerBPN` | Supply chain | Business partner number |
| 26 | `fuelType` | Art 13 | Powertrain classification |
| 27 | `batteryChemistry` | Interop | Mirrors the battery passport's own field |
| 28 | `emissionsClass` | Art 13 | Euro standard |
| 29 | `batteryPassportId` | Interop | **The explicit link to a battery passport** |
| 30 | `passportOrigin` | Art 13 | `new` is issued at first placing on the market, `retrofit` is added to a vehicle produced before the regulation applies. Provisional occupancy 2026-08-27; the two paths share fields today, and this is how a record says which it took |

### Reserved string: slot 31

---

## Why the reserve exists

The previous 16-slot panel was full on day one, and twelve credible fields had to be cut, several
plausibly mandatory once 2026/1738 applies in 2028. Filling 32/32 would repeat that mistake at a
larger scale.

Six reserved slots is roughly 19% headroom, split by type so either kind of field can be added
without reordering. Anything beyond that needs a genuine re-anchor round, which the SDK's own
guidance says to do **in one batch, never field by field**.

## Where our passport ends: SETTLED (2026-08-27)

VINPassport covers the **vehicle's** record. An EV's battery is a separate regime with its own
passport, mandatory from February 2027 under
[Reg (EU) 2023/1542](https://eur-lex.europa.eu/eli/reg/2023/1542/oj), and
[NIGHTPASS](https://github.com/ODATANO/NIGHTPASS) covers that ground.

**Slot 29 `batteryPassportId` is clearly ours to hold**: it is the reference out, populated only
when the vehicle is electric. That reference *is* the regulation's interoperability clause made
concrete, and it is what makes a NIGHTPASS composition demo real rather than rhetorical.

**Slot 17 `batteryStateOfHealthPct` returns to the reserve.** State of health is a claim about
the battery, not about the vehicle. Holding it here would restate someone else's record, and the two
would eventually disagree, at which point a verifier has two answers and no way to choose. The
battery passport is authoritative for the battery; we hold the link and stop.

**Slot 27 `batteryChemistry` stays.** It is descriptive rather than a claim, so it carries no
divergence risk of the same kind.

Raised with ODATANO on 2026-08-27 and agreed. Their wording: *"state of health is the battery
passport's claim; a mirror here is a second record that will diverge"*, while slot 29 *"is the link:
an EV carries the battery passport id from our side, a verifier follows it into the battery passport
and checks there instead of trusting a copy."*

The change costs nothing today: nothing is anchored yet, and absent slots are salted empty leaves
either way.

---

## Who writes a field, over a vehicle's life

The panel is designed for a car, not for a registration event. Six of its slots are life-cycle
counters, and the rule each is created under is what makes them useful:

| Slot | Field | Rule | What a real event looks like |
|---|---|---|---|
| 0 | `odometerKm` | neverFalls | A service reads 62,400 where the last read 44,210 |
| 1 | `accidentCount` | neverFalls | A collision is reported: 0 becomes 1 |
| 2 | `ownerCount` | neverFalls | A sale: 1 becomes 2 |
| 3 | `serviceCount` | neverFalls | A service: 3 becomes 4 |
| 4 | `writeOffCategory` | neverFalls | An insurer categorises the vehicle: 0 becomes a category code |
| 6 | `lastInspectionDate` | neverFalls | A roadworthiness test moves the date forward |
| 5 | `firstRegistrationDate` | neverChanges | Set once and never again |

None of those events belong to the manufacturer. A dealership records the first keeper, a garage
the manufacturer never named records a service twelve years later. Since **2026-10-14** the
contract expresses that: the registrar for a vehicle may authorise another identity to write that
vehicle's fields, and every field records which identity last wrote it. See
[D25](DECISIONS.md#settled) for the shape and for what it costs in privacy.

Two things that do not change when someone else writes:

- **The rule still holds.** An authorised writer cannot write a lower odometer any more than the
  registrar can. The circuit refuses it.
- **Permission is not knowledge.** Updating a field also requires the current value and its salt.
  Those are private state, handed over deliberately and per field, outside the contract.

## Two budgets, and only one is scarce

There are two places a fact can live, and they have nothing to do with each other.

| | Cap | How it is enforced |
|---|---|---|
| **The anchored panel**, the canonical document | **Hard 32** | `padToWidth` throws: *"33 entries do not fit a 32-slot tree"* |
| **Provable fields**, `fieldCommitment` on chain | **No cap** | A `Map` keyed by `slotOf(vinHash, fieldKey, contentRoot)`; any field key at all |

Verified by execution rather than by reading, because the whole shape of the registry depends on
it: a field key in no panel slot was initialised, updated, had a decrease refused under
`neverFalls`, and backed a proven claim; 41 such fields coexisted on one vehicle. Separately,
`contentRoot` iterates slots 0 to 31 and reads names from `PANEL` only, so **twenty history
fields left the root byte-identical** while changing one real panel field moved it.

Two consequences, both load-bearing:

- **Adding a history field re-anchors nothing.** No new root, no recompile, no redeploy, and every
  passport already on chain stays valid.
- **History does not belong in the panel.** The panel is the document a manufacturer hands over
  under Annex V. A vehicle’s history is a stream of events that outlives whoever registered it.
  The six remaining slots are therefore held for the Annex V / CoC alignment that
  [REGULATION.md](REGULATION.md) flags as an open deliverable, plus `partsRemovalInfoRef` for
  Article 11, which is one of the four items Art. 13(2) requires and which we do not yet carry.

## The Annex V alignment, worked 18 October 2026

The reserve above was held for this. [Appendix 1 to Annex V of Implementing Regulation (EU)
2025/1707](https://eur-lex.europa.eu/eli/reg_impl/2025/1707/oj) is now read and mapped against the
panel. **The reserve is not large enough, and the finding is structural rather than a matter of a
few slots.**

| Appendix 1 parameter | CoC field | Panel slot |
|---|---|---|
| Vehicle Identification Number | 0.10 | **22 `vinHash`.** Held as `blake2b(VIN)`, which is the passport's public address. A reader supplies the VIN to reach the page at all, per Annex V 4.2.3, so the hash is the right shape |
| Approval certificate number | 0.11(b) | **24 `euTypeApprovalNumber`** |
| Date approval granted | 0.11(b) | none |
| Make, trade name of manufacturer | 0.1 | none. `manufacturerBPN` is a business partner number, not the trade name |
| Date of manufacture | 0.11 | none. Slot 5 is `firstRegistrationDate`, which is a different event |
| Commercial name | 0.2.1 | none |
| PEMS family identifier | 0.2.3.3 | none |
| Maximum net power, combustion engine | 27.1 | none |
| Maximum net power, electric motor | 27.3 | none |
| WLTP highest values: CO, NOx, NMHC, THC, THC+NOx, particle mass, particle number | 48 | none. Slot 28 `emissionsClass` is the Euro standard, not the measured values |
| CO2, fuel consumption and electric energy, WLTP, five phases | 49.1 | none. Slot 7 `co2FootprintKgCO2e` is a **life-cycle** footprint under 2026/1738 Art. 13, not a WLTP tailpipe figure. They are different quantities and must not be conflated |
| Electric range | 49.2 | none |
| OVC-HEV charge-sustaining, charge-depleting, weighted and equivalent-range rows | 49.4, 49.5 | none |

**Two of roughly twenty are held, and both are identity rather than substance. Every measured
emissions value is absent.**

### What that means for the panel

A conventional M1 needs about **18 further values**, a plug-in hybrid closer to 40. The reserve is
**five numeric slots and one string**. It is short by roughly a dozen for the simplest case, and
the panel cannot be widened: width is permanent, cross-root proofs relate documents of the same
width, and the menu stops at 32.

**So the EVP does not fit beside the circularity panel, and it should not try to.** They are
different documents under different instruments with different update rules: the circularity panel
serves Regulation 2026/1738 Art. 13, and the EVP serves Euro 7 Art. 17 and is fixed at type
approval. The answer is **section roots**, which is also what the `attestation-vault-32` maintainer
recommended independently for width beyond 32: several same-width trees under one top root.

| Section | Carries | Changes |
|---|---|---|
| EVP | Appendix 1 parameters | Only on re-approval |
| Circularity panel | 2026/1738 Art. 13 declarations | Rarely |
| History | the fifty-one event fields below | Continuously |

**This is not an argument for a bigger panel.** It is the regulation telling us the document
boundary, and it happens to agree with the engineering.

### What we do not hold, and do not need to

Every absent parameter above is **type-approval data the manufacturer already owns and is obliged
to issue**. We do not have to source it and should not pretend to. What this project supplies is
the part Annex V 4.2 and Art. 17(4) make awkward: a vehicle-specific page reachable from an
ISO/IEC 18004 code with nothing to type, an anchored record a reader can check was not edited, and
a twenty year guarantee that does not depend on the vendor surviving.

## The history set

Fifty-one fields with no panel slot, covering what a buyer actually asks and what CARFAX, HPI and
carVertical publish. Grouped as the catalogue groups them: title and legal status, ownership and
use, odometer, roadworthiness, damage and repair, service, recalls, and specification. The
authoritative list is `FIELDS` in [`scripts/lib/scenario.mjs`](../scripts/lib/scenario.mjs); it is
not restated here, because a second copy of a list is a second thing to get wrong.

Three rules shaped it:

**Every history field is `neverFalls`.** History accumulates. A count of accidents, a date that
moves forward, a bitmask that only ever gains bits. The specification block is `neverChanges`
because it describes the vehicle as built.

**A value that must be able to fall is restated as two that cannot.** Open recalls drops when one
is fixed, so there is no such field: `recallIssuedCount` and `recallCompletedCount` are both
monotone and open recalls is the difference. Outstanding finance is deliberately absent, being
live lien data rather than a passport fact.

**A provable value is `Uint<64>`, so a string cannot be one.** Make, model and body type are
numeric codes against a published list and are provable like anything else. Free text, photos and
a garage’s name stay in the document, bound by the content root.

### Presence is public, so the set is written whole

`slotOf` is an exported pure circuit over a public `vinHash` and a public `contentRoot`, so anyone
can compute a slot for a candidate field name and ask whether this vehicle holds it. The field
map therefore leaks **which** fields exist, though never their values.

That is harmless for a field every vehicle carries and fatal for one only some do. If
`floodDamageCount` were initialised only on cars that had flooded, **the existence of the field
would be the disclosure** and hiding its value would protect nothing.

> **A vehicle initialises the whole registry, zeros included, or none of it.**

The panel already behaves this way, because absent leaves are still salted and still anchored. The
field map does not, which is why the rule is written down rather than assumed.

**The demonstration vehicles do not follow this rule, and that is a gap rather than a decision.**
They initialise a handful of fields each, because a preprod run is capped at `MAX_CALLS_PER_RUN`
to bound its wall clock, and because the static demo was built before the rule was written down. A
real passport must carry the whole set. Said here rather than left for a reader to notice.

## What a field costs, and the one line that sets the price

Each `initialiseField` **closes its transaction**, so N fields is N transactions. The cause is not
the field write:

```
initialiseField  fieldCommitment.insert(slot, ...)   fresh key
                 fieldRule.insert(slot, ...)         fresh key
                 fieldWriter.insert(slot, writer)    fresh key
                 updateCount.increment(1)            <- an already-populated cell
```

`updateCount` is a global `Counter`: one cell, always populated. The ledger refuses a
populated-cell write when any later intent follows it in the same transaction, which is the bare
`1010/188` in [DEMO-MODE.md](DEMO-MODE.md). `registerPassport` and `proveFieldAtMost` perform the
same kind of fresh `Map` insert and **batch freely**, which is the evidence that the inserts are
not what closes the transaction.

Remove the counter and `initialiseField` is three fresh inserts, so up to `MAX_CALLS_PER_TX` ride
together:

| | Today | Without `updateCount` |
|---|---|---|
| 60 fields at registration | 60 transactions | 8 transactions |
| Proving, paid per field either way | unchanged | unchanged |
| Per-transaction submit and confirm | paid 60 times | paid 8 times |

`updateCount` has no correctness role. Its only readers are display: the "Updates recorded" row in
`site/assets/chain-sees.mjs`, a cell in `site/proofs/proofs.js`, and the README ledger table. An
indexer can count field writes without it.

`recordField` stays one per transaction whatever happens, because it genuinely overwrites
`fieldCommitment`. That asymmetry suits the use case exactly: registration is a bulk event and
lifetime updates arrive one at a time anyway.

**Honesty note.** `initialiseField` proving time has never been measured; the 16.56s figure is
`registerPassport`. Batching eight initialisations in one transaction has never been tried. The
reasoning above is from the contract plus the observed behaviour of two circuits that write the
same way, not from a measurement.

## The question catalogue

A field is only worth holding if somebody can ask a question of it. The questions are published in
[`site/assets/claim-catalogue.mjs`](../site/assets/claim-catalogue.mjs) and read by all three
surfaces: the verify page, the preprod planner and the simulator. Before it existed each kept its
own hardcoded list of four, and they agreed by luck.

A reader sees every question the passport **could** answer, and gets back `proven`, `superseded`
or `not-proven`. Never a value. The unanswered questions are the point: they make declining to
answer visible.

Three properties of that list are not obvious and are tested in
`test/app/claim-catalogue.test.mjs`:

- **There is no proven no.** A failed proof writes nothing, so silence is the only other outcome.
  A "no" exists only if someone deliberately proves the opposite direction.
- **A bound of zero is a full disclosure.** `atMost 0` on a `Uint<64>` fixes the value at zero.
  Most yes/no questions are that shape; they let the holder choose to reveal, they do not hide.
- **Bounds are fixed standard rungs.** `claimKey` includes the bound, so answers accumulate and
  never reset. A bespoke bound per enquiry is what narrows a value towards a point, so only the
  two open-bound questions take a bound from the asker, and the test refuses a third.

### Questions that compare a vehicle with itself

Two of the questions are not a field against a number. *Serviced within the last 15 000 km* is the
odometer against the reading taken at the last service; *every recall has been carried out* is
recalls issued against recalls completed. Neither can be asked with a public bound, because the
thing being compared to is hidden too, and publishing one of the pair in order to prove something
about the pair gives away exactly what the passport exists to keep.

`proveFieldAtMostField` opens both commitments inside the circuit and publishes only the **slack**:
how far apart the two values are allowed to be. A slack of zero is equality, which is what "every
recall has been carried out" means. These claims live in their own `relClaims` map rather than
widening `Claim`, so a reader that understands only single-field claims cannot misread one of them
as a claim about one field, and they go stale when **either** value moves.

A question of this shape carries `against` and `slack` where the others carry `bound`. Adding one
is a data change; the circuit is already deployed.

---

## Operational requirements

**Prover keys must be fetched before the first proof.** The 32-slot keys are not packed into npm:

```bash
npx nightgate-fetch-keys attestation-vault-32
```

*"Prover keys are part of the artifact generation digest. A server booting without them says so by
name; container images already contain them."*

**Every document-bound action must name the wider vault**: `compiledArtifactRef:
'attestation-vault-32'`, and browser consumers import
`@odatano/nightgate/browser/attestation-vault-32` and pass `slotWidth: 32` to the `prepare*` helpers.

**`allowedMask` widened to Integer64.** SQLite needs nothing. **PostgreSQL and HANA need a schema
redeploy**, which bites at deployment rather than in development, since we develop on SQLite.

---

## Verification status

**Verified by execution against the installed `@odatano/dpp-sdk@0.2.0`: 24/24 on 2026-08-23.**
Run it yourself:

```bash
npm run test:sdk        # test/sdk-assumptions.mjs
```

Re-run after **any** `@odatano/*` version bump. ODATANO shipped 0.17.2 → 0.19.0 in four days, so
treat a passing run as valid only for the version it ran against.

| Claim | Status |
|---|---|
| `VAULT_SLOT_WIDTHS = [8, 16, 32]` | ✅ executed |
| `MERKLE_DEPTH = 4` is a default, not a cap | ✅ executed |
| `depthForWidth` / `widthForDepth`: 16 ↔ 4, 32 ↔ 5 | ✅ executed |
| `depthForWidth` rejects non-powers-of-two | ✅ executed |
| `VALUE_SCALE = 1000`, numerics ×1000 into Uint64 | ✅ executed |
| Numeric fields precede all string fields | ✅ executed |
| `fieldKeyHex` = blake2b-256 of the field name | ✅ executed |
| `padToWidth` throws on overflow rather than truncating | ✅ executed |
| Depth-5 tree: 6 levels, 5-sibling paths, all 32 proofs verify | ✅ executed |
| A proof for one slot does not verify another (soundness) | ✅ executed |

### Two things execution revealed that reading did not

**The SDK itself supports up to 1024 slots.** `depthForWidth` rejects bad input with *"slot width
must be a power of two in 2..1024"*. So 32 is not an SDK limit: it is the widest **vault contract
lineage NIGHTGATE ships**, bounded by wasm proving memory (their note: the ceiling is hit at 64). If
a future panel genuinely needed 64, the blockers are the contract and prover memory, not this
library.

**Overflow messages are specific** (*"33 entries do not fit a 32-slot tree"*), so a registry that
outgrows its width fails loudly and legibly rather than silently dropping fields.

### Still to confirm by running the full stack

- [ ] A 32-slot custom panel needs no contract change beyond naming `attestation-vault-32`
- [ ] Proving time, memory and DUST cost at width 32 versus 16: Phase 0 cost measurement (Q5)
- [ ] `contentSaltSeed` persistence, and a tested restore path

Note that `@odatano/dpp-sdk@0.2.0` was published to npm **without a corresponding commit in the
GitHub repository**, which still shows only 0.1.0. Verify against the installed package, not the
repo, which is exactly what `test:sdk` does.
