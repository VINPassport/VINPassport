/**
 * Two file disciplines every tool that writes a record or opens a seed shares.
 *
 * ATOMIC WRITES. A deploy record, an audit trail entry, a committee list or a
 * signed proposal is rewritten as a whole: the new bytes go to a temporary
 * file in the same directory, are flushed, and are renamed over the old one.
 * A run stopped halfway leaves the previous file or the new one, never half
 * of either. Same directory, because a rename across volumes is a copy.
 *
 * ONE PROCESS PER SEED. Two processes that open one deploy seed spend the same
 * DUST twice and race each other's balancing, so every entry point that opens
 * the wallet takes `_local-tracking/locks/<network>.lock` first. It is created
 * with flag wx, holds the pid and the start time, and is removed on exit. A
 * lock left by a process that is no longer running is reported with the
 * command to remove it, and never taken over silently: only the operator can
 * know that no other machine-local process still has the seed open. Taking the
 * lock twice in one process is fine; the second take shares the first.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import {
    openSync, writeSync, fsyncSync, closeSync, renameSync, unlinkSync, mkdirSync, readFileSync, writeFileSync
} from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { LOCAL_DIR } from './local-credentials.mjs';

/** Write `data` to `path` through a flushed temporary file and a rename. */
export function writeFileAtomic(path, data, { mode = 0o644 } = {}) {
    const dir = dirname(path);
    mkdirSync(dir, { recursive: true });
    const tmp = join(dir, `.${basename(path)}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`);
    const fd = openSync(tmp, 'wx', mode);
    try {
        writeSync(fd, typeof data === 'string' ? data : Buffer.from(data));
        fsyncSync(fd);
    } catch (e) {
        closeSync(fd);
        try { unlinkSync(tmp); } catch { /* already gone */ }
        throw e;
    }
    closeSync(fd);
    try {
        renameSync(tmp, path);
    } catch (e) {
        try { unlinkSync(tmp); } catch { /* already gone */ }
        throw e;
    }
    return path;
}

/** A JSON document, two-space indented with a trailing newline, written atomically. */
export const writeJsonAtomic = (path, value, opts) => writeFileAtomic(path, JSON.stringify(value, null, 2) + '\n', opts);

export const LOCK_DIR = join(LOCAL_DIR, 'locks');

/** True while a process with this pid exists. EPERM means it exists under another user. */
export function pidAlive(pid) {
    try { process.kill(pid, 0); return true; } catch (e) { return e?.code === 'EPERM'; }
}

const held = new Map();   // lock path -> { count, release }

/**
 * Take the seed lock for `network`, or throw saying who holds it. Returns
 * `{ path, release }`; the lock is also released on exit, SIGINT and SIGTERM.
 * `dir` and `alive` exist for tests.
 */
export function takeSeedLock(network, { dir = LOCK_DIR, what = basename(process.argv[1] ?? 'node'), alive = pidAlive } = {}) {
    if (!/^[a-z0-9-]{1,32}$/.test(String(network))) throw new Error(`not a network name: ${network}`);
    const path = join(dir, `${network}.lock`);
    const mine = held.get(path);
    if (mine) {
        mine.count += 1;
        return { path, release: mine.release };
    }
    mkdirSync(dir, { recursive: true });
    const body = JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), what }) + '\n';
    try {
        writeFileSync(path, body, { flag: 'wx', mode: 0o600 });
    } catch (e) {
        if (e?.code !== 'EEXIST') throw e;
        let owner = null;
        try { owner = JSON.parse(readFileSync(path, 'utf8')); } catch { /* unreadable: reported below */ }
        const who = owner ? `pid ${owner.pid} (${owner.what ?? '?'}, since ${owner.startedAt ?? '?'})` : 'an unreadable lock file';
        if (owner?.pid && alive(owner.pid)) {
            throw new Error(`${path} is held by ${who}: another process has the ${network} seed open. Wait for it to finish.`);
        }
        throw new Error(`${path} was left by ${who}, which is no longer running. Make sure nothing else uses the `
            + `${network} seed, then remove the lock by hand: rm "${path}"`);
    }
    const drop = () => {
        if (!held.has(path)) return;
        held.delete(path);
        process.removeListener('exit', drop);
        process.removeListener('SIGINT', onSignal);
        process.removeListener('SIGTERM', onSignal);
        try { if (readFileSync(path, 'utf8') === body) unlinkSync(path); } catch { /* already gone */ }
    };
    const onSignal = (sig) => { drop(); process.exit(sig === 'SIGINT' ? 130 : 143); };
    const release = () => {
        const entry = held.get(path);
        if (entry && --entry.count === 0) drop();
    };
    held.set(path, { count: 1, release });
    process.on('exit', drop);
    process.on('SIGINT', onSignal);
    process.on('SIGTERM', onSignal);
    return { path, release };
}
