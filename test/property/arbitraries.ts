import * as fc from 'fast-check';
import { expect } from 'vitest';

import {
  Amount,
  CTSError,
  PaymentRequestTransportType,
  bytesToHex,
  type PaymentRequestOptions,
  type PaymentRequestTransport,
  type Proof,
  type Token,
} from '../../src';
import { U64_MAX } from '../../src/utils/limits';
import { encodeNprofile } from '../../src/utils/tlv';

const { PROPERTY_RUNS, PROPERTY_SEED, PROPERTY_PATH } = process.env;
const runsOverride = Number(PROPERTY_RUNS) || undefined;
fc.configureGlobal({
  ...(runsOverride && { numRuns: runsOverride }),
  ...(PROPERTY_SEED && { seed: Number(PROPERTY_SEED), path: PROPERTY_PATH }),
});

/**
 * Run count for a property that needs fewer than fast-check's default to fit the CI budget.
 *
 * @remarks
 * `PROPERTY_RUNS` overrides every property's count, as the nightly workflow does. `PROPERTY_SEED`
 * and `PROPERTY_PATH` replay a reported failure; pick the test with `-t`.
 */
export function runs(n: number): number {
  return runsOverride ?? n;
}

export function hex(minBytes: number, maxBytes = minBytes): fc.Arbitrary<string> {
  return fc.uint8Array({ minLength: minBytes, maxLength: maxBytes }).map(bytesToHex);
}

// Well-formed Unicode: protocol text fields are UTF-8 on the wire.
export const text = fc.string({ unit: 'grapheme', minLength: 1, maxLength: 12 });

export const amount = fc.bigInt({ min: 0n, max: U64_MAX }).map((a) => Amount.from(a));

// Modern keyset ids: v0 short (00, 8 bytes) and full-length v1/v3 (01/02, 33 bytes).
export const keysetId = fc.oneof(
  hex(7).map((h) => '00' + h),
  hex(32).map((h) => '01' + h),
  hex(32).map((h) => '02' + h),
);

const witness = fc.oneof(
  text,
  fc.record({ signatures: fc.array(hex(64)) }, { requiredKeys: [] }),
  fc.record({ preimage: hex(32), signatures: fc.array(hex(64)) }, { requiredKeys: ['preimage'] }),
);

export function proof(id: fc.Arbitrary<string>, amounts = amount): fc.Arbitrary<Proof> {
  return fc.record(
    {
      id,
      amount: amounts,
      secret: text,
      C: hex(33),
      dleq: fc.record({ e: hex(32), s: hex(32), r: hex(32) }),
      p2pk_e: hex(33),
      witness,
      spend_info: fc.record(
        { k: hex(32), E: hex(33), K: hex(33), u: hex(32), tree: fc.array(hex(1, 40)) },
        { requiredKeys: [] },
      ),
    },
    { requiredKeys: ['id', 'amount', 'secret', 'C'] },
  );
}

/**
 * Tokens with distinct secrets and keyset ids that stay distinct when shortened to 8 bytes.
 */
export const token: fc.Arbitrary<{ token: Token; keysetIds: string[] }> = fc
  .uniqueArray(keysetId, { minLength: 1, maxLength: 3, selector: (id) => id.slice(0, 16) })
  .chain((keysetIds) =>
    fc.record({
      keysetIds: fc.constant(keysetIds),
      token: fc.record(
        {
          mint: text,
          unit: text,
          memo: text,
          proofs: fc.uniqueArray(proof(fc.constantFrom(...keysetIds)), {
            maxLength: 5,
            selector: (p) => p.secret,
          }),
        },
        { requiredKeys: ['mint', 'unit', 'proofs'] },
      ),
    }),
  );

const tagTuples = fc.array(fc.array(text, { maxLength: 3 }), { minLength: 1, maxLength: 3 });

function nonEmpty<T>(arb: fc.Arbitrary<T>): fc.Arbitrary<T[]> {
  return fc.array(arb, { minLength: 1, maxLength: 3 });
}

// Empty nutroot lists mean the same as absent ones and are not encoded.
const nutroot = fc.record(
  { receiverKey: hex(33), leaves: nonEmpty(hex(1, 40)), blindKeys: nonEmpty(hex(33)) },
  { requiredKeys: ['receiverKey'] },
);

const supportedMethod = fc.record(
  { method: text, fee: fc.bigInt({ min: 0n, max: U64_MAX }) },
  { requiredKeys: ['method'] },
);

/**
 * Payment request options for creqA (CBOR), which can carry any string kind and empty tag lists.
 */
export const creqAOptions: fc.Arbitrary<PaymentRequestOptions> = fc.record(
  {
    id: text,
    amount: fc.bigInt({ min: 0n, max: U64_MAX }),
    unit: text,
    mints: fc.array(text, { maxLength: 3 }),
    description: text,
    transport: fc.array(
      fc.record(
        {
          type: fc.constantFrom(
            PaymentRequestTransportType.NOSTR,
            PaymentRequestTransportType.POST,
          ),
          target: text,
          tags: fc.array(fc.array(text, { maxLength: 3 }), { maxLength: 3 }),
        },
        { requiredKeys: ['type', 'target'] },
      ),
      { maxLength: 3 },
    ),
    singleUse: fc.boolean(),
    nut10: fc.record(
      {
        kind: text,
        data: text,
        tags: fc.array(fc.array(text, { maxLength: 3 }), { maxLength: 3 }),
      },
      { requiredKeys: ['kind', 'data'] },
    ),
    mintsPreferred: fc.boolean(),
    supportedMethods: nonEmpty(supportedMethod),
    nutroot,
  },
  { requiredKeys: ['unit'] },
);

// A nostr target is an nprofile; NUT-26 carries its relays as `r` tags, so other tags avoid that key.
const nostrTransport: fc.Arbitrary<PaymentRequestTransport> = fc.record(
  {
    type: fc.constant(PaymentRequestTransportType.NOSTR),
    target: fc
      .tuple(fc.uint8Array({ minLength: 32, maxLength: 32 }), fc.array(text, { maxLength: 2 }))
      .map(([pubkey, relays]) => encodeNprofile(pubkey, relays)),
    tags: tagTuples.filter((tags) => tags.every((t) => t[0] !== 'r')),
  },
  { requiredKeys: ['type', 'target'] },
);

const postTransport: fc.Arbitrary<PaymentRequestTransport> = fc.record(
  { type: fc.constant(PaymentRequestTransportType.POST), target: text, tags: tagTuples },
  { requiredKeys: ['type', 'target'] },
);

/**
 * Payment request options in the domain creqB (TLV) can represent.
 */
export const creqBOptions: fc.Arbitrary<PaymentRequestOptions> = fc.record(
  {
    id: text,
    amount: fc.bigInt({ min: 0n, max: U64_MAX }),
    // A lone NUL byte is the wire form of 'sat'.
    unit: text.filter((u) => u !== '\u0000'),
    mints: nonEmpty(text),
    description: text,
    transport: nonEmpty(fc.oneof(nostrTransport, postTransport)),
    singleUse: fc.boolean(),
    // Unknown kinds travel as their decimal byte; 0 and 1 are P2PK and HTLC.
    nut10: fc.record({
      kind: fc.oneof(fc.constantFrom('P2PK', 'HTLC'), fc.integer({ min: 2, max: 255 }).map(String)),
      data: text,
      tags: fc.array(fc.array(text, { maxLength: 3 }), { maxLength: 3 }),
    }),
    mintsPreferred: fc.boolean(),
    supportedMethods: nonEmpty(supportedMethod),
    nutroot,
  },
  { requiredKeys: ['unit'] },
);

/**
 * Values a JS caller or a counterparty can hand a public function in place of the declared type.
 */
export const hostile: fc.Arbitrary<unknown> = fc.oneof(
  fc.anything({
    withBigInt: true,
    withBoxedValues: true,
    withDate: true,
    withMap: true,
    withNullPrototype: true,
    withObjectString: true,
    withSet: true,
    withSparseArray: true,
    withTypedArray: true,
  }),
  fc.string({ unit: 'binary' }),
  fc.double(),
  fc.bigInt(),
  fc.constantFrom(
    NaN,
    Infinity,
    -Infinity,
    -0,
    -1,
    0.5,
    Number.MAX_VALUE,
    Number.MAX_SAFE_INTEGER + 1,
    -(2n ** 64n),
    2n ** 64n,
    '',
    ' 1',
    '1e3',
    '0x10',
    '-0',
  ),
);

/**
 * Replaces the value at one path inside a JSON-like tree, leaving the input untouched.
 */
export function replaceAt(tree: unknown, path: Array<string | number>, value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  const copy = (Array.isArray(tree) ? [...(tree as unknown[])] : { ...(tree as object) }) as Record<
    string | number,
    unknown
  >;
  copy[head] = replaceAt(copy[head], rest, value);
  return copy;
}

/**
 * Removes the key at one path inside a JSON-like tree, leaving the input untouched.
 */
export function removeAt(tree: unknown, path: Array<string | number>): unknown {
  const [head, ...rest] = path;
  const copy = (Array.isArray(tree) ? [...(tree as unknown[])] : { ...(tree as object) }) as Record<
    string | number,
    unknown
  >;
  if (rest.length === 0) delete copy[head];
  else copy[head] = removeAt(copy[head], rest);
  return copy;
}

/**
 * Every path in a tree that matches a pattern of keys, where `*` is any key or index.
 */
export function expand(tree: unknown, pattern: string[]): Array<Array<string | number>> {
  if (pattern.length === 0) return [[]];
  if (typeof tree !== 'object' || tree === null) return [];
  const [head, ...rest] = pattern;
  const keys =
    head === '*' ? Object.keys(tree).map((k) => (Array.isArray(tree) ? Number(k) : k)) : [head];
  return keys.flatMap((k) =>
    k in tree
      ? expand((tree as Record<string | number, unknown>)[k], rest).map((p) => [k, ...p])
      : [],
  );
}

/**
 * Every path to a value inside a JSON-like tree, the root included.
 */
export function pathsOf(tree: unknown): Array<Array<string | number>> {
  const out: Array<Array<string | number>> = [[]];
  if (tree instanceof Uint8Array || typeof tree !== 'object' || tree === null) return out;
  for (const [k, v] of Object.entries(tree)) {
    const key = Array.isArray(tree) ? Number(k) : k;
    for (const p of pathsOf(v)) out.push([key, ...p]);
  }
  return out;
}

/**
 * Picks one path of a template and swaps a hostile value in.
 */
export function mutated(template: unknown): fc.Arbitrary<unknown> {
  const paths = pathsOf(template);
  return fc
    .tuple(fc.integer({ min: 0, max: paths.length - 1 }), hostile)
    .map(([i, v]) => replaceAt(template, paths[i], v));
}

/**
 * The rejection rule for untrusted input: a CTSError, or a plain Error from a dependency that says
 * why. A TypeError or RangeError means a value reached code that never checked it.
 */
export function isLibraryError(e: unknown): boolean {
  if (e instanceof CTSError) return true;
  return e instanceof Error && e.constructor === Error && e.message.length > 0;
}

/**
 * Asserts `fn` either returns a value `check` accepts or throws per {@link isLibraryError}.
 */
export function expectValidOrRejected<T>(fn: () => T, check: (value: T) => void): void {
  let value: T;
  try {
    value = fn();
  } catch (e) {
    expect(isLibraryError(e), `unexpected ${String(e)}`).toBe(true);
    return;
  }
  check(value);
}

/**
 * Async form of {@link expectValidOrRejected}.
 */
export async function expectValidOrRejectedAsync<T>(
  fn: () => Promise<T>,
  check: (value: T) => void,
): Promise<void> {
  let value: T;
  try {
    value = await fn();
  } catch (e) {
    expect(isLibraryError(e), `unexpected ${String(e)}`).toBe(true);
    return;
  }
  check(value);
}
