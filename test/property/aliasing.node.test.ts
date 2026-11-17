import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  KeyChain,
  LockBuilder,
  PaymentRequest,
  type PaymentRequestBuilder,
  PaymentRequestTransportType,
  Wallet,
  bytesToHex,
  createKeyPairDeriver,
  createSecretAndBlindingFactorDeriver,
  getPubKeyFromPrivKey,
  isP2PKKnownTagKey,
  type LockOptions,
  type P2PKTag,
  type PaymentRequestTransport,
} from '../../src';
import { DUMMY_TEST_KEYS, DUMMY_TEST_KEYSET } from '../consts';
import { mintInfoResp, mintUrl } from '../wallet/_setup';

import { creqAOptions, hex, runs, text } from './arbitraries';

/**
 * Mutates every array and object reachable from `v` in place.
 */
function scribble(v: unknown): void {
  if (v instanceof Uint8Array) {
    v.fill(0xee);
    return;
  }
  if (typeof v !== 'object' || v === null || Object.isFrozen(v)) return;
  Object.values(v).forEach(scribble);
  if (Array.isArray(v)) v.push('scribbled');
  else (v as Record<string, unknown>).scribbled = true;
}

const pubkeys = [1, 2, 3, 4, 5, 6].map((i) => {
  const priv = new Uint8Array(32);
  priv[31] = i;
  return bytesToHex(getPubKeyFromPrivKey(priv));
});

const tagKey = text.filter((k) => !isP2PKKnownTagKey(k));

const lockRecipe = fc.record({
  main: fc.subarray(pubkeys, { minLength: 1, maxLength: 3 }),
  refund: fc.subarray(pubkeys, { maxLength: 2 }),
  tags: fc.array(
    fc
      .tuple(tagKey, fc.array(text, { minLength: 1, maxLength: 2 }))
      .map(([k, v]): P2PKTag => [k, ...v]),
    { minLength: 1, maxLength: 2 },
  ),
  leafKeys: fc.subarray(pubkeys, { minLength: 1, maxLength: 3 }),
});

type LockRecipe = typeof lockRecipe extends fc.Arbitrary<infer T> ? T : never;

function p2pkBuilder(r: LockRecipe): LockBuilder {
  const b = new LockBuilder().addMainPubkey(r.main).addTags(r.tags).blindKeys().sigAll();
  return r.refund.length ? b.lockUntil(4_102_444_800).addRefundPubkey(r.refund) : b;
}

function nutrootBuilder(r: LockRecipe): LockBuilder {
  return new LockBuilder()
    .addMainPubkey(r.main)
    .addLeaf({ type: 'threshold', n: 1, keys: r.leafKeys })
    .blindKeys(r.leafKeys.slice(0, 1));
}

function snapshot(lock: LockOptions): LockOptions {
  return structuredClone(lock);
}

describe('LockBuilder', () => {
  const fields: Array<[keyof LockOptions, (r: LockRecipe) => LockBuilder]> = [
    ['mainKeys', p2pkBuilder],
    ['refundKeys', p2pkBuilder],
    ['additionalTags', p2pkBuilder],
    ['leaves', nutrootBuilder],
    ['blindKeys', nutrootBuilder],
  ];

  for (const [field, build] of fields) {
    it(`mutating the returned ${field} does not change a later toOptions`, () => {
      fc.assert(
        fc.property(lockRecipe, (r) => {
          const b = build(r);
          const first = b.toOptions();
          const expected = snapshot(first);
          scribble(first[field]);
          expect(b.toOptions()).toEqual(expected);
        }),
      );
    });
  }

  it('mutating setter arguments after the call does not change toOptions', () => {
    fc.assert(
      fc.property(lockRecipe, fc.boolean(), (generated, nutroot) => {
        const r = structuredClone(generated);
        const b = nutroot ? nutrootBuilder(r) : p2pkBuilder(r);
        const expected = snapshot(b.toOptions());
        scribble(r);
        expect(b.toOptions()).toEqual(expected);
      }),
    );
  });

  it('mutating a lock after fromOptions does not change the builder', () => {
    fc.assert(
      fc.property(lockRecipe, fc.boolean(), (r, nutroot) => {
        const lock = (nutroot ? nutrootBuilder(r) : p2pkBuilder(r)).toOptions();
        const b = LockBuilder.fromOptions(lock);
        const expected = snapshot(b.toOptions());
        scribble(lock);
        expect(b.toOptions()).toEqual(expected);
      }),
    );
  });
});

describe('PaymentRequest', () => {
  it('mutating the output of toRawRequest does not change the request', () => {
    fc.assert(
      fc.property(creqAOptions, (o) => {
        const request = new PaymentRequest(structuredClone(o));
        const expected = request.toEncodedCreqA();
        scribble(request.toRawRequest());
        expect(request.toEncodedCreqA()).toBe(expected);
      }),
    );
  });

  const transport: fc.Arbitrary<PaymentRequestTransport> = fc.record({
    type: fc.constant(PaymentRequestTransportType.POST),
    target: text,
    tags: fc.array(fc.array(text, { minLength: 1, maxLength: 2 }), { minLength: 1, maxLength: 2 }),
  });

  const requestRecipe = fc.record({
    mints: fc.uniqueArray(
      hex(1, 4).map((h) => `https://m${h}.example`),
      { minLength: 1, maxLength: 2 },
    ),
    transport,
    methods: fc.uniqueArray(text, { minLength: 1, maxLength: 2 }),
    lock: lockRecipe,
  });

  type RequestRecipe = typeof requestRecipe extends fc.Arbitrary<infer T> ? T : never;

  function requestBuilder(r: RequestRecipe): PaymentRequestBuilder {
    const b = PaymentRequest.builder()
      .unit('sat')
      .addMint(r.mints)
      .addTransport(r.transport)
      .lock(new LockBuilder().addMainPubkey(r.lock.main));
    for (const m of r.methods) b.addSupportedMethod(m, 1);
    return b;
  }

  const fields: Array<keyof PaymentRequest> = ['mints', 'supportedMethods', 'transport', 'nut10'];

  for (const field of fields) {
    it(`mutating the built ${field} does not change a later build`, () => {
      fc.assert(
        fc.property(requestRecipe, (generated) => {
          const b = requestBuilder(structuredClone(generated));
          const first = b.build();
          const expected = first.toEncodedCreqA();
          scribble(first[field]);
          expect(b.build().toEncodedCreqA()).toBe(expected);
        }),
      );
    });
  }

  it('mutating a transport after addTransport does not change the built request', () => {
    fc.assert(
      fc.property(requestRecipe, (generated) => {
        const r = structuredClone(generated);
        const b = requestBuilder(r);
        const expected = b.build().toEncodedCreqA();
        scribble(r.transport);
        expect(b.build().toEncodedCreqA()).toBe(expected);
      }),
    );
  });

  it('mutating the mint list after addMint does not change the built request', () => {
    fc.assert(
      fc.property(requestRecipe, (generated) => {
        const r = structuredClone(generated);
        const b = requestBuilder(r);
        const expected = b.build().toEncodedCreqA();
        scribble(r.mints);
        expect(b.build().toEncodedCreqA()).toBe(expected);
      }),
    );
  });
});

describe('seed derivation', () => {
  const seed = fc.uint8Array({ minLength: 64, maxLength: 64 });
  const counter = fc.integer({ min: 0, max: 1_000 });

  const legacyIds = fc.oneof(
    hex(7).map((h) => '00' + h),
    fc.base64String({ minLength: 12, maxLength: 12 }),
  );
  const hmacIds = fc.oneof(
    hex(32).map((h) => '01' + h),
    hex(32).map((h) => '02' + h),
  );

  function expectDeriverIgnoresSeedWrites(pristine: Uint8Array, id: string, c: number): void {
    const s = pristine.slice();
    const derive = createSecretAndBlindingFactorDeriver(s, id);
    scribble(s);
    scribble(derive(c).secret);
    expect(derive(c)).toEqual(createSecretAndBlindingFactorDeriver(pristine, id)(c));
  }

  it('a legacy-keyset deriver ignores later writes to its seed and outputs', () => {
    fc.assert(
      fc.property(seed, legacyIds, counter, (s, id, c) => expectDeriverIgnoresSeedWrites(s, id, c)),
      { numRuns: runs(8) },
    );
  });

  it('an HMAC-keyset deriver ignores later writes to its seed and outputs', () => {
    fc.assert(
      fc.property(seed, hmacIds, counter, (s, id, c) => expectDeriverIgnoresSeedWrites(s, id, c)),
      { numRuns: runs(15) },
    );
  });

  it('a keypair deriver ignores later writes to its seed', () => {
    fc.assert(
      fc.property(seed, counter, fc.constantFrom('P2PK', 'QuoteLock'), (pristine, c, purpose) => {
        const s = pristine.slice();
        const derive = createKeyPairDeriver(s, purpose);
        scribble(s);
        expect(derive(c)).toEqual(createKeyPairDeriver(pristine, purpose)(c));
      }),
      { numRuns: runs(15) },
    );
  });

  it('a wallet ignores later writes to the seed it was given', async () => {
    const cache = KeyChain.mintToCacheDTO(mintUrl, [DUMMY_TEST_KEYSET], [DUMMY_TEST_KEYS]);
    function seeded(bip39seed: Uint8Array): Wallet {
      const wallet = new Wallet(mintUrl, { unit: 'sat', bip39seed });
      wallet.loadMintFromCache(mintInfoResp, cache);
      return wallet;
    }
    await fc.assert(
      fc.asyncProperty(seed, async (pristine) => {
        const s = pristine.slice();
        const reference = seeded(pristine);
        const wallet = seeded(s);
        scribble(s);
        expect(await wallet.createQuoteLockKey()).toEqual(await reference.createQuoteLockKey());
      }),
      { numRuns: runs(10) },
    );
  });
});
