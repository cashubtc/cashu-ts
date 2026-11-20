import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/curves/utils.js';
import { bech32m } from '@scure/base';
import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  HttpResponseError,
  Keyset,
  OutputData,
  PaymentRequest,
  deriveKeysetId,
  deserializeSwapPreview,
  type Keys,
  type MintKeys,
  type Secret,
  type SerializedProof,
} from '../src';
import {
  getP2PKExpectedWitnessPubkeys,
  getP2PKWitnessSignatures,
  parseP2PKSecret,
  parseSecret,
} from '../src/crypto';
import { NULL_LOGGER } from '../src/logger';
import request, { setRequestLogger } from '../src/transport';
import {
  ABSOLUTE_MAX_ARRAY_LENGTH,
  DEFAULT_MAX_RESPONSE_BYTES,
  MAX_KEYSET_DENOMINATIONS,
  MAX_P2PK_PUBKEYS,
  MAX_SECRET_LENGTH,
  MAX_WITNESS_LENGTH,
  decodeCBOR,
} from '../src/utils';
import { encodeTLV } from '../src/utils/tlv';

// Not exported: MAX_CBOR_DEPTH in src/utils/cbor.ts and LIMIT_LENGTH in src/utils/bech32m.ts.
const CBOR_MAX_DEPTH = 64;
const CREQB_MAX_LENGTH = 1023;

const KEYS = Array.from({ length: MAX_P2PK_PUBKEYS + 2 }, (_, i) => pubkeyOf(i + 1));
const DATA_KEY = KEYS[0];
const SIGNERS = KEYS.slice(1);

function pubkeyOf(scalar: number): string {
  const sk = new Uint8Array(32);
  sk[31] = scalar;
  return bytesToHex(secp256k1.getPublicKey(sk, true));
}

function p2pkSecretOfLength(length: number): string {
  const shell = `["P2PK",{"nonce":"","data":"${DATA_KEY}"}]`;
  return shell.replace('"nonce":""', `"nonce":"${'a'.repeat(length - shell.length)}"`);
}

function paymentPayloadWithProofs(count: number): string {
  const proof = { id: '00bd033559de27d0', amount: 1, secret: 's', C: '02'.padEnd(66, '0') };
  return JSON.stringify({
    mint: 'http://localhost:3338',
    unit: 'sat',
    proofs: Array(count).fill(proof),
  });
}

// Pads a tag so the created secret is exactly `length` bytes.
function createdP2pkSecretOfLength(length: number): OutputData {
  const build = (pad: number) =>
    OutputData.createSingleP2PKData(
      { kind: 'P2PK', data: DATA_KEY, additionalTags: [['x', 'a'.repeat(pad)]] },
      1,
      '00bd033559de27d0',
    );
  return build(length - build(1).secret.length + 1);
}

function swapPreviewWithInputs(count: number) {
  const proof: SerializedProof = { id: '00bd033559de27d0', amount: '1', secret: 's', C: 'C' };
  return { amount: '0', fees: '0', inputs: new Array<SerializedProof>(count).fill(proof) };
}

function witnessOfLength(length: number): string {
  const shell = '{"padding":"","signatures":[]}';
  return shell.replace('"padding":""', `"padding":"${'a'.repeat(length - shell.length)}"`);
}

function lockedTo(tag: 'pubkeys' | 'refund', count: number): Secret {
  return [
    'P2PK',
    {
      nonce: 'a',
      data: DATA_KEY,
      tags: [
        ['locktime', '1'],
        [tag, ...SIGNERS.slice(0, count)],
      ],
    },
  ];
}

function nestedCbor(depth: number): Uint8Array {
  // 0x81 opens a one-item array; 0x00 is the innermost item.
  const bytes = new Uint8Array(depth + 1);
  bytes.fill(0x81, 0, depth);
  return bytes;
}

function creqbWithDescription(length: number): string {
  return bech32m.encode(
    'creqb',
    bech32m.toWords(encodeTLV({ description: 'a'.repeat(length) })),
    false,
  );
}

// Longest creqB the decoder accepts and the next byte up: byte-aligned data skips 1023 itself.
function creqbAroundLimit(): { within: string; over: string } {
  let length = 0;
  while (creqbWithDescription(length + 1).length <= CREQB_MAX_LENGTH) length++;
  return { within: creqbWithDescription(length), over: creqbWithDescription(length + 1) };
}

function keysetOf(count: number): MintKeys {
  const keys: Keys = {};
  for (let i = 0; i < count; i++)
    keys[String(i + 1)] = '02' + (i + 1).toString(16).padStart(64, '0');
  return { id: deriveKeysetId(keys, { versionByte: 0 }), unit: 'sat', active: true, keys };
}

type Bound = {
  name: string;
  atLimit: () => unknown;
  overLimit: () => unknown;
  error: RegExp;
};

const creqb = creqbAroundLimit();

const bounds: Bound[] = [
  {
    name: 'a serialized P2PK secret',
    atLimit: () => parseP2PKSecret(p2pkSecretOfLength(MAX_SECRET_LENGTH)),
    overLimit: () => parseP2PKSecret(p2pkSecretOfLength(MAX_SECRET_LENGTH + 1)),
    error: /Secret too long/,
  },
  {
    name: 'a serialized NUT-10 secret of another kind',
    atLimit: () => parseSecret(p2pkSecretOfLength(MAX_SECRET_LENGTH).replace('P2PK', 'XYZW')),
    overLimit: () => parseSecret(p2pkSecretOfLength(MAX_SECRET_LENGTH + 1).replace('P2PK', 'XYZW')),
    error: /Secret too long/,
  },
  {
    name: 'a created P2PK secret',
    atLimit: () => createdP2pkSecretOfLength(MAX_SECRET_LENGTH),
    overLimit: () => createdP2pkSecretOfLength(MAX_SECRET_LENGTH + 1),
    error: /Secret too long/,
  },
  {
    name: 'the proofs in a payment payload',
    atLimit: () =>
      PaymentRequest.decodePayload(paymentPayloadWithProofs(ABSOLUTE_MAX_ARRAY_LENGTH)),
    overLimit: () =>
      PaymentRequest.decodePayload(paymentPayloadWithProofs(ABSOLUTE_MAX_ARRAY_LENGTH + 1)),
    error: /too many proofs/,
  },
  {
    name: 'the inputs of a saved swap preview',
    atLimit: () => deserializeSwapPreview(swapPreviewWithInputs(ABSOLUTE_MAX_ARRAY_LENGTH)),
    overLimit: () => deserializeSwapPreview(swapPreviewWithInputs(ABSOLUTE_MAX_ARRAY_LENGTH + 1)),
    error: /too many inputs/,
  },
  {
    name: 'a serialized witness',
    atLimit: () => getP2PKWitnessSignatures(witnessOfLength(MAX_WITNESS_LENGTH)),
    overLimit: () => getP2PKWitnessSignatures(witnessOfLength(MAX_WITNESS_LENGTH + 1)),
    error: /Witness too long/,
  },
  {
    name: 'a pubkeys tag',
    atLimit: () => getP2PKExpectedWitnessPubkeys(lockedTo('pubkeys', MAX_P2PK_PUBKEYS)),
    overLimit: () => getP2PKExpectedWitnessPubkeys(lockedTo('pubkeys', MAX_P2PK_PUBKEYS + 1)),
    error: /Too many pubkeys/,
  },
  {
    name: 'a refund tag',
    atLimit: () => getP2PKExpectedWitnessPubkeys(lockedTo('refund', MAX_P2PK_PUBKEYS)),
    overLimit: () => getP2PKExpectedWitnessPubkeys(lockedTo('refund', MAX_P2PK_PUBKEYS + 1)),
    error: /Too many refund pubkeys/,
  },
  {
    name: 'CBOR nesting',
    atLimit: () => decodeCBOR(nestedCbor(CBOR_MAX_DEPTH)),
    overLimit: () => decodeCBOR(nestedCbor(CBOR_MAX_DEPTH + 1)),
    error: /nesting exceeds the maximum depth/,
  },
  {
    name: 'a creqB payment request',
    atLimit: () => PaymentRequest.fromEncodedRequest(creqb.within),
    overLimit: () => PaymentRequest.fromEncodedRequest(creqb.over),
    error: /Invalid bech32m string/,
  },
];

describe('input bounds', () => {
  test.each(bounds)('accepts $name at its limit and rejects one past it', (bound) => {
    expect(bound.atLimit).not.toThrow();
    expect(bound.overLimit).toThrow(bound.error);
  });

  test('verifies a keyset at the denomination cap and refuses one more distinct key', () => {
    expect(Keyset.verifyKeysetId(keysetOf(MAX_KEYSET_DENOMINATIONS))).toBe(true);
    expect(Keyset.verifyKeysetId(keysetOf(MAX_KEYSET_DENOMINATIONS + 1))).toBe(false);
  });

  describe('mint response body', () => {
    afterEach(() => vi.restoreAllMocks());

    function respondWithLength(contentLength: number) {
      setRequestLogger(NULL_LOGGER);
      const headers = {
        'Content-Type': 'application/json',
        'Content-Length': String(contentLength),
      };
      vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { headers }));
    }

    test('accepts a declared length at the default cap', async () => {
      respondWithLength(DEFAULT_MAX_RESPONSE_BYTES);
      await expect(request({ endpoint: 'https://mint.test/v1/info' })).resolves.toEqual({});
    });

    test('rejects a declared length one past the default cap before reading', async () => {
      respondWithLength(DEFAULT_MAX_RESPONSE_BYTES + 1);
      const thrown = await request({ endpoint: 'https://mint.test/v1/info' }).catch((e) => e);
      expect(thrown).toBeInstanceOf(HttpResponseError);
      expect((thrown as Error).message).toMatch(`exceeds ${DEFAULT_MAX_RESPONSE_BYTES} bytes`);
    });
  });
});
