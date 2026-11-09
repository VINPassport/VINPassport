/**
 * The workaround registry (scripts/lib/known-issues.mjs) against the code.
 *
 * A workaround outlives its reason when nobody can find it. These checks keep
 * the registry and the code in step: every file the registry names carries
 * its issue's mark, and every file under scripts/ that carries a mark is
 * named, so a new workaround cannot be added without saying when it goes.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KNOWN_ISSUES, issueUrl } from '../../scripts/lib/known-issues.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const posix = (p) => p.split('\\').join('/');
function walk(dir) {
    return readdirSync(dir).flatMap((n) => {
        const p = join(dir, n);
        return statSync(p).isDirectory() ? walk(p) : (p.endsWith('.mjs') ? [p] : []);
    });
}
const scriptFiles = walk(join(ROOT, 'scripts')).map((p) => posix(relative(ROOT, p)))
    .filter((p) => p !== 'scripts/lib/known-issues.mjs');

test('every entry is complete: issue, what it affects, and when the workaround goes', () => {
    for (const i of KNOWN_ISSUES) {
        assert.match(issueUrl(i), /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/\d+$/, i.id);
        assert.ok(i.affects && i.remove, `${i.id} says what it affects and what to do when it is fixed`);
        assert.equal(Boolean(i.workaround), i.files.length > 0, `${i.id}: a workaround names its files, and only a workaround does`);
    }
});

test('every file the registry names exists and carries its issue\'s mark', () => {
    for (const i of KNOWN_ISSUES) {
        for (const f of i.files) {
            assert.ok(existsSync(join(ROOT, f)), `${i.id}: ${f} exists`);
            const text = readFileSync(join(ROOT, f), 'utf8');
            assert.ok(i.marks.some((m) => text.includes(m)), `${i.id}: ${f} mentions ${i.marks.join(' or ')}`);
        }
    }
});

test('every file under scripts/ that carries a mark is named in the registry', () => {
    for (const i of KNOWN_ISSUES) {
        for (const f of scriptFiles) {
            const text = readFileSync(join(ROOT, f), 'utf8');
            if (i.marks.some((m) => text.includes(m))) assert.ok(i.files.includes(f), `${f} carries ${i.id} but the registry does not name it`);
        }
    }
});
