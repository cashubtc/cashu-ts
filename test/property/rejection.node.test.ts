import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  Amount,
  AmountWithUnit,
  KeyChain,
  PaymentRequest,
  computeMessageDigest,
  getDecodedToken,
  getDecodedTokenBinary,
  getEncodedTokenBinary,
  verifyReceivedProofs,
  type Proof,
  type Token,
} from '../../src';
import { decodeCBOR, encodeCBOR, encodeUint8ToBase64Url } from '../../src/utils';
import { encodeBech32m } from '../../src/utils/bech32m';
import { U64_MAX } from '../../src/utils/limits';
import { DUMMY_TEST_KEYS, DUMMY_TEST_KEYSET } from '../consts';
import { mintUrl } from '../wallet/_setup';

import {
  creqAOptions,
  creqBOptions,
  expectValidOrRejected,
  expectValidOrRejectedAsync,
  hex,
  hostile,
  mutated,
  text,
  token,
} from './arbitraries';

function expectAmount(a: unknown): void {
  expect(a).toBeInstanceOf(Amount);
  const v = (a as Amount).toBigInt();
  expect(typeof v).toBe('bigint');
  expect(v >= 0n && v <= U64_MAX).toBe(true);
}

function expectOptional(v: unknown, type: string): void {
  if (v !== undefined) expect(typeof v).toBe(type);
}

function expectStrings(v: unknown): void {
  expect(Array.isArray(v)).toBe(true);
  for (const s of v as unknown[]) expect(typeof s).toBe('string');
}

function expectWellFormedProof(p: Proof): void {
  expect(typeof p.id).toBe('string');
  expect(typeof p.secret).toBe('string');
  expect(typeof p.C).toBe('string');
  expectAmount(p.amount);
  if (p.dleq !== undefined) {
    for (const k of ['e', 's', 'r'] as const) expect(typeof p.dleq[k]).toBe('string');
  }
  expectOptional(p.p2pk_e, 'string');
  // The Proof type allows a witness as JSON text or parsed.
  if (p.witness !== undefined) expect(['string', 'object']).toContain(typeof p.witness);
  if (p.spend_info !== undefined) {
    const { tree, ...keys } = p.spend_info;
    for (const v of Object.values(keys)) expect(typeof v).toBe('string');
    if (tree !== undefined) expectStrings(tree);
  }
}

function expectWellFormedToken(t: Token): void {
  expect(typeof t.mint).toBe('string');
  expectOptional(t.unit, 'string');
  expectOptional(t.memo, 'string');
  expect(Array.isArray(t.proofs)).toBe(true);
  t.proofs.forEach(expectWellFormedProof);
}

function expectWellFormedRequest(r: PaymentRequest): void {
  expect(r).toBeInstanceOf(PaymentRequest);
  for (const k of ['id', 'unit', 'description'] as const) expectOptional(r[k], 'string');
  for (const k of ['singleUse', 'mintsPreferred'] as const) expectOptional(r[k], 'boolean');
  if (r.amount !== undefined) expectAmount(r.amount);
  if (r.mints !== undefined) expectStrings(r.mints);
  for (const t of r.transport ?? []) {
    expect(typeof t.type).toBe('string');
    expect(typeof t.target).toBe('string');
    (t.tags ?? []).forEach(expectStrings);
  }
  if (r.nut10 !== undefined) {
    expect(typeof r.nut10.kind).toBe('string');
    expect(typeof r.nut10.data).toBe('string');
    (r.nut10.tags ?? []).forEach(expectStrings);
  }
  for (const m of r.supportedMethods ?? []) {
    expect(typeof m.method).toBe('string');
    if (m.fee !== undefined) expectAmount(m.fee);
  }
  if (r.nutroot !== undefined) {
    expect(typeof r.nutroot.receiverKey).toBe('string');
    if (r.nutroot.leaves !== undefined) expectStrings(r.nutroot.leaves);
    if (r.nutroot.blindKeys !== undefined) expectStrings(r.nutroot.blindKeys);
  }
}

// Mutated wire payloads that still encode, so the decoder is what has to cope.
function encodable<T>(arb: fc.Arbitrary<unknown>, encode: (v: unknown) => T): fc.Arbitrary<T> {
  return arb
    .map((v) => {
      try {
        return { ok: encode(v) };
      } catch {
        return undefined;
      }
    })
    .filter((r): r is { ok: T } => r !== undefined)
    .map((r) => r.ok);
}

const keysetIdsOf = token.map((t) => t.keysetIds);

const cashuB = token.chain(({ token, keysetIds }) => {
  const template = decodeCBOR(getEncodedTokenBinary(token).slice(5));
  return fc.tuple(
    encodable(mutated(template), (v) => 'cashuB' + encodeUint8ToBase64Url(encodeCBOR(v))),
    fc.constant(keysetIds),
  );
});

const crawB = token.chain(({ token, keysetIds }) => {
  const template = decodeCBOR(getEncodedTokenBinary(token).slice(5));
  const magic = getEncodedTokenBinary(token).slice(0, 5);
  return fc.tuple(
    encodable(mutated(template), (v) => new Uint8Array([...magic, ...encodeCBOR(v)])),
    fc.constant(keysetIds),
  );
});

// v3 JSON tokens only carry short (v0) and legacy keyset ids.
const cashuA = token
  .filter(({ keysetIds }) => keysetIds.every((id) => id.startsWith('00')))
  .chain(({ token, keysetIds }) => {
    const template = {
      token: [
        {
          mint: token.mint,
          proofs: token.proofs.map((p) => ({ ...p, amount: p.amount.toString() })),
        },
      ],
      unit: token.unit,
    };
    const toWire = (v: unknown) =>
      'cashuA' + encodeUint8ToBase64Url(new TextEncoder().encode(JSON.stringify(v)));
    return fc.tuple(encodable(mutated(template), toWire), fc.constant(keysetIds));
  });

describe('Amount', () => {
  it('Amount.from returns a valid amount or rejects', () => {
    fc.assert(
      fc.property(hostile, (v) => {
        expectValidOrRejected(() => Amount.from(v as never), expectAmount);
      }),
    );
  });

  it('the Amount constructor builds a valid amount or rejects', () => {
    const AmountCtor = Amount as unknown as new (v: unknown) => Amount;
    fc.assert(
      fc.property(hostile, (v) => {
        expectValidOrRejected(() => new AmountCtor(v), expectAmount);
      }),
    );
  });

  it('the AmountWithUnit constructor builds a valid amount or rejects', () => {
    fc.assert(
      fc.property(hostile, text, (v, unit) => {
        expectValidOrRejected(
          () => new AmountWithUnit(v as Amount, unit),
          (a) => expectAmount(a.toAmount()),
        );
      }),
    );
  });
});

const notString = hostile.filter((v) => typeof v !== 'string');
function prefixed(...prefixes: string[]): fc.Arbitrary<string> {
  return fc.constantFrom(...prefixes).chain((p) => fc.string().map((s) => p + s));
}

const anyString = fc.oneof(fc.string({ unit: 'binary' }), prefixed('cashuB', 'creqA'));

describe('token decoders', () => {
  it('getDecodedToken returns a well-formed token or rejects any string', () => {
    fc.assert(
      fc.property(anyString, keysetIdsOf, (v, ids) => {
        expectValidOrRejected(() => getDecodedToken(v, ids), expectWellFormedToken);
      }),
    );
  });

  it('getDecodedToken returns a well-formed token or rejects any cashuA string', () => {
    fc.assert(
      fc.property(prefixed('cashuA'), keysetIdsOf, (v, ids) => {
        expectValidOrRejected(() => getDecodedToken(v, ids), expectWellFormedToken);
      }),
    );
  });

  it('getDecodedToken rejects a value that is not a string', () => {
    fc.assert(
      fc.property(notString, keysetIdsOf, (v, ids) => {
        expectValidOrRejected(() => getDecodedToken(v as string, ids), expectWellFormedToken);
      }),
    );
  });

  it('getDecodedToken returns a well-formed token or rejects a mutated cashuB token', () => {
    fc.assert(
      fc.property(cashuB, ([encoded, ids]) => {
        expectValidOrRejected(() => getDecodedToken(encoded, ids), expectWellFormedToken);
      }),
    );
  });

  it('getDecodedToken returns a well-formed token or rejects a mutated cashuA token', () => {
    fc.assert(
      fc.property(cashuA, ([encoded, ids]) => {
        expectValidOrRejected(() => getDecodedToken(encoded, ids), expectWellFormedToken);
      }),
    );
  });

  it('getDecodedTokenBinary returns a well-formed token or rejects any value', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          hostile,
          crawB.map(([b]) => b),
        ),
        keysetIdsOf,
        (v, ids) => {
          expectValidOrRejected(
            () => getDecodedTokenBinary(v as Uint8Array, ids),
            expectWellFormedToken,
          );
        },
      ),
    );
  });
});

describe('payment request decoders', () => {
  const creqA = creqAOptions.chain((o) => {
    const raw = decodeCBOR(encodeCBOR(new PaymentRequest(o).toRawRequest()));
    return encodable(mutated(raw), (v) => 'creqA' + encodeUint8ToBase64Url(encodeCBOR(v)));
  });
  const creqB = fc
    .uint8Array({ maxLength: 200 })
    .map((b) => encodeBech32m('creqb', b).toUpperCase());

  it('fromEncodedRequest returns a well-formed request or rejects any string', () => {
    fc.assert(
      fc.property(fc.oneof(anyString, creqB), (v) => {
        expectValidOrRejected(() => PaymentRequest.fromEncodedRequest(v), expectWellFormedRequest);
      }),
    );
  });

  it('fromEncodedRequest returns a well-formed request or rejects any creqB string', () => {
    fc.assert(
      fc.property(prefixed('creqb1'), (v) => {
        expectValidOrRejected(() => PaymentRequest.fromEncodedRequest(v), expectWellFormedRequest);
      }),
    );
  });

  it('fromEncodedRequest rejects a value that is not a string', () => {
    fc.assert(
      fc.property(notString, (v) => {
        expectValidOrRejected(
          () => PaymentRequest.fromEncodedRequest(v as string),
          expectWellFormedRequest,
        );
      }),
    );
  });

  it('fromEncodedRequest returns a well-formed request or rejects a mutated creqA request', () => {
    fc.assert(
      fc.property(creqA, (encoded) => {
        expectValidOrRejected(
          () => PaymentRequest.fromEncodedRequest(encoded),
          expectWellFormedRequest,
        );
      }),
    );
  });

  it('toEncodedCreqB encodes or rejects a request of any size', () => {
    fc.assert(
      fc.property(creqBOptions, (o) => {
        expectValidOrRejected(
          () => new PaymentRequest(o).toEncodedCreqB(),
          (s) => expect(typeof s).toBe('string'),
        );
      }),
    );
  });
});

describe('message digest', () => {
  it('computeMessageDigest hashes any well-formed string and rejects the rest', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (v) => {
        expectValidOrRejected(
          () => computeMessageDigest(v),
          (digest) => expect(digest).toHaveLength(32),
        );
      }),
    );
  });

  it('computeMessageDigest rejects a value that is not a string', () => {
    fc.assert(
      fc.property(notString, (v) => {
        expectValidOrRejected(
          () => computeMessageDigest(v as string),
          (digest) => expect(digest).toBeUndefined(),
        );
      }),
    );
  });
});

describe('verifyReceivedProofs', () => {
  const keyChain = KeyChain.fromCache(
    mintUrl,
    'sat',
    KeyChain.mintToCacheDTO(mintUrl, [DUMMY_TEST_KEYSET], [DUMMY_TEST_KEYS]),
  );
  const unsigned = fc.record({
    id: fc.constant(DUMMY_TEST_KEYSET.id),
    amount: fc.constantFrom(1, 2),
    secret: text,
    C: hex(33),
  });

  function verifyOne(p: unknown) {
    return verifyReceivedProofs([p as Proof], (id) => keyChain.getKeyset(id));
  }

  it('verifyReceivedProofs settles or rejects a proof with one hostile field', async () => {
    await fc.assert(
      fc.asyncProperty(unsigned.chain(mutated), async (p) => {
        await expectValidOrRejectedAsync(
          () => verifyOne(p),
          ({ valid, invalid }) => expect(valid.length + invalid.length).toBe(1),
        );
      }),
    );
  });

  it('every proof verifyReceivedProofs reports valid is a well-formed proof', async () => {
    await fc.assert(
      fc.asyncProperty(unsigned.chain(mutated), async (p) => {
        const result = await verifyOne(p).catch(() => undefined);
        fc.pre(result !== undefined);
        // Results are the caller's own objects, so amounts keep their input form.
        for (const proof of result.valid) {
          expectWellFormedProof({ ...proof, amount: Amount.from(proof.amount) });
        }
      }),
    );
  });
});
