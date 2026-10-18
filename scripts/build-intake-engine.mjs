/**
 * Bundle the intake engine for the browser, into site/assets/intake-engine/.
 *
 *   npm run build:engine          write the bundle
 *   npm run build:engine -- --check   rebuild to a temp dir and compare
 *
 * WHY THE OUTPUT IS COMMITTED. The rest of site/ is plain ES modules served
 * exactly as they are written, so a judge clones and serves the directory
 * with no toolchain. The engine cannot be: it carries 1.4 MB of runtime wasm
 * that only a bundler can wire up. Committing the built artifact keeps the
 * zero-build promise for the site while letting one page do something a
 * static file cannot.
 *
 * The cost of that choice is drift, so --check exists and runs in CI's place
 * here: it rebuilds and compares, and fails if the committed bundle is not
 * what the current sources produce. A stale bundle is the worst outcome of
 * this design, because the page would keep working while running last
 * week's circuits.
 *
 * The bundle is loaded lazily, only when no circuit server answers and only
 * when someone actually registers, so a visitor who never touches the form
 * never downloads it.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, rmSync, mkdtempSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = join(ROOT, 'scripts', 'lib', 'intake-engine.mjs');
const OUT = join(ROOT, 'site', 'assets', 'intake-engine');
const CHECK = process.argv.includes('--check');

const { build } = await import('vite');

/** Every emitted file, by name, as a content hash: the comparable form. */
const fingerprint = (dir) => Object.fromEntries(
    readdirSync(dir).sort().map((name) => [
        name,
        createHash('sha256').update(readFileSync(join(dir, name))).digest('hex').slice(0, 16)
    ])
);

const target = CHECK ? mkdtempSync(join(tmpdir(), 'vinpassport-engine-')) : OUT;

await build({
    logLevel: 'warn',
    // Relative, so the wasm is fetched from beside the bundle rather than
    // from the site root. The default emitted `/midnight_..._bg.wasm`, which
    // 404s and arrives as an HTML error page: the browser then reports
    // "expected 4 bytes, fell off end" and nothing points at the real cause.
    base: './',
    build: {
        outDir: target,
        emptyOutDir: true,
        target: 'es2022',
        // Keep the wasm as its own file. Inlined as a base64 data URL it was
        // 2.0 MB and gzipped to 614 kB, against 409 kB for the binary beside
        // the JS: base64 does not compress back down, so inlining cost half
        // as much again in transfer to save one request.
        assetsInlineLimit: 0,
        // NOT library mode. `build.lib` always inlines wasm, because a
        // library cannot assume where its assets will sit; it produced one
        // 2.0 MB file. A plain build emits the binary beside the JS.
        rollupOptions: {
            input: ENTRY,
            // Without this a plain build treats the entry as an application,
            // decides nothing consumes its exports and drops them: the wasm
            // loads and the module comes back with no functions on it.
            preserveEntrySignatures: 'strict',
            // Fixed names, because the page imports the entry by name and a
            // content hash would mean editing the importer on every build.
            output: {
                format: 'es',
                entryFileNames: 'intake-engine.js',
                chunkFileNames: '[name].js',
                assetFileNames: '[name][extname]'
            }
        }
    }
});

if (!CHECK) {
    const built = fingerprint(OUT);
    for (const [name, hash] of Object.entries(built)) console.log(`  ${hash}  ${name}`);
    console.log(`\nbuild:engine: ${Object.keys(built).length} files in site/assets/intake-engine/`);
    process.exit(0);
}

if (!existsSync(OUT)) {
    console.error('check: site/assets/intake-engine/ does not exist. Run `npm run build:engine`.');
    rmSync(target, { recursive: true, force: true });
    process.exit(1);
}

const fresh = fingerprint(target);
const committed = fingerprint(OUT);
rmSync(target, { recursive: true, force: true });

const names = [...new Set([...Object.keys(fresh), ...Object.keys(committed)])].sort();
const drifted = names.filter((n) => fresh[n] !== committed[n]);
for (const n of names) console.log(`  ${drifted.includes(n) ? 'DRIFT' : 'same '}  ${n}`);
if (drifted.length) {
    console.error('\ncheck: the committed engine is not what these sources build.');
    console.error('The page would keep working and would be running an older contract.');
    console.error('Run `npm run build:engine` and commit the result.');
    process.exit(1);
}
console.log('\ncheck: the committed engine matches its sources');
