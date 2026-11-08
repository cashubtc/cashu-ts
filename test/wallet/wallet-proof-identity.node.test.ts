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
  getG2PubKeyFromPrivKey,
  hashToCurve,
  hashToCurveBls,
  hashToCurveHex,
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
    ['\uD800', '\uFFFD'],
    ['\uDC00', '\uFFFD'],
    ['\uD800', '\uD801'],
    ['same-secret', 'same-secret'],
  ])('rejects repeated value for %j and %j', async (first, second) => {
    const proofs = [signedProof(first), signedProof(second)];
    const verified = await verifyReceivedProofs(proofs, () => ({ id, keys }), { require: true });
    expect(verified.invalid).toEqual([]);
    expect(verified.valid).toEqual(proofs);
    expect(proofs[0].C).toBe(proofs[1].C);
    expect(hashToCurveHex(first, id)).toBe(hashToCurveHex(second, id));

    const w = wallet();
    const payload = PaymentRequest.decodePayload(request.encodePayload(mintUrl, proofs));
    for (const received of [proofs, payload.proofs]) {
      expect(() => w.isPaymentRequestSatisfied(request, received)).toThrow(
        /duplicate proof at index 1/i,
      );
      await expect(w.prepareSwapToReceive(received, { requireDleq: true })).rejects.toThrow(
        /duplicate proof at index 1/i,
      );
    }
    await expect(
      w.prepareSwapToReceive({ mint: mintUrl, unit, proofs }, { requireDleq: true }),
    ).rejects.toThrow(/duplicate proof at index 1/i);
  });

  test('rejects repeated value in an encoded token', async () => {
    const proof = signedProof('\uFFFD');
    const token = getEncodedToken({ mint: mintUrl, unit, proofs: [proof, { ...proof }] });
    await expect(wallet().prepareSwapToReceive(token, { requireDleq: true })).rejects.toThrow(
      /duplicate proof at index 1/i,
    );
  });

  test('rejects the same Y across keyset IDs on the same curve', async () => {
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

  test('accepts the same secret on different curves with distinct Ys', async () => {
    const blsKeys = { '1': bytesToHex(getG2PubKeyFromPrivKey(mintKey)) };
    const blsId = deriveKeysetId(blsKeys, { versionByte: 2, unit, input_fee_ppk: 0 });
    const w = wallet();
    w.loadMintFromCache(mintInfoResp, {
      mintUrl,
      savedAt: Date.now(),
      keysets: [
        { id, unit, active: true, input_fee_ppk: 0, keys },
        { id: blsId, unit, active: true, input_fee_ppk: 0, keys: blsKeys },
      ],
    });
    const secret = keys['1'];
    const blsProof: Proof = {
      id: blsId,
      amount: Amount.from(1),
      secret,
      C: hashToCurveBls(new TextEncoder().encode(secret)).multiply(2n).toHex(true),
      spend_info: { k: bytesToHex(mintKey) },
    };
    expect(w.isPaymentRequestSatisfied(request, [signedProof(secret), blsProof])).toBe(true);
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
