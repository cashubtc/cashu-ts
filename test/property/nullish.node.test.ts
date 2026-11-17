import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  KeyChain,
  PaymentRequest,
  getDecodedToken,
  getEncodedTokenBinary,
  parseSecret,
  verifyReceivedProofs,
  type Proof,
} from '../../src';
import { decodeCBOR, encodeCBOR, encodeUint8ToBase64Url } from '../../src/utils';
import { DUMMY_TEST_KEYS, DUMMY_TEST_KEYSET } from '../consts';
import { mintUrl } from '../wallet/_setup';

import { creqAOptions, expand, hex, removeAt, replaceAt, text, token } from './arbitraries';

type Case = { tree: unknown; decode: (v: unknown) => unknown };

/**
 * Interop rule: a peer that writes an unset optional field as `null` means the same as one that
 * leaves the key out, so both must decode to the same value.
 *
 * @param optional The fields the NUTs mark optional, as `[parent pattern, keys]`.
 */
function nullMeansAbsent<T>(
  format: string,
  optional: Array<[at: string[], keys: string[]]>,
  arb: fc.Arbitrary<T>,
  setup: (value: T) => Case,
): void {
  describe(format, () => {
    for (const [at, keys] of optional) {
      for (const key of keys) {
        const field = [...at, key].join('.');
        it(`reads a null ${field} as absent`, async () => {
          let checked = 0;
          await fc.assert(
            fc.asyncProperty(arb, async (value) => {
              const { tree, decode } = setup(value);
              for (const parent of expand(tree, at)) {
                const path = [...parent, key];
                const absent = await decode(removeAt(tree, path));
                expect(await decode(replaceAt(tree, path, null))).toEqual(absent);
                checked++;
              }
            }),
          );
          expect(checked).toBeGreaterThan(0);
        });
      }
    }
  });
}

const jsonWire = (prefix: string) => (v: unknown) =>
  prefix + encodeUint8ToBase64Url(new TextEncoder().encode(JSON.stringify(v)));
const cborWire = (prefix: string) => (v: unknown) => prefix + encodeUint8ToBase64Url(encodeCBOR(v));

const wireProofs = (proofs: Proof[]) => proofs.map((p) => ({ ...p, amount: p.amount.toString() }));

// NUT-00 witness, NUT-12 dleq, NUT-28 p2pk_e and the nutroot spend info.
const proofFields = ['witness', 'dleq', 'p2pk_e', 'spend_info'];

describe('null means absent', () => {
  nullMeansAbsent(
    'NUT-18 payment payload',
    [
      [[], ['id', 'memo']],
      [['proofs', '*'], proofFields],
    ],
    fc.tuple(
      token.filter((t) => t.token.proofs.length > 0),
      text,
    ),
    ([{ token }, id]) => ({
      tree: { id, mint: token.mint, unit: token.unit, proofs: wireProofs(token.proofs) },
      decode: (v) => PaymentRequest.decodePayload(JSON.stringify(v)),
    }),
  );

  nullMeansAbsent(
    'cashuA token',
    [
      [[], ['unit', 'memo']],
      [['token', '*', 'proofs', '*'], proofFields],
    ],
    token.filter(({ keysetIds }) => keysetIds.every((id) => id.startsWith('00'))),
    ({ token, keysetIds }) => ({
      tree: { token: [{ mint: token.mint, proofs: wireProofs(token.proofs) }], unit: token.unit },
      decode: (v) => getDecodedToken(jsonWire('cashuA')(v), keysetIds),
    }),
  );

  nullMeansAbsent(
    'cashuB token',
    [
      [[], ['d']],
      [
        ['t', '*', 'p', '*'],
        ['w', 'd', 'pe', 'si'],
      ],
    ],
    token,
    ({ token, keysetIds }) => ({
      tree: decodeCBOR(getEncodedTokenBinary(token).slice(5)),
      decode: (v) => getDecodedToken(cborWire('cashuB')(v), keysetIds),
    }),
  );

  nullMeansAbsent(
    'creqA payment request',
    [
      [[], ['i', 'a', 'u', 's', 'm', 'mp', 'sm', 'd', 't', 'nut10', 'nutroot']],
      [['t', '*'], ['g']],
      [['nut10'], ['t']],
      [['sm', '*'], ['mf']],
    ],
    creqAOptions,
    (o) => ({
      tree: decodeCBOR(encodeCBOR(new PaymentRequest(o).toRawRequest())),
      decode: (v) => PaymentRequest.fromEncodedRequest(cborWire('creqA')(v)),
    }),
  );

  nullMeansAbsent(
    'NUT-10 secret',
    [[['1'], ['tags']]],
    fc.tuple(text, hex(32)),
    ([nonce, data]) => ({
      tree: ['P2PK', { nonce, data }],
      decode: (v) => parseSecret(JSON.stringify(v)),
    }),
  );

  const keyChain = KeyChain.fromCache(
    mintUrl,
    'sat',
    KeyChain.mintToCacheDTO(mintUrl, [DUMMY_TEST_KEYSET], [DUMMY_TEST_KEYS]),
  );
  nullMeansAbsent(
    'proof given to verifyReceivedProofs',
    [[[], ['dleq', 'witness', 'p2pk_e']]],
    fc.record({
      id: fc.constant(DUMMY_TEST_KEYSET.id),
      amount: fc.constantFrom(1, 2),
      secret: text,
      C: hex(32).map((x) => '02' + x),
    }),
    (p) => ({
      tree: p,
      decode: async (v) => {
        const r = await verifyReceivedProofs([v as Proof], (id) => keyChain.getKeyset(id));
        return { valid: r.valid.length, errors: r.invalid.map((i) => i.error.message) };
      },
    }),
  );
});
