/**
 * The what-the-chain-sees panel, and the three formatters every surface needs.
 *
 * Kept out of the page so it can be exercised without a browser: this renders
 * the public record for one vehicle AND the list of things that are absent,
 * and an absence is exactly the kind of claim that rots quietly. A test can
 * feed it the committed ledger export and read both halves back.
 *
 * SPDX-License-Identifier: Apache-2.0
 */

export const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
export const short = (h) => `${String(h).slice(0, 10)}…${String(h).slice(-6)}`;
export const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));


/* ----------------------------------------------- what the chain sees ---- */

export const seeRow = (label, value, note) =>
    `<div style="padding:9px 0;border-bottom:1px solid rgba(0,74,173,.1)">
    <div style="display:flex;justify-content:space-between;gap:12px;align-items:baseline">
      <span style="font-size:12.5px;color:rgba(14,23,38,.72)">${esc(label)}</span>
      <span class="mono" style="font-size:11px;text-align:right;word-break:break-all;max-width:62%">${esc(value)}</span>
    </div>
    <div style="margin-top:3px;font-size:11.5px;line-height:1.5;color:rgba(14,23,38,.62)">${note}</div>
  </div>`;

/**
 * One thing the ledger does not carry.
 *
 * Deliberately NOT the `.none` badge the verdict rows use. That dashed square
 * is spoken for: it means "no claim on the ledger answers this question", and
 * the page spells that out in prose a few rows above. Nothing in this list is
 * an unproven claim. They are things the design never publishes, and wearing
 * the unproven badge would tell a reader the opposite of what is true: that
 * we tried to show who owns the vehicle and could not, rather than that the
 * contract has no concept of an owner at all.
 *
 * So these are a plain list, with the list's own marker, and they borrow no
 * part of the claim vocabulary.
 */
const absentRow = (what, why) =>
    `<li style="padding:8px 0;border-bottom:1px solid rgba(0,74,173,.1);font-size:12.5px;line-height:1.55;color:rgba(14,23,38,.72)">
    <b style="color:#0E1726">${esc(what)}</b> &middot; ${why}
  </li>`;

/**
 * Everything the public ledger holds about this vehicle, and everything it
 * does not.
 *
 * The page's whole argument is that a verdict can be reached without the
 * readings being published. That is a claim about an absence, and an absence
 * is the one thing a page cannot show by rendering what it has. So this block
 * lists both halves from the same ledger the verdict came from: every public
 * value, in full, next to the things a reader might reasonably assume are
 * hidden and deserve to see named.
 *
 * It is collapsed because it is evidence, not the answer.
 */
export function chainSeesBlock(vin, view, ledger) {
    const commitments = Object.keys(ledger.fieldCommitment ?? {}).length;
    const claims = view.answers.map((a) => a.claim).filter(Boolean);

    const held = [
        seeRow('VIN hash', vin,
            'The only vehicle identifier on the ledger. Hashing is one-way, so this does not give back the VIN.'),
        seeRow('Content root', view.contentRoot ?? 'none',
            'A hash of the canonical record, not the record. Every field slot is derived from it, which is what ties a claim to <i>this</i> document rather than merely to this vehicle.'),
        seeRow('Registrar', view.registrar ?? 'unknown',
            'Derived inside the circuit from a secret the registrar holds. The chain stores who, never how they proved it.'),
        seeRow('Updates recorded', String(ledger.updateCount ?? 0),
            'How many times a field was written across every vehicle. A count, not a history.'),
        seeRow('Field commitments on this ledger', String(commitments),
            'Across all vehicles. A slot is a hash of the vehicle, the field and the document, so this list names no vehicle by itself.'),
        seeRow('Delegated writers on this ledger', String((ledger.writers ?? []).length),
            'A registrar can hand the right to write <i>one</i> vehicle to a dealership or a garage, and take it back. Each entry is a hash of the vehicle and the party, so the list names neither by itself.')
    ].join('');

    // Who last wrote the field a claim was proven against. The claim names
    // its own slot, and the ledger records a writer per slot, so this is the
    // one place the custody chain can be shown per vehicle without deriving
    // slots the page has no reason to know.
    const wroteIt = (slot) => {
        const who = (ledger.fieldWriter ?? {})[slot];
        if (!who) return '';
        const delegated = who !== (view.registrar ?? '');
        return ` Last written by <span class="mono">${esc(short(who))}</span>`
            + (delegated
                ? ', which is not the registrar: this field was written by a party the registrar authorised for this vehicle.'
                : ', the registrar that registered it.');
    };

    const claimRows = claims.length
        ? claims.map((c) => seeRow(
            `Claim · ${c.atMost ? '≤' : '≥'} ${fmt(c.bound)}`,
            short(c.commitment),
            `Proven against that commitment, at slot ${esc(short(c.slot))}. The bound is public because it is the question asked; the value that satisfied it is not here.${wroteIt(c.slot)}`)).join('')
        : `<div style="padding:9px 0;font-size:12.5px;color:rgba(14,23,38,.62)">No claims proven yet. Registration publishes a root and a registrar and nothing else.</div>`;

    const absent = [
        absentRow('The VIN', 'only its hash is published, and the hash is what every slot is derived from'),
        absentRow('Every field value', 'mileage, accidents, keepers, the recycled-content figures. Each one exists on the ledger only as a commitment'),
        absentRow('The salts', 'held by whoever can open a commitment. Without one, a commitment cannot be opened even by someone who guesses the value'),
        absentRow('The registrar\'s secret', 'the identity above is derived from it; the secret itself never enters a transaction'),
        absentRow('Who owns the vehicle', 'the contract has no concept of an owner. It records a registrar and the record it anchored'),
        absentRow('Which commitments are this vehicle\'s', 'a slot reveals nothing without the vehicle, the field and the document that made it. Only a claim names its own slot')
    ].join('');

    return `<details class="vfy-more" style="margin:0">
    <summary style="padding:14px 18px"><span style="flex:1 1 240px;min-width:0">
      <b style="display:block;font-family:'Barlow Condensed',sans-serif;font-size:17px;letter-spacing:.02em">WHAT THE CHAIN SEES</b>
      <span style="font-size:12.5px;color:rgba(14,23,38,.62)">Every public value for this vehicle, and what stays off the ledger</span>
    </span></summary>
    <div style="padding:4px 18px 18px">
      <p class="vfy-measure" style="margin:0 0 10px;font-size:12.5px;line-height:1.6;color:rgba(14,23,38,.72)">
        Read from the same ledger as the verdict above. Anyone can read all of it; none of it is ours to withhold.
      </p>
      <span style="display:block;font:600 10px Barlow,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#002E6E;margin:12px 0 2px">On the ledger</span>
      ${held}
      <div class="vfy-claims-on-ledger">${claimRows}</div>
      <span style="display:block;font:600 10px Barlow,sans-serif;letter-spacing:.14em;text-transform:uppercase;color:#002E6E;margin:16px 0 2px">Not on the ledger</span>
      <ul style="margin:0;padding:0 0 0 18px">${absent}</ul>
    </div>
  </details>`;
}
