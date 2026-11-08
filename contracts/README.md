# Contracts

VINPassport's own Compact contracts. Layout follows
[NIGHTGATE's convention](https://github.com/ODATANO/NIGHTGATE/tree/main/contracts):
`<name>/src/<name>.compact` with compiled output under `src/managed/<name>/`.

| Contract | Circuits | Purpose |
|---|---|---|
| `vinpassport` | registration, field writes (`initialiseField`, `recordField`), writers and grants, three claim circuits, six read circuits, four pure helpers | The vehicle passport: registration, and any panel field held as private state under its own integrity rule. The read circuits (`isRegistered`, `registrarOf`, `commitmentOf`, `holdsAtMost`, `holdsAtLeast`, `holdsGrant`) let another contract ask it in the same transaction ([D33](../docs/DECISIONS.md#settled)) |
| `listing` | `list` | Composability demo: lists a vehicle only if VINPassport holds a current claim meeting a rule fixed at deploy, asked through a cross-contract call. Deployed on Preview, see [`../deploy/listing.preview.json`](../deploy/listing.preview.json) |

## Building

**Compact has no native Windows binary, and on a Windows host `compact` resolves to the built-in
NTFS compression utility.** Always build in WSL2, macOS, or Linux.

```bash
npm run compile            # compact compile +0.36.0 contracts/vinpassport/src/vinpassport.compact ...
npm run compile:listing    # compact compile +0.36.0 contracts/listing/src/listing.compact ...
```

Both pin the compiler, because a different compiler version produces different verifier keys,
and the keys on chain are what a build has to match. Add `--skip-zk` for a fast syntax and type
check that skips key generation. Keys land in `src/managed/<name>/keys/`, which is gitignored;
everything else the compiler writes is committed.

Verified with **Compact CLI 0.5.2, compiler 0.36.0 (language 0.28.0, runtime 0.21.0, ledger 9)**,
the toolchain of Preview and mainnet since 6 to 7 November 2026. The ledger 8 build (compiler
0.31.1) for preprod is kept at the git tag `ledger8-preprod`.

## The private-state model

No field value ever reaches the ledger. Only `persistentCommit(value, salt)` is stored, one per
(vehicle, field) slot.

`recordField` requires the caller to open the *existing* commitment in-circuit, proving they know
the current value, then asserts the change respects the field's rule, and replaces the commitment.
Both values stay witnesses throughout, so the chain records that an integrity check passed without
recording what passed it.

**The rule is per field and fixed at creation.** Every field the panel uses today may never fall:
mileage, accident count, keeper count, service count, write-off category. The opposite direction is
supported so that adding a field which only declines is a data change rather than a contract change,
and because a rule that could only ever point one way would not be fixing anything at creation.

Storing the rule on the ledger rather than accepting it per call is what stops a caller choosing the
flattering rule at the moment they need it; recreating a field to change it is refused.

`proveFieldAtMost` and `proveFieldAtLeast` do the same for a public bound: they prove the hidden
value sits at or below, or at or above, a threshold without disclosing it. *"Never had a reported
accident"* is simply `proveFieldAtMost` with a bound of zero.

## What this does and does not prove

It proves a reading is **the one that was committed** and that it satisfies a bound. It does not
prove the reading matches physical reality: a producer who commits a false value produces a
cryptographically valid proof of a false fact.

That gap closes at the writer rather than the sensor, with a value committed by a party already
accountable for it, marked so a verifier can tell such a write from a self-declared one. No hardware
is scheduled. See [`../docs/ARCHITECTURE.md`](../docs/ARCHITECTURE.md).
