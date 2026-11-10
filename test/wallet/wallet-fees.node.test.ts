import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import { HttpResponse, http } from 'msw';
import { test, describe, expect, vi } from 'vitest';

import { Wallet, Amount, CTSError, PaymentRequest, OutputData, type Proof } from '../../src';
import { createP2PKsecret } from '../../src/crypto/NUT11';
import { verifyHTLCSpendingConditions } from '../../src/crypto/NUT14';
import { deriveP2BKBlindedPubkeys } from '../../src/crypto/NUT28';
import {
  NUTROOT_NUMS_KEY,
  deriveReceiverKeyedSecret,
  serializeNutrootLeafHex,
  type NutrootLeaf,
} from '../../src/crypto/nutroot';
import { NULL_LOGGER } from '../../src/logger';
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
  keyed: { secret: string; k?: string; E?: string; tree?: string[]; K?: string; u?: string },
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
  test('matches and verifies an HTLC hash independently of hexadecimal case', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const hash = 'ec4916dd28fc4c10d78e287ca5d9cc51ee1ae73cbfde08c6b37324cbfaac8bc5';
    const pr = new PaymentRequest({
      id: 'htlc',
      amount: 100,
      unit: 'sat',
      nut10: { kind: 'HTLC', data: hash },
    });
    const secret = JSON.stringify(['HTLC', { nonce: 'ab', data: hash.toUpperCase(), tags: [] }]);
    const [proof] = lockedProofs([100], secret);
    proof.witness = { preimage: '00'.repeat(31) + '01' };

    expect(wallet.isPaymentRequestSatisfied(pr, [proof])).toBe(true);
    expect(verifyHTLCSpendingConditions(proof).success).toBe(true);
  });

  describe('experimental refund_delay acceptance', () => {
    const now = 1700000000;
    const payee = '02c3b5bb27e361457c92d93d78dd73d3d53732110b2cfe8b50fbc0abc615e9c331';
    const refund = '0234ad87e907e117db1590cc20a3942ffdfd5137aa563d36095d5cf5f96bada122';
    const request = (tags: string[][] = [['refund_delay', '604800']]) =>
      new PaymentRequest({ amount: 500, unit, nut10: { kind: 'P2PK', data: payee, tags } });
    const check = async (secret: string, pr = request(), timing = { now, tolerance: 0 }) => {
      const wallet = new Wallet(mint, { unit });
      await wallet.loadMint();
      return wallet.isPaymentRequestSatisfied(pr, lockedProofs([500], secret), undefined, timing);
    };

    // Exact NUT-18 "Payer refund path / Payee acceptance" secrets, rows a-p.
    test.each([
      {
        row: 'a',
        accept: true,
        secret:
          '["P2PK",{"nonce":"0ed3fcb22c649dd7bbbdcca36e0c52d4f0187dd3b6a19efcc2bfbebb5f85b2a1","data":"02c3b5bb27e361457c92d93d78dd73d3d53732110b2cfe8b50fbc0abc615e9c331"}]',
      },
      {
        row: 'b',
        accept: true,
        secret:
          '["P2PK",{"nonce":"0ed3fcb22c649dd7bbbdcca36e0c52d4f0187dd3b6a19efcc2bfbebb5f85b2a1","data":"02c3b5bb27e361457c92d93d78dd73d3d53732110b2cfe8b50fbc0abc615e9c331","tags":[["locktime","1700604800"],["refund","0234ad87e907e117db1590cc20a3942ffdfd5137aa563d36095d5cf5f96bada122"]]}]',
      },
      {
        row: 'c',
        accept: true,
        secret:
          '["P2PK",{"nonce":"0ed3fcb22c649dd7bbbdcca36e0c52d4f0187dd3b6a19efcc2bfbebb5f85b2a1","data":"02c3b5bb27e361457c92d93d78dd73d3d53732110b2cfe8b50fbc0abc615e9c331","tags":[["locktime","1700604800"],["refund","0234ad87e907e117db1590cc20a3942ffdfd5137aa563d36095d5cf5f96bada122","026acbcd0fff3a424499c83ec892d3155c9d1984438659f448d9d0f1af3e92276a"],["n_sigs_refund","2"]]}]',
      },
      {
        row: 'd',
        accept: true,
        secret:
          '["P2PK",{"nonce":"0ed3fcb22c649dd7bbbdcca36e0c52d4f0187dd3b6a19efcc2bfbebb5f85b2a1","data":"02c3b5bb27e361457c92d93d78dd73d3d53732110b2cfe8b50fbc0abc615e9c331","tags":[["locktime","1700604800"],["refund","0234ad87e907e117db1590cc20a3942ffdfd5137aa563d36095d5cf5f96bada122"],["sigflag","SIG_INPUTS"]]}]',
      },
      {
        row: 'e',
        accept: true,
        secret:
          '["P2PK",{"nonce":"0ed3fcb22c649dd7bbbdcca36e0c52d4f0187dd3b6a19efcc2bfbebb5f85b2a1","data":"02c3b5bb27e361457c92d93d78dd73d3d53732110b2cfe8b50fbc0abc615e9c331","tags":[["locktime","1700604800"],["refund","0234ad87e907e117db1590cc20a3942ffdfd5137aa563d36095d5cf5f96bada122"],["n_sigs","1"]]}]',
      },
      {
        row: 'f',
        accept: true,
        secret:
          '["P2PK",{"nonce":"0ed3fcb22c649dd7bbbdcca36e0c52d4f0187dd3b6a19efcc2bfbebb5f85b2a1","data":"02c3b5bb27e361457c92d93d78dd73d3d53732110b2cfe8b50fbc0abc615e9c331","tags":[["refund_delay","604800"],["locktime","1700604800"],["refund","0234ad87e907e117db1590cc20a3942ffdfd5137aa563d36095d5cf5f96bada122"]]}]',
      },
      {
        row: 'g',
        accept: true,
        secret:
          '["P2PK",{"nonce":"0ed3fcb22c649dd7bbbdcca36e0c52d4f0187dd3b6a19efcc2bfbebb5f85b2a1","data":"02c3b5bb27e361457c92d93d78dd73d3d53732110b2cfe8b50fbc0abc615e9c331","tags":[["refund_delay","604800"]]}]',
      },
      {
        row: 'h',
        accept: true,
        secret:
          '["P2PK",{"nonce":"0ed3fcb22c649dd7bbbdcca36e0c52d4f0187dd3b6a19efcc2bfbebb5f85b2a1","data":"02c3b5bb27e361457c92d93d78dd73d3d53732110b2cfe8b50fbc0abc615e9c331","tags":[["refund","0234ad87e907e117db1590cc20a3942ffdfd5137aa563d36095d5cf5f96bada122"]]}]',
      },
      {
        row: 'i',
        accept: true,
        secret:
          '["P2PK",{"nonce":"0ed3fcb22c649dd7bbbdcca36e0c52d4f0187dd3b6a19efcc2bfbebb5f85b2a1","data":"02c3b5bb27e361457c92d93d78dd73d3d53732110b2cfe8b50fbc0abc615e9c331","tags":[["locktime","1700604800"]]}]',
      },
      {
        row: 'j',
        accept: false,
        secret:
          '["P2PK",{"nonce":"0ed3fcb22c649dd7bbbdcca36e0c52d4f0187dd3b6a19efcc2bfbebb5f85b2a1","data":"02c3b5bb27e361457c92d93d78dd73d3d53732110b2cfe8b50fbc0abc615e9c331","tags":[["locktime","1700604799"],["refund","0234ad87e907e117db1590cc20a3942ffdfd5137aa563d36095d5cf5f96bada122"]]}]',
      },
      {
        row: 'k',
        accept: false,
        secret:
          '["P2PK",{"nonce":"0ed3fcb22c649dd7bbbdcca36e0c52d4f0187dd3b6a19efcc2bfbebb5f85b2a1","data":"0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"}]',
      },
      {
        row: 'l',
        accept: false,
        secret:
          '["P2PK",{"nonce":"0ed3fcb22c649dd7bbbdcca36e0c52d4f0187dd3b6a19efcc2bfbebb5f85b2a1","data":"02c3b5bb27e361457c92d93d78dd73d3d53732110b2cfe8b50fbc0abc615e9c331","tags":[["pubkeys","0234ad87e907e117db1590cc20a3942ffdfd5137aa563d36095d5cf5f96bada122"]]}]',
      },
      {
        row: 'm',
        accept: false,
        secret:
          '["P2PK",{"nonce":"0ed3fcb22c649dd7bbbdcca36e0c52d4f0187dd3b6a19efcc2bfbebb5f85b2a1","data":"02c3b5bb27e361457c92d93d78dd73d3d53732110b2cfe8b50fbc0abc615e9c331","tags":[["locktime","1700604800"],["refund","0234ad87e907e117db1590cc20a3942ffdfd5137aa563d36095d5cf5f96bada122"],["sigflag","SIG_ALL"]]}]',
      },
      {
        row: 'n',
        accept: false,
        secret:
          '["P2PK",{"nonce":"0ed3fcb22c649dd7bbbdcca36e0c52d4f0187dd3b6a19efcc2bfbebb5f85b2a1","data":"02c3b5bb27e361457c92d93d78dd73d3d53732110b2cfe8b50fbc0abc615e9c331","tags":[["locktime","1700604800"],["locktime","1700604800"],["refund","0234ad87e907e117db1590cc20a3942ffdfd5137aa563d36095d5cf5f96bada122"]]}]',
      },
      {
        row: 'o',
        accept: false,
        secret:
          '["P2PK",{"nonce":"0ed3fcb22c649dd7bbbdcca36e0c52d4f0187dd3b6a19efcc2bfbebb5f85b2a1","data":"02c3b5bb27e361457c92d93d78dd73d3d53732110b2cfe8b50fbc0abc615e9c331","tags":[["locktime","1700604800"],["refund","0234ad87e907e117db1590cc20a3942ffdfd5137aa563d36095d5cf5f96bada122","026acbcd0fff3a424499c83ec892d3155c9d1984438659f448d9d0f1af3e92276a"],["n_sigs_refund","3"]]}]',
      },
      {
        row: 'p',
        accept: false,
        secret:
          '["P2PK",{"nonce":"0ed3fcb22c649dd7bbbdcca36e0c52d4f0187dd3b6a19efcc2bfbebb5f85b2a1","data":"02c3b5bb27e361457c92d93d78dd73d3d53732110b2cfe8b50fbc0abc615e9c331","tags":[["locktime","abc"],["refund","0234ad87e907e117db1590cc20a3942ffdfd5137aa563d36095d5cf5f96bada122"]]}]',
      },
    ])('spec row $row accepts=$accept', async ({ secret, accept }) => {
      if (accept) expect(await check(secret)).toBe(true);
      else await expect(check(secret)).rejects.toThrow(/nut10 request/);
    });

    test('accepts the opt-in payer output', async () => {
      const pr = request();
      const output = OutputData.createSingleP2PKData(
        pr.toP2PKOptions({ refundKeys: [refund], now, margin: 0 })!,
        500,
        '00bd033559de27d0',
      );
      expect(await check(new TextDecoder().decode(output.secret), pr)).toBe(true);
    });

    test('keeps exact equality without a refund_delay request', async () => {
      const pr = request([]);
      expect(await check(createP2PKsecret(payee), pr)).toBe(true);
      await expect(
        check(
          createP2PKsecret(payee, [
            ['locktime', '1700604800'],
            ['refund', refund],
          ]),
          pr,
        ),
      ).rejects.toThrow(/requested spending condition/);
    });

    test.each(['0', '01', 'abc'])('ignores copied or absent malformed delay %s', async (delay) => {
      const pr = request([['refund_delay', delay]]);
      const copied = createP2PKsecret(payee, [['refund_delay', delay]]);
      expect(await check(copied, pr)).toBe(true);
      expect(await check(createP2PKsecret(payee), pr)).toBe(true);
    });

    test.each([
      [
        ['refund_delay', '1'],
        ['refund_delay', '2'],
      ],
      [
        ['refund_delay', '604800'],
        ['locktime', '1700604800'],
        ['refund', refund],
        ['n_sigs_refund', '1'],
      ],
    ])(
      'ignores repeated or conflicting markers but keeps refund tags exact %j',
      async (...tags) => {
        const pr = request(tags);
        const conditions = tags.filter((tag) => tag[0] !== 'refund_delay');
        expect(await check(createP2PKsecret(payee, conditions), pr)).toBe(true);
        expect(await check(createP2PKsecret(payee, tags), pr)).toBe(true);
        await expect(
          check(createP2PKsecret(payee, [...conditions, ['custom', 'extra']]), pr),
        ).rejects.toThrow(/requested spending condition/);
        if (conditions.length) {
          await expect(check(createP2PKsecret(payee), pr)).rejects.toThrow(
            /requested spending condition/,
          );
        }
      },
    );

    test.each([
      [['refund_delay', '0']],
      [['refund_delay', '01']],
      [
        ['refund_delay', '1'],
        ['refund_delay', '2'],
      ],
      [
        ['refund_delay', '604800'],
        ['locktime', '1700604800'],
        ['refund', refund],
      ],
    ])('accepts payer output for ineligible markers %j', async (...tags) => {
      const pr = request(tags);
      for (const refundKeys of [undefined, [refund]]) {
        const output = OutputData.createSingleP2PKData(
          pr.toP2PKOptions({ refundKeys, now, margin: 0 })!,
          500,
          '00bd033559de27d0',
        );
        expect(await check(new TextDecoder().decode(output.secret), pr)).toBe(true);
      }
    });

    test('accepts an upper-case proof key after canonicalisation', async () => {
      expect(await check(createP2PKsecret(payee.toUpperCase()))).toBe(true);
    });

    test('refuses a refund-path secret over the parser limit', async () => {
      const secret = JSON.stringify([
        'P2PK',
        {
          nonce: 'n',
          data: payee,
          tags: [
            ['locktime', '1700604800'],
            ['refund', refund],
            ['refund_delay', 'x'.repeat(1024)],
          ],
        },
      ]);
      await expect(check(secret)).rejects.toThrow(/does not carry a valid NUT-10 lock/);
    });

    test.each([
      [['n_sigs', '0']],
      [['n_sigs', '2']],
      [['n_sigs', 'abc']],
      [['custom', 'value']],
      [
        ['refund_delay', '1'],
        ['refund_delay', '2'],
      ],
      [['locktime', '1700604800.0']],
      [['locktime', '-1700604800']],
      [['locktime', '+1700604800']],
      [['locktime']],
      [['refund']],
      [['n_sigs_refund']],
      [['locktime'], ['refund', refund]],
    ])('rejects malformed or different proof tags %j', async (...tags) => {
      const secret = JSON.stringify(['P2PK', { nonce: 'n', data: payee, tags }]);
      await expect(check(secret)).rejects.toThrow(/nut10 request/);
    });

    test.each(['01700604800', '01700604801'])(
      'accepts decimal locktime %s at or above the floor',
      async (locktime) => {
        expect(await check(createP2PKsecret(payee, [['locktime', locktime]]))).toBe(true);
      },
    );

    test.each([
      {
        secret: 'not a secret',
        message: 'nut10 request: proof does not carry a valid NUT-10 lock of the requested kind',
      },
      {
        secret: createP2PKsecret(payee, [['locktime', '1700604799']]),
        message:
          'nut10 request: proof lock is not the requested spending condition: proof locktime is below the refund delay',
      },
    ])('logs a payee rejection once: $secret', async ({ secret, message }) => {
      const error = vi.fn();
      const wallet = new Wallet(mint, { unit, logger: { ...NULL_LOGGER, error } });
      await wallet.loadMint();
      error.mockClear();

      expect(() =>
        wallet.isPaymentRequestSatisfied(request(), lockedProofs([500], secret), undefined, {
          now,
          tolerance: 0,
        }),
      ).toThrow(message);
      expect(error).toHaveBeenCalledExactlyOnceWith(message, undefined);
    });

    test('ignores a copied marker value', async () => {
      expect(await check(createP2PKsecret(payee, [['refund_delay', 'abc']]))).toBe(true);
    });

    test('keeps HTLC marker equality and refuses unrequested refund tags', async () => {
      const data = 'ab'.repeat(32);
      const pr = request();
      pr.nut10 = {
        kind: 'HTLC',
        data,
        tags: [
          ['pubkeys', payee],
          ['refund_delay', '604800'],
        ],
      };
      const secret = (tags: string[][]) => JSON.stringify(['HTLC', { nonce: 'n', data, tags }]);
      const tags = [
        ['pubkeys', payee],
        ['refund_delay', '604800'],
      ];
      expect(await check(secret(tags), pr)).toBe(true);
      await expect(
        check(secret([...tags, ['locktime', '1700604800'], ['refund', refund]]), pr),
      ).rejects.toThrow(/requested spending condition/);
    });

    test('matches explicit request defaults and preserves requested extension tags', async () => {
      const pr = request([
        ['refund_delay', '604800'],
        ['n_sigs', '1'],
        ['sigflag', 'SIG_INPUTS'],
        ['custom', 'value'],
      ]);
      expect(await check(createP2PKsecret(payee, [['custom', 'value']]), pr)).toBe(true);
      await expect(check(createP2PKsecret(payee), pr)).rejects.toThrow(
        /requested spending condition/,
      );
    });

    test('uses the current time and five-second default tolerance', async () => {
      const clock = vi.spyOn(Date, 'now').mockReturnValue(now * 1000);
      try {
        const wallet = new Wallet(mint, { unit });
        await wallet.loadMint();
        const secret = createP2PKsecret(payee, [['locktime', '1700604795']]);
        expect(wallet.isPaymentRequestSatisfied(request(), lockedProofs([500], secret))).toBe(true);
        const early = createP2PKsecret(payee, [['locktime', '1700604794']]);
        expect(() =>
          wallet.isPaymentRequestSatisfied(request(), lockedProofs([500], early)),
        ).toThrow(/nut10 request/);
      } finally {
        clock.mockRestore();
      }
    });

    test.each([
      { now: NaN, tolerance: 0 },
      { now: -1, tolerance: 0 },
      { now, tolerance: -1 },
      { now, tolerance: Infinity },
    ])('rejects invalid payee timing %j', async (timing) => {
      await expect(check(createP2PKsecret(payee), request(), timing)).rejects.toThrow(
        /finite seconds/,
      );
    });

    test('honours custom tolerance at the inclusive boundary', async () => {
      const secret = createP2PKsecret(payee, [
        ['locktime', '1700604790'],
        ['refund', refund],
      ]);
      expect(await check(secret, request(), { now, tolerance: 10 })).toBe(true);
      await expect(check(secret, request(), { now, tolerance: 9 })).rejects.toThrow(
        /nut10 request/,
      );
    });
  });

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

  test('does not settle a request this mint is not admissible for', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    // Strict list (mp absent) naming another mint.
    const strict = new PaymentRequest({
      id: 'strict',
      amount: 100,
      unit: 'sat',
      mints: ['https://other.mint'],
    });
    expect(() => wallet.isPaymentRequestSatisfied(strict, proofsTotalling([100]))).toThrow(
      /strict mint list/,
    );

    // The fixture mint melts sat via bolt11 only, so a swift-only request is unsettleable here.
    const unsupported = new PaymentRequest({
      id: 'method',
      amount: 100,
      unit: 'sat',
      supportedMethods: [{ method: 'swift' }],
    });
    expect(() => wallet.isPaymentRequestSatisfied(unsupported, proofsTotalling([100]))).toThrow(
      /cannot melt/,
    );

    // A listed mint that melts an accepted method still settles.
    const ok = new PaymentRequest({
      id: 'ok',
      amount: 100,
      unit: 'sat',
      mints: [mintUrl],
      supportedMethods: [{ method: 'bolt11', fee: 5 }],
    });
    expect(wallet.isPaymentRequestSatisfied(ok, proofsTotalling([100]))).toBe(true);
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
    ).toThrow(/does not carry a valid NUT-10 lock/);

    // A repeated key makes the lock unspendable, though the builder would dedupe it to carol's.
    const evenCarol = '02' + carol.slice(2);
    const oddCarol = '03' + carol.slice(2);
    for (const tags of [[['pubkeys', carol]], [['pubkeys', oddCarol]]]) {
      const repeated = JSON.stringify(['P2PK', { nonce: 'ab', data: evenCarol, tags }]);
      expect(() =>
        wallet.isPaymentRequestSatisfied(both, lockedProofs([100], repeated), 100, {
          privkeys: priv(1),
        }),
      ).toThrow(/does not carry a valid NUT-10 lock/);
    }
    const badHash = JSON.stringify([
      'HTLC',
      { nonce: 'ab', data: 'zz', tags: [['pubkeys', carol]] },
    ]);
    expect(() =>
      wallet.isPaymentRequestSatisfied(both, lockedProofs([100], badHash), 100, {
        privkeys: priv(1),
      }),
    ).toThrow(/does not carry a valid NUT-10 lock/);
    const refundTags = [
      ['locktime', '4102444800'],
      ['refund', pub(9)],
    ];
    const withRefund = new PaymentRequest({
      id: 'refund',
      amount: 100,
      unit: 'sat',
      nut10: { kind: 'P2PK', data: carol, tags: refundTags },
    });
    expect(
      wallet.isPaymentRequestSatisfied(
        withRefund,
        lockedProofs([100], createP2PKsecret(carol, refundTags)),
      ),
    ).toBe(true);
    const repeatedRefund = JSON.stringify([
      'P2PK',
      {
        nonce: 'ab',
        data: carol,
        tags: [
          ['locktime', '4102444800'],
          ['refund', pub(9), pub(9)],
        ],
      },
    ]);
    expect(() =>
      wallet.isPaymentRequestSatisfied(withRefund, lockedProofs([100], repeatedRefund)),
    ).toThrow(/does not carry a valid NUT-10 lock/);

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

  test('an unlocked request settles only proofs the payee can spend', async () => {
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
    const pr = new PaymentRequest({ id: 'open', amount: 100, unit: 'sat' });
    const [bearer] = proofsTotalling([100]);

    expect(wallet.isPaymentRequestSatisfied(pr, [bearer])).toBe(true);

    // Locked to the payer's own key: sums to the amount, transfers nothing.
    const toPayer = lockedProofs([100], createP2PKsecret(pub(9)));
    expect(() => wallet.isPaymentRequestSatisfied(pr, toPayer)).toThrow(
      /unlocked request: the payee cannot spend a proof \(not-keyed-to-you\)/,
    );

    // One unspendable proof sinks the payment, however much the rest covers.
    expect(() => wallet.isPaymentRequestSatisfied(pr, [bearer, ...toPayer])).toThrow(
      /the payee cannot spend/,
    );

    // A lock this wallet cannot read is not a bearer secret: a laxer mint may still enforce it.
    const unreadable = JSON.stringify([
      'P2PK',
      { nonce: 'ab', data: pub(9), tags: [['memo', '']] },
    ]);
    expect(() => wallet.isPaymentRequestSatisfied(pr, lockedProofs([100], unreadable))).toThrow(
      /Invalid NUT-10 tag/,
    );

    // Locked to the payee is still a payment, once the payee says which key is theirs.
    const toPayee = lockedProofs([100], createP2PKsecret(pub(1)));
    expect(() => wallet.isPaymentRequestSatisfied(pr, toPayee)).toThrow(/the payee cannot spend/);
    expect(wallet.isPaymentRequestSatisfied(pr, toPayee, undefined, { privkeys: priv(1) })).toBe(
      true,
    );

    // Blinded to the payee (NUT-28): the held key matches only through the proof's `p2pk_e`.
    const { blinded, Ehex } = deriveP2BKBlindedPubkeys([pub(1)]);
    const [toBlindedPayee] = lockedProofs([100], createP2PKsecret(blinded[0]));
    const blindedProof = { ...toBlindedPayee, p2pk_e: Ehex };
    expect(() => wallet.isPaymentRequestSatisfied(pr, [blindedProof])).toThrow(
      /the payee cannot spend/,
    );
    expect(
      wallet.isPaymentRequestSatisfied(pr, [blindedProof], undefined, { privkeys: priv(1) }),
    ).toBe(true);

    // The v3 twins: a bearer proof hands over its key, a keyed one spends only for its receiver.
    const keyedTo = (seed: number) => [v3Proof(100, deriveReceiverKeyedSecret(pub(seed)))];
    expect(
      wallet.isPaymentRequestSatisfied(pr, [v3Proof(100, { secret: pub(4), k: priv(4) })]),
    ).toBe(true);
    expect(() =>
      wallet.isPaymentRequestSatisfied(pr, keyedTo(9), undefined, { privkeys: priv(1) }),
    ).toThrow(/the payee cannot spend/);
    expect(wallet.isPaymentRequestSatisfied(pr, keyedTo(1), undefined, { privkeys: priv(1) })).toBe(
      true,
    );
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
    for (const outOfRange of ['00'.repeat(32), 'ff'.repeat(32)]) {
      expect(() =>
        wallet.isPaymentRequestSatisfied(pr, [v3Proof(100, payee)], 100, {
          privkeys: [priv(1), outOfRange],
        }),
      ).toThrow(/valid 32-byte hex private keys/);
    }

    expect(
      wallet.isPaymentRequestSatisfied(pr, [v3Proof(100, payee)], 100, { privkeys: priv(1) }),
    ).toBe(true);
    // The tree matches the (empty) request, but the key path is the payer's.
    expect(() =>
      wallet.isPaymentRequestSatisfied(pr, [v3Proof(100, payer)], 100, { privkeys: priv(1) }),
    ).toThrow(/not keyed to the requested receiver key/);
    // A general keyring may hold the key a proof is keyed to, but the request named only pub(1).
    expect(() =>
      wallet.isPaymentRequestSatisfied(pr, [v3Proof(100, payer)], 100, {
        privkeys: [priv(1), priv(9)],
      }),
    ).toThrow(/not keyed to the requested receiver key/);
    expect(() =>
      wallet.isPaymentRequestSatisfied(pr, [v3Proof(100, payer)], 100, { privkeys: priv(9) }),
    ).toThrow(/holds no key for the requested receiver key/);
    // The receiver key binds by x-coordinate: recovery walks either parity.
    const flipped = (pub(1).startsWith('02') ? '03' : '02') + pub(1).slice(2);
    const flippedPr = new PaymentRequest({
      id: 'v3-flipped',
      amount: 100,
      unit: 'sat',
      nutroot: { receiverKey: flipped },
    });
    expect(
      wallet.isPaymentRequestSatisfied(
        flippedPr,
        [v3Proof(100, deriveReceiverKeyedSecret(flipped))],
        100,
        { privkeys: [priv(9), priv(1)] },
      ),
    ).toBe(true);
    // Keyed to the payee, so perfectly spendable, but short: spendability alone cannot catch this.
    expect(
      wallet.isPaymentRequestSatisfied(pr, [v3Proof(8, payee)], 100, { privkeys: priv(1) }),
    ).toBe(false);

    // A v3 keyset spends only point secrets, so a legacy lock on one is never the legacy option.
    const both = new PaymentRequest({
      id: 'both',
      amount: 100,
      unit: 'sat',
      nut10: { kind: 'P2PK', data: pub(1) },
      nutroot: { receiverKey: pub(1) },
    });
    const legacyOnV3 = v3Proof(100, { secret: createP2PKsecret(pub(1)) });
    expect(() =>
      wallet.isPaymentRequestSatisfied(both, [legacyOnV3], 100, { privkeys: priv(1) }),
    ).toThrow(/not a v3 point secret/);
    expect(
      wallet.isPaymentRequestSatisfied(both, lockedProofs([100], createP2PKsecret(pub(1))), 100, {
        privkeys: priv(1),
      }),
    ).toBe(true);
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
