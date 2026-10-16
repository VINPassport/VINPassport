/**
 * Every script that constructs the compiled contract must list every witness
 * the contract declares.
 *
 * The generated `Contract` class checks the SHAPE of its witness argument at
 * construction, before anything is built, proven or spent, and it does so even
 * for a deploy that calls no witness at all. So adding a witness to
 * `vinpassport.compact` silently breaks every caller that writes the set out
 * by hand, and it breaks them at the one moment nobody is watching: the
 * constructor of a long-running job someone started and walked away from.
 *
 * That is not hypothetical. On 2026-10-15 the two-field circuit added
 * `otherValue` and `otherSalt`; the simulator and the preprod runner were
 * updated, the deploy script was not, and the redeploy died on the first line
 * of work with
 *
 *   first (witnesses) argument to Contract constructor does not contain a
 *   function-valued field named otherValue
 *
 * It cost a wasted run on a submission deadline. A grep would not have found
 * it, because nothing was wrong with any single file.
 *
 * The contract source is the authority here, not a list repeated in this file.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (...p) => readFileSync(join(ROOT, ...p), 'utf8');

/** What the contract actually declares. */
const DECLARED = [...read('contracts', 'vinpassport', 'src', 'vinpassport.compact')
    .matchAll(/^witness\s+(\w+)\s*\(/gm)].map((m) => m[1]);

/**
 * Scripts that write a witness set out by hand, as an object literal whose
 * keys are witness names. A script that derives its set from
 * `makeWitnessHolder` is not listed: it cannot drift, because there is one
 * definition.
 *
 * The spikes are gitignored, so they are checked only on a machine that has
 * them. The deploy script is not optional: a run where it silently vanished
 * from this list is a run that proves nothing about the thing that broke.
 */
const BY_HAND = [
    { path: 'scripts/deploy-preprod.mjs', optional: false },
    { path: 'scripts/spike-call-build.mjs', optional: true }
];

const keysOf = (src) => {
    const at = src.indexOf('const witnesses = {');
    assert.notEqual(at, -1, 'no `const witnesses = {` literal found');
    const block = src.slice(at, at + src.slice(at).indexOf('};'));
    return [...block.matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1]);
};

test('the contract declares the witnesses this test thinks it does', () => {
    // A guard on the guard: if the regex stops matching, every assertion
    // below passes vacuously against an empty list.
    assert.ok(DECLARED.length >= 7, `only found ${DECLARED.length} witnesses in the contract`);
    assert.ok(DECLARED.includes('registrarSecret'), 'the registrar secret witness should be among them');
});

for (const { path, optional } of BY_HAND) {
    test(`${path} lists every witness the contract declares`, (t) => {
        if (optional && !existsSync(join(ROOT, ...path.split('/')))) {
            t.skip(`${path} is gitignored and not on this machine`);
            return;
        }
        const listed = keysOf(read(...path.split('/')));
        const missing = DECLARED.filter((w) => !listed.includes(w));
        const extra = listed.filter((w) => !DECLARED.includes(w));

        assert.deepEqual(missing, [],
            `${path} would be refused by the Contract constructor: missing ${missing.join(', ')}`);
        assert.deepEqual(extra, [],
            `${path} lists ${extra.join(', ')}, which the contract no longer declares`);
    });
}

/**
 * The checks above compare two files. This one asks the constructor, which is
 * the thing that actually refuses, so the test cannot pass on a shape the
 * runtime would reject for some reason the regex never modelled.
 */
test('the constructor accepts the deploy script\'s set, and refuses a short one', async () => {
    const { Contract } = await import(pathToFileURL(join(
        ROOT, 'contracts', 'vinpassport', 'src', 'managed', 'vinpassport', 'contract', 'index.js')).href);

    const stub = (n) => () => { throw new Error(`witness ${n} was called`); };
    const listed = keysOf(read('scripts', 'deploy-preprod.mjs'));

    assert.doesNotThrow(() => new Contract(Object.fromEntries(listed.map((n) => [n, stub(n)]))));

    // And prove the check has teeth: one short of the set must be refused.
    assert.throws(
        () => new Contract(Object.fromEntries(listed.slice(1).map((n) => [n, stub(n)]))),
        /does not contain a function-valued field/);
});
