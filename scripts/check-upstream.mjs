#!/usr/bin/env node
/**
 * What moved upstream since this tree was pinned (build plan 3.5). Read only.
 *
 *   npm run check:upstream            report; exit 1 when an installed Midnight
 *                                       package is behind the newest patch of its line
 *   npm run check:upstream -- --strict  also exit 1 when an issue a workaround
 *                                       depends on is closed (time to remove it)
 *
 * Three things, from public sources only, with no credential:
 *   - every Midnight package pinned in package.json, in `dependencies` and in
 *     `overrides`, against npm (registry.npmjs.org): the installed version
 *     must be the newest patch of its pinned minor, and a newer minor or major
 *     is reported (scripts/lib/upstream.mjs);
 *   - the pinned Compact compiler (scripts/lib/eras.mjs BUILD) against the
 *     latest compactc release on GitHub;
 *   - the state of every issue in scripts/lib/known-issues.mjs, with what to
 *     do when one closes.
 *
 * A newer minor or major is reported, never acted on: upgrades are deliberate,
 * and the runbook (docs/UPGRADE-RUNBOOK.md) says how. A missed patch of the
 * pinned line fails the check. A closed issue means a workaround in this tree
 * may have outlived its reason.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BUILD } from './lib/eras.mjs';
import { KNOWN_ISSUES, issueUrl } from './lib/known-issues.mjs';
import { cmp, midnightPins, checkPins } from './lib/upstream.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict');
const UA = { 'user-agent': 'vinpassport-check-upstream', accept: 'application/vnd.github+json' };

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

async function json(url, headers = {}) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    return res.json();
}

const installed = (name) => {
    const file = join(ROOT, 'node_modules', ...name.split('/'), 'package.json');
    return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).version : null;
};
// The abbreviated document lists every version without the full metadata.
const versions = async (name) => Object.keys((await json(`https://registry.npmjs.org/${name.replace('/', '%2f')}`,
    { accept: 'application/vnd.npm.install-v1+json' })).versions ?? {});

let failures = 0;
let behind = 0;
let unreachable = 0;

console.log('npm packages (dependencies and overrides; installed, newest patch of the pinned line, latest on npm)');
for (const r of await checkPins(midnightPins(pkg), { installed, versions })) {
    const where = r.sources.includes('overrides') ? (r.sources.includes('dependencies') ? 'dep+ovr' : 'override') : 'dep';
    const head = `  ${r.name.padEnd(54)} ${where.padEnd(8)} ${String(r.installed ?? '-').padEnd(10)}`;
    if (r.error) {
        unreachable += 1;
        console.log(`${head} ?          could not read: ${r.error}`);
        continue;
    }
    if (r.behind) behind += 1;
    const state = r.missing ? 'not installed'
        : r.behind ? `BEHIND: ${r.newestPatch} is the newest patch of ${r.pinned}`
            : r.newerLine ? 'NEWER LINE AVAILABLE' : 'current';
    console.log(`${head} ${String(r.newestPatch ?? '-').padEnd(10)} ${String(r.latest ?? '-').padEnd(10)} ${state}`);
}

console.log('\nCompact compiler (scripts/lib/eras.mjs, latest compactc release on GitHub)');
try {
    const releases = await json('https://api.github.com/repos/midnightntwrk/compact/releases?per_page=30', UA);
    const compactc = releases.map((r) => r.tag_name).filter((t) => /^compactc-v\d/.test(t)).map((t) => t.slice('compactc-v'.length)).sort(cmp);
    const latest = compactc.at(-1);
    console.log(`  compactc ${BUILD.compiler} pinned, ${latest} latest: ${cmp(BUILD.compiler, latest) >= 0 ? 'current' : 'NEWER AVAILABLE'}`);
} catch (e) {
    unreachable += 1;
    console.log(`  could not read the releases: ${e.message}`);
}

console.log('\nKnown issues (scripts/lib/known-issues.mjs)');
for (const i of KNOWN_ISSUES) {
    try {
        const issue = await json(`https://api.github.com/repos/${i.repo}/issues/${i.number}`, UA);
        const closed = issue.state === 'closed';
        console.log(`  ${i.id.padEnd(12)} ${issue.state.toUpperCase().padEnd(7)} ${issueUrl(i)}`);
        console.log(`  ${''.padEnd(12)} affects: ${i.affects}`);
        if (i.workaround) console.log(`  ${''.padEnd(12)} workaround here: ${i.workaround}`);
        if (closed) {
            console.log(`  ${''.padEnd(12)} CLOSED ${issue.closed_at?.slice(0, 10) ?? ''}: ${i.remove}`);
            if (i.workaround) failures += 1;
        }
    } catch (e) {
        unreachable += 1;
        console.log(`  ${i.id.padEnd(12)} ?       could not read: ${e.message}`);
    }
}

console.log(`\n${behind ? `${behind} installed Midnight package(s) behind the newest patch of their line.` : 'Every installed Midnight package is on the newest patch of its line.'}`);
console.log(`${failures ? `${failures} workaround(s) may have outlived their issue.` : 'No workaround has outlived its issue.'}`
    + `${unreachable ? ` ${unreachable} source(s) could not be read.` : ''}`);
process.exit(behind || (STRICT && failures) ? 1 : 0);
