import { HttpResponse, http } from 'msw';
import { test, describe, expect } from 'vitest';
import { Wallet, Amount, type Proof } from '../../src';
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
});
