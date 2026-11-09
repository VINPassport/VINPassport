#!/usr/bin/env node
/**
 * What moved upstream since this tree was pinned (build plan 3.5). Read only.
 *
 *   npm run check:upstream            report
 *   npm run check:upstream -- --strict  also exit 1 when an issue a workaround
 *                                       depends on is closed (time to remove it)
 *
 * Three things, from public sources only, with no credential:
 *   - every Midnight package pinned in package.json against its latest version
 *     on npm (registry.npmjs.org);
 *   - the pinned Compact compiler (scripts/lib/eras.mjs BUILD) against the
 *     latest compactc release on GitHub;
 *   - the state of every issue in scripts/lib/known-issues.mjs, with what to
 *     do when one closes.
 *
 * A newer version is reported, never acted on: upgrades are deliberate, and
 * the runbook (docs/UPGRADE-RUNBOOK.md) says how. A closed issue is different:
 * it means a workaround in this tree may have outlived its reason.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { BUILD } from './lib/eras.mjs';
import { KNOWN_ISSUES, issueUrl } from './lib/known-issues.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STRICT = process.argv.includes('--strict');
const UA = { 'user-agent': 'vinpassport-check-upstream', accept: 'application/vnd.github+json' };

const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const pinned = Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })
    .filter(([name]) => /^@midnight-?ntwrk\//.test(name))
    .map(([name, v]) => [name, String(v).replace(/^[\^~=]/, '')]);

const cmp = (a, b) => {
    const pa = a.split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
    const pb = b.split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        if (pa[i] === pb[i]) continue;
        if (pa[i] === undefined) return 1;      // 1.0.0 > 1.0.0-rc.1
        if (pb[i] === undefined) return -1;
        return typeof pa[i] === 'number' && typeof pb[i] === 'number' ? Math.sign(pa[i] - pb[i]) : String(pa[i]).localeCompare(String(pb[i]));
    }
    return 0;
};

async function json(url, headers = {}) {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`${url} answered ${res.status}`);
    return res.json();
}

let failures = 0;
let unreachable = 0;

console.log('npm packages (pinned in package.json, latest on npm)');
for (const [name, have] of pinned) {
    try {
        const latest = (await json(`https://registry.npmjs.org/${name.replace('/', '%2f')}/latest`)).version;
        const state = cmp(have, latest) >= 0 ? 'current' : 'NEWER AVAILABLE';
        console.log(`  ${name.padEnd(58)} ${have.padEnd(10)} ${latest.padEnd(10)} ${state}`);
    } catch (e) {
        unreachable += 1;
        console.log(`  ${name.padEnd(58)} ${have.padEnd(10)} ?          could not read: ${e.message}`);
    }
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

console.log(`\n${failures ? `${failures} workaround(s) may have outlived their issue.` : 'No workaround has outlived its issue.'}`
    + `${unreachable ? ` ${unreachable} source(s) could not be read.` : ''}`);
process.exit(STRICT && failures ? 1 : 0);
