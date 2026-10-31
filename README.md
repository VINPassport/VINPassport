<div align="center">
  <img src="site/assets/vinpassport-banner.png" alt="VINPassport, proving a vehicle identity" width="700"/>
  <p><strong>A Digital Circularity Vehicle Passport built on Midnight's zero-knowledge blockchain.</strong></p>
  <p>Prove what a vehicle is. Reveal only what the asker is entitled to see.</p>
  <p><em>Euro 7 binds new M1 and N1 types on <strong>29 November 2026</strong>. The circularity passport follows in 2032.</em></p>
  <p>
    <a href="https://passport.vin/"><b>Website (Live Demo)</b></a> ·
    <a href="https://passport.vin/#video"><b>Explainer video</b></a> ·
    <a href="https://passport.vin/deck/"><b>Slide deck</b></a>
  </p>
</div>

---

### Deployed on Midnight preprod

| | |
|---|---|
| **Contract address** | `2f66c442f14ec98ca59372e14eaa08832f71de9d4aed74aa7bb48140e5d648f5` |
| **Deployed** | 16 October 2026, block **2999411** |
| **Deploy transaction** | `6f4ce1692a1e1c115b4de63f3b7b6ed95f03540c9004926fb091a9bb20cebf69` |
| **Exercised on chain** | full passport run, blocks 3000263 to 3000384, one claim refused in-circuit |
| **Contract shape** | 14 circuits: 11 exported, 8 of them provable |
| **Check it yourself** | [`deploy/preprod.json`](deploy/preprod.json), and the indexer query under [Evaluating this repository](#evaluating-this-repository) |

> **Status: pre-alpha, under active development.** The Compact contract is written, compiles and is
> covered by tests, and the three application surfaces (verification, intake console, proof
> explorer) run against the compiled circuits with one command (`npm run app`). The contract is
> **deployed on Midnight preprod** (16 Oct 2026, block 2999411,
> [`deploy/preprod.json`](deploy/preprod.json)) and has been **exercised end to end on chain**:
> registration, five field initialisations, a delegated update and four proven claims, across
> blocks 3000263 to 3000384, with a fifth claim refused in-circuit because the rule held. The run
> **authorises a dealership to write that one vehicle, has the dealership write it, then takes
> the authorisation back**, so a delegation's whole life cycle is on the public chain rather than
> only in the test suite. The reading the dealership wrote stays written and stays stamped with
> it, because revoking a grant cannot make it untrue that they wrote it. **Every circuit the
> contract proves with has now run on a public ledger**, all eight of them.
> The four proven claims cover **all three proof circuits**, including one that
> compares two of the vehicle's own hidden fields and publishes only how far apart they are
> allowed to be.
> The `/demo/` surface and the intake console write **real transactions to that contract**, paying
> their own DUST, capped per UTC day. They run locally under `npm run app`; the hosted copy reports
> preprod runs as unavailable, because the host that served them was cancelled on 10 Oct 2026.
> The other pages read committed demo state, so the site
> stays fully functional as a static export. The table under
> [Where this actually stands](#where-this-actually-stands) says exactly what does and does not
> exist today.

## Contents

- [The problem](#the-problem) · [What VINPassport does](#what-vinpassport-does)
- [Quick start](#quick-start) · [Evaluating this repository](#evaluating-this-repository)
- [The contract](#the-contract) · [How privacy is achieved](#how-privacy-is-achieved)
- [Built during Wave 1](#built-during-wave-1) · [Where this actually stands](#where-this-actually-stands)
- [Repository map](#repository-map)
- [Built on](#built-on) · [Documentation](#documentation)

## The problem

Two EU instruments ask for a vehicle passport, and the one that binds first is not the one usually
quoted.

**Euro 7** ([Regulation (EU) 2024/1257](https://eur-lex.europa.eu/eli/reg/2024/1257/oj)) obliges
manufacturers to issue an **Environmental Vehicle Passport** with every new M1 and N1 type from
**29 November 2026**, delivered to the purchaser with the vehicle and made available *"through a
QR code"* or a similar method (Art. 7(4)). The same regulation obliges them to design the vehicle
so as to minimise tampering with, among nine listed systems, the **odometer** and the **passport
itself** (Art. 4(7)(d) and (j)). Every provision in that paragraph was read from the Official
Journal on 14 October 2026 and is quoted in [REGULATION.md](docs/REGULATION.md).

> **What the EVP actually contains, read 18 October 2026.** [Appendix 1 to Annex V of Implementing
> Regulation (EU) 2025/1707](https://eur-lex.europa.eu/eli/reg_impl/2025/1707/oj) lists the
> parameters: approval certificate, make, VIN, date of manufacture, powertrain power, the WLTP
> pollutant values, CO2, consumption and electric range. About **20 discrete values for a
> conventional M1**, all fixed at type approval. **The odometer is not one of them**, and neither
> is accident history, write-off status or service history. The odometer reaches this project
> through the Art. 4(7)(d) anti-tampering duty and the Art. 4(10) lifetime-values regime, not
> through the EVP parameter list, and this repository does not claim otherwise. The mapping against
> our own registry is in [FIELDS.md](docs/FIELDS.md#the-annex-v-alignment-worked-18-october-2026).

The **Digital Circularity Vehicle Passport** follows from **1 September 2032** under
[Regulation (EU) 2026/1738](https://eur-lex.europa.eu/eli/reg/2026/1738/oj), which entered into
force on 13 August 2026 and requires that passport to be *"aligned, interoperable and, where
possible, integrated with other vehicle related environmental passports established under Union
law"*: most obviously the EV battery passport that becomes mandatory in February 2027 under
[Regulation (EU) 2023/1542](https://eur-lex.europa.eu/eli/reg/2023/1542/oj).

So the legal destination is 2032 and the first party under an obligation is a manufacturer on
29 November 2026. That ordering is why this repository is built the way it is: a passport opened
on the production line, carrying a QR code, that refuses a later edit to the odometer.

That mandate creates a conflict. A vehicle passport has to be **verifiable by strangers**: a buyer,
a recycler, a border authority, and simultaneously **confidential**, because a full vehicle history
is commercially sensitive to a dealer and personally identifying to an owner. Publishing the record
solves the first and destroys the second. Keeping it private solves the second and leaves the first
where it is today: trust the seller.

The reason it is worth solving privately is everything downstream of it: title washing,
undisclosed accident history, fabricated service records, mileage fraud, and the ordinary asymmetry
where a used-car buyer has no way to check what they are told.

## What VINPassport does

One canonical vehicle record, anchored once on Midnight. From then on, each party is shown exactly
what they are entitled to and provably nothing more.

The contract in this repository holds a commitment **per field**, each under an integrity rule
fixed when the field is created:

| The question | What the chain learns |
|---|---|
| Register this vehicle's passport | A VIN hash, a content root, and who vouched for it |
| Has it ever been written off? | **No** or the transaction fails |
| Has it ever had a reported accident? | **No** or the transaction fails |
| Record a service, an inspection, a reading | That the field moved **only the way that field may move** |
| Is the mileage under 150,000 km? | **Yes** or the transaction fails |

Every field is held the same way, and each declares its own integrity rule when it is created.
Mileage, accidents, keepers, services and write-off category may never fall. The opposite direction
exists too: a rule that could only ever point one way would not be a rule at all, and nothing would
be fixed at creation.

At no point does a field value itself reach the ledger. Neither does the salt that hides it.
The chain stores a commitment; the claims are proven against that commitment inside a ZK circuit.
That is [tested directly](#how-privacy-is-achieved), not asserted.

### Nobody touches a wallet

A buyer scans a QR code and sees a verdict, *never written off · no reported accidents · one
keeper*, with no app, no account, and no login. A dealer signs in with an email and a password. Neither ever holds a key, a
token, or any cryptocurrency.

Every transaction fee is paid by VINPassport, never by the customer. Every customer payment is
ordinary fiat: card, direct debit or invoice. The blockchain is an implementation detail, and it is
meant to stay one. See [BUILD-SCOPE.md](docs/BUILD-SCOPE.md).

## Quick start

Requires **Node.js 22+**. Nothing else: no Docker, no wallet, no network access, no API keys.

```bash
git clone https://github.com/VINPassport/VINPassport
cd vinpassport
npm install
npm test
```

Expected: **129 contract tests, 193 app tests and 24 SDK assertions, all passing**, in a couple of
seconds.

```
 Test Files  1 passed (1)
      Tests  129 passed (129)

# pass 193

================ 24 passed, 0 failed ================
```

| Command | What it does |
|---|---|
| `npm test` | Everything below, in one run |
| `npm run test:contract` | The 129 contract tests, against the compiled circuits |
| `npm run test:watch` | The same, re-running on change |
| `npm run test:app` | 193 tests on the application paths: verdicts, the deploy's registrar list, the submission path, the chain-sees panel and the QR encoder, via `node --test`. **Most import and run product code; a minority assert on what is written in the repository** (that every screenshot the guide names exists, that each page's bar carries the same links, that every page names its content with one `<main>` and offers a way past the bar, that the verify page cannot answer with a vehicle nobody asked for, that no text colour drops below the contrast floor). Both kinds have caught real regressions, but they are not the same kind of evidence and the split is stated rather than averaged |
| `npm run test:sdk` | 24 assertions pinning our assumptions about `@odatano/dpp-sdk` |
| `npm run app` | All three surfaces + the circuits, one dependency-free server |
| `npm run serve:site` | The site statically, as GitHub Pages serves it: no circuits, demo state only |
| `npm run demo:export` | Regenerate `site/verify/` demo ledger by running the compiled circuits |
| `npm run deploy:preprod` | Build + prove the deploy locally; `--submit` hands it to the sponsor |
| `npm run compile` | Recompile the Compact contract: **WSL2, macOS or Linux only**, see below |

### The app: every surface, one command

```bash
npm run app        # -> http://localhost:8790
```

| Surface | | Who it is for |
|---|---|---|
| **Home** | `/` | The problem, the mechanism, and what the chain does and does not learn |
| **Regulation** | `/regulation/` | What Reg (EU) 2026/1738 actually requires, article by article |
| **Verification** | `/verify/` | A buyer: scan a QR or type the VIN, see what the passport has *proven* and what it has not. The VIN is hashed in the browser, so it never reaches a server, and an identifier with no passport is told so rather than answered with another vehicle |
| **Intake console** | `/intake/` | A registrar: fill in the fields, submit, watch the circuits accept and refuse |
| **Proof explorer** | `/proofs/` | An auditor: every claim on the ledger, marked current or superseded |
| **Live preprod demo** | `/demo/` | Anyone: one click writes a real passport to the deployed contract |

`/console/` is kept as a redirect to `/intake/`, because the console moved after the URL was shared.

The server is dependency-free Node and runs the **real compiled circuits in-process**: submitting
the console form registers the passport, records the history, and proves the claims. A rollback
update or an unsupportable claim is refused in-circuit, shown as refused, and writes nothing. The
same three surfaces are live statically at **<https://passport.vin/>**, where the
console falls back to producing an intake file for `scripts/intake.mjs`.

All three are plain HTML/CSS/JS with no build step, by decision
([D11](docs/DECISIONS.md#settled)): the audience is a used-car buyer holding a phone.

### Running it on the real chain

A fourth surface, `/demo/`, does the same intake against the **deployed preprod
contract** instead of an in-process ledger: real proving, real dust fees from our own
wallet, real blocks, and a receipt holding the values and salts that the chain never
saw. It is capped per UTC day and gives every run a fresh random VIN. The intake
console carries the same thing as a *Submit to Midnight preprod* toggle.

This needs a funded, synced wallet, so it is off unless the server is started with
`VINPASSPORT_PREPROD=1` and pointed at a seed file and wallet snapshots. A plain
`npm run app` is unchanged and needs no secrets. [docs/DEMO-MODE.md](docs/DEMO-MODE.md)
has the design, the API, and the two ledger rules that decide how calls pack into
transactions.

Its demo ledger is **not hand-written**: `scripts/export-demo-state.mjs` runs the real compiled
circuits through a scripted history and exports the resulting public ledger, asserted clean of
every private value. Two vehicles on purpose: one that proved the four buyer questions, and one
whose clean-history proofs would abort in-circuit, so the page must render *not proven* honestly
rather than inferring a "no".

### Recompiling the contract

The compiled output is committed, so the tests and this repository can be evaluated with no Compact
toolchain at all. To rebuild it yourself you need
[Compact CLI 0.5.2 with compiler 0.31.1](https://docs.midnight.network/):

```bash
npm run compile
```

**Compact has no native Windows binary, and on Windows `compact` resolves to the built-in NTFS
compression utility instead**: a silent failure that looks like success. Compile in WSL2, macOS or
Linux. See [`contracts/README.md`](contracts/README.md).

## Evaluating this repository

If you are reviewing this (for the Midnight Buildathon or otherwise) this is the shortest path to
seeing whether the claims hold.

**1. The contract compiles.** The committed build carries its own provenance:

```bash
cat contracts/vinpassport/src/managed/vinpassport/compiler/contract-info.json
```

> `"compiler-version": "0.31.1"`, `"language-version": "0.23.0"`, `"runtime-version": "0.16.0"`,
> the stable ledger-8 line. Ten exported circuits: seven proving ones, plus three pure
> helpers. `registrarIdOf` derives a registrar's public identity from a secret
> the chain never sees, `slotOf` derives where a field lives from the
> vehicle, the field and the document root, and `writerKeyOf` derives the entry that says a
> given party may write a given vehicle. All three are exported so a verifier can
> recompute them instead of trusting that we did.

**2. The deploy is real.** The contract is live on Midnight preprod; address and transaction
hash are committed at [`deploy/preprod.json`](deploy/preprod.json). That address holds the **Wave 2
build of 16 October 2026**: eleven exported circuits, eight of them proved, with the registrar
authority and the per-vehicle writer list ([D25](docs/DECISIONS.md#settled)). We paid the fee
ourselves, out of dust this project's own wallet generates.

> **The repository matches that address, and the build proves it rather than asserting it.**
> `deploy/preprod.json` carries a `buildId`: a sha256 over the compiled `contract/index.js` and
> every circuit `.bzkir`, here `0fdd47a77126b79c`. Anything about to submit compares its own
> build against it first. A circuit's verifier key is fixed at deployment, so a working tree
> ahead of the chain produces calls the node refuses with nothing useful to say, and the check
> turns that into one sentence before a fee is spent. Earlier addresses are kept at
> `deploy/preprod-superseded-*.json` so they can be compared. Ask the public indexer yourself:

```bash
curl -s -X POST https://midnight-preprod.blockfrost.io/api/v0   -H 'Content-Type: application/json'   -H "project_id: $BLOCKFROST_MIDNIGHT_PREPROD"   -d '{"query":"{ contractAction(address: \"2f66c442f14ec98ca59372e14eaa08832f71de9d4aed74aa7bb48140e5d648f5\", offset: { transactionOffset: { hash: \"6f4ce1692a1e1c115b4de63f3b7b6ed95f03540c9004926fb091a9bb20cebf69\" } }) { __typename transaction { hash block { height } } } }"}'
```

> Returns a `ContractDeploy` whose transaction hash matches the committed record, in block
> 2999411, which is what it returned when this command was last run on 16 October. The offset
> pins the query to that deployment; without it the indexer answers with the contract's *most
> recent* action, which changes as the contract is called.
>
> **The hash in the record is the one the indexer resolves, which is not the one the
> submitter returned.** Our submitter reported `0xc685604a...`, kept in the record as
> `submitterReportedId`; the indexer resolves `6f4ce169...` for the same deployment. The
> Wave 1 deploy diverged the same way through ODATANO's sponsor, which returned a 33-byte
> identifier the indexer rejects outright as not a transaction hash. Two different submission
> paths, the same divergence, so it is the submission path and not the sponsor. Only the
> resolvable hash is published, because a hash that answers nothing is worse than none.
>
> Midnight retired its own preprod indexer on 2026-10-09 and the Midnight indexer is now
> served by Blockfrost, so the query needs a free Blockfrost project id for Midnight
> Preprod in `BLOCKFROST_MIDNIGHT_PREPROD`. A project id is scoped to one network. The
> old host answers HTTP 410 and names the
> [migration guide](https://docs.midnight.network/guides/networks-and-environments).

**3. The tests exercise the real circuits.** `test/passport-simulator.mjs` loads the *compiled*
contract and runs it through `@midnight-ntwrk/compact-runtime` at the pinned matching version
(`0.16.0`). An assertion that fires in these tests is the same assertion that would reject the
transaction on chain.

**4. The tests would catch a regression.** Passing tests prove only that the tests agree with the
code. So every guard in the contract is checked by mutation: it is deleted, the contract is
recompiled, and the suite is run against the compiled circuits to see what notices. A guard that
can be removed with the suite still green is a guard nothing depends on.

**32 of 32 guards are load-bearing.** Reproduce it yourself:

```bash
node scripts/mutate-guards.mjs --list   # the guards, no changes made
node scripts/mutate-guards.mjs          # delete each in turn, report the kills
```

| Guard deleted | Circuit | Tests that fail |
|---|---|---|
| `not the registrar for this vehicle, and not authorised to write it` | `writerFor` | 6 |
| `passport already registered` | `registerPassport` | 2 |
| `not an authorised registrar` | `registerPassport` | 2 |
| `unknown passport` | `authoriseWriter` | 1 |
| `not the registrar for this vehicle` | `authoriseWriter` | 2 |
| `the registrar already writes this vehicle` | `authoriseWriter` | 1 |
| `unknown passport` | `withdrawWriter` | 1 |
| `not the registrar for this vehicle` | `withdrawWriter` | 1 |
| `not a writer for this vehicle` | `withdrawWriter` | 1 |
| `unknown passport` | `initialiseField` | 1 |
| `field already initialised` | `initialiseField` | 2 |
| `unknown passport` | `recordField` | 1 |
| `field not initialised` | `recordField` | 1 |
| `previous value does not open the stored commitment` | `recordField` | 5 |
| `value decreased` | `recordField` | 9 |
| `value increased` | `recordField` | 3 |
| `value changed` | `recordField` | 3 |
| `unknown passport` | `proveFieldAtMost` | 1 |
| `field not initialised` | `proveFieldAtMost` | 1 |
| `value does not open the stored commitment` | `proveFieldAtMost` | 1 |
| `value above the claimed bound` | `proveFieldAtMost` | 5 |
| `unknown passport` | `proveFieldAtLeast` | 1 |
| `field not initialised` | `proveFieldAtLeast` | 1 |
| `value does not open the stored commitment` | `proveFieldAtLeast` | 1 |
| `value below the claimed bound` | `proveFieldAtLeast` | 3 |
| `unknown passport` | `proveFieldAtMostField` | 1 |
| `a field compared with itself proves nothing` | `proveFieldAtMostField` | 1 |
| `first field not initialised` | `proveFieldAtMostField` | 1 |
| `second field not initialised` | `proveFieldAtMostField` | 1 |
| `first value does not open the stored commitment` | `proveFieldAtMostField` | 1 |
| `second value does not open the stored commitment` | `proveFieldAtMostField` | 1 |
| `the two values are further apart than the claimed slack` | `proveFieldAtMostField` | 3 |

The harness restores the tree afterwards, including the prover keys, so a run leaves the repository
byte-identical to how it found it. It is also the reason two tests exist. Twice now a full sweep has
found a single guard that could be deleted with the whole suite still green: first the floor proof
about an unregistered vehicle, and then, when `proveFieldAtMostField` was added, the same case again
on the new circuit. Both mirror tests were written because the harness asked for them rather than
because anyone remembered to, which is the entire argument for running it.

**5. Read the contract itself.** It is commented for a reader who does not know Compact: [`contracts/vinpassport/src/vinpassport.compact`](contracts/vinpassport/src/vinpassport.compact).

**6. The honest limits are written down, not buried.** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
§ *The trust gap* states plainly what this does not prove. See [below](#what-this-does-not-prove).

## The contract

[`contracts/vinpassport`](contracts/vinpassport). VINPassport's own Compact contract.

### Public ledger

| Ledger field | Type | Holds |
|---|---|---|
| `passports` | `Map<Bytes<32>, Bytes<32>>` | VIN hash → content root of the canonical record |
| `registrar` | `Map<Bytes<32>, Bytes<32>>` | VIN hash → registering authority, so a claim is attributable |
| `fieldCommitment` | `Map<Bytes<32>, Bytes<32>>` | slot → commitment to that field's current value |
| `fieldRule` | `Map<Bytes<32>, Rule>` | slot → the integrity rule, written once at creation |
| `claims` | `Map<Bytes<32>, Claim>` | claim key → a proof that was made, and the value version it was made about |
| `relClaims` | `Map` | Claims comparing two of a vehicle's fields, holding both commitments and the public slack, and neither value |

A **`Claim`** records what was proven and never the value that satisfied it: the slot, the VIN hash,
the field key, the bound, the direction, and **the commitment the proof opened**. That last part is
what stops a claim outliving the value it was made about: record a new reading and the old claim
no longer matches the current `fieldCommitment` for that slot, so a verifier can see it is
superseded without being told. See [D19](docs/DECISIONS.md#settled).

A **slot** is `persistentHash(["vinpassport:field:v1", vinHash, fieldKey])`: domain-separated, so a
slot key cannot collide with any other hash the contract stores, and an observer who does not
already know both the vehicle and the field cannot tell which slot holds what.

### Private state

Four witnesses, none of which ever reach the ledger:

| Witness | Type | Why it is private |
|---|---|---|
| `newValue` | `Uint<64>` | The value being written |
| `previousValue` | `Uint<64>` | The current value, needed to open the stored commitment |
| `previousSalt` | `Bytes<32>` | The opening for that commitment |
| `newSalt` | `Bytes<32>` | A fresh opening, so equal values do not produce equal commitments |

### Circuits

| Circuit | Public arguments | Proves |
|---|---|---|
| `registerPassport` | VIN hash, content root, registrar id | This vehicle is registered once, by a named registrar |
| `initialiseField` | VIN hash, field key, rule | A field exists under a rule fixed for good: without publishing its value |
| `recordField` | VIN hash, field key | The caller **knows the current value**, and the change **respects the field's rule** |
| `proveFieldAtMost` | VIN hash, field key, bound | The hidden value is **at or below a public bound** |
| `proveFieldAtLeast` | VIN hash, field key, bound | The hidden value is **at or above a public bound** |

Both proof circuits **record the claim** on success. A circuit that only asserted would leave a
verifier nothing to read: the transaction succeeding *is* the proof, but nothing would index it by
vehicle, so a scan-to-verdict page would have no state to query. A failed proof aborts before the
write, so the claims ledger only ever holds claims that held.

The rule lives on the ledger rather than in the call, so a caller cannot pick the flattering rule at
the moment they need it. Recreating a field to change its rule is refused.

Threshold proofs carry the claims a buyer actually asks for: *"never written off"* is
`proveFieldAtMost(writeOffCategory, 0)`, *"never had a reported accident"* is
`proveFieldAtMost(accidentCount, 0)`, and *"one owner from new"* is
`proveFieldAtMost(ownerCount, 1)`. `proveFieldAtLeast` is the mirror, for a floor rather than a
ceiling.

## How privacy is achieved

`recordField` is the interesting one, so it is worth stating what it actually does.

The ledger holds `persistentCommit(value, salt)`, never the value. To write a new one the caller
must, **inside the circuit**:

1. supply the current value and its salt as witnesses;
2. recompute the commitment and prove it equals what the ledger already stores, which is only
   possible if they genuinely know the current value;
3. read the field's rule **from the ledger** and prove the new value respects it;
4. replace the commitment with one over the new value and a fresh salt.

Both values are witnesses throughout. The chain records **that an integrity check passed**, without
recording **what passed it**. `proveFieldAtMost` and `proveFieldAtLeast` do the same against a
public bound, so a dealer can answer *"never written off?"* or *"under 150,000 km?"* with a proof
rather than a promise.

A recorded claim **names the field it is about**, which the slot hash alone would not reveal. That
is deliberate: a verdict a verifier cannot read is not a verdict, and the VIN hash is already public
because `passports` is keyed by it. Fields nobody has claimed about stay unnamed, and the value
itself is never written: two adjacent tests pin both halves rather than leaving it to this
paragraph.

### What a published claim gives away

The value is never *written* to the ledger. That is not the same as the value being unknowable, and
the difference is worth stating plainly rather than being discovered by whoever checks.

**A bound of zero is a full disclosure.** `proveFieldAtMost(writeOffCategory, 0)` publishes the
bound, and the field is a `Uint<64>`, so `value <= 0` and `value >= 0` together fix the value at
exactly 0. "Never written off" and "no reported accidents" are claims of this shape. They are
meant to be: the honest reading is that the holder chose to reveal that fact, not that the fact
stayed hidden. The contract test group says the same thing in the one place it matters, that *"0 is
both the bound and the value here, so it cannot be used to separate them"*.

**Claims accumulate, and they are permanent.** Each claim writes its bound under a key that
includes that bound, so a second claim with a different bound does not replace the first, it joins
it. A field with `atLeast 80000` and `atMost 100000` against it has its value pinned to a 20,000
wide window by two readable facts. Nothing in the contract limits how many claims a slot may carry,
so a holder who answers enough differently-phrased questions narrows their own value towards a
point. A verifier only ever needs one claim; issuing a new bound for each asker is what costs
privacy.

**Two rules interact with this.** For a `neverChanges` field the commitment never rotates, so the
window only ever narrows and nothing resets it. For a `neverFalls` field an old `atLeast X` claim
still implies the *current* value is at least X, because the rule says so, even after an update has
moved the commitment and made that claim formally stale.

None of this is a defect in the circuits, which disclose exactly what they are asked to. It is the
cost of recording a verdict instead of re-proving it on demand ([D19](docs/DECISIONS.md#settled)),
and the mitigation is operational: reuse a standard bound rather than minting a bespoke one per
enquiry.

This is tested rather than claimed. `test/passport.test.mjs` includes a group named
*what the public ledger never learns*, which walks every value on the ledger after a full service
history and asserts no reading and no salt appears among them, plus a test that the search **would**
find a value that is there, so the privacy assertions cannot pass vacuously.

The suite also covers the attacks worth naming:

- a rollback by one kilometre, not just an obvious one;
- a caller who knows the reading but not the salt, and vice versa;
- a rollback dressed up with a matching false opening;
- a threshold proof that tries to claim a flattering value it cannot open to.

### What this does not prove

It proves a reading is **the one that was committed**, and that it satisfies a bound. It does not
prove the reading matches physical reality. A producer who commits a false value produces a
cryptographically valid proof of a false fact.

It is the first question a serious reader asks, so this section says where the Wave 2 contract
leaves it rather than deferring the whole thing. Three properties narrow the gap to the **first**
write of a field, and all three are in the deployed circuits:

1. **The write is attributable.** `registerPassport` derives the caller's identity in-circuit from
   a witness secret, never from `ownPublicKey()`, and refuses any identity outside
   `allowedRegistrars`, a set fixed in the constructor with no circuit that adds to it.
   `initialiseField` and `recordField` then refuse anyone but that vehicle's registrar and the
   writers it has authorised by name, and each field records which identity last wrote it
   ([D25](docs/DECISIONS.md#settled)). Who wrote what is on the ledger and stays there.
2. **The rule precedes the value.** A field's integrity rule is written when the field is created
   and cannot be rewritten, so a flattering rule cannot be chosen later ([D18](docs/DECISIONS.md#settled)).
3. **The correction is refused.** Under `neverFalls` a later, lower value fails in-circuit. The
   rollback is not a policy we decline to apply; it is a transaction that does not complete.

What is left is real. Tying one of those on-chain identities to a legal person is an off-chain
admission step, not a cryptographic one, and the first value for a vehicle that joins mid-life is
only as good as the party that entered it. That is why the first customer is the manufacturer:
Euro 7 obliges them from 29 November 2026, and a passport opened on the production line has no
earlier history to misstate. A reading signed at the sensor is Phase 2 and **no date is claimed
for it**. The limit is stated in full in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Built during Wave 1

Wave 1 ran 27 August - 16 September 2026. Everything below was written inside that window: this
repository begins with no contract at all.

| What was built | Where to look |
|---|---|
| **The contract** - five exported circuits at Wave 1's close, field-generic, with each field's integrity rule fixed on the ledger at creation so a caller cannot pick a flattering one | [`vinpassport.compact`](contracts/vinpassport/src/vinpassport.compact), [D18](docs/DECISIONS.md#settled) |
| **Deployed to Midnight preprod**, 28 August, built and signed locally | [`deploy/preprod.json`](deploy/preprod.json) |
| **346 tests today** - 129 contract, 193 application, 24 SDK assumption assertions; all thirty-two guards mutation-checked | [`test/`](test/), and [Evaluating this repository](#evaluating-this-repository) |
| **Three surfaces** - verification, intake console, proof explorer - all running the compiled circuits, not a mock | [passport.vin](https://passport.vin/) |
| **On-chain runs from the browser, self-funded**, after a hosted sponsor turned out to be a single point of failure in a demo a judge runs unattended | [D24](docs/DECISIONS.md#settled) |
| **The regulatory basis read from the Official Journal** rather than secondary analysis - which caught two wrong article citations that had survived months of work | [REGULATION.md](docs/REGULATION.md) |
| **A decision log with six reversals** of our own earlier calls, kept so they are not reinstated by accident | [DECISIONS.md](docs/DECISIONS.md) |

**The hardest bug did not throw.** A single call was proven with witnesses as they stood, and an
unarmed holder reads as value zero with a zero salt - so it proved, landed on the public chain, and
wrote a commitment nobody can ever open. The engine now arms the first call itself and the holder
refuses to be read until armed, so a missed arming is a loud build error instead of a quiet zero.

## Built during Wave 2

Wave 2 runs 29 September - 19 October 2026. Wave 1 closed with five circuits, five wired fields and
141 tests. What follows was built inside Wave 2's window, and the numbers either side are from the
tree at each wave's close, not from memory.

| | Wave 1 close | Now |
|---|---:|---:|
| Exported circuits | 5 | **11**, eight of them proved |
| Integrity rules | 2 | **3** |
| Fields carrying an integrity rule | 5 | **68** |
| Of those, ever written on chain | 5 | **8** |
| Contract tests | 67 | **129** |
| Application tests | 50 | **193** |
| SDK assumption assertions | 24 | 24 |
| Guards checked by mutation | the two integrity rules | **32 of 32** |

| What changed | Why it matters | Where to look |
|---|---|---|
| **The registrar is derived in-circuit** from a witness secret, and checked against an allowlist pinned at deployment. `registrarIdOf` is a new circuit | Wave 1 took the caller's word for who was writing. A contract that cannot tell one writer from another cannot refuse the wrong one | `registrarIdOf`, `registerPassport` |
| **Every field commitment is bound to the content root** it was taken from | A commitment that floats free of its document can be replayed against a different document. Binding it means a revised document moves every slot with it | [`vinpassport.compact`](contracts/vinpassport/src/vinpassport.compact) |
| **A third integrity rule, `neverChanges`**, and the panel widened from 5 fields to 17 | The lifecycle fields accumulate, so `neverFalls` fits them. The regulatory declarations do not move inside one document version, and filing them under `neverFalls` would have let a recycled-content figure drift upward - the direction that flatters | [`scenario.mjs`](scripts/lib/scenario.mjs), [FIELDS.md](docs/FIELDS.md) |
| **Every guard mutation-checked, 32 of 32**, with the kill table published and the harness in the repo | "Tests pass" says nothing about whether a guard is load-bearing. Deleting it and watching what dies does | `node scripts/mutate-guards.mjs` |
| **A panel that states what the chain does *not* hold** | A verifier who misreads silence as a denial is the failure this project exists to prevent, so the page names the absences instead of leaving them to inference | [passport.vin/verify](https://passport.vin/verify/) |
| **Moved to the Blockfrost indexer** after the preprod indexer was decommissioned mid-wave and began answering HTTP 410 | A submission a judge cannot run is not a submission | [`scripts/lib/endpoints.mjs`](scripts/lib/endpoints.mjs) |

**Deployed on 2026-10-16**, in block 2999411, with the fee paid out of our own dust
([D24](docs/DECISIONS.md#settled)). The deploy before it, on 13 October, was sponsored by
ODATANO, and for most of Wave 1 this paragraph said the opposite, because the sponsor refused
the bytes with what read
like a transaction-format mismatch: it named both serialization forms it had tried and failed to
deserialize. It was not a format problem. The sponsor was decoding 12,257 bytes where we had built
12,269, because the base64 had been handed over as a literal argument and sixteen characters had
dropped out of a run of near-identical sixteen-character groups. The bytes on disk were correct the
whole time. Transactions now travel to the sponsor as a file path, and both ends print the
character count, the byte count and a sha256 of the decoded bytes, so the next transit loss is one
line of comparison rather than two days of reading tag names.

## Where this actually stands

| Component | Status |
|---|---|
| Compact contract: 11 circuits, 8 of them proving | **Done.** Compiles clean, artifacts committed and reproducible from source |
| Contract test suite | **Done.** 129 tests; every guard mutation-checked, 32 of 32 |
| SDK assumption guard | **Done.** 24 assertions against `@odatano/dpp-sdk` 0.2.0 |
| Proving cost, the three circuits a verifier waits on | **Re-measured 14 Oct 2026 against the build deployed that day**, wasm in-process, no proof server, 32 cores, n=3 each. Build, prove and sign: `registerPassport` **17.5s** (5,229 B), `proveFieldAtMost` **27.6s** (5,567 B), `proveFieldAtLeast` **27.0s** (5,568 B). Within noise of the 13 October build (16.6s, 29.4s, 27.1s), so **the writer circuits and the two ledger collections they added cost these three nothing measurable**, which is the question re-measuring was there to answer. Registration is 3.7x Wave 1's 4.77s, the cost of the registrar identity derived in-circuit and the field commitments bound to the content root. **`initialiseField` was measured for the first time on 16 Oct and is the most expensive circuit here: 37.4s median (min 35.8 / max 53.2, n=5, 5,516 B).** It had never been timed because the three above are the ones a verifier's experience depends on, and it is the one an issuer runs most: a vehicle carrying the full 68-field registry is one registration and 68 of these, about **42.6 minutes of proving**. Batching does not reduce that, because batching removes block confirmations and not proofs. That number, rather than any wallet count, is the real ceiling on how many vehicles a day one writer can issue, and it is why [FIELDS.md](docs/FIELDS.md)'s whole-registry rule has never once been satisfied by a real vehicle. **These are the times to ISSUE a claim, paid once by whoever writes it.** A verifier reads the verdict off the ledger and waits on a query, never on a proof, which is why a proven claim is recorded rather than re-proven on demand ([D19](docs/DECISIONS.md#settled)). DUST cost per anchor and per proof was **measured on 14 Oct 2026** against the deployed contract with real proofs, and is published in [BUILD-SCOPE](docs/BUILD-SCOPE.md); latency is not cost |
| Provable-field registry, 32 slots | **Settled** ([FIELDS.md](docs/FIELDS.md)). 26 in use, reserve 17 to 21, and 31. Slots 0 to 16 are wired end to end and provable; the rest are salted into the content root but carry no rule yet |
| Deployment to Midnight preprod | **Done. The Wave 2 contract is live (16 Oct 2026), block 2999411.** Built, proven, signed and paid for locally: the fee came out of our own dust ([D24](docs/DECISIONS.md#settled)), not a sponsor. Address and the indexer-resolvable tx hash committed at [`deploy/preprod.json`](deploy/preprod.json), with a `buildId` fingerprinting the artefacts that address holds, so a working tree ahead of the chain is caught before a fee is spent. Earlier addresses kept alongside it as `preprod-superseded-*.json` |
| Frontend: verification, intake console, proof explorer | **Done.** Three surfaces against the compiled circuits (`npm run app`), live for anyone at [passport.vin](https://passport.vin/) |
| Live preprod runs from the browser | **Built, not currently hosted.** `/demo/` and the intake console write real transactions to the deployed contract, paying their own DUST ([D24](docs/DECISIONS.md#settled)), capped per UTC day, every hash linking to the [preprod explorer](https://preprod.midnightexplorer.com). The host that served them was cancelled on 10 Oct 2026, so the page now reports that preprod runs are unavailable rather than pretending otherwise. `npm run app` runs the same path locally |
| CAP service layer, tier redaction | **Not in this submission, and not in Wave 2.** See [D20](docs/DECISIONS.md#settled) |

## Repository map

```
contracts/vinpassport/
  src/vinpassport.compact     the contract: start here
  src/managed/                       compiled output, committed on purpose
docs/                                design, decisions, regulatory basis
scripts/
  mutate-guards.mjs                  deletes each guard in turn, reports the kills
  lib/scenario.mjs                   the 32-slot panel and its integrity rules
test/
  passport-simulator.mjs             harness: compiled circuits + a local ledger
  passport.test.mjs                  129 contract tests
  app/                               193 tests on the paths around the circuits
  sdk-assumptions.mjs                24 assertions pinning @odatano/dpp-sdk behaviour
```

## Built on

| | |
|---|---|
| [Midnight Network](https://midnight.network) | Zero-knowledge blockchain; ledger 8, Compact 0.31.1 |
| [`@odatano/dpp-sdk`](https://github.com/ODATANO) | Salted-Merkle field panel: key derivation, value scaling, tree construction |
| [`@odatano/nightgate-tx`](https://github.com/ODATANO/NIGHTGATE) | Local transaction building, batch segment ordering, in-process wasm proving |

**Where the line falls.** VINPassport's Compact contract is its own work: eleven exported circuits,
its own ledger, its own integrity rules. It is not a fork, and it does not extend NIGHTGATE's
`attestation-vault`. The 32-slot field panel is ours too: the slot layout is a vehicle-domain
design, built on `@odatano/dpp-sdk` for key derivation, value scaling and Merkle construction.

VINPassport builds on ODATANO in three ways, two of them on every single run. The field panel uses
`@odatano/dpp-sdk` for key derivation, value scaling and Merkle construction. `@odatano/nightgate-tx`
builds, batches and proves every transaction locally against our own key. And ODATANO's hosted
NIGHTGATE **sponsored the contract deployment** on 28 August 2026 under a metered grant.

**Ongoing fees are no longer sponsored.** Since [D24](docs/DECISIONS.md#settled) the demo pays its
own DUST from a wallet we fund and submits to the public preprod node itself: no token, no sponsor
session, no hosted call in the runtime path. That was the fallback [D20](docs/DECISIONS.md#settled)
anticipated after a sponsor outage on 25 August, and it cost one function precisely because every
transaction was *already* built, proven and signed on our side. **NIGHTGATE never saw a witness when
it paid, and there is no witness to see now.**

VINPassport does not use NIGHTGATE's CAP service, its OData layer, its `attestation-vault` contract,
or its disclosure grants. Those are on the roadmap (disclosure grants are the piece Phase 1
actually needs), not in this submission. See [D20](docs/DECISIONS.md#settled).

Thanks to **[ODATANO](https://github.com/ODATANO)** for the SDK, for the deployment grant, for
review, and for the [reference integration](https://github.com/maxalexweber1/VINPassport-NIGHTGATE-DEMO)
that implements this panel end-to-end on Midnight preprod.

## Documentation

| Document | What it covers |
|---|---|
| [Explainer video](https://passport.vin/#video) | Watch it first: the shortest route to what this does, embedded on the home page |
| [DEMO.md](docs/DEMO.md) | The ninety-second walkthrough: the script behind the video, and a guided run you can do yourself |
| [deck/](deck/index.html) | The Wave 1 slide deck: [present it live](https://passport.vin/deck/), arrow keys to advance, Ctrl+P for the PDF |
| [REGULATION.md](docs/REGULATION.md) | Primary legal sources, with direct EUR-Lex links |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System design, the trust model, and its honest limits |
| [BUILD-SCOPE.md](docs/BUILD-SCOPE.md) | Structure, stack, sponsoring and billing models |
| [DECISIONS.md](docs/DECISIONS.md) | Settled decisions and the reasoning behind them |
| [FIELDS.md](docs/FIELDS.md) | The 32-slot provable-field registry and its capacity limits |
| [ROADMAP.md](docs/ROADMAP.md) | Phased delivery plan |
| [contracts/README.md](contracts/README.md) | Building the contract, and the private-state model |

**New here?** Start with [REGULATION.md](docs/REGULATION.md): the regulation is *why* this project
exists, and the full text is one click away.

## Licence

Apache-2.0, matching the ODATANO stack. See [LICENSE](LICENSE).

---

<div align="center">
  Rebuilt August 2026 · <a href="https://midnight.network">Midnight Network</a> · <a href="https://github.com/ODATANO">ODATANO</a>
</div>
