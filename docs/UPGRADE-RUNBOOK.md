# Upgrade runbook

How to move the contract to a new toolchain, a new ledger, or a new version of its own circuits,
from first check to published evidence. Every step below was done for real on Midnight Preview
between 8 and 9 November 2026; the decision each step rests on is linked. The 27 November 2026 build
was then deployed and handed over to our committee on preprod, the network that mirrors mainnet,
with our own keys ([`deploy/preprod.json`](../deploy/preprod.json)).

Every step that writes to a chain needs the owner's approval, each time. Preview first, always,
while Preview runs. After judging (15 December 2026) Preview is retired and this runbook targets
preprod: read `--network preprod` wherever a command below says `preview`.

## 0. See what moved

```bash
npm run check:upstream
```

Pinned Midnight packages against npm, the pinned `compactc` against its latest release, and the
state of every issue a workaround here depends on ([`scripts/lib/known-issues.mjs`](../scripts/lib/known-issues.mjs)).
A closed issue comes with its removal steps. The same check runs weekly in CI (`Upstream`).

## 1. Decide: in place, or a fresh deploy

| The change | Path | Why |
|---|---|---|
| New circuits, no new ledger fields, every existing circuit's verifier key unchanged | **In place**: the committee inserts the new keys | [D33](DECISIONS.md#settled): six read circuits were added this way, block 19822 |
| Any existing circuit's verifier key changes, or the ledger layout changes | **Fresh deploy** at a new address | Ledger 9 refuses key removal today ([D28](DECISIONS.md#settled), node#2375); events and governance went this way ([D29](DECISIONS.md#settled), [D32](DECISIONS.md#settled)) |

Find out which by compiling (step 2) and comparing every verifier key with the hashes in
`deploy/<network>.json` (`build.verifierKeys`). A key that differs means a fresh deploy.

## 2. Build

1. Move the pins together: `package.json` (exact versions, and `overrides` so one copy of each wasm
   runtime is installed), `BUILD` in [`scripts/lib/eras.mjs`](../scripts/lib/eras.mjs), and in
   [`.github/workflows/compile.yml`](../.github/workflows/compile.yml) `COMPACTC_VERSION` with the
   release zip's sha256.
2. Compile with keys, in WSL (the Compact toolchain has no Windows build):

   ```bash
   npm run compile           # about 70 to 100 s on 32 cores
   npm run compile:listing
   ```

3. Commit `contracts/*/src/managed/` (prover keys stay out; verifier keys are committed). CI's
   `Reproducible build` job recompiles from the release and fails on any changed byte, keys
   included.

## 3. Prove it behaves the same

```bash
npm test                                                  # contract, application, SDK assumptions
node scripts/mutate-guards.mjs                            # every guard deleted in turn; all must kill
```

The mutation harness compiles once per guard; on Windows it needs
`VINPASSPORT_COMPACT_COMPILE` pointing at the compiler in WSL (see its header). Update the README's
kill table from its output. Hash parity with the previous build is the golden-vector test
(`test/app/golden-vectors.test.mjs`).

## 4. Rehearse on Preview

**In place.** Members propose, sign on their own machines, and submit:

```bash
node scripts/maintenance.mjs propose --network preview --insert <circuit,...>
node scripts/maintenance.mjs sign --proposal <file> --key <member key file>    # two members
node scripts/maintenance.mjs submit --proposal <file> --submit
node scripts/ask.mjs --network preview <new read circuit> <args> --submit      # one call to a new circuit
```

**Fresh deploy.** The deploy is fitted to the live block limits first
([D34](DECISIONS.md#settled)); one too large goes in steps, writing circuits first, then the rest
inserted by the deploy key before the handover:

```bash
node scripts/deploy.mjs --network preview --redeploy             # dry run: block fit, steps, fees
node scripts/deploy.mjs --network preview --redeploy --submit
node scripts/deploy.mjs --network preview --redeploy --resume <address> --submit   # only if a step was interrupted
```

The previous record is archived beside the new one; its maintenance audit trail stays in its own
directory under `deploy/maintenance/<network>/`.

**Who pays.** With `VINPASSPORT_NIGHTGATE_URL` and `VINPASSPORT_NIGHTGATE_TOKEN` set, the deploy
steps and the committee's updates are handed to a NIGHTGATE sponsor ([D37](DECISIONS.md#settled)).
The grant then needs `allowDeploy` and `allowMaintenance`, and a sponsor pays an update only for a
contract that grant deployed. A deploy that fits one block, and `scripts/ask.mjs`, stay self-paid.

## 5. Exercise and read back

```bash
node scripts/run.mjs --network preview --submit                                   # guided run, one call per transaction
node scripts/chain-readback.mjs --network preview --receipt <receipt file>        # 13 checks, events included
node scripts/govern.mjs --network preview --remove <label> --as <label>           # if registrar governance changed: dry run, then --submit
node scripts/maintenance.mjs handover --network preview --submit                  # authority to the 2-of-3 committee
node scripts/listing.mjs deploy --network preview --submit                        # the composability demo, trusting the new address
```

A run that stops keeps a receipt marked incomplete under `_local-tracking/receipts/`, holding only
what landed. Without a complete receipt there is no readback and no bundles, so finish with a
complete run.

## 6. Publish the evidence

```bash
node scripts/record-run.mjs <receipt file>                        # the site's recorded run
node scripts/export-bundles.mjs --network preview --receipt <receipt file>
npm test && npm run check:pages                                    # the disclose page checks the new bundles
```

Then the README's Preview box and status rows, and a decision entry for anything decided on the
way. A push to `main` that touches `site/` redeploys passport.vin.

## 7. Mainnet

VINPassport has not deployed to mainnet. The same steps, once every gate is met: our own keys held
outside synced folders; who holds the committee keys ([Q8](DECISIONS.md#open)); legal advice before
real VINs, so demo vehicles only until counsel has advised; the site reading a real chain; and a
mainnet fee source ([Q7](DECISIONS.md#open): a NIGHTGATE grant if its operator enables mainnet,
else our own NIGHT). Mainnet's block limits and prices are read live by the same tools, never
assumed from Preview's.
