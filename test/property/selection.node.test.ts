import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  Amount,
  KeyChain,
  Wallet,
  selectProofsRGLI,
  selectProofsRotating,
  type Proof,
  type SelectProofs,
  type SendResponse,
} from '../../src';
import { DUMMY_TEST_KEYS, DUMMY_TEST_KEYSET } from '../consts';
import { mintInfoResp, mintUrl } from '../wallet/_setup';

import { hex, proof } from './arbitraries';

type KeysetSpec = { id: string; fee: number; active: boolean };

// Selectors only read fee, activity and id shape, so a stub stands in for a loaded chain.
function keyChainOf(keysets: KeysetSpec[]): KeyChain {
  const byId = new Map(keysets.map((k) => [k.id, k]));
  const stub = {
    getKeyset: (id: string) => {
      const k = byId.get(id)!;
      return { id, fee: k.fee, isActive: k.active, hasHexId: /^[0-9a-f]+$/.test(id) };
    },
    getKeysets: () => keysets,
    isUnitKeyset: (id: string) => byId.has(id),
  };
  return stub as unknown as KeyChain;
}

// Fees above 1000 ppk let a proof cost more than it is worth.
const keysets = fc.uniqueArray(
  fc.record({
    id: fc.oneof(
      hex(7).map((h) => '00' + h),
      hex(32).map((h) => '01' + h),
      fc.base64String({ minLength: 12, maxLength: 12 }),
    ),
    fee: fc.integer({ min: 0, max: 3000 }),
    active: fc.boolean(),
  }),
  { minLength: 1, maxLength: 3, selector: (k) => k.id },
);

const scenario = keysets.chain((ks) =>
  fc.record({
    keysets: fc.constant(ks),
    proofs: fc.uniqueArray(
      proof(
        fc.constantFrom(...ks.map((k) => k.id)),
        fc.integer({ min: 1, max: 64 }).map((a) => Amount.from(a)),
      ),
      { maxLength: 8, selector: (p) => p.secret },
    ),
    target: fc.integer({ min: 0, max: 200 }),
    includeFees: fc.boolean(),
    exactMatch: fc.boolean(),
  }),
);

const closeMatch = scenario.map((s) => ({ ...s, exactMatch: false }));

function netOf(proofs: Proof[], keysets: KeysetSpec[], includeFees: boolean): bigint {
  const fee = new Map(keysets.map((k) => [k.id, BigInt(k.fee)]));
  let gross = 0n;
  let ppk = 0n;
  for (const p of proofs) {
    gross += p.amount.toBigInt();
    ppk += fee.get(p.id)!;
  }
  return gross - (includeFees ? (ppk + 999n) / 1000n : 0n);
}

/**
 * Whether some subset of the pool pays the target: exactly, or at least, as asked.
 */
function subsetExists(proofs: Proof[], keysets: KeysetSpec[], s: Scenario): boolean {
  const target = BigInt(s.target);
  for (let mask = 1; mask < 1 << proofs.length; mask++) {
    const subset = proofs.filter((_, i) => mask & (1 << i));
    const net = netOf(subset, keysets, s.includeFees);
    if (s.exactMatch ? net === target : net >= target) return true;
  }
  return false;
}

type Scenario = { target: number; includeFees: boolean; exactMatch: boolean };

function secretsOf(proofs: Proof[]): string[] {
  return proofs.map((p) => p.secret).sort();
}

describe.each([
  ['selectProofsRGLI', selectProofsRGLI],
  ['selectProofsRotating', selectProofsRotating],
] as Array<[string, SelectProofs]>)('%s', (_name, select) => {
  it('keep and send together are exactly the input proofs', () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const { keep, send } = select(
          s.proofs,
          s.target,
          keyChainOf(s.keysets),
          s.includeFees,
          s.exactMatch,
        );
        expect(secretsOf([...keep, ...send])).toEqual(secretsOf(s.proofs));
      }),
    );
  });

  it('a non-empty send pays the target, exactly when asked to', () => {
    fc.assert(
      fc.property(scenario, (s) => {
        const { send } = select(
          s.proofs,
          s.target,
          keyChainOf(s.keysets),
          s.includeFees,
          s.exactMatch,
        );
        fc.pre(send.length > 0);
        const net = netOf(send, s.keysets, s.includeFees);
        if (s.exactMatch) expect(net).toBe(BigInt(s.target));
        else expect(net >= BigInt(s.target)).toBe(true);
      }),
    );
  });

  // Exact match is a randomized search that may return nothing, so only a close match must cover.
  it('a close match is found whenever some subset of the pool covers the target', () => {
    fc.assert(
      fc.property(closeMatch, (s) => {
        fc.pre(s.target > 0 && subsetExists(s.proofs, s.keysets, s));
        const { send } = select(
          s.proofs,
          s.target,
          keyChainOf(s.keysets),
          s.includeFees,
          s.exactMatch,
        );
        expect(send.length).toBeGreaterThan(0);
      }),
    );
  });
});

describe('Wallet.sendOffline', () => {
  function walletWithFee(fee: number): Wallet {
    const wallet = new Wallet(mintUrl, { unit: 'sat' });
    const keyset = { ...DUMMY_TEST_KEYSET, input_fee_ppk: fee };
    const keys = { ...DUMMY_TEST_KEYS, input_fee_ppk: fee };
    wallet.loadMintFromCache(mintInfoResp, KeyChain.mintToCacheDTO(mintUrl, [keyset], [keys]));
    return wallet;
  }

  const offline = fc.record({
    fee: fc.constantFrom(0, 400, 1500),
    proofs: fc.uniqueArray(
      proof(
        fc.constant(DUMMY_TEST_KEYSET.id),
        fc.constantFrom(1, 2).map((a) => Amount.from(a)),
      ),
      { minLength: 1, maxLength: 8, selector: (p) => p.secret },
    ),
    amount: fc.integer({ min: 1, max: 8 }),
    includeFees: fc.boolean(),
    exactMatch: fc.boolean(),
  });

  type Offline = typeof offline extends fc.Arbitrary<infer T> ? T : never;

  function sendOffline(s: Offline, requireDleq: boolean): SendResponse {
    const wallet = walletWithFee(s.fee);
    try {
      return wallet.sendOffline(s.amount, s.proofs, {
        requireDleq,
        includeFees: s.includeFees,
        exactMatch: s.exactMatch,
      });
    } catch {
      // No offline selection for this pool; the property is about the ones that succeed.
      fc.pre(false);
      throw new Error('unreachable');
    }
  }

  it('keep and send together are exactly the input proofs', () => {
    fc.assert(
      fc.property(offline, (s) => {
        const { keep, send } = sendOffline(s, false);
        expect(secretsOf([...keep, ...send])).toEqual(secretsOf(s.proofs));
      }),
    );
  });

  it('keep and send together are exactly the input proofs when a DLEQ is required', () => {
    fc.assert(
      fc.property(offline, (s) => {
        const { keep, send } = sendOffline(s, true);
        expect(secretsOf([...keep, ...send])).toEqual(secretsOf(s.proofs));
      }),
    );
  });

  it('the send pays the amount, plus fees when asked to', () => {
    fc.assert(
      fc.property(offline, fc.boolean(), (s, requireDleq) => {
        const { send } = sendOffline(s, requireDleq);
        const spec = [{ id: DUMMY_TEST_KEYSET.id, fee: s.fee, active: true }];
        const net = netOf(send, spec, s.includeFees);
        if (s.exactMatch) expect(net).toBe(BigInt(s.amount));
        else expect(net >= BigInt(s.amount)).toBe(true);
      }),
    );
  });
});
