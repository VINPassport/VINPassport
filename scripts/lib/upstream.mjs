/**
 * The version arithmetic behind scripts/check-upstream.mjs, with every lookup
 * injected so it runs offline in a test.
 *
 * A Midnight package is pinned in two places: `dependencies` (and
 * `devDependencies`) name what this repository imports, `overrides` pin the
 * copies its dependencies pull in, so that only one copy of each WASM package
 * exists. Both count. For each one the check compares the INSTALLED version
 * against the newest patch release of the pinned minor: a patch fixes, and a
 * tree behind the newest patch of its own line is a finding. A newer minor or
 * major is reported only, because that is an upgrade and upgrades are
 * deliberate (docs/UPGRADE-RUNBOOK.md).
 *
 * SPDX-License-Identifier: Apache-2.0
 */

export const MIDNIGHT = /^@midnight-?ntwrk\//;

/** Compare two versions; a release sorts above its own prereleases. */
export function cmp(a, b) {
    const pa = String(a).split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
    const pb = String(b).split(/[.-]/).map((x) => (/^\d+$/.test(x) ? Number(x) : x));
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        if (pa[i] === pb[i]) continue;
        if (pa[i] === undefined) return 1;      // 1.0.0 > 1.0.0-rc.1
        if (pb[i] === undefined) return -1;
        return typeof pa[i] === 'number' && typeof pb[i] === 'number' ? Math.sign(pa[i] - pb[i]) : String(pa[i]).localeCompare(String(pb[i]));
    }
    return 0;
}

const plain = (v) => String(v).replace(/^[\^~=v]/, '');
const isRelease = (v) => /^\d+\.\d+\.\d+$/.test(v);

/**
 * Every Midnight package package.json pins, with where it is pinned. An
 * override nested under a parent (`{ "a": { "b": "1.0.0" } }`) counts as a
 * pin of `b`; a value that is not a version (a path, a `$ref`) is skipped.
 */
export function midnightPins(pkg) {
    const pins = new Map();
    const add = (name, version, source) => {
        if (!MIDNIGHT.test(name) || typeof version !== 'string' || !/^[\^~=v]?\d/.test(version)) return;
        const entry = pins.get(name) ?? { name, pinned: plain(version), sources: [] };
        entry.sources.push(source);
        pins.set(name, entry);
    };
    for (const [name, v] of Object.entries({ ...pkg.dependencies, ...pkg.devDependencies })) add(name, v, 'dependencies');
    const walk = (obj) => {
        for (const [name, v] of Object.entries(obj ?? {})) {
            if (typeof v === 'string') add(name, v, 'overrides');
            else if (v && typeof v === 'object') {
                if (typeof v['.'] === 'string') add(name, v['.'], 'overrides');
                walk(Object.fromEntries(Object.entries(v).filter(([k]) => k !== '.')));
            }
        }
    };
    walk(pkg.overrides);
    return [...pins.values()];
}

/** The newest release with the same major and minor as `pinned`, or null. */
export function newestPatch(pinned, versions) {
    const [major, minor] = plain(pinned).split('.');
    return versions.filter(isRelease).filter((v) => {
        const [a, b] = v.split('.');
        return a === major && b === minor;
    }).sort(cmp).at(-1) ?? null;
}

/**
 * One row per pin. `installed(name)` returns the version in node_modules or
 * null; `versions(name)` resolves to every published version (may throw).
 * `behind` is the finding: installed below the newest patch of its minor.
 */
export async function checkPins(pins, { installed, versions }) {
    const rows = [];
    for (const p of pins) {
        const have = installed(p.name);
        let all;
        try { all = await versions(p.name); } catch (e) {
            rows.push({ ...p, installed: have, error: String(e?.message ?? e) });
            continue;
        }
        const latest = all.filter(isRelease).sort(cmp).at(-1) ?? null;
        const patch = newestPatch(p.pinned, all);
        rows.push({
            ...p, installed: have, latest, newestPatch: patch,
            missing: have == null,
            behind: have != null && patch != null && cmp(have, patch) < 0,
            newerLine: latest != null && patch != null && cmp(latest, patch) > 0
        });
    }
    return rows;
}
