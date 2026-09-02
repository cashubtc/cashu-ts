import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import { HttpResponse, http } from 'msw';
import { test, describe, expect } from 'vitest';

import { Wallet, Amount, CTSError, PaymentRequest, type Proof } from '../../src';
import { createP2PKsecret } from '../../src/crypto/NUT11';
import {
  NUTROOT_NUMS_KEY,
  deriveReceiverKeyedSecret,
  serializeNutrootLeafHex,
  type NutrootLeaf,
} from '../../src/crypto/nutroot';
import { deriveKeysetId } from '../../src/utils';
import { PUBKEYS } from '../consts';

import { mint, unit, mintUrl, useTestServer, dummyKeysetResp } from './_setup';

// Full power-of-two denomination set, a realistic set for fee convergence. A v0 keyset id hashes
// only the pubkeys (not the fee), so one id is valid for any advertised fee.
const FULL_DENOM_ID = deriveKeysetId(PUBKEYS, { versionByte: 0 });

// Advertise a full-denomination keyset with a given input fee, so fee convergence sees a realistic
// denomination set rather than the {1,2} default fixture.
const useKeysetWithFee = (server: ReturnType<typeof useTestServer>, input_fee_ppk: number) => {
  const id = FULL_DENOM_ID;
  const withKeys = { id, unit: 'sat', active: true, input_fee_ppk, keys: PUBKEYS };
  server.use(
    http.get(mintUrl + '/v1/keysets', () =>
      HttpResponse.json({ keysets: [{ id, unit: 'sat', active: true, input_fee_ppk }] }),
    ),
    http.get(mintUrl + '/v1/keys', () => HttpResponse.json({ keysets: [withKeys] })),
    http.get(mintUrl + '/v1/keys/' + id, () => HttpResponse.json({ keysets: [withKeys] })),
  );
};

const server = useTestServer();

const proofsTotalling = (amounts: number[]): Proof[] =>
  amounts.map((a, i) => ({
    id: '00bd033559de27d0',
    amount: Amount.from(a),
    secret: `secret-${i}`,
    C: `C-${i}`,
  }));

const V3_KEYSET = '02' + 'ab'.repeat(32);
const priv = (seed: number) => bytesToHex(new Uint8Array(32).fill(seed));
const pub = (seed: number) => bytesToHex(secp256k1.getPublicKey(hexToBytes(priv(seed)), true));

// Legacy proofs all under one lock; the secret carries the condition, so amounts are the only
// thing that varies.
const lockedProofs = (amounts: number[], secret: string): Proof[] =>
  amounts.map((a) => ({ id: '00bd033559de27d0', amount: Amount.from(a), secret, C: 'C' }));

const v3Proof = (
  amount: number,
  keyed: { secret: string; E?: string; tree?: string[]; K?: string; u?: string },
): Proof => {
  const { secret, ...spend_info } = keyed;
  return { id: V3_KEYSET, amount: Amount.from(amount), secret, C: 'aa'.repeat(48), spend_info };
};

describe('wallet.maxSpendableAfterFees', () => {
  test('returns total minus feeReserve when input fees are zero', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const proofs = proofsTotalling([64, 32, 4]); // total = 100
    const result = wallet.maxSpendableAfterFees(proofs, 10);

    expect(result.equals(90)).toBe(true);
  });

  test('returns zero when feeReserve exactly consumes total', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const proofs = proofsTotalling([64, 32, 4]); // total = 100
    const result = wallet.maxSpendableAfterFees(proofs, 100);

    expect(result.isZero()).toBe(true);
  });

  test('clamps to zero when fees exceed total (no underflow)', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const proofs = proofsTotalling([10]);
    const result = wallet.maxSpendableAfterFees(proofs, 50);

    expect(result.isZero()).toBe(true);
  });

  test('returns total when feeReserve is omitted and input fees are zero', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const proofs = proofsTotalling([64, 32, 4]); // total = 100
    const result = wallet.maxSpendableAfterFees(proofs);

    expect(result.equals(100)).toBe(true);
  });

  test('subtracts per-proof input fees when keyset charges input_fee_ppk', async () => {
    // Override keyset metadata to advertise input_fee_ppk = 1000 (= 1 sat per proof).
    server.use(
      http.get(mintUrl + '/v1/keysets', () =>
        HttpResponse.json({
          keysets: [
            {
              id: '00bd033559de27d0',
              unit: 'sat',
              active: true,
              input_fee_ppk: 1000,
              final_expiry: undefined,
            },
          ],
        }),
      ),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const proofs = proofsTotalling([64, 32, 4]); // total = 100, 3 proofs → inputFee = 3
    const result = wallet.maxSpendableAfterFees(proofs, 10);

    // 100 - 10 (feeReserve) - 3 (inputFee) = 87
    expect(result.equals(87)).toBe(true);
  });

  test('throws with cause when a proof keyset fee lookup fails', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const call = () =>
      wallet.maxSpendableAfterFees([
        {
          id: '00missingkeyset',
          amount: Amount.from(1),
          secret: 'secret',
          C: 'C',
        },
      ]);

    expect(call).toThrow(/Could not get fee\. No keyset found for keyset id: 00missingkeyset/);
    try {
      call();
    } catch (e) {
      expect(e).toBeInstanceOf(CTSError);
      expect((e as CTSError).cause).toBeInstanceOf(Error);
    }
  });

  test('computes an exact integer fee for a huge input_fee_ppk', async () => {
    // nInputs * feePPK + 999 lands past Number.MAX_SAFE_INTEGER; number math would round up 1 sat.
    useKeysetWithFee(server, 9007199254740000);
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    // ceil(1 * 9007199254740000 / 1000) = 9007199254740, not ...741
    expect(wallet.getFeesForKeyset(1, FULL_DENOM_ID).toBigInt()).toBe(9007199254740n);
  });

  test('returns a zero fee for a zero-fee keyset', async () => {
    useKeysetWithFee(server, 0);
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    expect(wallet.getFeesForKeyset(5, FULL_DENOM_ID).isZero()).toBe(true);
  });

  test('throws with cause when a keyset fee lookup fails', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const call = () => wallet.getFeesForKeyset(1, '00missingkeyset');

    expect(call).toThrow(/No keyset found with ID 00missingkeyset/);
    try {
      call();
    } catch (e) {
      expect(e).toBeInstanceOf(CTSError);
      expect((e as CTSError).cause).toBeInstanceOf(Error);
    }
  });
});

describe('wallet.getFeesToInclude', () => {
  test('returns zero when the keyset charges no input fees', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    expect(wallet.getFeesToInclude(100).isZero()).toBe(true);
  });

  test('converges on the fee for the fee outputs themselves', async () => {
    // 1000 ppk = 1 sat per proof.
    server.use(
      http.get(mintUrl + '/v1/keysets', () =>
        HttpResponse.json({
          keysets: [{ id: '00bd033559de27d0', unit: 'sat', active: true, input_fee_ppk: 1000 }],
        }),
      ),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    // Fixture keys are {1,2}. Amount 2 is one output (naive fee 1), but the fee
    // output itself incurs a fee: two inputs cost 2, so the converged fee is 2.
    expect(wallet.getFeesToInclude(2).toString()).toBe('2');
  });

  test('nOutputs overrides the count derived from the default split', async () => {
    server.use(
      http.get(mintUrl + '/v1/keysets', () =>
        HttpResponse.json({
          keysets: [{ id: '00bd033559de27d0', unit: 'sat', active: true, input_fee_ppk: 1000 }],
        }),
      ),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    // Caller plans 3 outputs (custom denominations): 3 fee outputs converge on 6.
    expect(wallet.getFeesToInclude(2, { nOutputs: 3 }).toString()).toBe('6');
  });

  test('throws when the keyset id is unknown', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    expect(() => wallet.getFeesToInclude(100, { keysetId: '00missingkeyset' })).toThrow(
      /not found/,
    );
  });

  test('converges on the minimal (fewest-output) fee, not an overshoot', async () => {
    // 3000 ppk = 3 sat per input. Spending 1 real output plus its fee outputs, a single 8 output
    // is minimal: it covers the two-input fee (fee(2) = 6) with the fewest outputs. A convergence
    // that jumps past the low-popcount value would settle on 9 (two outputs) instead.
    useKeysetWithFee(server, 3000);
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    expect(wallet.getFeesToInclude(1).toString()).toBe('8');
  });

  test('fails fast instead of hanging when input_fee_ppk is degenerately large', async () => {
    useKeysetWithFee(server, 10_000_000_000);
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    expect(() => wallet.getFeesToInclude(1)).toThrow(/did not converge/);
  });
});

describe('wallet.isPaymentRequestSatisfied', () => {
  test('enforces the net-of-input-fees formula (NUT-18)', async () => {
    // Keyset charges 1 sat per proof (1000 ppk), the spec's dust-protection scenario.
    server.use(
      http.get(mintUrl + '/v1/keysets', () =>
        HttpResponse.json({
          keysets: [{ id: '00bd033559de27d0', unit: 'sat', active: true, input_fee_ppk: 1000 }],
        }),
      ),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const pr = new PaymentRequest({ id: 'net', amount: 100, unit: 'sat' });
    // 3 proofs cost 3 sats to swap: 103 - 3 >= 100 nets the amount, 102 - 3 does not.
    expect(wallet.isPaymentRequestSatisfied(pr, proofsTotalling([50, 50, 3]))).toBe(true);
    expect(wallet.isPaymentRequestSatisfied(pr, proofsTotalling([50, 50, 2]))).toBe(false);
  });

  test('adds mf when this mint is outside the request mint list', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const outside = new PaymentRequest({
      id: 'mf',
      amount: 100,
      unit: 'sat',
      mints: ['https://other.mint'],
      mintsPreferred: true,
      supportedMethods: [{ method: 'bolt11', fee: 5 }], // fixture mint melts bolt11/sat
    });
    expect(wallet.isPaymentRequestSatisfied(outside, proofsTotalling([105]))).toBe(true);
    expect(wallet.isPaymentRequestSatisfied(outside, proofsTotalling([104]))).toBe(false);

    // Listed mint (normalized match) owes no mf.
    const listed = new PaymentRequest({
      id: 'listed',
      amount: 100,
      unit: 'sat',
      mints: [mintUrl + '/'],
      supportedMethods: [{ method: 'bolt11', fee: 5 }],
    });
    expect(wallet.isPaymentRequestSatisfied(listed, proofsTotalling([100]))).toBe(true);
  });

  test('a both-encoded request settles only legacy proofs carrying the requested lock', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const carol = '02f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9';

    const both = new PaymentRequest({
      id: 'both',
      amount: 100,
      unit: 'sat',
      nut10: { kind: 'P2PK', data: carol },
      nutroot: { receiverKey: carol },
    });
    expect(
      wallet.isPaymentRequestSatisfied(both, lockedProofs([100], createP2PKsecret(carol)), 100, {
        privkeys: priv(1),
      }),
    ).toBe(true);

    // Plain bearer proofs carry no lock at all.
    expect(() =>
      wallet.isPaymentRequestSatisfied(both, proofsTotalling([100]), 100, { privkeys: priv(1) }),
    ).toThrow(/does not carry a NUT-10 lock/);

    // An expired refund path is the legacy clawback: locked to carol, spendable by the payer.
    const clawback = createP2PKsecret(carol, [
      ['locktime', '1'],
      ['refund', pub(9)],
    ]);
    expect(() =>
      wallet.isPaymentRequestSatisfied(both, lockedProofs([100], clawback), 100, {
        privkeys: priv(1),
      }),
    ).toThrow(/not the requested spending condition/);

    // nutroot alone is a request for v3 outputs only: legacy proofs cannot settle it.
    const v3only = new PaymentRequest({
      id: 'v3only',
      amount: 100,
      unit: 'sat',
      nutroot: { receiverKey: carol },
    });
    expect(() =>
      wallet.isPaymentRequestSatisfied(v3only, proofsTotalling([100]), 100, { privkeys: priv(1) }),
    ).toThrow(/v3 proofs only/);
  });

  test('a receiver-keyed nutroot request settles only proofs keyed to the payee', async () => {
    server.use(
      http.get(mintUrl + '/v1/keysets', () =>
        HttpResponse.json({
          keysets: [
            { id: '00bd033559de27d0', unit: 'sat', active: true, input_fee_ppk: 0 },
            { id: V3_KEYSET, unit: 'sat', active: true, input_fee_ppk: 0 },
          ],
        }),
      ),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const pr = new PaymentRequest({
      id: 'v3',
      amount: 100,
      unit: 'sat',
      nutroot: { receiverKey: pub(1) },
    });
    const payee = deriveReceiverKeyedSecret(pub(1));
    const payer = deriveReceiverKeyedSecret(pub(9));

    // Without the receiver key there is nothing to bind the proofs to, so the check refuses.
    expect(() => wallet.isPaymentRequestSatisfied(pr, [v3Proof(100, payee)])).toThrow(
      /pass the requested key\(s\)/,
    );
    expect(() =>
      wallet.isPaymentRequestSatisfied(pr, [v3Proof(100, payee)], 100, { privkeys: 'nothex' }),
    ).toThrow(/32-byte hex/);

    expect(
      wallet.isPaymentRequestSatisfied(pr, [v3Proof(100, payee)], 100, { privkeys: priv(1) }),
    ).toBe(true);
    // The tree matches the (empty) request, but the key path is the payer's.
    expect(() =>
      wallet.isPaymentRequestSatisfied(pr, [v3Proof(100, payer)], 100, { privkeys: priv(1) }),
    ).toThrow(/not keyed to the requested receiver key/);
  });

  test("a blind-me leaf key must carry the payee's own blinding", async () => {
    server.use(
      http.get(mintUrl + '/v1/keysets', () =>
        HttpResponse.json({
          keysets: [{ id: V3_KEYSET, unit: 'sat', active: true, input_fee_ppk: 0 }],
        }),
      ),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    // One leaf, its only key the payee's, tagged blind-me so it travels blinded.
    const leaf: NutrootLeaf = { type: 'threshold', n: 1, keys: [pub(1)] };
    const nutroot = {
      receiverKey: pub(1),
      leaves: [serializeNutrootLeafHex(leaf)],
      blindKeys: [pub(1)],
    };
    const pr = new PaymentRequest({ id: 'blind', amount: 100, unit: 'sat', nutroot });
    const honest = deriveReceiverKeyedSecret(pub(1), { leaves: [leaf], blindKeys: [pub(1)] });
    // Same leaf shape, but the blinded key is the payer's: a leaf only they can spend.
    const swapped = deriveReceiverKeyedSecret(pub(1), {
      leaves: [{ ...leaf, keys: [pub(9)] }],
      blindKeys: [pub(9)],
    });

    expect(
      wallet.isPaymentRequestSatisfied(pr, [v3Proof(100, honest)], 100, { privkeys: priv(1) }),
    ).toBe(true);
    expect(() =>
      wallet.isPaymentRequestSatisfied(pr, [v3Proof(100, swapped)], 100, { privkeys: priv(1) }),
    ).toThrow(/blind-me leaf key/);

    // A NUMS request has no key path at all, so a substituted leaf key is the whole payment.
    const nums = new PaymentRequest({
      id: 'nums',
      amount: 100,
      unit: 'sat',
      nutroot: { ...nutroot, receiverKey: NUTROOT_NUMS_KEY },
    });
    const numsHonest = deriveReceiverKeyedSecret(NUTROOT_NUMS_KEY, {
      leaves: [leaf],
      blindKeys: [pub(1)],
    });
    const numsSwapped = deriveReceiverKeyedSecret(NUTROOT_NUMS_KEY, {
      leaves: [{ ...leaf, keys: [pub(9)] }],
      blindKeys: [pub(9)],
    });
    expect(() => wallet.isPaymentRequestSatisfied(nums, [v3Proof(100, numsHonest)])).toThrow(
      /blind-me nutroot request/,
    );
    expect(
      wallet.isPaymentRequestSatisfied(nums, [v3Proof(100, numsHonest)], 100, {
        privkeys: priv(1),
      }),
    ).toBe(true);
    expect(() =>
      wallet.isPaymentRequestSatisfied(nums, [v3Proof(100, numsSwapped)], 100, {
        privkeys: priv(1),
      }),
    ).toThrow(/blind-me leaf key/);
  });

  test('rejects unit mismatches and amountless requests without an expectation', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const usd = new PaymentRequest({ id: 'usd', amount: 100, unit: 'usd' });
    expect(() => wallet.isPaymentRequestSatisfied(usd, proofsTotalling([100]))).toThrow(/unit/);

    const amountless = new PaymentRequest({ id: 'free', unit: 'sat' });
    expect(() => wallet.isPaymentRequestSatisfied(amountless, proofsTotalling([10]))).toThrow(
      /amountless/,
    );
    expect(wallet.isPaymentRequestSatisfied(amountless, proofsTotalling([10]), 10)).toBe(true);
  });

  test('does not count repeated copies of one proof as distinct value', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const pr = new PaymentRequest({ id: 'dup', amount: 100, unit: 'sat' });
    const [proof] = proofsTotalling([60]);

    expect(() => wallet.isPaymentRequestSatisfied(pr, [proof, { ...proof }])).toThrow(
      /duplicate proof at index 1/i,
    );
  });

  test('rejects proofs from another unit on the same mint', async () => {
    const usdKeysetId = '009a1f293253e41f';
    server.use(
      http.get(mintUrl + '/v1/keysets', () =>
        HttpResponse.json({
          keysets: [
            ...dummyKeysetResp.keysets,
            { id: usdKeysetId, unit: 'usd', active: true, input_fee_ppk: 0 },
          ],
        }),
      ),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const pr = new PaymentRequest({ id: 'unit', amount: 100, unit: 'sat' });
    const usdProofs: Proof[] = [
      { id: usdKeysetId, amount: Amount.from(100), secret: 'usd-secret', C: 'C-usd' },
    ];

    expect(() => wallet.isPaymentRequestSatisfied(pr, usdProofs)).toThrow(/not a sat keyset/);
  });
});
