import { HttpResponse, http } from 'msw';
import { describe, expect, test, vi } from 'vitest';

import { Wallet, deserializeTransactionPreview, serializeTransactionPreview } from '../../src';
import { schnorrSignDigest, schnorrVerifyDigest } from '../../src/crypto';
import { deriveRemainderLockKey } from '../../src/crypto/NUT13';
import { buildNutrootSecret } from '../../src/crypto/nutroot';
import {
  derivedQuoteId,
  inputBoundQuoteId,
  inputsForPayload,
  remainderQuoteId,
} from '../../src/crypto/transcript';
import { Amount } from '../../src/model/Amount';
import type { Proof } from '../../src/model/types';
import { deriveKeysetId } from '../../src/utils';
import { NUT02_V3_VECTOR1_KEYS, NUT02_V3_VECTOR1_KEYSET } from '../consts';

import {
  dummyKeysResp,
  dummyKeysetResp,
  mintInfoResp,
  mintUrl,
  unit,
  useTestServer,
} from './_setup';

const server = useTestServer();
const privkey = '0000000000000000000000000000000000000000000000000000000000000001';
const pubkey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const remainderKey = '022f8bde4d1a07209355b4a7250a5c5128e88b84bddc619ab7cba8d569b240efe4';
const remainder = { pubkey: remainderKey };
const remainderId = remainderQuoteId('quote-melt-0001');
const quote = {
  quote: 'quote-mint-0001',
  method: 'bolt11',
  unit,
  pubkey,
  amount_paid: Amount.from(64),
  amount_issued: Amount.from(0),
};
const melt = {
  method: 'bolt11',
  quote: { quote: 'quote-melt-0001', amount: Amount.from(5), fee_reserve: Amount.from(1) },
};

const meltQuoteJson = { amount: 5, fee_reserve: 1, unit, request: 'lnbc1', expiry: 0 };
const txoutQuoteJson = (id: string, amount: number) => ({
  quote: id,
  request: '',
  unit,
  amount,
  amount_paid: amount,
  amount_issued: 0,
  state: 'PAID',
  expiry: null,
  pubkey: remainderKey,
});

function serveInfo(xx?: object) {
  server.use(
    http.get(mintUrl + '/v1/info', () =>
      HttpResponse.json({ ...mintInfoResp, nuts: { ...mintInfoResp.nuts, ...(xx && { XX: xx }) } }),
    ),
  );
}

/**
 * Serves `/v1/transaction` as settled, and collects each body.
 */
function serveTransaction(): any[] {
  const bodies: any[] = [];
  server.use(
    http.post(mintUrl + '/v1/transaction', async ({ request }) => {
      const body: any = await request.json();
      bodies.push(body);
      return HttpResponse.json({
        state: 'PAID',
        signatures: [],
        melt_quotes: body.melt_quote_outputs.map((m: any) => ({
          quote: m.quote,
          amount: 5,
          fee_reserve: 1,
          unit,
          state: 'PAID',
          expiry: 0,
        })),
        mint_quotes: [],
      });
    }),
  );
  return bodies;
}

/**
 * Prepares and completes in one go, signing with the quote's key.
 */
async function transact(wallet: Wallet, transaction: Parameters<Wallet['prepareTransaction']>[0]) {
  return wallet.completeTransaction(await wallet.prepareTransaction(transaction), privkey);
}

describe('Wallet transactions (NUT-XX)', () => {
  test('refuses a mint that does not advertise transactions', async () => {
    serveInfo();
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    await expect(
      transact(wallet, {
        mintQuoteInputs: [{ quote, amount: 8 }],
        meltQuoteOutput: melt,
        mintQuoteOutputs: [remainder],
      }),
    ).rejects.toThrow('does not support transactions');
  });

  test('pays a melt from a quote, prices the quote input, and returns change in blanks', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 100 });
    const bodies = serveTransaction();
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const result = await transact(wallet, {
      mintQuoteInputs: [{ quote, amount: 8 }],
      meltQuoteOutput: melt,
      mintQuoteOutputs: [remainder],
    });
    const [body] = bodies;
    expect(result.response.state).toBe('PAID');
    // 8 in, 6 melt, 1 fee (popcount 1 * 100 ppk rounds up): a 1-sat proof and a blank for the reserve.
    expect(body.blinded_outputs.map((o: any) => o.amount)).toEqual([1, 0]);
    expect(body).toMatchObject({
      proof_inputs: [],
      melt_quote_outputs: [{ quote: 'quote-melt-0001', fee_reserve: 1 }],
      mint_quote_outputs: [{ pubkey: remainderKey }],
    });
    expect(body.mint_quote_inputs[0]).toMatchObject({ quote: 'quote-mint-0001', amount: 8 });
    // The quote signs over the outputs, the melt output (amount + fee reserve) and the remainder
    // quote, named by the melt.
    const tx = inputsForPayload({
      mintQuoteInputs: [{ quoteId: 'quote-mint-0001', amount: 8, lockKey: pubkey, issued: 0 }],
      blindedOutputs: body.blinded_outputs,
      meltQuoteOutput: { quoteId: 'quote-melt-0001', amount: 6 },
      mintQuoteOutputs: [{ pubkey: remainderKey, quoteId: remainderId }],
    });
    const [signature] = JSON.parse(body.mint_quote_inputs[0].witness).signatures;
    expect(schnorrVerifyDigest(signature, tx.quotes.get('quote-mint-0001')!.digest, pubkey)).toBe(
      true,
    );
  });

  test('a rehydrated preview resends the same transaction', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    const bodies = serveTransaction();
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const preview = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote, amount: 8 }],
      meltQuoteOutput: melt,
      mintQuoteOutputs: [remainder],
    });
    await wallet.completeTransaction(preview, privkey);
    const stored = JSON.parse(JSON.stringify(serializeTransactionPreview(preview)));
    await wallet.completeTransaction(deserializeTransactionPreview(stored), privkey);
    const strip = (b: any) => ({
      ...b,
      mint_quote_inputs: b.mint_quote_inputs.map((q: any) => q.quote),
    });
    expect(strip(bodies[1])).toEqual(strip(bodies[0]));
  });

  test('checkTransaction reads a pending transaction from its melt quote and remainder quote', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    let meltState = 'PENDING';
    const fetched: string[] = [];
    server.use(
      http.post(mintUrl + '/v1/transaction', () =>
        HttpResponse.json({
          state: 'PENDING',
          signatures: [],
          melt_quotes: [],
          mint_quotes: [null],
        }),
      ),
      http.get(mintUrl + '/v1/melt/quote/bolt11/:id', ({ params }) =>
        HttpResponse.json({ ...meltQuoteJson, quote: params.id, state: meltState }),
      ),
      http.get(mintUrl + '/v1/mint/quote/txout/:id', ({ params }) => {
        fetched.push(params.id as string);
        return HttpResponse.json(txoutQuoteJson(params.id as string, 2));
      }),
    );
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const preview = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote, amount: 8 }],
      meltQuoteOutput: melt,
      mintQuoteOutputs: [remainder],
    });
    const first = await wallet.completeTransaction(preview, privkey);
    expect(first.response.state).toBe('PENDING');
    const pending = await wallet.checkTransaction(preview);
    expect(pending.response).toMatchObject({ state: 'PENDING', mint_quotes: [null] });
    expect(fetched).toEqual([]);
    meltState = 'PAID';
    const settled = await wallet.checkTransaction(preview);
    expect(settled.response.state).toBe('PAID');
    expect(fetched).toEqual([remainderId]);
    expect(settled.response.mint_quotes[0]).toMatchObject({ quote: remainderId, method: 'txout' });
    // A released payment leaves the melt quote UNPAID.
    meltState = 'UNPAID';
    expect((await wallet.checkTransaction(preview)).response.state).toBe('FAILED');
  });

  test('checkTransaction reads a remainder quote never created as null, and needs a melt', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    server.use(
      http.get(mintUrl + '/v1/melt/quote/bolt11/:id', ({ params }) =>
        HttpResponse.json({ ...meltQuoteJson, quote: params.id, state: 'PAID' }),
      ),
      http.get(mintUrl + '/v1/mint/quote/txout/:id', () =>
        HttpResponse.json({ detail: 'quote not found', code: 20010 }, { status: 400 }),
      ),
    );
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const preview = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote, amount: 8 }],
      meltQuoteOutput: melt,
      mintQuoteOutputs: [remainder],
    });
    const result = await wallet.checkTransaction(preview);
    expect(result.response).toMatchObject({ state: 'PAID', mint_quotes: [null] });
    // A failed fetch is not an answer: the remainder quote may hold the outputs' value.
    server.use(http.get(mintUrl + '/v1/mint/quote/txout/:id', () => HttpResponse.error()));
    await expect(wallet.checkTransaction(preview)).rejects.toThrow();
    server.use(
      http.get(mintUrl + '/v1/mint/quote/txout/:id', () =>
        HttpResponse.json({ detail: 'internal error' }, { status: 500 }),
      ),
    );
    await expect(wallet.checkTransaction(preview)).rejects.toThrow();
    // nutshell answers any unexpected failure as a 400 with code 0: still not a "not found".
    server.use(
      http.get(mintUrl + '/v1/mint/quote/txout/:id', () =>
        HttpResponse.json({ detail: 'database is locked', code: 0 }, { status: 400 }),
      ),
    );
    await expect(wallet.checkTransaction(preview)).rejects.toThrow('database is locked');
    const swap = await wallet.prepareTransaction({ mintQuoteInputs: [{ quote, amount: 8 }] });
    await expect(wallet.checkTransaction(swap)).rejects.toThrow('only a transaction with a melt');
  });

  test('waitForSettlementMs polls a PENDING reply until it settles', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    let polls = 0;
    server.use(
      http.post(mintUrl + '/v1/transaction', () =>
        HttpResponse.json({
          state: 'PENDING',
          signatures: [],
          melt_quotes: [],
          mint_quotes: [null],
        }),
      ),
      http.get(mintUrl + '/v1/melt/quote/bolt11/:id', ({ params }) => {
        polls++;
        return HttpResponse.json({ ...meltQuoteJson, quote: params.id, state: 'PAID' });
      }),
      http.get(mintUrl + '/v1/mint/quote/txout/:id', ({ params }) =>
        HttpResponse.json(txoutQuoteJson(params.id as string, 2)),
      ),
    );
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const preview = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote, amount: 8 }],
      meltQuoteOutput: melt,
      mintQuoteOutputs: [remainder],
    });
    const result = await wallet.completeTransaction(preview, privkey, {
      waitForSettlementMs: 5_000,
    });
    expect(polls).toBe(1);
    expect(result.response.state).toBe('PAID');
  });

  test('a NUT-30 melt carries its fee_index and signs over that option', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    const bodies = serveTransaction();
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const onchain = {
      method: 'bolt11',
      quote: {
        quote: 'quote-melt-0001',
        amount: Amount.from(5),
        fee_options: [
          { fee_index: 0, fee_reserve: 1 },
          { fee_index: 1, fee_reserve: 3 },
        ],
      },
      feeIndex: 1,
    };
    await transact(wallet, {
      mintQuoteInputs: [{ quote, amount: 8 }],
      meltQuoteOutput: onchain,
      mintQuoteOutputs: [remainder],
    });
    expect(bodies[0].melt_quote_outputs).toEqual([
      { quote: 'quote-melt-0001', fee_reserve: 3, fee_index: 1 },
    ]);
    const { digest } = inputsForPayload({
      mintQuoteInputs: [{ quoteId: 'quote-mint-0001', amount: 8, lockKey: pubkey, issued: 0 }],
      blindedOutputs: bodies[0].blinded_outputs,
      meltQuoteOutput: { quoteId: 'quote-melt-0001', amount: 8 },
      mintQuoteOutputs: [{ pubkey: remainderKey, quoteId: remainderId }],
    }).quotes.get('quote-mint-0001')!;
    const [signature] = JSON.parse(bodies[0].mint_quote_inputs[0].witness).signatures;
    expect(schnorrVerifyDigest(signature, digest, pubkey)).toBe(true);
  });

  test('refuses what would lose or misprice value', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 100 });
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    // 7 in, 6 melt, 1 fee: no proofs, one blank for the reserve, and no remainder quote needed.
    const exact = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote, amount: 7 }],
      meltQuoteOutput: melt,
    });
    expect(exact.amount.isZero()).toBe(true);
    expect(exact.outputData.map((d) => d.blindedMessage.amount.toNumber())).toEqual([0]);
    expect(exact.mintQuoteOutputs).toEqual([]);
    // 7 in, 6 melt, 1 fee (popcount 3 * 100 ppk rounds up to 1): nothing left for 1 more.
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 7 }],
        proofOutputs: { amount: 1 },
        meltQuoteOutput: melt,
        mintQuoteOutputs: [remainder],
      }),
    ).rejects.toThrow('must equal');
    // The remainder quote backs a melt's outputs: one at most, never without both.
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 8 }],
        mintQuoteOutputs: [remainder],
      }),
    ).rejects.toThrow('needs a melt');
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 8 }],
        meltQuoteOutput: melt,
        mintQuoteOutputs: [remainder, remainder],
      }),
    ).rejects.toThrow('at most one');
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 5 }],
        meltQuoteOutput: {
          method: 'bolt11',
          quote: { quote: 'quote-melt-0001', amount: Amount.from(4), fee_reserve: Amount.from(0) },
        },
        mintQuoteOutputs: [remainder],
      }),
    ).rejects.toThrow('needs blinded outputs');
    // A slim melt quote cannot say what the digest binds.
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 8 }],
        meltQuoteOutput: {
          method: 'bolt11',
          quote: { quote: 'quote-melt-0001', amount: Amount.from(5) },
        },
        mintQuoteOutputs: [remainder],
      }),
    ).rejects.toThrow('full melt quote');
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 8 }],
        meltQuoteOutput: {
          method: 'bolt11',
          quote: { quote: 'quote-melt-0001', fee_reserve: Amount.from(1) } as any,
        },
        mintQuoteOutputs: [remainder],
      }),
    ).rejects.toThrow('full melt quote');
    // fee_index belongs only to a quote offering fee_options.
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 8 }],
        meltQuoteOutput: { ...melt, feeIndex: 0 },
        mintQuoteOutputs: [remainder],
      }),
    ).rejects.toThrow('offering fee_options');
  });
  test('a fixed txout quote without idPreimage takes an id bound to the inputs', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0, fixed_txout_quotes: true });
    const bodies = serveTransaction();
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const fixed = { pubkey: remainderKey, idPreimage: '11'.repeat(32), amount: 3 };
    const fixedId = derivedQuoteId(Buffer.from(fixed.idPreimage, 'hex'));
    const preview = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote, amount: 8 }],
      mintQuoteOutputs: [fixed, { pubkey: remainderKey, amount: 5 }],
    });
    // k counts every mint quote output, so the bound one is at 1.
    const boundId = inputBoundQuoteId(
      { mintQuoteInputs: [{ quoteId: quote.quote, amount: 8n, lockKey: pubkey, issued: 0n }] },
      1,
    );
    expect(preview.amount.isZero()).toBe(true);
    expect(preview.mintQuoteOutputs).toEqual([
      { quote: fixedId, ...fixed, amount: Amount.from(3) },
      { quote: boundId, pubkey: remainderKey, amount: Amount.from(5) },
    ]);
    const stored = JSON.parse(JSON.stringify(serializeTransactionPreview(preview)));
    expect(deserializeTransactionPreview(stored).mintQuoteOutputs).toEqual(
      preview.mintQuoteOutputs,
    );
    await wallet.completeTransaction(preview, privkey);
    const [body] = bodies;
    expect(body.mint_quote_outputs).toEqual([
      { id_preimage: fixed.idPreimage, pubkey: remainderKey, amount: 3 },
      { pubkey: remainderKey, amount: 5 },
    ]);
    // The quote signs over the input-bound id, as the mint computes it.
    const tx = inputsForPayload({
      mintQuoteInputs: [{ quoteId: quote.quote, amount: 8, lockKey: pubkey, issued: 0 }],
      mintQuoteOutputs: [
        { pubkey: remainderKey, quoteId: fixedId, amount: 3 },
        { pubkey: remainderKey, quoteId: boundId, amount: 5 },
      ],
    });
    const [signature] = JSON.parse(body.mint_quote_inputs[0].witness).signatures;
    expect(schnorrVerifyDigest(signature, tx.quotes.get(quote.quote)!.digest, pubkey)).toBe(true);
  });

  test('fixed txout quotes are paid out of the inputs, and refused where the mint would', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0, fixed_txout_quotes: true });
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const fixed = { pubkey: remainderKey, idPreimage: '11'.repeat(32), amount: 3 };
    const other = {
      pubkey: '03fff97bd5755eeea420453a14355235d382f6472f8568a18b2f057a1460297556',
      idPreimage: '22'.repeat(32),
    };
    // 8 in, 3 to the fixed quote: the new proofs take 5.
    const preview = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote, amount: 8 }],
      mintQuoteOutputs: [fixed],
    });
    expect(preview.amount).toEqual(Amount.from(5));
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 8 }],
        mintQuoteOutputs: [{ ...fixed, amount: 9 }],
      }),
    ).rejects.toThrow('do not cover');
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 8 }],
        mintQuoteOutputs: [fixed, { ...other, amount: 1, idPreimage: fixed.idPreimage }],
      }),
    ).rejects.toThrow('must not repeat');
    for (const idPreimage of [null, '11'.repeat(31), 'zz'.repeat(32)]) {
      await expect(
        wallet.prepareTransaction({
          mintQuoteInputs: [{ quote, amount: 8 }],
          mintQuoteOutputs: [{ ...fixed, idPreimage: idPreimage as string }],
        }),
      ).rejects.toThrow('32-byte hex idPreimage');
    }
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 8 }],
        mintQuoteOutputs: [{ ...fixed, amount: 0 }],
      }),
    ).rejects.toThrow('must be positive');
    // Lock keys may repeat.
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 8 }],
        mintQuoteOutputs: [fixed, { ...other, pubkey: remainderKey, amount: 5 }],
      }),
    ).resolves.toMatchObject({ amount: Amount.zero() });
    // Value in a txout quote cannot hop to another one.
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [
          { quote: { ...quote, method: 'txout', amount_paid: Amount.from(8) }, amount: 8 },
        ],
        mintQuoteOutputs: [fixed],
      }),
    ).rejects.toThrow('cannot pay into a fixed txout quote');
    // A fixed quote beside the remainder quote, and never two remainders.
    const withMelt = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote, amount: 16 }],
      meltQuoteOutput: melt,
      mintQuoteOutputs: [fixed, remainder],
    });
    expect(withMelt.mintQuoteOutputs.map((c) => c.quote)).toEqual([
      derivedQuoteId(Buffer.from(fixed.idPreimage, 'hex')),
      remainderId,
    ]);
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 16 }],
        meltQuoteOutput: melt,
        mintQuoteOutputs: [remainder, remainder],
      }),
    ).rejects.toThrow('at most one');
    // A mint without fixed_txout_quotes takes only the remainder quote.
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    const plain = new Wallet(mintUrl, { unit });
    await plain.loadMint();
    await expect(
      plain.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 8 }],
        mintQuoteOutputs: [fixed],
      }),
    ).rejects.toThrow('does not accept fixed txout quotes');
  });

  test('checkTransaction treats a missing fixed txout quote as an error', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0, fixed_txout_quotes: true });
    server.use(
      http.get(mintUrl + '/v1/melt/quote/bolt11/:id', ({ params }) =>
        HttpResponse.json({ ...meltQuoteJson, quote: params.id, state: 'PAID' }),
      ),
      http.get(mintUrl + '/v1/mint/quote/txout/:id', () =>
        HttpResponse.json({ detail: 'quote not found', code: 20010 }, { status: 400 }),
      ),
    );
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const preview = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote, amount: 8 }],
      meltQuoteOutput: melt,
      mintQuoteOutputs: [
        { pubkey: remainderKey, idPreimage: '22'.repeat(32), amount: 1 },
        remainder,
      ],
    });
    await expect(wallet.checkTransaction(preview)).rejects.toThrow('quote not found');
  });

  test('swaps proofs into new proofs, and a rehydrated preview unblinds the same', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    const bodies: any[] = [];
    server.use(
      http.post(mintUrl + '/v1/transaction', async ({ request }) => {
        const body: any = await request.json();
        bodies.push(body);
        return HttpResponse.json({
          state: 'PAID',
          signatures: body.blinded_outputs.map((b: any) => ({
            id: b.id,
            amount: b.amount,
            C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
          })),
          melt_quotes: [],
          mint_quotes: [],
        });
      }),
    );
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const proofs: Proof[] = [1, 2].map((n) => ({
      id: '00bd033559de27d0',
      amount: Amount.from(n),
      secret: `secret-${n}`,
      C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
    }));
    const preview = await wallet.prepareTransaction({ proofInputs: proofs });
    expect(preview.amount.toNumber()).toBe(3);
    const stored = JSON.parse(JSON.stringify(serializeTransactionPreview(preview)));
    const result = await wallet.completeTransaction(
      deserializeTransactionPreview(stored),
      privkey,
      {
        preferAsync: true,
      },
    );
    expect(bodies[0].prefer_async).toBe(true);
    expect(bodies[0].proof_inputs.map((p: any) => p.secret)).toEqual(['secret-1', 'secret-2']);
    expect(result.proofs.map((p) => p.amount.toNumber()).sort()).toEqual([1, 2]);
    expect(result.proofs[0].id).toBe('00bd033559de27d0');
  });

  test('a sign callback signs the quote input, and a wrong signature is refused', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    const bodies = serveTransaction();
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const preview = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote, amount: 8 }],
      meltQuoteOutput: melt,
    });
    const signed: string[] = [];
    const signer = (key: string) => async (ctx: { digest: Uint8Array; quoteId: string }) => {
      signed.push(ctx.quoteId);
      return schnorrSignDigest(ctx.digest, key);
    };
    await wallet.completeTransaction(preview, undefined, { sign: signer(privkey) });
    expect(signed).toEqual(['quote-mint-0001']);
    expect(bodies).toHaveLength(1);
    await expect(
      wallet.completeTransaction(preview, undefined, { sign: signer(privkey.replace(/1$/, '2')) }),
    ).rejects.toThrow('does not verify');
    expect(bodies).toHaveLength(1);
  });

  test('rejects a malformed transaction record', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    server.use(
      http.post(mintUrl + '/v1/transaction', () =>
        HttpResponse.json({ digest: 'ab'.repeat(32), state: 'DONE', signatures: [] }),
      ),
    );
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    await expect(
      transact(wallet, {
        mintQuoteInputs: [{ quote, amount: 8 }],
      }),
    ).rejects.toThrow('Invalid response from mint');
  });
  test('an explicit proof amount must balance, and blanks still take the melt change', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const meltQuoteOutput = {
      method: 'bolt11',
      quote: { quote: 'quote-melt-0001', amount: Amount.from(5), fee_reserve: Amount.from(2) },
    };
    const preview = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote, amount: 16 }],
      proofOutputs: { amount: 9 },
      meltQuoteOutput,
      mintQuoteOutputs: [remainder],
    });
    expect(preview.amount).toEqual(Amount.from(9));
    expect(preview.outputData.some((d) => d.blindedMessage.amount.isZero())).toBe(true);
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 16 }],
        proofOutputs: { amount: 0 },
        meltQuoteOutput,
        mintQuoteOutputs: [remainder],
      }),
    ).rejects.toThrow('must equal');
  });

  test('a melt returns its change in blank outputs, the zero ones omitted', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    const bodies: any[] = [];
    server.use(
      http.post(mintUrl + '/v1/transaction', async ({ request }) => {
        const body: any = await request.json();
        bodies.push(body);
        // Change 2 fills the first blank; the trailing three stay at zero.
        const imprint = [1, 2];
        return HttpResponse.json({
          state: 'PAID',
          signatures: imprint.map((amount) => ({
            id: body.blinded_outputs[0].id,
            amount,
            C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
          })),
          melt_quotes: [],
          mint_quotes: [null],
        });
      }),
    );
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const result = await transact(wallet, {
      mintQuoteInputs: [{ quote, amount: 13 }],
      meltQuoteOutput: {
        method: 'bolt11',
        quote: { quote: 'quote-melt-0001', amount: Amount.from(5), fee_reserve: Amount.from(7) },
      },
      mintQuoteOutputs: [remainder],
    });
    // The 1 sat surplus is a fixed output; on this {1, 2} keyset a change of 7 is 2+2+2+1, so four
    // blanks cover the reserve.
    expect(bodies[0].blinded_outputs.map((o: any) => o.amount)).toEqual([1, 0, 0, 0, 0]);
    expect(result.proofs.map((p) => p.amount.toNumber())).toEqual([1, 2]);
  });

  test('a melt whose outputs lost their keyset returns their value in the remainder quote', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    server.use(
      http.post(mintUrl + '/v1/transaction', () =>
        HttpResponse.json({
          state: 'PAID',
          signatures: [],
          melt_quotes: [
            { quote: 'quote-melt-0001', amount: 5, fee_reserve: 1, unit, state: 'PAID', expiry: 0 },
          ],
          mint_quotes: [
            {
              quote: remainderId,
              request: '',
              unit,
              amount: 2,
              amount_paid: 2,
              amount_issued: 0,
              state: 'PAID',
              expiry: null,
              pubkey: remainderKey,
            },
          ],
        }),
      ),
    );
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const preview = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote, amount: 8 }],
      meltQuoteOutput: melt,
      mintQuoteOutputs: [remainder],
    });
    expect(preview.outputData.map((d) => d.blindedMessage.amount.toNumber())).toEqual([2, 0]);
    const result = await wallet.completeTransaction(preview, privkey);
    expect(result.response.state).toBe('PAID');
    expect(result.proofs).toEqual([]);
    expect(result.response.mint_quotes[0]!.amount_paid.toNumber()).toBe(2);
  });

  test('a melt without a remainder quote forfeits unsigned outputs without throwing', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    server.use(
      http.post(mintUrl + '/v1/transaction', () =>
        HttpResponse.json({ state: 'PAID', signatures: [], melt_quotes: [], mint_quotes: [] }),
      ),
    );
    const warn = vi.fn();
    const logger = {
      error: vi.fn(),
      warn,
      info: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      log: vi.fn(),
    };
    const wallet = new Wallet(mintUrl, { unit, logger });
    await wallet.loadMint();
    const result = await transact(wallet, {
      mintQuoteInputs: [{ quote, amount: 8 }],
      meltQuoteOutput: melt,
    });
    expect(result.proofs).toEqual([]);
    expect(warn).toHaveBeenCalledWith(
      'Mint did not sign the transaction outputs and there is no remainder quote',
      expect.anything(),
    );
  });

  test('createRemainderLockKey derives from the melt quote id when seeded', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    const seed = new Uint8Array(64).fill(1);
    const wallet = new Wallet(mintUrl, { unit, bip39seed: seed });
    await wallet.loadMint();
    const lock = wallet.createRemainderLockKey('quote-melt-0001');
    const mintPubkey = mintInfoResp.pubkey;
    expect(lock.privkey).toBe(
      Buffer.from(deriveRemainderLockKey(seed, mintPubkey, 'quote-melt-0001')).toString('hex'),
    );
    // No counter: the same melt quote id recovers the same key.
    expect(wallet.createRemainderLockKey('quote-melt-0001')).toEqual(lock);
    const unseeded = new Wallet(mintUrl, { unit });
    await unseeded.loadMint();
    expect(unseeded.createRemainderLockKey('quote-melt-0001').pubkey).not.toBe(lock.pubkey);
  });

  test('a seeded wallet backs a melt with outputs with its remainder quote by default', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    const seeded = new Wallet(mintUrl, { unit, bip39seed: new Uint8Array(64).fill(1) });
    await seeded.loadMint();
    const meltTx = { mintQuoteInputs: [{ quote, amount: 8 }], meltQuoteOutput: melt };
    const auto = await seeded.prepareTransaction(meltTx);
    expect(auto.mintQuoteOutputs).toEqual([
      { quote: remainderId, pubkey: seeded.createRemainderLockKey('quote-melt-0001').pubkey },
    ]);
    // `[]` opts out, a swap has nothing to back, and an unseeded wallet has no key to recover.
    expect(
      (await seeded.prepareTransaction({ ...meltTx, mintQuoteOutputs: [] })).mintQuoteOutputs,
    ).toEqual([]);
    expect(
      (await seeded.prepareTransaction({ mintQuoteInputs: [{ quote, amount: 8 }] }))
        .mintQuoteOutputs,
    ).toEqual([]);
    const unseeded = new Wallet(mintUrl, { unit });
    await unseeded.loadMint();
    expect((await unseeded.prepareTransaction(meltTx)).mintQuoteOutputs).toEqual([]);
    // A mint publishing no identity scopes no key, so none is added.
    server.use(
      http.get(mintUrl + '/v1/info', () =>
        HttpResponse.json({
          ...mintInfoResp,
          pubkey: undefined,
          nuts: { ...mintInfoResp.nuts, XX: { supported: true, quote_input_fee_ppk: 0 } },
        }),
      ),
    );
    const anonymous = new Wallet(mintUrl, { unit, bip39seed: new Uint8Array(64).fill(1) });
    await anonymous.loadMint();
    expect((await anonymous.prepareTransaction(meltTx)).mintQuoteOutputs).toEqual([]);
  });

  test('a quote input named by id and method is read from the mint', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    const fetched: string[] = [];
    server.use(
      http.get(mintUrl + '/v1/mint/quote/bolt11/:id', ({ params }) => {
        fetched.push(params.id as string);
        const { amount_paid, amount_issued, ...rest } = quote;
        return HttpResponse.json({
          ...rest,
          quote: params.id,
          request: 'lnbc1',
          state: 'PAID',
          amount: 64,
          amount_paid: amount_paid.toNumber(),
          amount_issued: amount_issued.toNumber(),
          expiry: null,
          ...(params.id === 'unlocked' && { pubkey: undefined }),
        });
      }),
    );
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const preview = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote: { quote: 'quote-mint-0001', method: 'bolt11' }, amount: 8 }],
    });
    expect(fetched).toEqual(['quote-mint-0001']);
    expect(preview.mintQuoteInputs).toEqual([
      { quote: 'quote-mint-0001', pubkey, amount: Amount.from(8), issued: Amount.from(0) },
    ]);
    // A full quote is taken as given.
    await wallet.prepareTransaction({ mintQuoteInputs: [{ quote, amount: 8 }] });
    expect(fetched).toHaveLength(1);
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote: { quote: 'unlocked', method: 'bolt11' }, amount: 8 }],
      }),
    ).rejects.toThrow('must be locked');
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote: { quote: 'q' } as typeof quote, amount: 8 }],
      }),
    ).rejects.toThrow('needs its method');
  });

  test('a txout quote is drawn only in full, in a transaction or by its mint route', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const txout = {
      ...quote,
      method: 'txout',
      unit,
      amount_paid: Amount.from(5),
      amount_issued: Amount.from(0),
    };
    await expect(
      wallet.prepareTransaction({ mintQuoteInputs: [{ quote: txout, amount: 3 }] }),
    ).rejects.toThrow('redeems in full');
    await expect(
      wallet.prepareTransaction({ mintQuoteInputs: [{ quote: txout, amount: 5 }] }),
    ).resolves.toMatchObject({ amount: Amount.from(5) });
    await expect(wallet.prepareMint('txout', 3, txout, { privkey })).rejects.toThrow(
      'redeems in full',
    );
  });

  test('refuses an overdraw of a partly issued quote, and binds its issued amount', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    const bodies: any[] = [];
    server.use(
      http.post(mintUrl + '/v1/transaction', async ({ request }) => {
        const body: any = await request.json();
        bodies.push(body);
        return HttpResponse.json({
          state: 'PAID',
          signatures: body.blinded_outputs.map((b: any) => ({
            id: b.id,
            amount: b.amount,
            C_: pubkey,
          })),
          melt_quotes: [],
          mint_quotes: [],
        });
      }),
    );
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const partial = { ...quote, unit, amount_paid: Amount.from(8), amount_issued: Amount.from(5) };
    await expect(
      wallet.prepareTransaction({ mintQuoteInputs: [{ quote: partial, amount: 4 }] }),
    ).rejects.toThrow('only 3 available');
    const result = await transact(wallet, { mintQuoteInputs: [{ quote: partial, amount: 3 }] });
    expect(result.proofs.map((p) => p.amount.toNumber()).sort()).toEqual([1, 2]);
    // The witness binds the quote's state: 5 already issued.
    const digestAt = (issued: number) =>
      inputsForPayload({
        mintQuoteInputs: [{ quoteId: 'quote-mint-0001', amount: 3, lockKey: pubkey, issued }],
        blindedOutputs: bodies[0].blinded_outputs,
      }).quotes.get('quote-mint-0001')!.digest;
    const [signature] = JSON.parse(bodies[0].mint_quote_inputs[0].witness).signatures;
    expect(schnorrVerifyDigest(signature, digestAt(5), pubkey)).toBe(true);
    expect(schnorrVerifyDigest(signature, digestAt(0), pubkey)).toBe(false);
  });

  test('rounds proof fees and quote popcounts together exactly once', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 200 });
    server.use(
      http.get(mintUrl + '/v1/keysets', () =>
        HttpResponse.json({
          keysets: dummyKeysetResp.keysets.map((k) => ({ ...k, input_fee_ppk: 400 })),
        }),
      ),
    );
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const preview = await wallet.prepareTransaction({
      proofInputs: [
        {
          id: dummyKeysetResp.keysets[0].id,
          amount: Amount.from(8),
          secret: 'fee-input',
          C: pubkey,
        },
      ],
      mintQuoteInputs: [{ quote: { ...quote, unit }, amount: 7 }],
    });
    // 400 + popcount(7) * 200 = 1000 ppk: rounding each source separately costs 2.
    expect(preview.fee).toEqual(Amount.from(1));
    expect(preview.amount).toEqual(Amount.from(14));
  });

  test('reserves disjoint deterministic outputs and persists their counters', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    const wallet = new Wallet(mintUrl, { unit, bip39seed: new Uint8Array(64).fill(1) });
    await wallet.loadMint();
    const onCountersReserved = vi.fn();
    const transaction = { mintQuoteInputs: [{ quote, amount: 3 }] };
    const first = await wallet.prepareTransaction(transaction, { onCountersReserved });
    const second = await wallet.prepareTransaction(transaction, { onCountersReserved });
    expect(onCountersReserved.mock.calls.map(([range]) => range)).toEqual([
      expect.objectContaining({ start: 0, count: 2, next: 2 }),
      expect.objectContaining({ start: 2, count: 2, next: 4 }),
    ]);
    expect(await wallet.counters.peekNext(first.outputData[0].blindedMessage.id)).toBe(4);
    expect(
      new Set([...first.outputData, ...second.outputData].map((d) => d.blindedMessage.B_)).size,
    ).toBe(4);
    const restored = deserializeTransactionPreview(
      JSON.parse(JSON.stringify(serializeTransactionPreview(first))),
    );
    expect(restored.outputData.map((d) => d.blindedMessage)).toEqual(
      first.outputData.map((d) => d.blindedMessage),
    );
  });

  test('blank outputs follow an explicit counter instead of reusing it', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    const wallet = new Wallet(mintUrl, { unit, bip39seed: new Uint8Array(64).fill(1) });
    await wallet.loadMint();
    const preview = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote, amount: 8 }],
      proofOutputs: { outputType: { type: 'deterministic', counter: 100 } },
      meltQuoteOutput: melt,
      mintQuoteOutputs: [remainder],
    });
    expect(preview.outputData.map((d) => d.blindedMessage.amount.toNumber())).toEqual([2, 0]);
    // The output takes counter 100 and the blank 101, so the cursor sits after both.
    expect(await wallet.counters.peekNext(preview.outputData[0].blindedMessage.id)).toBe(102);
  });

  test('custom outputs made only of blanks are sent, and need a melt', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const { outputData: fixed } = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote, amount: 1 }],
    });
    const blanks = fixed.map((d) => ({
      ...d,
      blindedMessage: { ...d.blindedMessage, amount: Amount.zero() },
    })) as typeof fixed;
    const outputType = { type: 'custom' as const, data: blanks };
    const preview = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote, amount: 6 }],
      proofOutputs: { outputType },
      meltQuoteOutput: melt,
      mintQuoteOutputs: [remainder],
    });
    expect(preview.outputData).toHaveLength(blanks.length);
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 8 }],
        proofOutputs: { outputType },
      }),
    ).rejects.toThrow('only beside a melt');
    // Custom outputs bring their own blanks; the wallet adds none.
    const bare = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote, amount: 6 }],
      proofOutputs: { outputType },
      meltQuoteOutput: melt,
    });
    expect(bare.outputData).toHaveLength(blanks.length);
  });

  test('refuses a balance the output keyset cannot represent', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    // A keyset without the 1 sat key cannot hold 3 sat in proofs.
    const twoOnly = { '2': dummyKeysResp.keysets[0].keys['2'] };
    const id = deriveKeysetId(twoOnly, { versionByte: 0 });
    const keyset = { ...dummyKeysetResp.keysets[0], id };
    const keysResp = () => HttpResponse.json({ keysets: [{ ...keyset, keys: twoOnly }] });
    server.use(
      http.get(mintUrl + '/v1/keys', keysResp),
      http.get(mintUrl + `/v1/keys/${id}`, keysResp),
      http.get(mintUrl + '/v1/keysets', () => HttpResponse.json({ keysets: [keyset] })),
    );
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    await expect(
      wallet.prepareTransaction({ mintQuoteInputs: [{ quote, amount: 3 }] }),
    ).rejects.toThrow('Unable to split');
  });

  test('custom outputs determine the proof total, which must balance', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const { outputData } = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote, amount: 3 }],
    });
    const custom = { outputType: { type: 'custom' as const, data: outputData } };
    const preview = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote, amount: 3 }],
      proofOutputs: custom,
    });
    expect(preview.amount).toEqual(Amount.from(3));
    expect(preview.outputData.map((d) => d.blindedMessage)).toEqual(
      outputData.map((d) => d.blindedMessage),
    );
    await expect(
      wallet.prepareTransaction({ mintQuoteInputs: [{ quote, amount: 8 }], proofOutputs: custom }),
    ).rejects.toThrow('must equal');
  });

  test.each(['PENDING', 'FAILED'] as const)(
    '%s with reserved outputs returns no proofs and a null remainder quote',
    async (state) => {
      serveInfo({ supported: true, quote_input_fee_ppk: 0 });
      const wallet = new Wallet(mintUrl, { unit });
      await wallet.loadMint();
      const preview = await wallet.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 8 }],
        proofOutputs: { amount: 2 },
        meltQuoteOutput: { ...melt, quote: { ...melt.quote, unit } },
        mintQuoteOutputs: [remainder],
      });
      server.use(
        http.post(mintUrl + '/v1/transaction', () =>
          HttpResponse.json({
            state,
            signatures: [],
            melt_quotes: [],
            mint_quotes: [null],
          }),
        ),
      );
      const result = await wallet.completeTransaction(preview, privkey);
      expect(result.response).toMatchObject({
        state,
        mint_quotes: [null],
      });
      expect(result.proofs).toEqual([]);
    },
  );

  test('recovers signed outputs from the melt quote after a lost POST response', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const preview = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote, amount: 9 }],
      proofOutputs: { amount: 3 },
      meltQuoteOutput: melt,
      mintQuoteOutputs: [remainder],
    });
    const stored = JSON.parse(JSON.stringify(serializeTransactionPreview(preview)));
    const posted = vi.fn();
    server.use(
      http.post(mintUrl + '/v1/transaction', () => {
        posted();
        return HttpResponse.error();
      }),
      http.get(mintUrl + '/v1/melt/quote/bolt11/:id', ({ params }) =>
        HttpResponse.json({
          ...meltQuoteJson,
          quote: params.id,
          state: 'PAID',
          change: preview.outputData.map((d) => ({
            id: d.blindedMessage.id,
            amount: d.blindedMessage.amount,
            C_: pubkey,
          })),
        }),
      ),
      http.get(mintUrl + '/v1/mint/quote/txout/:id', ({ params }) =>
        HttpResponse.json(txoutQuoteJson(params.id as string, 1)),
      ),
    );
    await expect(wallet.completeTransaction(preview, privkey)).rejects.toThrow();
    expect(posted).toHaveBeenCalled();
    const recovered = await wallet.checkTransaction(deserializeTransactionPreview(stored));
    expect(recovered.proofs.map((p) => p.amount.toNumber()).sort()).toEqual([1, 2]);
    expect(recovered.response.mint_quotes[0]).toMatchObject({ quote: remainderId });
    const again = await wallet.checkTransaction(deserializeTransactionPreview(stored));
    expect(again.proofs).toEqual(recovered.proofs);
  });

  test('v3 script-path witnesses and receipts bind quote inputs, the melt and the remainder quote', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    server.use(
      http.get(mintUrl + '/v1/keysets', () =>
        HttpResponse.json({ keysets: [NUT02_V3_VECTOR1_KEYSET] }),
      ),
      http.get(mintUrl + '/v1/keys', () => HttpResponse.json({ keysets: [NUT02_V3_VECTOR1_KEYS] })),
    );
    const bodies = serveTransaction();
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const built = buildNutrootSecret(remainderKey, [{ type: 'threshold', n: 1, keys: [pubkey] }]);
    const input: Proof = {
      id: NUT02_V3_VECTOR1_KEYSET.id,
      amount: Amount.from(8),
      secret: built.secret,
      C: NUT02_V3_VECTOR1_KEYS.keys['1'],
      spend_info: { k: '0'.repeat(63) + '5', tree: built.tree },
    };
    const preview = await wallet.prepareTransaction({
      proofInputs: [input],
      mintQuoteInputs: [{ quote, amount: 8 }],
      meltQuoteOutput: melt,
      mintQuoteOutputs: [remainder],
    });
    const result = await wallet.completeTransaction(preview, privkey, {
      scriptPath: [{ secret: input.secret, leafIndex: 0 }],
    });
    expect(result.receipts).toHaveLength(1);
    expect(bodies[0].proof_inputs[0]).not.toHaveProperty('spend_info');
    const tx = inputsForPayload({
      proofInputs: [input],
      mintQuoteInputs: [{ quoteId: quote.quote, amount: 8, lockKey: pubkey, issued: 0 }],
      blindedOutputs: bodies[0].blinded_outputs,
      meltQuoteOutput: { quoteId: 'quote-melt-0001', amount: 6 },
      mintQuoteOutputs: [{ pubkey: remainderKey, quoteId: remainderId }],
    });
    const digest = [...tx.proofs.values()][0].digest;
    const witness = JSON.parse(bodies[0].proof_inputs[0].witness);
    expect(witness.leaf).toBe(built.tree[0]);
    expect(witness.control.K).toBe(remainderKey);
    expect(schnorrVerifyDigest(witness.signatures[0], digest, pubkey)).toBe(true);
    expect(result.receipts![0].inputDigest).toBe(Buffer.from(digest).toString('hex'));
    const changed = inputsForPayload({
      proofInputs: [input],
      mintQuoteInputs: [{ quoteId: quote.quote, amount: 7, lockKey: pubkey, issued: 0 }],
      blindedOutputs: bodies[0].blinded_outputs,
      meltQuoteOutput: { quoteId: 'quote-melt-0001', amount: 6 },
      mintQuoteOutputs: [{ pubkey: remainderKey, quoteId: remainderId }],
    });
    expect(
      schnorrVerifyDigest(witness.signatures[0], [...changed.proofs.values()][0].digest, pubkey),
    ).toBe(false);
  });

  // Review regression: metadata warnings must not prevent recovery of settled proofs.
  test('an extra null mint quote entry does not discard settled proofs', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const preview = await wallet.prepareTransaction({ mintQuoteInputs: [{ quote, amount: 1 }] });
    server.use(
      http.post(mintUrl + '/v1/transaction', () =>
        HttpResponse.json({
          state: 'PAID',
          melt_quotes: [],
          mint_quotes: [null],
          signatures: preview.outputData.map((d) => ({
            id: d.blindedMessage.id,
            amount: d.blindedMessage.amount,
            C_: pubkey,
          })),
        }),
      ),
    );
    const result = await wallet.completeTransaction(preview, privkey);
    expect(result.proofs).toHaveLength(1);
    expect(result.proofs[0].amount).toEqual(Amount.from(1));
  });

  test('warns when a txout quote comes back under a different id', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    const warn = vi.fn();
    const logger = {
      error: vi.fn(),
      warn,
      info: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      log: vi.fn(),
    };
    server.use(
      http.post(mintUrl + '/v1/transaction', () =>
        HttpResponse.json({
          state: 'PAID',
          signatures: [],
          melt_quotes: [],
          mint_quotes: [txoutQuoteJson('other-id', 8)],
        }),
      ),
    );
    const wallet = new Wallet(mintUrl, { unit, logger });
    await wallet.loadMint();
    const result = await transact(wallet, {
      mintQuoteInputs: [{ quote, amount: 8 }],
      meltQuoteOutput: melt,
      mintQuoteOutputs: [remainder],
    });
    expect(result.response.mint_quotes[0]).toMatchObject({ quote: 'other-id' });
    expect(warn).toHaveBeenCalledWith(
      'Mint returned a txout quote under a different id',
      expect.objectContaining({ expected: remainderId, received: 'other-id' }),
    );
  });

  test.each([
    { name: 'short', signatures: [], error: '0 signatures for 1 outputs' },
    {
      name: 'wrong amount',
      signatures: [{ id: '00bd033559de27d0', amount: 2, C_: pubkey }],
      error: 'wrong amount',
    },
    {
      name: 'wrong keyset',
      signatures: [{ id: '00aaaaaaaaaaaaaa', amount: 1, C_: pubkey }],
      error: 'does not match output',
    },
  ])(
    'rejects a $name settled signature response with recovery advice',
    async ({ signatures, error }) => {
      serveInfo({ supported: true, quote_input_fee_ppk: 0 });
      const wallet = new Wallet(mintUrl, { unit });
      await wallet.loadMint();
      const preview = await wallet.prepareTransaction({ mintQuoteInputs: [{ quote, amount: 1 }] });
      server.use(
        http.post(mintUrl + '/v1/transaction', () =>
          HttpResponse.json({
            state: 'PAID',
            signatures,
            melt_quotes: [],
            mint_quotes: [],
          }),
        ),
      );
      await expect(wallet.completeTransaction(preview, privkey)).rejects.toThrow(error);
      await expect(wallet.completeTransaction(preview, privkey)).rejects.toThrow('NUT-09');
    },
  );

  test('rejects unknown NUT-30 fee selections before signing', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    for (const feeIndex of [undefined, 2]) {
      await expect(
        wallet.prepareTransaction({
          mintQuoteInputs: [{ quote, amount: 8 }],
          meltQuoteOutput: {
            ...melt,
            quote: { ...melt.quote, fee_options: [{ fee_index: 0, fee_reserve: 1 }] },
            feeIndex,
          },
          mintQuoteOutputs: [remainder],
        }),
      ).rejects.toThrow('selected feeIndex');
    }
  });
});
