/**
 * Credentials, read from the environment or from `_local-tracking/`.
 *
 * `_local-tracking/` sits ABOVE the repository root, so git cannot see it at
 * all: it is not a matter of remembering to gitignore something. Nothing in
 * here ever returns a credential to a caller that intends to print it, so
 * every reader is responsible for redacting before logging.
 *
 * Reading from a file rather than taking a credential by hand keeps it out of
 * shell history and out of any transcript.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
export const LOCAL_DIR = join(HERE, '..', '..', '..', '_local-tracking');

/** Where a given credential file lives. Exported so errors can name the path. */
export const credentialPath = (file) => join(LOCAL_DIR, file);

/**
 * Read `name` from the environment, else from `name=value` in
 * `_local-tracking/<file>`. Returns null when absent; the caller decides
 * whether that is fatal, because some callers are allowed to run without it.
 *
 * A line whose value still looks like a placeholder is treated as absent, so
 * a template file that was never filled in fails the same way a missing one
 * does rather than sending a literal "paste-it-here" to a server.
 */
export function localCredential(name, file) {
    const fromEnv = process.env[name]?.trim();
    if (fromEnv) return fromEnv;

    const path = credentialPath(file);
    if (!existsSync(path)) return null;

    const line = readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .find((l) => l.trim().startsWith(`${name}=`));
    const value = line?.slice(line.indexOf('=') + 1).trim();
    if (!value) return null;
    if (/^<.*>$/.test(value) || /paste|your[-_ ]?key|replace/i.test(value)) return null;
    return value;
}
