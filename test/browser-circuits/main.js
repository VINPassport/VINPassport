/* The compiled VINPassport contract, and the intake path above it, executing
   in a browser.

   This is circuit EXECUTION, not proving: the same work app-server.mjs does
   for the intake console, which is why it needs 1.4 MB of runtime wasm and
   none of the 52 MB of prover keys. If it holds, the intake console can run
   on the published static site with no host and no running cost, and only
   the guided preprod run still needs a machine somewhere.

   Two layers, because either could fail on its own:

     circuits   the compiled contract through PassportSimulator
     intake     scenario.mjs, which is what the console actually calls, and
                which reached for node:crypto and Buffer until it was made
                runtime-agnostic. Those four lines are the reason this half
                exists: Node keeps passing whether or not they came back.

   It is a check rather than a note because what it establishes belongs to a
   dependency: @midnight-ntwrk/onchain-runtime-v3 declares a `browser` export
   condition today, and an upgrade could quietly drop it.
   Run by scripts/check-browser-circuits.mjs. */

// NO Buffer SHIM. There was one, for the single hex() helper that used it;
// that helper is pure JS now and nothing here may quietly depend on a Node
// global again. If a Buffer comes back, this check is where it surfaces.

const out = document.getElementById('out');
const lines = [];
const say = (s) => { lines.push(s); out.textContent = lines.join('\n'); };

try {
    const t0 = performance.now();
    const { PassportSimulator, REGISTRAR_ID, REGISTRAR_SECRET, DEALER_ID, DEALER_SECRET, bytes32, fieldKey, hex, Rule } =
        await import('../passport-simulator.mjs');
    const { pureCircuits } = await import('../../contracts/vinpassport/src/managed/vinpassport/contract/index.js');
    say(`loaded in ${Math.round(performance.now() - t0)} ms`);

    // ---- layer one: the circuits themselves --------------------------------

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
    if (writer !== hex(DEALER_ID)) {
        say('RESULT failed: the writer recorded was not the dealership');
        throw new Error('stop');
    }
    say('delegation recorded against the dealership');

    // ---- layer two: the intake path the console actually calls -------------

    const t2 = performance.now();
    const { applyIntake, buildDemoVehicles, exportLedger, saltStream, DEMO_WRITERS, CONSOLE_REGISTRAR_SECRET } =
        await import('../../scripts/lib/scenario.mjs');
    say('');
    say(`scenario.mjs loaded in ${Math.round(performance.now() - t2)} ms`);

    const t3 = performance.now();
    const sim2 = new PassportSimulator();
    const salt = saltStream();
    buildDemoVehicles(sim2, salt);
    say('buildDemoVehicles  ok');

    const result = applyIntake(sim2, {
        vin: 'VPDBROWSERINTAKE1',
        registrar: 'browser',
        fields: { odometerKm: 40000, accidentCount: 0, serviceCount: 4 },
        panel: { vehicleCategory: 'M1', fuelType: 'bev' },
        writers: [DEMO_WRITERS.dealership],
        registrarSecret: CONSOLE_REGISTRAR_SECRET,
        updates: [{ odometerKm: 48000, by: 'dealership' }],
        prove: { noAccidents: true, mileageUnder: 150000 }
    }, salt);
    say(`applyIntake        ok  (${result.applied.length} applied, ${result.refused.length} refused)`);
    for (const r of result.refused) say(`   refused: ${r.step} - ${r.reason}`);

    const exported = exportLedger(sim2, 'browser check');
    const vehicles = Object.keys(exported.passports).length;
    say(`exportLedger       ok  (${vehicles} vehicles, ${Object.keys(exported.fieldCommitment).length} fields)`);
    say(`intake path in ${Math.round(performance.now() - t3)} ms`);

    // The export has to be the shape local-ledger.mjs will accept, or the
    // console would produce something /verify/ then refuses to read.
    const shaped = ['passports', 'registrar', 'fieldCommitment', 'fieldRule', 'fieldWriter']
        .every((k) => exported[k] && typeof exported[k] === 'object') && Array.isArray(exported.claims);

    say('');
    if (!shaped) say('RESULT failed: the export is not the shape the local ledger stores');
    else if (result.refused.length) say('RESULT failed: the intake was refused in a browser but not in Node');
    else if (!exported.passports[result.vinHex]) say('RESULT failed: the registered vehicle is not in the export');
    else say('RESULT ok');
} catch (e) {
    if (String(e?.message) !== 'stop') say('RESULT failed: ' + (e?.stack ?? e));
}
