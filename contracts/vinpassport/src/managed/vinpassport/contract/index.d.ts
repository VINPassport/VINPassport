import type * as __compactRuntime from '@midnight-ntwrk/compact-runtime';

export enum Rule { neverFalls = 0, neverRises = 1, neverChanges = 2 }

export enum Tier { trade = 0, authority = 1 }

export type Claim = { slot: Uint8Array;
                      vinHash: Uint8Array;
                      fieldKey: Uint8Array;
                      commitment: Uint8Array;
                      bound: bigint;
                      atMost: boolean
                    };

export type RelClaim = { slotHigh: Uint8Array;
                         slotLow: Uint8Array;
                         vinHash: Uint8Array;
                         fieldKeyHigh: Uint8Array;
                         fieldKeyLow: Uint8Array;
                         commitmentHigh: Uint8Array;
                         commitmentLow: Uint8Array;
                         slack: bigint
                       };

export type Witnesses<PS> = {
  newValue(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  previousValue(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  previousSalt(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  newSalt(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  otherValue(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, bigint];
  otherSalt(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
  registrarSecret(context: __compactRuntime.WitnessContext<Ledger, PS>): [PS, Uint8Array];
}

export type ImpureCircuits<PS> = {
  registerPassport(context: __compactRuntime.CircuitContext<PS>,
                   vinHash_0: Uint8Array,
                   contentRoot_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  authoriseWriter(context: __compactRuntime.CircuitContext<PS>,
                  vinHash_0: Uint8Array,
                  writerId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  withdrawWriter(context: __compactRuntime.CircuitContext<PS>,
                 vinHash_0: Uint8Array,
                 writerId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  grantDisclosure(context: __compactRuntime.CircuitContext<PS>,
                  vinHash_0: Uint8Array,
                  granteeId_0: Uint8Array,
                  tier_0: Tier): __compactRuntime.CircuitResults<PS, []>;
  revokeDisclosure(context: __compactRuntime.CircuitContext<PS>,
                   vinHash_0: Uint8Array,
                   granteeId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  initialiseField(context: __compactRuntime.CircuitContext<PS>,
                  vinHash_0: Uint8Array,
                  fieldKey_0: Uint8Array,
                  rule_0: Rule): __compactRuntime.CircuitResults<PS, []>;
  recordField(context: __compactRuntime.CircuitContext<PS>,
              vinHash_0: Uint8Array,
              fieldKey_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  proveFieldAtMost(context: __compactRuntime.CircuitContext<PS>,
                   vinHash_0: Uint8Array,
                   fieldKey_0: Uint8Array,
                   bound_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  proveFieldAtLeast(context: __compactRuntime.CircuitContext<PS>,
                    vinHash_0: Uint8Array,
                    fieldKey_0: Uint8Array,
                    bound_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  proveFieldAtMostField(context: __compactRuntime.CircuitContext<PS>,
                        vinHash_0: Uint8Array,
                        fieldKeyHigh_0: Uint8Array,
                        fieldKeyLow_0: Uint8Array,
                        slack_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type ProvableCircuits<PS> = {
  registerPassport(context: __compactRuntime.CircuitContext<PS>,
                   vinHash_0: Uint8Array,
                   contentRoot_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  authoriseWriter(context: __compactRuntime.CircuitContext<PS>,
                  vinHash_0: Uint8Array,
                  writerId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  withdrawWriter(context: __compactRuntime.CircuitContext<PS>,
                 vinHash_0: Uint8Array,
                 writerId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  grantDisclosure(context: __compactRuntime.CircuitContext<PS>,
                  vinHash_0: Uint8Array,
                  granteeId_0: Uint8Array,
                  tier_0: Tier): __compactRuntime.CircuitResults<PS, []>;
  revokeDisclosure(context: __compactRuntime.CircuitContext<PS>,
                   vinHash_0: Uint8Array,
                   granteeId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  initialiseField(context: __compactRuntime.CircuitContext<PS>,
                  vinHash_0: Uint8Array,
                  fieldKey_0: Uint8Array,
                  rule_0: Rule): __compactRuntime.CircuitResults<PS, []>;
  recordField(context: __compactRuntime.CircuitContext<PS>,
              vinHash_0: Uint8Array,
              fieldKey_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  proveFieldAtMost(context: __compactRuntime.CircuitContext<PS>,
                   vinHash_0: Uint8Array,
                   fieldKey_0: Uint8Array,
                   bound_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  proveFieldAtLeast(context: __compactRuntime.CircuitContext<PS>,
                    vinHash_0: Uint8Array,
                    fieldKey_0: Uint8Array,
                    bound_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  proveFieldAtMostField(context: __compactRuntime.CircuitContext<PS>,
                        vinHash_0: Uint8Array,
                        fieldKeyHigh_0: Uint8Array,
                        fieldKeyLow_0: Uint8Array,
                        slack_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type PureCircuits = {
  slotOf(vinHash_0: Uint8Array,
         fieldKey_0: Uint8Array,
         contentRoot_0: Uint8Array): Uint8Array;
  registrarIdOf(secret_0: Uint8Array): Uint8Array;
  writerKeyOf(vinHash_0: Uint8Array, writerId_0: Uint8Array): Uint8Array;
  grantKeyOf(vinHash_0: Uint8Array, granteeId_0: Uint8Array): Uint8Array;
}

export type Circuits<PS> = {
  slotOf(context: __compactRuntime.CircuitContext<PS>,
         vinHash_0: Uint8Array,
         fieldKey_0: Uint8Array,
         contentRoot_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  registrarIdOf(context: __compactRuntime.CircuitContext<PS>,
                secret_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  writerKeyOf(context: __compactRuntime.CircuitContext<PS>,
              vinHash_0: Uint8Array,
              writerId_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  grantKeyOf(context: __compactRuntime.CircuitContext<PS>,
             vinHash_0: Uint8Array,
             granteeId_0: Uint8Array): __compactRuntime.CircuitResults<PS, Uint8Array>;
  registerPassport(context: __compactRuntime.CircuitContext<PS>,
                   vinHash_0: Uint8Array,
                   contentRoot_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  authoriseWriter(context: __compactRuntime.CircuitContext<PS>,
                  vinHash_0: Uint8Array,
                  writerId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  withdrawWriter(context: __compactRuntime.CircuitContext<PS>,
                 vinHash_0: Uint8Array,
                 writerId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  grantDisclosure(context: __compactRuntime.CircuitContext<PS>,
                  vinHash_0: Uint8Array,
                  granteeId_0: Uint8Array,
                  tier_0: Tier): __compactRuntime.CircuitResults<PS, []>;
  revokeDisclosure(context: __compactRuntime.CircuitContext<PS>,
                   vinHash_0: Uint8Array,
                   granteeId_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  initialiseField(context: __compactRuntime.CircuitContext<PS>,
                  vinHash_0: Uint8Array,
                  fieldKey_0: Uint8Array,
                  rule_0: Rule): __compactRuntime.CircuitResults<PS, []>;
  recordField(context: __compactRuntime.CircuitContext<PS>,
              vinHash_0: Uint8Array,
              fieldKey_0: Uint8Array): __compactRuntime.CircuitResults<PS, []>;
  proveFieldAtMost(context: __compactRuntime.CircuitContext<PS>,
                   vinHash_0: Uint8Array,
                   fieldKey_0: Uint8Array,
                   bound_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  proveFieldAtLeast(context: __compactRuntime.CircuitContext<PS>,
                    vinHash_0: Uint8Array,
                    fieldKey_0: Uint8Array,
                    bound_0: bigint): __compactRuntime.CircuitResults<PS, []>;
  proveFieldAtMostField(context: __compactRuntime.CircuitContext<PS>,
                        vinHash_0: Uint8Array,
                        fieldKeyHigh_0: Uint8Array,
                        fieldKeyLow_0: Uint8Array,
                        slack_0: bigint): __compactRuntime.CircuitResults<PS, []>;
}

export type Ledger = {
  passports: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  registrar: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  fieldCommitment: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  fieldRule: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Rule;
    [Symbol.iterator](): Iterator<[Uint8Array, Rule]>
  };
  claims: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Claim;
    [Symbol.iterator](): Iterator<[Uint8Array, Claim]>
  };
  relClaims: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): RelClaim;
    [Symbol.iterator](): Iterator<[Uint8Array, RelClaim]>
  };
  allowedRegistrars: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  writers: {
    isEmpty(): boolean;
    size(): bigint;
    member(elem_0: Uint8Array): boolean;
    [Symbol.iterator](): Iterator<Uint8Array>
  };
  fieldWriter: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Uint8Array;
    [Symbol.iterator](): Iterator<[Uint8Array, Uint8Array]>
  };
  grants: {
    isEmpty(): boolean;
    size(): bigint;
    member(key_0: Uint8Array): boolean;
    lookup(key_0: Uint8Array): Tier;
    [Symbol.iterator](): Iterator<[Uint8Array, Tier]>
  };
}

export type ContractReferenceLocations = any;

export declare const contractReferenceLocations : ContractReferenceLocations;

export declare class Contract<PS = any, W extends Witnesses<PS> = Witnesses<PS>> {
  witnesses: W;
  circuits: Circuits<PS>;
  impureCircuits: ImpureCircuits<PS>;
  provableCircuits: ProvableCircuits<PS>;
  constructor(witnesses: W);
  initialState(context: __compactRuntime.ConstructorContext<PS>,
               registrars_0: Uint8Array[]): __compactRuntime.ConstructorResult<PS>;
}

export declare function ledger(state: __compactRuntime.StateValue | __compactRuntime.ChargedState): Ledger;
export declare const pureCircuits: PureCircuits;
