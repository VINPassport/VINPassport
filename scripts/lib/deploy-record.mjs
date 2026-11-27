/**
 * Changing a deploy record (deploy/<network>.json) without losing another
 * tool's change to it.
 *
 * Several tools write the record: maintenance (authority, build, maintenance
 * log), govern (registrarChanges), deploy (the steps of a stepped deploy). A
 * tool that reads the record at start and writes its copy back at the end
 * drops whatever another tool wrote in between. So a tool states its change,
 * and `rewriteRecord` applies it to the record as it is on disk at that moment
 * and replaces the file atomically (scripts/lib/files.mjs).
 *
 * A change is `{ set, append }`: `set` maps a key to its new value, or to a
 * function of the current record that returns it; `append` maps a key to one
 * entry added to the array under it.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync } from 'node:fs';
import { writeJsonAtomic } from './files.mjs';

/** The record with `change` applied. Pure: `record` is not modified. */
export function applyRecordChange(record, { set = {}, append = {} } = {}) {
    const out = { ...record };
    for (const [key, value] of Object.entries(set)) out[key] = typeof value === 'function' ? value(record) : value;
    for (const [key, entry] of Object.entries(append)) out[key] = [...(record[key] ?? []), entry];
    return out;
}

/**
 * Re-read `path`, check it still names `contractAddress`, apply `change` and
 * write it back atomically. Returns the record written.
 */
export function rewriteRecord(path, change, { contractAddress } = {}) {
    const current = JSON.parse(readFileSync(path, 'utf8'));
    if (contractAddress && current.contractAddress !== contractAddress) {
        throw new Error(`${path} now names ${current.contractAddress}, not ${contractAddress}: a redeploy happened meanwhile. Not writing.`);
    }
    const next = applyRecordChange(current, change);
    writeJsonAtomic(path, next);
    return next;
}
