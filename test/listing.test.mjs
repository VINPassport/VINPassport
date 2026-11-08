/**
 * The listing demo (contracts/listing): a second contract that lists a
 * vehicle only if VINPassport holds a current claim for it, asked through a
 * cross-contract call in the same transaction (build plan 2.5, D33).
 *
 * These run the real compiled call tree in memory: the listing circuit calls
 * VINPassport's `holdsAtMost` through the Compact runtime's
 * `crossContractCall`, with the callee's state and module supplied the way
 * Midnight.js supplies them on chain. The callee's verifier key is a committed
 * fixture, because the runtime refuses a callee whose keys do not match what
 * is deployed, and that refusal is one of the things tested here.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    createConstructorContext, createCircuitContext, sampleContractAddress, encodeContractAddress,
    ContractState, ContractOperation
} from '@midnight-ntwrk/compact-runtime';
import { Contract as Listing, ledger as listingLedger } from '../contracts/listing/src/managed/listing/contract/index.js';
import { PassportSimulator, Rule, bytes32, fieldKey, REGISTRAR_SECRET } from './passport-simulator.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, 'fixtures', 'verifier-keys');
const VP_MODULE = '../contracts/vinpassport/src/managed/vinpassport/contract/index.js';

const VIN = bytes32(0x11);
const OTHER_VIN = bytes32(0x22);
const ROOT = bytes32(0xaa);
const ODO = fieldKey('odometerKm');
const S1 = bytes32(0xd1);
const S2 = bytes32(0xd2);
const BOUND = 150_000n;

const vpAddress = sampleContractAddress();
const listingAddress = sampleContractAddress();

let sim;
beforeEach(async () => {
    sim = await PassportSimulator.create();
    await sim.registerPassport(VIN, ROOT, REGISTRAR_SECRET);
    await sim.initialiseField(VIN, ODO, Rule.neverFalls, 83_000n, S1);
    await sim.registerPassport(OTHER_VIN, ROOT, REGISTRAR_SECRET);
    await sim.initialiseField(OTHER_VIN, ODO, Rule.neverFalls, 40_000n, S1);
});

/**
 * VINPassport as a callee sees it: the simulator's current ledger, with the
 * verifier key of the called circuit installed, as a deploy would install it.
 * `key` lets a test install the wrong one.
 */
function deployedPassport(key = 'holdsAtMost.verifier') {
    const state = new ContractState();
    state.data = sim.ctx.callContext.currentQueryContext.state;
    const op = new ContractOperation();
    op.verifierKey = new Uint8Array(readFileSync(join(FIXTURES, key)));
    state.setOperation('holdsAtMost', op);
    return state;
}

async function deployListing() {
    const listing = new Listing({});
    const init = await listing.initialState(
        createConstructorContext({}, '0'.repeat(64)),
        { bytes: encodeContractAddress(vpAddress) },
        ODO,
        BOUND
    );
    return { listing, state: init.currentContractState };
}

/** Call `list` on the listing, with VINPassport resolvable at its address. */
async function list(vin, { key, module = VP_MODULE } = {}) {
    const { listing, state } = await deployListing();
    const passport = deployedPassport(key);
    const ctx = createCircuitContext({
        circuitId: 'list',
        contractAddress: listingAddress,
        coinPublicKeyOrZswapState: '0'.repeat(64),
        contractState: state,
        privateState: {},
        parentBlockHash: '00'.repeat(32),
        crossContract: {
            stateProvider: { getContractState: async (_block, address) => (address === vpAddress ? passport : undefined) },
            moduleProvider: { resolve: (address) => (address === vpAddress ? () => import(module) : undefined) }
        }
    });
    const r = await listing.impureCircuits.list(ctx, vin);
    return { ledger: listingLedger(r.context.callContext.currentQueryContext.state), result: r };
}

describe('listing: a second contract asks VINPassport in the same transaction', () => {
    it('lists a vehicle VINPassport holds a current mileage claim for', async () => {
        await sim.proveFieldAtMost(VIN, ODO, BOUND);
        const { ledger, result } = await list(VIN);
        expect(ledger.listed.member(VIN)).toBe(true);
        // Two calls in one tree: the callee first, then the listing that asked.
        expect(result.context.callProofDataTrace.length).toBe(2);
    });

    it('refuses a vehicle with no such claim, and writes nothing', async () => {
        await expect(list(OTHER_VIN)).rejects.toThrow(/VINPassport holds no current claim/);
    });

    it('refuses once the claim is stale: the odometer moved after the proof', async () => {
        await sim.proveFieldAtMost(VIN, ODO, BOUND);
        await sim.recordField(VIN, ODO, 84_000n, S2);
        await expect(list(VIN)).rejects.toThrow(/VINPassport holds no current claim/);
    });

    it('a claim with a different bound does not satisfy the rule', async () => {
        await sim.proveFieldAtMost(VIN, ODO, 200_000n);
        await expect(list(VIN)).rejects.toThrow(/VINPassport holds no current claim/);
    });

    it('refuses a callee whose deployed key is not the one its code was built with', async () => {
        await sim.proveFieldAtMost(VIN, ODO, BOUND);
        const e = await list(VIN, { key: 'registerPassport.verifier' }).catch((x) => x);
        expect(e.constructor.name).toBe('ModuleResolutionError');
        expect(e.message).toMatch(/Cross-contract call .* to 'holdsAtMost'/);
    });

    it('refuses when nothing is deployed at the address it trusts', async () => {
        const { listing, state } = await deployListing();
        const ctx = createCircuitContext({
            circuitId: 'list', contractAddress: listingAddress, coinPublicKeyOrZswapState: '0'.repeat(64),
            contractState: state, privateState: {}, parentBlockHash: '00'.repeat(32),
            crossContract: { stateProvider: { getContractState: async () => undefined }, moduleProvider: { resolve: () => undefined } }
        });
        const e = await listing.impureCircuits.list(ctx, VIN).catch((x) => x);
        // The runtime asks for the callee's state before its code, and says so by address.
        expect(e.message).toMatch(/Expected contract state for callee '[0-9a-f]{64}' to be defined/);
    });
});
