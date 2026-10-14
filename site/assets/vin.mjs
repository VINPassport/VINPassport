/**
 * What someone typed, turned into the key a passport is stored under.
 *
 * Kept apart from the page so it can be tested as a function rather than
 * asserted on as source text. Every branch here is a thing a real person
 * does: shouting a VIN down a phone and writing it with spaces, reading an
 * O that is a zero off a dirty windscreen, pasting the whole link we gave
 * them, or pasting the hash out of it.
 *
 * The one rule that matters: this never decides a vehicle is unknown. It
 * decides what was asked for. Whether a passport exists is the ledger's
 * answer, not this function's.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { vinHashHex } from './blake2b.mjs?v=1';

/** ISO 3779: seventeen characters, and I, O and Q are not among them. */
export const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
/** Our own identifier, as it appears in a link or a code. */
export const HASH_RE = /^[0-9a-f]{64}$/;

/**
 * @param {string} typed
 * @returns {{key: string, vin: string|null} | {error: string}}
 */
export function parseEntry(typed) {
    // Spaces and dashes arrive whenever a VIN is read aloud or copied off a
    // document, and neither belongs to the alphabet.
    const entry = String(typed ?? '').trim().toUpperCase().replace(/[\s-]/g, '');

    if (!entry) {
        return { error: 'Type a VIN first. It is the seventeen characters on the windscreen, the door frame or the registration document.' };
    }

    // A whole link, pasted. Take the identifier out of it rather than telling
    // someone that what we sent them is not a VIN.
    const inLink = entry.match(/[?&]V=([0-9A-F]{64})/);
    const candidate = inLink ? inLink[1].toLowerCase() : entry;

    if (HASH_RE.test(candidate.toLowerCase())) {
        return { key: candidate.toLowerCase(), vin: null };
    }

    if (VIN_RE.test(candidate)) {
        return { key: vinHashHex(candidate), vin: candidate };
    }

    if (candidate.length === 17) {
        return { error: 'That is seventeen characters, but a VIN never contains I, O or Q, so one of them is a 1 or a 0.' };
    }
    return {
        error: `A VIN is seventeen characters and this is ${candidate.length}. `
            + 'Check for a missing character rather than a wrong one.',
    };
}
