/**
 * The disclosure guard must stay a guard.
 *
 * `scripts/check-disclosure.mjs` keeps findings, weaknesses and open issues
 * out of this repository. It runs as a pre-commit and commit-msg hook, so it
 * is the one piece of tooling whose failure mode is silent: a guard that has
 * quietly stopped catching things looks exactly like a repository with nothing
 * to catch.
 *
 * It grew an exemption on 2026-10-14. Legislation uses the same vocabulary the
 * patterns look for, so quoting Article 4(7) of Euro 7 verbatim in
 * docs/REGULATION.md blocked the commit, and rewording a citation to get past
 * a grep would make the citation worthless. A file can now mark a region:
 *
 *   <!-- disclosure-ok: Article 4(7) of Reg (EU) 2024/1257, quoted verbatim -->
 *   ...
 *   <!-- /disclosure-ok -->
 *
 * An exemption is the dangerous kind of feature, so this file pins the four
 * properties that make it safe rather than convenient:
 *
 *   1. an unmarked finding is still blocked
 *   2. an UNCLOSED marker waives nothing, so a stray opener near the top of a
 *      file cannot silence the rest of it
 *   3. a region does not leak past its close
 *   4. a genuine region passes AND is announced on stderr, because a silent
 *      exemption is the thing to avoid
 *
 * Property 2 is the one worth having a test for. Failing open there turns one
 * typo into a repository-wide hole, and nothing about the commit would look
 * unusual.
 *
 * Each case runs in a throwaway git repository under the OS temp directory, so
 * nothing here touches the real index.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHECKER = join(REPO, 'scripts', 'check-disclosure.mjs');

/** Text that must always be refused: a weakness stated plainly. */
const A_FINDING = 'The odometer check is still vulnerable to a replay.';

/**
 * Stage `content` as docs/t.md in a fresh repository and run the checker.
 * Returns its exit code and output rather than throwing, because a blocked
 * commit is the expected result in most of these cases.
 */
function check(content) {
    const dir = mkdtempSync(join(tmpdir(), 'vinpassport-disclosure-'));
    try {
        mkdirSync(join(dir, 'scripts'), { recursive: true });
        mkdirSync(join(dir, 'docs'), { recursive: true });
        copyFileSync(CHECKER, join(dir, 'scripts', 'check-disclosure.mjs'));
        writeFileSync(join(dir, 'docs', 't.md'), content);

        const git = (...a) => execFileSync('git', a, { cwd: dir, stdio: 'pipe' });
        git('init', '-q');
        // A commit needs an identity, and the machine's may be unset in CI.
        git('config', 'user.email', 'test@example.invalid');
        git('config', 'user.name', 'test');
        git('add', '-A');

        const r = spawnSync(process.execPath, ['scripts/check-disclosure.mjs', '--staged'],
            { cwd: dir, encoding: 'utf8' });
        return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}

const blocked = (r) => r.code !== 0;

test('a finding outside any marked region is blocked', () => {
    const r = check(`${A_FINDING}\n`);
    assert.ok(blocked(r), `expected a block, got exit ${r.code}:\n${r.out}`);
    assert.match(r.out, /COMMIT BLOCKED/);
});

test('an unclosed marker waives nothing', () => {
    // The failure this guards against: one opener, no close, everything after
    // it silently exempt. The guard must fail closed.
    const r = check(`<!-- disclosure-ok: pretending this is a quote -->\n${A_FINDING}\n`);
    assert.ok(blocked(r), `an unclosed marker suppressed a finding:\n${r.out}`);
});

test('a region does not leak past its close', () => {
    const r = check(
        '<!-- disclosure-ok: a real quote -->\n'
        + 'quoted line\n'
        + '<!-- /disclosure-ok -->\n'
        + `${A_FINDING}\n`
    );
    assert.ok(blocked(r), `a closed region exempted text after it:\n${r.out}`);
});

test('a marked quotation passes, and the waiver is announced', () => {
    const r = check(
        '<!-- disclosure-ok: Article 4(7) of Reg (EU) 2024/1257, quoted verbatim -->\n'
        + '> minimise vulnerabilities, arising in all phases of their life-cycle,\n'
        + '> that may lead to tampering with the following: (d) odometer\n'
        + '<!-- /disclosure-ok -->\n'
    );
    assert.equal(r.code, 0, `a quoted region should pass:\n${r.out}`);
    assert.match(r.out, /waived inside marked regions/,
        'a waiver must be printed; a silent exemption is the thing to avoid');
    assert.match(r.out, /Article 4\(7\)/, 'the stated reason must appear in the notice');
});

test('the reason is required: a bare marker does not open a region', () => {
    // `disclosure-ok` with no reason should not parse as an opener, so the
    // finding below stays exposed.
    const r = check(`<!-- disclosure-ok -->\n${A_FINDING}\n<!-- /disclosure-ok -->\n`);
    assert.ok(blocked(r), `a reasonless marker opened a region:\n${r.out}`);
});

test('the guard still catches the other pattern families', () => {
    for (const line of [
        'This is a known bypass of the registrar check.',
        'Workaround for the broken salt derivation.',
        'TODO: the proof path is still broken under batching.'
    ]) {
        const r = check(`${line}\n`);
        assert.ok(blocked(r), `not caught: ${line}\n${r.out}`);
    }
});
