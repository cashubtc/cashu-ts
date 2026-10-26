import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import { HttpResponse, http } from 'msw';
import { test, describe, expect } from 'vitest';

import { Wallet, Amount, CTSError, OutputData, PaymentRequest, type Proof } from '../../src';
import { createP2PKsecret } from '../../src/crypto/NUT11';
import { createHTLCHash, createHTLCsecret } from '../../src/crypto/NUT14';
import { deriveP2BKBlindedPubkeys } from '../../src/crypto/NUT28';
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
  const priv = (seed: number) => bytesToHex(new Uint8Array(32).fill(seed));
  const pub = (seed: number) => bytesToHex(secp256k1.getPublicKey(hexToBytes(priv(seed)), true));
  // Legacy proofs all under one lock; amounts are the only thing that varies.
  const lockedProofs = (amounts: number[], secret: string): Proof[] =>
    amounts.map((a) => ({ id: '00bd033559de27d0', amount: Amount.from(a), secret, C: 'C' }));
  const request = (o: {
    amount?: number;
    unit?: string;
    mints?: string[];
    mp?: boolean;
    sm?: Array<{ method: string; fee?: number }>;
    nut10?: { kind: string; data: string; tags?: string[][] };
  }) =>
    new PaymentRequest(
      undefined,
      'pr',
      o.amount,
      o.unit,
      o.mints,
      undefined,
      false,
      o.nut10,
      o.mp,
      o.sm,
    );

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

    const pr = request({ amount: 100, unit: 'sat' });
    // 3 proofs cost 3 sats to swap: 103 - 3 >= 100 nets the amount, 102 - 3 does not.
    expect(wallet.isPaymentRequestSatisfied(pr, proofsTotalling([50, 50, 3]))).toBe(true);
    expect(wallet.isPaymentRequestSatisfied(pr, proofsTotalling([50, 50, 2]))).toBe(false);
  });

  test('adds mf when this mint is outside the request mint list', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const outside = request({
      amount: 100,
      unit: 'sat',
      mints: ['https://other.mint'],
      mp: true,
      sm: [{ method: 'bolt11', fee: 5 }], // fixture mint melts bolt11/sat
    });
    expect(wallet.isPaymentRequestSatisfied(outside, proofsTotalling([105]))).toBe(true);
    expect(wallet.isPaymentRequestSatisfied(outside, proofsTotalling([104]))).toBe(false);

    // Listed mint (normalized match) owes no mf.
    const listed = request({
      amount: 100,
      unit: 'sat',
      mints: [mintUrl + '/'],
      sm: [{ method: 'bolt11', fee: 5 }],
    });
    expect(wallet.isPaymentRequestSatisfied(listed, proofsTotalling([100]))).toBe(true);
  });

  test('does not settle a request this mint is not admissible for', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    // Strict list (mp absent) naming another mint.
    const strict = request({ amount: 100, unit: 'sat', mints: ['https://other.mint'] });
    expect(() => wallet.isPaymentRequestSatisfied(strict, proofsTotalling([100]))).toThrow(
      /strict mint list/,
    );

    // The fixture mint does not melt swift, so a swift-only request is unsettleable here.
    const unsupported = request({ amount: 100, unit: 'sat', sm: [{ method: 'swift' }] });
    expect(() => wallet.isPaymentRequestSatisfied(unsupported, proofsTotalling([100]))).toThrow(
      /cannot melt/,
    );

    // A listed mint that melts an accepted method still settles.
    const ok = request({
      amount: 100,
      unit: 'sat',
      mints: [mintUrl],
      sm: [{ method: 'bolt11', fee: 5 }],
    });
    expect(wallet.isPaymentRequestSatisfied(ok, proofsTotalling([100]))).toBe(true);
  });

  test('a mint with melting disabled accepts no method', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const info = wallet.getMintInfo();
    const isSupported = info.isSupported.bind(info);
    // Stub only NUT-05; every other lookup keeps the fixture's answer.
    info.isSupported = ((num: number) =>
      num === 5 ? { disabled: true, params: [] } : isSupported(num as 4)) as typeof isSupported;

    const pr = request({ amount: 100, unit: 'sat', sm: [{ method: 'bolt11' }] });
    expect(() => wallet.isPaymentRequestSatisfied(pr, proofsTotalling([100]))).toThrow(
      /cannot melt/,
    );
  });

  test('a locked request settles only proofs carrying the requested lock', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const carol = pub(3);
    // A redundant n_sigs=1 canonicalises away, so the proof need not repeat it.
    const pr = request({
      amount: 100,
      unit: 'sat',
      nut10: { kind: 'P2PK', data: carol, tags: [['n_sigs', '1']] },
    });
    expect(wallet.isPaymentRequestSatisfied(pr, lockedProofs([100], createP2PKsecret(carol)))).toBe(
      true,
    );

    // Plain bearer proofs carry no lock at all.
    expect(() => wallet.isPaymentRequestSatisfied(pr, proofsTotalling([100]))).toThrow(
      /does not carry a NUT-10 lock/,
    );

    // An expired refund path is the clawback: locked to carol, spendable by the payer.
    const clawback = createP2PKsecret(carol, [
      ['locktime', '1'],
      ['refund', pub(9)],
    ]);
    expect(() => wallet.isPaymentRequestSatisfied(pr, lockedProofs([100], clawback))).toThrow(
      /not the requested spending condition/,
    );

    // A kind the wallet cannot read as a lock cannot be checked, so it never settles.
    const exotic = request({ amount: 100, unit: 'sat', nut10: { kind: 'FROST', data: 'xyz' } });
    expect(() => wallet.isPaymentRequestSatisfied(exotic, proofsTotalling([100]))).toThrow(
      /cannot check the request's nut10 lock kind/,
    );
  });

  test('an unlocked request settles only proofs the payee can spend', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const pr = request({ amount: 100, unit: 'sat' });
    const [bearer] = proofsTotalling([100]);
    const payee = { privkeys: priv(1) };

    expect(wallet.isPaymentRequestSatisfied(pr, [bearer])).toBe(true);

    // Locked to the payer's own key: sums to the amount, transfers nothing.
    const toPayer = lockedProofs([100], createP2PKsecret(pub(9)));
    expect(() => wallet.isPaymentRequestSatisfied(pr, toPayer)).toThrow(
      /unlocked request: the payee cannot spend a proof/,
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
    expect(wallet.isPaymentRequestSatisfied(pr, toPayee, undefined, payee)).toBe(true);

    // Blinded to the payee (NUT-28): the held key matches only through the proof's `p2pk_e`.
    const { blinded, Ehex } = deriveP2BKBlindedPubkeys([pub(1)]);
    const [toBlindedPayee] = lockedProofs([100], createP2PKsecret(blinded[0]));
    const blindedProof = { ...toBlindedPayee, p2pk_e: Ehex };
    expect(() => wallet.isPaymentRequestSatisfied(pr, [blindedProof])).toThrow(
      /the payee cannot spend/,
    );
    expect(wallet.isPaymentRequestSatisfied(pr, [blindedProof], undefined, payee)).toBe(true);
  });

  test('an unlocked request reads thresholds, expiry and hashlocks', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const pr = request({ amount: 100, unit: 'sat' });
    const settles = (secret: string, privkeys?: string[]) =>
      wallet.isPaymentRequestSatisfied(pr, lockedProofs([100], secret), undefined, { privkeys });

    // 2-of-2: one payee key is not enough.
    const multisig = createP2PKsecret(pub(1), [
      ['pubkeys', pub(2)],
      ['n_sigs', '2'],
    ]);
    expect(() => settles(multisig, [priv(1)])).toThrow(/the payee cannot spend/);
    expect(settles(multisig, [priv(1), priv(2)])).toBe(true);

    // Expired with no refund keys: anyone can spend it.
    expect(settles(createP2PKsecret(pub(9), [['locktime', '1']]))).toBe(true);

    // Expired with a refund path to the payee: spendable through the refund keys.
    const refundToPayee = createP2PKsecret(pub(9), [
      ['locktime', '1'],
      ['refund', pub(1)],
    ]);
    expect(() => settles(refundToPayee)).toThrow(/the payee cannot spend/);
    expect(settles(refundToPayee, [priv(1)])).toBe(true);

    // Not yet expired: the refund path is closed.
    const future = String(Math.floor(Date.now() / 1000) + 3600);
    const refundLater = createP2PKsecret(pub(9), [
      ['locktime', future],
      ['refund', pub(1)],
    ]);
    expect(() => settles(refundLater, [priv(1)])).toThrow(/the payee cannot spend/);

    // A hashlock needs its preimage, which no key supplies.
    const htlc = createHTLCsecret(createHTLCHash().hash, [['pubkeys', pub(1)]]);
    expect(() => settles(htlc, [priv(1)])).toThrow(/the payee cannot spend/);

    // After the locktime, an HTLC refund path to the payee needs no preimage.
    const htlcRefund = createHTLCsecret(createHTLCHash().hash, [
      ['pubkeys', pub(9)],
      ['locktime', '1'],
      ['refund', pub(1)],
    ]);
    expect(() => settles(htlcRefund)).toThrow(/the payee cannot spend/);
    expect(settles(htlcRefund, [priv(1)])).toBe(true);
  });

  test('proofs built from the request lock settle it', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    // What a payer's sendToRequest locks to: the request's own options, built into a secret.
    const builtFrom = (pr: PaymentRequest) => {
      const output = OutputData.createSingleP2PKData(pr.toP2PKOptions()!, 100, '00bd033559de27d0');
      return lockedProofs([100], new TextDecoder().decode(output.secret));
    };

    const p2pk = request({
      amount: 100,
      unit: 'sat',
      nut10: {
        kind: 'P2PK',
        data: pub(1),
        tags: [
          ['pubkeys', pub(2), pub(3)],
          ['n_sigs', '2'],
          ['locktime', '4000000000'],
          ['refund', pub(4)],
          ['sigflag', 'SIG_ALL'],
          ['memo', 'inv-1'],
        ],
      },
    });
    expect(wallet.isPaymentRequestSatisfied(p2pk, builtFrom(p2pk))).toBe(true);

    // A hashlock is hex: an uppercase request accepts the lowercase proof a payer writes.
    const { hash } = createHTLCHash();
    const htlc = request({
      amount: 100,
      unit: 'sat',
      nut10: {
        kind: 'HTLC',
        data: hash.toUpperCase(),
        tags: [
          ['pubkeys', pub(1)],
          ['locktime', '4000000000'],
          ['refund', pub(4)],
        ],
      },
    });
    expect(wallet.isPaymentRequestSatisfied(htlc, builtFrom(htlc))).toBe(true);
    const foreign = createHTLCsecret(hash, [
      ['pubkeys', pub(1)],
      ['locktime', '4000000000'],
      ['refund', pub(4)],
    ]);
    expect(wallet.isPaymentRequestSatisfied(htlc, lockedProofs([100], foreign))).toBe(true);
  });

  test('rejects unit mismatches and amountless requests without an expectation', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const usd = request({ amount: 100, unit: 'usd' });
    expect(() => wallet.isPaymentRequestSatisfied(usd, proofsTotalling([100]))).toThrow(/unit/);

    const amountless = request({ unit: 'sat' });
    expect(() => wallet.isPaymentRequestSatisfied(amountless, proofsTotalling([10]))).toThrow(
      /amountless/,
    );
    expect(wallet.isPaymentRequestSatisfied(amountless, proofsTotalling([10]), 10)).toBe(true);
  });

  test('does not count repeated copies of one proof as distinct value', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const pr = request({ amount: 100, unit: 'sat' });
    const [proof] = proofsTotalling([60]);
    expect(() => wallet.isPaymentRequestSatisfied(pr, [proof, { ...proof }])).toThrow(
      /duplicate proof at index 1/i,
    );
  });

  test('rejects proofs from a keyset outside the wallet unit', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const pr = request({ amount: 100, unit: 'sat' });
    const [proof] = proofsTotalling([100]);
    expect(() =>
      wallet.isPaymentRequestSatisfied(pr, [{ ...proof, id: '009a1f293253e41f' }]),
    ).toThrow(/not a sat keyset/);
  });
});
