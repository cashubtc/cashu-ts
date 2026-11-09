import { secp256k1 } from '@noble/curves/secp256k1.js';
import { describe, expect, test } from 'vitest';

import {
  Amount,
  PaymentRequest,
  Wallet,
  blindMessage,
  bytesToHex,
  createDLEQProof,
  deriveKeysetId,
  getEncodedToken,
  hashToCurve,
  hexToBytes,
  verifyReceivedProofs,
  type Proof,
} from '../../src';

import { mintInfoResp, mintUrl, unit } from './_setup';

const mintKey = hexToBytes('2'.padStart(64, '0'));
const keys = { '1': bytesToHex(secp256k1.getPublicKey(mintKey, true)) };
const id = deriveKeysetId(keys, { versionByte: 0 });
const request = new PaymentRequest({ amount: 2, unit });

function signedProof(secret: string): Proof {
  const message = new TextEncoder().encode(secret);
  const { B_, r } = blindMessage(message, 3n);
  const { e, s } = createDLEQProof(B_, mintKey);
  return {
    id,
    amount: Amount.from(1),
    secret,
    C: hashToCurve(message).multiply(2n).toHex(true),
    dleq: { e: bytesToHex(e), s: bytesToHex(s), r: r.toString(16).padStart(64, '0') },
  };
}

function wallet(): Wallet {
  const w = new Wallet(mintUrl, { unit });
  w.loadMintFromCache(mintInfoResp, {
    mintUrl,
    savedAt: Date.now(),
    keysets: [{ id, unit, active: true, input_fee_ppk: 0, keys }],
  });
  return w;
}

describe('proof identity', () => {
  test.each([
    ['\uD800', '\uFFFD', /proof secret at index 0 must be well-formed UTF-16/i],
    ['\uDC00', '\uFFFD', /proof secret at index 0 must be well-formed UTF-16/i],
    ['\uD800', '\uD801', /proof secret at index 0 must be well-formed UTF-16/i],
    ['\uFFFD', '\uD800', /proof secret at index 1 must be well-formed UTF-16/i],
    ['same-secret', 'same-secret', /duplicate proof at index 1/i],
  ])('rejects repeated value for %j and %j', async (first, second, error) => {
    const proofs = [signedProof(first), signedProof(second)];
    const verified = await verifyReceivedProofs(proofs, () => ({ id, keys }), { require: true });
    expect(verified.invalid).toEqual([]);
    expect(verified.valid).toEqual(proofs);
    expect(proofs[0].C).toBe(proofs[1].C);
    expect(new TextEncoder().encode(first)).toEqual(new TextEncoder().encode(second));

    const w = wallet();
    const payload = PaymentRequest.decodePayload(request.encodePayload(mintUrl, proofs));
    for (const received of [proofs, payload.proofs]) {
      expect(() => w.isPaymentRequestSatisfied(request, received)).toThrow(error);
      await expect(w.prepareSwapToReceive(received, { requireDleq: true })).rejects.toThrow(error);
    }
    await expect(
      w.prepareSwapToReceive({ mint: mintUrl, unit, proofs }, { requireDleq: true }),
    ).rejects.toThrow(error);
  });

  test('rejects a single signed proof with an ill-formed secret', async () => {
    const proofs = [signedProof('\uD800')];
    const w = wallet();
    const error = /proof secret at index 0 must be well-formed UTF-16/i;
    expect(() => w.isPaymentRequestSatisfied(request, proofs)).toThrow(error);
    await expect(w.prepareSwapToReceive(proofs, { requireDleq: true })).rejects.toThrow(error);
  });

  test('rejects repeated value in an encoded token', async () => {
    const proof = signedProof('\uFFFD');
    const token = getEncodedToken({ mint: mintUrl, unit, proofs: [proof, { ...proof }] });
    await expect(wallet().prepareSwapToReceive(token, { requireDleq: true })).rejects.toThrow(
      /duplicate proof at index 1/i,
    );
  });

  test('rejects the same secret across keyset IDs', async () => {
    const otherId = deriveKeysetId(keys, { versionByte: 1, unit });
    const w = wallet();
    w.loadMintFromCache(mintInfoResp, {
      mintUrl,
      savedAt: Date.now(),
      keysets: [id, otherId].map((id) => ({
        id,
        unit,
        active: true,
        input_fee_ppk: 0,
        keys,
      })),
    });
    const proof = signedProof('same-secret');
    const proofs = [proof, { ...proof, id: otherId }];
    expect(() => w.isPaymentRequestSatisfied(request, proofs)).toThrow(/duplicate proof/i);
    await expect(w.prepareSwapToReceive(proofs, { requireDleq: true })).rejects.toThrow(
      /duplicate proof/i,
    );
  });

  test('accepts distinct signed proofs with Unicode secrets', async () => {
    const proofs = [signedProof('\uFFFD'), signedProof('\uD83D\uDE00')];
    const w = wallet();
    expect(w.isPaymentRequestSatisfied(request, proofs)).toBe(true);
    const preview = await w.prepareSwapToReceive(proofs, { requireDleq: true });
    expect(preview.inputs).toEqual(proofs);
    expect(preview.amount.equals(2)).toBe(true);
  });
});
