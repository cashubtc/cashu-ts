import { HttpResponse, http } from 'msw';
import { test, describe, expect } from 'vitest';

import { Wallet, Amount, CTSError, PaymentRequest, type Proof } from '../../src';
import { deriveKeysetId } from '../../src/utils';
import { PUBKEYS } from '../consts';

import { mint, unit, mintUrl, useTestServer } from './_setup';

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
});
