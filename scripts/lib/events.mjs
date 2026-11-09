/**
 * VINPassport's events (DECISIONS D29), decoded.
 *
 * Every state change emits one standard `Misc` event. Its 32-byte `name` is
 * the subject (the vehicle's VIN hash, or for registrar governance the
 * proposal key) and its payload is `serialize<PassportEvent, 256>` of two
 * constants: the schema "vinpassport.v1" and the kind of change. The runtime
 * hands it over as one cell of 32 + 256 bytes with trailing zero bytes
 * trimmed, so decoding is padding and slicing.
 *
 * Kinds, and what the subject is:
 *
 *   registered, writerAuthorised, writerWithdrawn, granted, revoked,
 *   fieldInitialised, fieldRecorded, claimAtMost, claimAtLeast, relClaim
 *                                     the vehicle (VIN hash)
 *   registrarApproval, registrarAdded, registrarRemoved
 *                                     the proposal (proposalKeyOf)
 *
 * The rest of a change is on the ledger at that block, and the circuit that
 * made it comes with the contract call. Events carry so little on purpose:
 * every variable byte is repacked in-circuit, and a six-field payload made
 * each writing circuit about ten times larger (D29 has the measurements).
 *
 * SPDX-License-Identifier: Apache-2.0
 */

export const EVENT_SCHEMA = 'vinpassport.v1';
export const VEHICLE_KINDS = Object.freeze(['registered', 'writerAuthorised', 'writerWithdrawn', 'granted', 'revoked',
    'fieldInitialised', 'fieldRecorded', 'claimAtMost', 'claimAtLeast', 'relClaim']);
export const GOVERNANCE_KINDS = Object.freeze(['registrarApproval', 'registrarAdded', 'registrarRemoved']);
const SIZE = 32 + 256;

// No Buffer: the simulator that imports this is bundled for the browser too.
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const text = (b) => new TextDecoder().decode(b).replace(/\0+$/, '');

/**
 * One runtime log event (as on `CircuitContext.events`) to
 * `{ address, kind, subject }`, or null when it is not a VINPassport event.
 */
export function decodeEvent(event) {
    if (event?.eventType !== 'misc' || event.data?.tag !== 'cell') return null;
    const raw = event.data.content?.value?.[0];
    if (!(raw instanceof Uint8Array) || raw.length > SIZE) return null;
    const bytes = new Uint8Array(SIZE);
    bytes.set(raw);
    if (text(bytes.subarray(32, 64)) !== EVENT_SCHEMA) return null;
    return { address: event.address ?? null, kind: text(bytes.subarray(64, 96)), subject: hex(bytes.subarray(0, 32)) };
}

/** Every VINPassport event in a list of runtime log events, decoded, in order. */
export const decodeEvents = (events) => (events ?? []).map(decodeEvent).filter(Boolean);
