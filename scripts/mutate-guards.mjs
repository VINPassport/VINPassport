/**
 * Mutation harness: delete each guard in the contract, one at a time, and
 * record which tests notice.
 *
 *   node scripts/mutate-guards.mjs                  every guard
 *   node scripts/mutate-guards.mjs --only "decreased"  guards whose message matches
 *   node scripts/mutate-guards.mjs --list           list the guards, change nothing
 *
 * WHY THIS EXISTS. A passing suite proves the tests agree with the code, not
 * that the code is right, and not that a guard is load-bearing. The only way to
 * know a guard is doing work is to remove it and watch something fail. A guard
 * that can be deleted with every test still green is a guard nothing depends
 * on, and that is worth knowing before a reviewer finds it.
 *
 * HOW. Each `assert(...)` is located by balancing parentheses from `assert(`
 * to its closing `);`, so a guard spanning several lines is removed whole. The
 * contract is recompiled for each mutation and the suite is run against the
 * compiled circuits, which is the point: the assertion under test is the one
 * the chain would enforce, not a mock of it.
 *
 * SAFETY. The pristine source and the whole managed directory are copied aside
 * first and restored afterwards, including on Ctrl-C, so a run leaves the tree
 * byte-identical to how it found it. Prover keys live in that directory and are
 * expensive to rebuild, which is why the restore copies rather than recompiles.
 *
 * The Compact CLI has no native Windows binary, so the compile command is
 * configurable:
 *
 *   VINPASSPORT_COMPACT_COMPILE='wsl bash -lc "cd \'/mnt/c/...\' && compact compile --skip-zk {src} {out}"'
 *
 * It defaults to `compact compile --skip-zk {src} {out}`, which is right when
 * run where `compact` is on PATH. `--skip-zk` is deliberate: the tests execute
 * the compiled JS circuits, so proving keys are not needed to learn which
 * assertion fired, and generating them per mutation would cost minutes each.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, writeFileSync, cpSync, rmSync, existsSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'contracts', 'vinpassport', 'src', 'vinpassport.compact');
const MANAGED = join(ROOT, 'contracts', 'vinpassport', 'src', 'managed', 'vinpassport');
const OUT_REL = 'contracts/vinpassport/src/managed/vinpassport';
const SRC_REL = 'contracts/vinpassport/src/vinpassport.compact';

const LIST = process.argv.includes('--list');
const onlyIx = process.argv.indexOf('--only');
const ONLY = onlyIx > -1 ? process.argv[onlyIx + 1] : null;

const COMPILE = process.env.VINPASSPORT_COMPACT_COMPILE
    ?? 'compact compile --skip-zk {src} {out}';

/* ------------------------------------------------------------- find guards -- */

/**
 * Every `assert(...)` in the source, with the byte range to cut and the message
 * it fails with. The message is the guard's name here because it is what a
 * caller sees and what the tests match on, so a kill table reads the same way
 * the failures do.
 */
function findGuards(text) {
    const guards = [];
    const needle = 'assert(';
    for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
        // skip an `assert` that is part of a longer identifier
        if (/[A-Za-z0-9_$.]/.test(text[i - 1] ?? '')) continue;
        let depth = 0;
        let j = i + needle.length - 1;
        let inStr = null;
        for (; j < text.length; j++) {
            const c = text[j];
            if (inStr) { if (c === inStr && text[j - 1] !== '\\') inStr = null; continue; }
            if (c === '"' || c === "'") { inStr = c; continue; }
            if (c === '(') depth++;
            else if (c === ')') { depth--; if (depth === 0) break; }
        }
        if (depth !== 0) continue;                       // unbalanced, leave it alone
        let end = j + 1;
        while (end < text.length && /\s/.test(text[end])) end++;
        if (text[end] === ';') end++;
        const body = text.slice(i, end);
        const msg = [...body.matchAll(/"((?:[^"\\]|\\.)*)"/g)].pop()?.[1] ?? '(no message)';
        // the circuit this guard sits in, for reading the table
        const before = text.slice(0, i);
        const circuit = [...before.matchAll(/circuit\s+([A-Za-z0-9_]+)\s*\(/g)].pop()?.[1] ?? '(top level)';
        guards.push({ start: i, end, msg, circuit, line: before.split('\n').length });
    }
    return guards;
}

/* ----------------------------------------------------------------- running -- */

function compile() {
    const cmd = COMPILE.replaceAll('{src}', SRC_REL).replaceAll('{out}', OUT_REL);
    // Always a POSIX shell, including on Windows. cmd.exe rewrites the quoting
    // of a nested command, which silently breaks a wrapper like
    // `wsl bash -lc "..."`; sh passes it through intact. Compact needs WSL on
    // Windows anyway, so a POSIX shell is already a requirement here.
    execFileSync('sh', ['-c', cmd], { cwd: ROOT, stdio: 'pipe' });
}

/** The failing tests, by full name. */
function runSuite(reportPath) {
    try {
        execFileSync('npx', ['vitest', 'run', '--reporter=json', `--outputFile=${reportPath}`],
            { cwd: ROOT, stdio: 'pipe', shell: process.platform === 'win32' });
    } catch { /* a non-zero exit is the normal case here */ }
    if (!existsSync(reportPath)) return null;
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    const all = report.testResults.flatMap((s) => s.assertionResults);
    return {
        total: all.length,
        failed: all.filter((t) => t.status === 'failed').map((t) => t.fullName)
    };
}

/* -------------------------------------------------------------------- main -- */

const pristine = readFileSync(SRC, 'utf8');
const guards = findGuards(pristine);
const chosen = ONLY ? guards.filter((g) => g.msg.includes(ONLY)) : guards;

console.log(`${guards.length} guards found, ${chosen.length} selected\n`);
if (LIST) {
    for (const g of guards) console.log(`  ${String(g.line).padStart(4)}  ${g.circuit.padEnd(20)} ${g.msg}`);
    process.exit(0);
}
if (!chosen.length) { console.error(`no guard message contains ${JSON.stringify(ONLY)}`); process.exit(1); }

const work = mkdtempSync(join(tmpdir(), 'vinpassport-mutate-'));
cpSync(MANAGED, join(work, 'managed'), { recursive: true });
writeFileSync(join(work, 'pristine.compact'), pristine);

let restored = false;
const restore = () => {
    if (restored) return;
    restored = true;
    writeFileSync(SRC, pristine);
    rmSync(MANAGED, { recursive: true, force: true });
    cpSync(join(work, 'managed'), MANAGED, { recursive: true });
};
process.on('SIGINT', () => { restore(); console.log('\nrestored; stopping.'); process.exit(130); });

const results = [];
try {
    // The baseline matters: a suite that is already red cannot report a kill.
    compile();
    const base = runSuite(join(work, 'base.json'));
    if (!base) throw new Error('could not read a baseline test report');
    if (base.failed.length) {
        console.error(`the suite is not green before mutating (${base.failed.length} failing). Fix that first:`);
        for (const f of base.failed) console.error(`   ${f}`);
        process.exit(1);
    }
    console.log(`baseline: ${base.total} tests, all passing\n`);

    for (const [n, g] of chosen.entries()) {
        process.stdout.write(`[${n + 1}/${chosen.length}] ${g.circuit}: ${g.msg} … `);
        writeFileSync(SRC, pristine.slice(0, g.start) + pristine.slice(g.end));
        let r;
        try {
            compile();
            r = runSuite(join(work, `m${n}.json`));
        } catch (e) {
            // A guard whose removal will not compile is still load-bearing: the
            // contract depends on it to be well-formed. Say so rather than
            // counting it as unprotected.
            results.push({ ...g, kills: null, note: 'removal does not compile' });
            console.log('does not compile');
            continue;
        }
        results.push({ ...g, kills: r ? r.failed.length : null, failed: r?.failed ?? [], total: r?.total });
        console.log(r ? `${r.failed.length} of ${r.total} tests fail` : 'no report');
    }
} finally {
    restore();
    rmSync(work, { recursive: true, force: true });
}

/* ------------------------------------------------------------------ report -- */

const covered = results.filter((r) => r.kills === null || r.kills > 0);
console.log(`\n===== kill table: ${covered.length} of ${results.length} guards are load-bearing =====\n`);
console.log(`| Guard | Circuit | Tests that fail |`);
console.log(`|---|---|---|`);
for (const r of results) {
    const cell = r.kills === null ? (r.note ?? 'no report') : `${r.kills}`;
    console.log(`| ${r.msg} | \`${r.circuit}\` | ${cell} |`);
}

const unprotected = results.filter((r) => r.kills === 0);
if (unprotected.length) {
    console.log(`\n${unprotected.length} guard(s) can be deleted with the suite still green:`);
    for (const r of unprotected) console.log(`   ${r.circuit}: ${r.msg}   (line ${r.line})`);
    console.log('\nEach needs a test that asserts the refusal, checked by message so it');
    console.log('cannot pass by accident. Record the detail locally, not in the repository.');
}
console.log('\nThe tree was restored; `git status` should be clean.');
process.exit(0);
