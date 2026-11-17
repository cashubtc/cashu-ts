import * as fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  Amount,
  OutputData,
  PaymentRequest,
  deserializeMeltPreview,
  deserializeSwapPreview,
  getDecodedToken,
  getDecodedTokenBinary,
  getEncodedToken,
  getEncodedTokenBinary,
  serializeMeltPreview,
  serializeSwapPreview,
  type Proof,
  type Token,
} from '../../src';
import { DUMMY_TEST_KEYSET } from '../consts';

import { amount, creqAOptions, creqBOptions, hex, proof, text, token } from './arbitraries';

// Tokens group proofs by keyset and carry witnesses as JSON text, so compare in that form.
function asTransported(t: Token): Token {
  const proofs = t.proofs.map((p): Proof => {
    if (p.witness === undefined || typeof p.witness === 'string') return p;
    return { ...p, witness: JSON.stringify(p.witness) };
  });
  return { ...t, proofs: bySecret(proofs) };
}

// creqB strings cap at 1023 characters; how oversize requests fail is a rejection property.
function encodeCreqBOrSkip(request: PaymentRequest): string {
  try {
    return request.toEncodedCreqB();
  } catch (e) {
    // Too long for bech32m: scure's message, wrapped or not.
    fc.pre(!`${String(e)} ${String((e as { cause?: unknown }).cause)}`.includes('exceeds limit'));
    throw e;
  }
}

function bySecret(proofs: Proof[]): Proof[] {
  return [...proofs].sort((a, b) => (a.secret < b.secret ? -1 : a.secret > b.secret ? 1 : 0));
}

describe('token round trip', () => {
  it('decoding an encoded token returns the same token', () => {
    fc.assert(
      fc.property(token, ({ token, keysetIds }) => {
        const decoded = getDecodedToken(getEncodedToken(token), keysetIds);
        expect({ ...decoded, proofs: bySecret(decoded.proofs) }).toEqual(asTransported(token));
      }),
    );
  });

  it('decoding a binary token returns the same token', () => {
    fc.assert(
      fc.property(token, ({ token, keysetIds }) => {
        const decoded = getDecodedTokenBinary(getEncodedTokenBinary(token), keysetIds);
        expect({ ...decoded, proofs: bySecret(decoded.proofs) }).toEqual(asTransported(token));
      }),
    );
  });
});

describe('payment request round trip', () => {
  it('decoding an encoded creqA request returns the same request', () => {
    fc.assert(
      fc.property(creqAOptions, (options) => {
        const request = new PaymentRequest(options);
        expect(PaymentRequest.fromEncodedRequest(request.toEncodedCreqA())).toEqual(request);
      }),
    );
  });

  it('decoding an encoded creqA request reads an empty supported-method list as absent', () => {
    fc.assert(
      fc.property(creqAOptions, (options) => {
        const request = new PaymentRequest({ ...options, supportedMethods: [] });
        expect(PaymentRequest.fromEncodedRequest(request.toEncodedCreqA())).toEqual(request);
      }),
    );
  });

  it('decoding an encoded creqB request returns the same request', () => {
    fc.assert(
      fc.property(creqBOptions, (options) => {
        const request = new PaymentRequest(options);
        expect(PaymentRequest.fromEncodedRequest(encodeCreqBOrSkip(request))).toEqual(request);
      }),
    );
  });
});

const outputPool = [1, 2, 2].map((a) => OutputData.createSingleRandomData(a, DUMMY_TEST_KEYSET.id));
const outputs = fc.subarray(outputPool, { maxLength: 2 });
const output = fc.subarray(outputPool, { maxLength: 1 });

const proofs = fc.uniqueArray(proof(hex(7).map((h) => '00' + h)), {
  maxLength: 4,
  selector: (p) => p.secret,
});

const mintPubkey = fc.record({ mintPubkey: hex(33) }, { requiredKeys: [] });

describe('preview round trip', () => {
  it('deserializing a serialized melt preview returns the same preview', () => {
    fc.assert(
      fc.property(
        text,
        fc.record({ quote: text, amount }, { requiredKeys: ['quote'] }),
        proofs,
        outputs,
        mintPubkey,
        (method, quote, inputs, outputData, mintPubkey) => {
          const preview = { method, quote, inputs, outputData, ...mintPubkey };
          const json = JSON.parse(JSON.stringify(serializeMeltPreview(preview)));
          expect(deserializeMeltPreview(json)).toEqual(preview);
        },
      ),
    );
  });

  it('deserializing a serialized swap preview returns the same preview', () => {
    fc.assert(
      fc.property(
        fc.record({ amount, fees: amount, inputs: proofs, send: output, keep: output }),
        mintPubkey,
        ({ amount, fees, inputs, send, keep }, mintPubkey) => {
          const sendTotal = Amount.sum(send.map((o) => o.blindedMessage.amount));
          const preview = {
            amount,
            fees,
            inputs,
            sendTotal,
            sendOutputs: send,
            keepOutputs: keep,
            ...mintPubkey,
          };
          const json = JSON.parse(JSON.stringify(serializeSwapPreview(preview)));
          expect(deserializeSwapPreview(json)).toEqual(preview);
        },
      ),
    );
  });
});
