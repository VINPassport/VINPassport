/**
 * Upstream issues this tree works around or watches, in one place (build plan
 * 3.8). Each workaround names its issue, the files that carry it, and what to
 * do when the issue is fixed, so a fix upstream turns into a removal here
 * instead of a workaround nobody remembers the reason for.
 *
 * `npm run check:upstream` reads the issues' state from GitHub; the test
 * test/app/known-issues.test.mjs holds the code to this list: every file named
 * here carries one of its issue's marks, and every file under scripts/ that
 * carries a mark is named here.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

export const KNOWN_ISSUES = Object.freeze([
    {
        id: 'ledger#838',
        repo: 'midnightntwrk/midnight-ledger',
        number: 838,
        marks: ['#838'],
        affects: 'a contract call whose fee is paid with exactly one DUST spend (Ledger 9 release notes, "Known issues")',
        workaround: 'every fee is paid with at least two DUST spends; the wallet needs two generating NIGHT UTXOs',
        files: ['scripts/lib/dust-selection.mjs', 'scripts/lib/wallet9.mjs', 'scripts/lib/runner9.mjs', 'scripts/dust.mjs', 'scripts/lib/deploy-fit.mjs'],
        remove: 'when the fix ships in a ledger release that Midnight.js pins: delete scripts/lib/dust-selection.mjs and the '
            + 'installTwoSpendSelection() call in wallet9.mjs, drop the #838 hint from runner9.mjs explainFailure and dust.mjs, '
            + 'and keep the block budget in deploy-fit.mjs (it also covers the fee itself); then run one guided run on Preview.'
    },
    {
        id: 'node#2375',
        repo: 'midnightntwrk/midnight-node',
        number: 2375,
        marks: ['2375', 'REMOVE_BLOCKED'],
        affects: 'maintenance updates that remove a verifier key',
        workaround: 'no key is ever proposed for removal; a changed circuit means a fresh deploy (DECISIONS D28, D34)',
        files: ['scripts/lib/maintenance9.mjs', 'scripts/maintenance.mjs'],
        remove: 'when the fix ships: rehearse a removal on Preview with the committee (propose, sign, submit), then lift the '
            + 'refusal in maintenance.mjs submit and the REMOVE_BLOCKED note; a changed circuit can then be replaced in place.'
    },
    {
        id: 'ledger#839',
        repo: 'midnightntwrk/midnight-ledger',
        number: 839,
        marks: [],
        affects: 'the byte accounting of a coin overwrite',
        workaround: null,
        files: [],
        remove: 'watched only: this contract handles no coins, and nothing in this tree depends on it.'
    }
]);

/** The issue URL on GitHub. */
export const issueUrl = (i) => `https://github.com/${i.repo}/issues/${i.number}`;
