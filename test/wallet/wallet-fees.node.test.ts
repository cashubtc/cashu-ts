import { HttpResponse, http } from 'msw';
import { test, describe, expect } from 'vitest';

import { Wallet, Amount, CTSError, type Proof } from '../../src';

import { mint, unit, mintUrl, useTestServer } from './_setup';

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
});
