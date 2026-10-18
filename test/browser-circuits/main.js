/* The compiled VINPassport contract, executing in a browser.

   This is circuit EXECUTION, not proving: the same work app-server.mjs does
   for the intake console, which is why it needs 1.4 MB of runtime wasm and
   none of the 52 MB of prover keys. If it holds, the intake console can run
   on the published static site with no host and no running cost, and only
   the guided preprod run still needs a machine somewhere.
   
   It is a check rather than a note because the thing it establishes is a
   property of a dependency: @midnight-ntwrk/onchain-runtime-v3 declares a
   `browser` export condition today, and an upgrade could quietly drop it.
   Run by scripts/check-browser-circuits.mjs. */

// passport-simulator.mjs has one Buffer use, in its hex() helper. Shimmed here
// so the spike answers the bundling question rather than tripping on one line.
globalThis.Buffer ??= {
    from: (b) => ({ toString: () => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('') })
};

const out = document.getElementById('out');
const lines = [];
const say = (s) => { lines.push(s); out.textContent = lines.join('\n'); };

try {
    const t0 = performance.now();
    const { PassportSimulator, REGISTRAR_ID, REGISTRAR_SECRET, DEALER_ID, DEALER_SECRET, bytes32, fieldKey, hex, Rule } =
        await import('../passport-simulator.mjs');
    const { pureCircuits } = await import('../../contracts/vinpassport/src/managed/vinpassport/contract/index.js');
    say(`loaded in ${Math.round(performance.now() - t0)} ms`);

    const sim = new PassportSimulator([REGISTRAR_ID]);
    sim.actAs(REGISTRAR_SECRET);
    const vin = fieldKey('VPDBROWSERSPIKE01');
    const odo = fieldKey('odometerKm');
    const root = bytes32(0x01);

    const t1 = performance.now();
    sim.registerPassport(vin, root);
    say('registerPassport   ok');

    // The ratchet odometerKm carries in the shipped registry: a reading may
    // never fall. Taken from the contract's own enum, not written out as a
    // number here - the first pass passed 1 (neverRises) and the circuit
    // refused the increase, which is how we know it is really running.
    sim.initialiseField(vin, odo, Rule.neverFalls, 40000n, bytes32(0x11));
    say('initialiseField    ok');

    sim.authoriseWriter(vin, DEALER_ID);
    say('authoriseWriter    ok');

    sim.actAs(DEALER_SECRET);
    sim.recordField(vin, odo, 48000n, bytes32(0x12));
    say('recordField        ok  (as the dealership)');
    sim.actAs(REGISTRAR_SECRET);

    sim.proveFieldAtMost(vin, odo, 150000n);
    say('proveFieldAtMost   ok');
    const ms = Math.round(performance.now() - t1);

    const slot = pureCircuits.slotOf(vin, odo, root);
    const writer = hex(sim.ledger.fieldWriter.lookup(slot));
    say('');
    say(`five circuits in ${ms} ms`);
    say(`fieldWriter = ${writer.slice(0, 16)}...`);
    say(`dealership  = ${hex(DEALER_ID).slice(0, 16)}...`);
    say(writer === hex(DEALER_ID) ? 'RESULT ok' : 'RESULT failed: the writer recorded was not the dealership');
} catch (e) {
    say('RESULT failed: ' + (e?.stack ?? e));
}
