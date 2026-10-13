import { HttpResponse, http } from 'msw';
import { describe, expect, test, vi } from 'vitest';

import { Wallet, deserializeTransactionPreview, serializeTransactionPreview } from '../../src';
import { schnorrSignDigest, schnorrVerifyDigest } from '../../src/crypto';
import { buildNutrootSecret } from '../../src/crypto/nutroot';
import { derivedQuoteId, inputsForPayload } from '../../src/crypto/transcript';
import { Amount } from '../../src/model/Amount';
import type { Proof } from '../../src/model/types';
import { NUT02_V3_VECTOR1_KEYS, NUT02_V3_VECTOR1_KEYSET } from '../consts';

import { dummyKeysetResp, mintInfoResp, mintUrl, unit, useTestServer } from './_setup';

const server = useTestServer();
const privkey = '0000000000000000000000000000000000000000000000000000000000000001';
const pubkey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const changeKey = '022f8bde4d1a07209355b4a7250a5c5128e88b84bddc619ab7cba8d569b240efe4';
const change = { pubkey: changeKey, idPreimage: '11'.repeat(32) };
const changeId = derivedQuoteId(Buffer.from(change.idPreimage, 'hex'));
const quote = { quote: 'quote-mint-0001', pubkey, amount_issued: Amount.from(0) };
const melt = {
  method: 'bolt11',
  quote: { quote: 'quote-melt-0001', amount: Amount.from(5), fee_reserve: Amount.from(1) },
};

const meltQuoteJson = { amount: 5, fee_reserve: 1, unit, request: 'lnbc1', expiry: 0 };
const changeQuoteJson = (id: string, amount: number) => ({
  quote: id,
  request: '',
  unit,
  amount,
  amount_paid: amount,
  amount_issued: 0,
  state: 'PAID',
  expiry: null,
  pubkey: changeKey,
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
        change_quotes: [],
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
        changeQuoteOutputs: [change],
      }),
    ).rejects.toThrow('does not support transactions');
  });

  test('pays a melt from a quote, prices the quote input, and parks the rest as change', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 100 });
    const bodies = serveTransaction();
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const result = await transact(wallet, {
      mintQuoteInputs: [{ quote, amount: 8 }],
      meltQuoteOutput: melt,
      changeQuoteOutputs: [change],
    });
    const [body] = bodies;
    expect(result.response.state).toBe('PAID');
    expect(result.proofs).toEqual([]);
    expect(body).toMatchObject({
      proof_inputs: [],
      blinded_outputs: [],
      melt_quote_outputs: [{ quote: 'quote-melt-0001', fee_reserve: 1 }],
      change_quote_outputs: [{ id_preimage: change.idPreimage, pubkey: changeKey }],
    });
    expect(body.mint_quote_inputs[0]).toMatchObject({ quote: 'quote-mint-0001', amount: 8 });
    // The quote signs over the melt output (amount + fee reserve) and the change quote.
    const tx = inputsForPayload({
      mintQuoteInputs: [{ quoteId: 'quote-mint-0001', amount: 8, lockKey: pubkey, issued: 0 }],
      meltQuoteOutput: { quoteId: 'quote-melt-0001', amount: 6 },
      changeQuoteOutputs: [{ pubkey: changeKey, quoteId: changeId }],
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
      changeQuoteOutputs: [change],
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

  test('checkTransaction reads a pending transaction from its melt quote and change quotes', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    let meltState = 'PENDING';
    const fetched: string[] = [];
    server.use(
      http.post(mintUrl + '/v1/transaction', () =>
        HttpResponse.json({
          state: 'PENDING',
          signatures: [],
          melt_quotes: [],
          change_quotes: [null],
        }),
      ),
      http.get(mintUrl + '/v1/melt/quote/bolt11/:id', ({ params }) =>
        HttpResponse.json({ ...meltQuoteJson, quote: params.id, state: meltState }),
      ),
      http.get(mintUrl + '/v1/mint/quote/change/:id', ({ params }) => {
        fetched.push(params.id as string);
        return HttpResponse.json(changeQuoteJson(params.id as string, 2));
      }),
    );
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const preview = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote, amount: 8 }],
      meltQuoteOutput: melt,
      changeQuoteOutputs: [change],
    });
    const first = await wallet.completeTransaction(preview, privkey);
    expect(first.response.state).toBe('PENDING');
    const pending = await wallet.checkTransaction(preview);
    expect(pending.response).toMatchObject({ state: 'PENDING', change_quotes: [null] });
    expect(fetched).toEqual([]);
    meltState = 'PAID';
    const settled = await wallet.checkTransaction(preview);
    expect(settled.response.state).toBe('PAID');
    expect(fetched).toEqual([changeId]);
    expect(settled.response.change_quotes[0]).toMatchObject({ quote: changeId, method: 'change' });
    // A released payment leaves the melt quote UNPAID.
    meltState = 'UNPAID';
    expect((await wallet.checkTransaction(preview)).response.state).toBe('FAILED');
  });

  test('checkTransaction reads a missing remainder quote as zero change, and needs a melt', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    server.use(
      http.get(mintUrl + '/v1/melt/quote/bolt11/:id', ({ params }) =>
        HttpResponse.json({ ...meltQuoteJson, quote: params.id, state: 'PAID' }),
      ),
      http.get(mintUrl + '/v1/mint/quote/change/:id', () =>
        HttpResponse.json({ detail: 'quote not found', code: 20007 }, { status: 400 }),
      ),
    );
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const fixed = { pubkey: changeKey, idPreimage: '22'.repeat(32), amount: 1 };
    const preview = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote, amount: 8 }],
      meltQuoteOutput: melt,
      changeQuoteOutputs: [change],
    });
    const result = await wallet.checkTransaction(preview);
    expect(result.response).toMatchObject({ state: 'PAID', change_quotes: [null] });
    // A fixed change quote always exists once PAID, so a failed fetch is an error.
    const withFixed = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote, amount: 8 }],
      meltQuoteOutput: melt,
      changeQuoteOutputs: [fixed, change],
    });
    await expect(wallet.checkTransaction(withFixed)).rejects.toThrow('quote not found');
    const swap = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote, amount: 8 }],
      changeQuoteOutputs: [change],
    });
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
          change_quotes: [null],
        }),
      ),
      http.get(mintUrl + '/v1/melt/quote/bolt11/:id', ({ params }) => {
        polls++;
        return HttpResponse.json({ ...meltQuoteJson, quote: params.id, state: 'PAID' });
      }),
      http.get(mintUrl + '/v1/mint/quote/change/:id', ({ params }) =>
        HttpResponse.json(changeQuoteJson(params.id as string, 2)),
      ),
    );
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const preview = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote, amount: 8 }],
      meltQuoteOutput: melt,
      changeQuoteOutputs: [change],
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
      changeQuoteOutputs: [change],
    });
    expect(bodies[0].melt_quote_outputs).toEqual([
      { quote: 'quote-melt-0001', fee_reserve: 3, fee_index: 1 },
    ]);
    const { digest } = inputsForPayload({
      mintQuoteInputs: [{ quoteId: 'quote-mint-0001', amount: 8, lockKey: pubkey, issued: 0 }],
      meltQuoteOutput: { quoteId: 'quote-melt-0001', amount: 8 },
      changeQuoteOutputs: [{ pubkey: changeKey, quoteId: changeId }],
    }).quotes.get('quote-mint-0001')!;
    const [signature] = JSON.parse(bodies[0].mint_quote_inputs[0].witness).signatures;
    expect(schnorrVerifyDigest(signature, digest, pubkey)).toBe(true);
  });

  test('refuses what would lose or misprice value', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 100 });
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    // Without a change quote the unspent fee reserve would stay with the mint.
    await expect(
      wallet.prepareTransaction({ mintQuoteInputs: [{ quote, amount: 7 }], meltQuoteOutput: melt }),
    ).rejects.toThrow('needs a remainder quote');
    // Unless the caller knowingly gives it up: 7 in, 6 melt, 1 fee, nothing left over.
    const forfeit = await wallet.prepareTransaction(
      { mintQuoteInputs: [{ quote, amount: 7 }], meltQuoteOutput: melt },
      { forfeitFeeReserve: true },
    );
    expect(forfeit.amount.isZero()).toBe(true);
    // 7 in, 6 melt, 1 fee (popcount 3 * 100 ppk rounds up to 1): nothing left for 1 more.
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 7 }],
        proofOutputs: { amount: 1 },
        meltQuoteOutput: melt,
        changeQuoteOutputs: [change],
      }),
    ).rejects.toThrow('must equal');
    // New proofs beside a melt need a change quote, even when the reserve is given up: the mint
    // cannot sign them if their keyset rotates during the payment.
    await expect(
      wallet.prepareTransaction(
        {
          mintQuoteInputs: [{ quote, amount: 8 }],
          proofOutputs: { amount: 1 },
          meltQuoteOutput: melt,
        },
        { forfeitFeeReserve: true },
      ),
    ).rejects.toThrow('cannot be signed if their keyset rotates');
    // A slim melt quote cannot say what the digest binds.
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 8 }],
        meltQuoteOutput: {
          method: 'bolt11',
          quote: { quote: 'quote-melt-0001', amount: Amount.from(5) },
        },
        changeQuoteOutputs: [change],
      }),
    ).rejects.toThrow('full melt quote');
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 8 }],
        meltQuoteOutput: {
          method: 'bolt11',
          quote: { quote: 'quote-melt-0001', fee_reserve: Amount.from(1) } as any,
        },
        changeQuoteOutputs: [change],
      }),
    ).rejects.toThrow('full melt quote');
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote: { quote: 'q', amount_issued: Amount.from(0) }, amount: 8 }],
      }),
    ).rejects.toThrow('must be locked');
    // fee_index belongs only to a quote offering fee_options.
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 8 }],
        meltQuoteOutput: { ...melt, feeIndex: 0 },
        changeQuoteOutputs: [change],
      }),
    ).rejects.toThrow('offering fee_options');
  });
  test('a fixed change quote is paid out of the inputs; the remainder quote takes the rest', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    const bodies = serveTransaction();
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const other = {
      pubkey: '03fff97bd5755eeea420453a14355235d382f6472f8568a18b2f057a1460297556',
      idPreimage: '22'.repeat(32),
    };
    const otherId = derivedQuoteId(Buffer.from(other.idPreimage, 'hex'));
    // 8 in, 3 to the fixed quote, the remainder quote takes 5: no new proofs by default.
    const preview = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote, amount: 8 }],
      changeQuoteOutputs: [{ ...change, amount: 3 }, other],
    });
    expect(preview.amount.isZero()).toBe(true);
    expect(preview.changeQuoteOutputs).toEqual([
      { quote: changeId, ...change, amount: Amount.from(3) },
      { quote: otherId, ...other },
    ]);
    const stored = JSON.parse(JSON.stringify(serializeTransactionPreview(preview)));
    expect(deserializeTransactionPreview(stored).changeQuoteOutputs).toEqual(
      preview.changeQuoteOutputs,
    );
    await wallet.completeTransaction(preview, privkey);
    expect(bodies[0].change_quote_outputs).toEqual([
      { id_preimage: change.idPreimage, pubkey: changeKey, amount: 3 },
      { id_preimage: other.idPreimage, pubkey: other.pubkey },
    ]);
    // Without a remainder quote the fixed quotes and new proofs must use the inputs exactly.
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 8 }],
        changeQuoteOutputs: [{ ...change, amount: 3 }],
      }),
    ).resolves.toMatchObject({ amount: Amount.from(5) });
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 8 }],
        changeQuoteOutputs: [{ ...change, amount: 9 }],
      }),
    ).rejects.toThrow('do not cover');
    // What the mint would reject is refused before anything is signed.
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 8 }],
        changeQuoteOutputs: [change, other],
      }),
    ).rejects.toThrow('at most one');
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 8 }],
        changeQuoteOutputs: [
          { ...change, amount: 3 },
          { ...other, idPreimage: change.idPreimage },
        ],
      }),
    ).rejects.toThrow('must not repeat');
    for (const idPreimage of [undefined, '11'.repeat(31), 'zz'.repeat(32)]) {
      await expect(
        wallet.prepareTransaction({
          mintQuoteInputs: [{ quote, amount: 8 }],
          changeQuoteOutputs: [{ pubkey: changeKey, idPreimage: idPreimage as string }],
        }),
      ).rejects.toThrow('32-byte hex idPreimage');
    }
    // Lock keys may repeat.
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 8 }],
        changeQuoteOutputs: [
          { ...change, amount: 3 },
          { ...other, pubkey: changeKey },
        ],
      }),
    ).resolves.toMatchObject({ amount: Amount.zero() });
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 8 }],
        changeQuoteOutputs: [{ ...change, amount: 0 }],
      }),
    ).rejects.toThrow('must be positive');
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
          change_quotes: [],
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
      changeQuoteOutputs: [change],
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
        changeQuoteOutputs: [change],
      }),
    ).rejects.toThrow('Invalid response from mint');
  });
  test('a melt whose outputs lost their keyset returns them as change, not proofs', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    server.use(
      http.post(mintUrl + '/v1/transaction', () =>
        HttpResponse.json({
          state: 'PAID',
          signatures: [],
          melt_quotes: [
            { quote: 'quote-melt-0001', amount: 5, fee_reserve: 1, unit, state: 'PAID', expiry: 0 },
          ],
          change_quotes: [
            {
              quote: changeId,
              request: '',
              unit,
              amount: 2,
              amount_paid: 2,
              amount_issued: 0,
              state: 'PAID',
              expiry: null,
              pubkey: changeKey,
            },
          ],
        }),
      ),
    );
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const preview = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote, amount: 8 }],
      proofOutputs: { amount: 1 },
      meltQuoteOutput: melt,
      changeQuoteOutputs: [change],
    });
    expect(preview.outputData).toHaveLength(1);
    const result = await wallet.completeTransaction(preview, privkey);
    expect(result.response.state).toBe('PAID');
    expect(result.proofs).toEqual([]);
    expect(result.response.change_quotes[0]!.amount_paid.toNumber()).toBe(2);
  });

  test('refuses an overdraw of a partly issued quote, and returns the change quote', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    const bodies: any[] = [];
    server.use(
      http.post(mintUrl + '/v1/transaction', async ({ request }) => {
        bodies.push(await request.json());
        return HttpResponse.json({
          state: 'PAID',
          signatures: [],
          melt_quotes: [],
          change_quotes: [
            {
              quote: changeId,
              request: '',
              unit,
              amount: 3,
              amount_paid: 3,
              amount_issued: 0,
              state: 'PAID',
              expiry: null,
              pubkey: changeKey,
            },
          ],
        });
      }),
    );
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const partial = { ...quote, unit, amount_paid: Amount.from(8), amount_issued: Amount.from(5) };
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote: partial, amount: 4 }],
        changeQuoteOutputs: [change],
      }),
    ).rejects.toThrow('only 3 available');
    const result = await transact(wallet, {
      mintQuoteInputs: [{ quote: partial, amount: 3 }],
      changeQuoteOutputs: [change],
    });
    expect(result.response.change_quotes[0]).toMatchObject({
      quote: changeId,
      method: 'change',
    });
    expect(result.response.change_quotes[0]!.amount_paid.toNumber()).toBe(3);
    // The witness binds the quote's state: 5 already issued.
    const digestAt = (issued: number) =>
      inputsForPayload({
        mintQuoteInputs: [{ quoteId: 'quote-mint-0001', amount: 3, lockKey: pubkey, issued }],
        changeQuoteOutputs: [{ pubkey: changeKey, quoteId: changeId }],
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

  test('custom outputs determine the proof total while the remainder takes the surplus', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const { outputData } = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote, amount: 3 }],
    });
    const preview = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote, amount: 8 }],
      proofOutputs: { outputType: { type: 'custom', data: outputData } },
      changeQuoteOutputs: [change],
    });
    expect(preview.amount).toEqual(Amount.from(3));
    expect(preview.outputData.map((d) => d.blindedMessage)).toEqual(
      outputData.map((d) => d.blindedMessage),
    );
  });

  test.each(['PENDING', 'FAILED'] as const)(
    '%s with reserved outputs returns no proofs and preserves null change',
    async (state) => {
      serveInfo({ supported: true, quote_input_fee_ppk: 0 });
      const wallet = new Wallet(mintUrl, { unit });
      await wallet.loadMint();
      const preview = await wallet.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 8 }],
        proofOutputs: { amount: 1 },
        meltQuoteOutput: { ...melt, quote: { ...melt.quote, unit } },
        changeQuoteOutputs: [change],
      });
      server.use(
        http.post(mintUrl + '/v1/transaction', () =>
          HttpResponse.json({
            state,
            signatures: [],
            melt_quotes: [],
            change_quotes: [null],
          }),
        ),
      );
      const result = await wallet.completeTransaction(preview, privkey);
      expect(result.response).toMatchObject({
        state,
        change_quotes: [null],
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
      changeQuoteOutputs: [change],
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
      http.get(mintUrl + '/v1/mint/quote/change/:id', ({ params }) =>
        HttpResponse.json(changeQuoteJson(params.id as string, 1)),
      ),
    );
    await expect(wallet.completeTransaction(preview, privkey)).rejects.toThrow();
    expect(posted).toHaveBeenCalled();
    const recovered = await wallet.checkTransaction(deserializeTransactionPreview(stored));
    expect(recovered.proofs.map((p) => p.amount.toNumber()).sort()).toEqual([1, 2]);
    expect(recovered.response.change_quotes[0]).toMatchObject({ quote: changeId });
    const again = await wallet.checkTransaction(deserializeTransactionPreview(stored));
    expect(again.proofs).toEqual(recovered.proofs);
  });

  test('v3 script-path witnesses and receipts bind both quote inputs and change outputs', async () => {
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
    const built = buildNutrootSecret(changeKey, [{ type: 'threshold', n: 1, keys: [pubkey] }]);
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
      changeQuoteOutputs: [change],
    });
    const result = await wallet.completeTransaction(preview, privkey, {
      scriptPath: [{ secret: input.secret, leafIndex: 0 }],
    });
    expect(result.receipts).toHaveLength(1);
    expect(bodies[0].proof_inputs[0]).not.toHaveProperty('spend_info');
    const tx = inputsForPayload({
      proofInputs: [input],
      mintQuoteInputs: [{ quoteId: quote.quote, amount: 8, lockKey: pubkey, issued: 0 }],
      changeQuoteOutputs: [{ pubkey: changeKey, quoteId: changeId }],
    });
    const digest = [...tx.proofs.values()][0].digest;
    const witness = JSON.parse(bodies[0].proof_inputs[0].witness);
    expect(witness.leaf).toBe(built.tree[0]);
    expect(witness.control.K).toBe(changeKey);
    expect(schnorrVerifyDigest(witness.signatures[0], digest, pubkey)).toBe(true);
    expect(result.receipts![0].inputDigest).toBe(Buffer.from(digest).toString('hex'));
    const changed = inputsForPayload({
      proofInputs: [input],
      mintQuoteInputs: [{ quoteId: quote.quote, amount: 7, lockKey: pubkey, issued: 0 }],
      changeQuoteOutputs: [{ pubkey: changeKey, quoteId: changeId }],
    });
    expect(
      schnorrVerifyDigest(witness.signatures[0], [...changed.proofs.values()][0].digest, pubkey),
    ).toBe(false);
  });

  // Review regression: metadata warnings must not prevent recovery of settled proofs.
  test('an extra null change entry does not discard settled proofs', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const preview = await wallet.prepareTransaction({ mintQuoteInputs: [{ quote, amount: 1 }] });
    server.use(
      http.post(mintUrl + '/v1/transaction', () =>
        HttpResponse.json({
          state: 'PAID',
          melt_quotes: [],
          change_quotes: [null],
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

  test('warns when a change quote comes back under a different id, and keeps the proofs', async () => {
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
          change_quotes: [changeQuoteJson('other-id', 8)],
        }),
      ),
    );
    const wallet = new Wallet(mintUrl, { unit, logger });
    await wallet.loadMint();
    const result = await transact(wallet, {
      mintQuoteInputs: [{ quote, amount: 8 }],
      changeQuoteOutputs: [change],
    });
    expect(result.response.change_quotes[0]).toMatchObject({ quote: 'other-id' });
    expect(warn).toHaveBeenCalledWith(
      'Mint returned a change quote under a different id',
      expect.objectContaining({ expected: changeId, received: 'other-id' }),
    );
  });

  test.each([
    { name: 'short', signatures: [], error: '0 signatures, expected 1' },
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
            change_quotes: [],
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
          changeQuoteOutputs: [change],
        }),
      ).rejects.toThrow('selected feeIndex');
    }
  });
});
