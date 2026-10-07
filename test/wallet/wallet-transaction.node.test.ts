import { HttpResponse, http } from 'msw';
import { describe, expect, test } from 'vitest';

import { Wallet, deserializeTransactionPreview, serializeTransactionPreview } from '../../src';
import { schnorrSignDigest, schnorrVerifyDigest } from '../../src/crypto';
import { inputsForPayload } from '../../src/crypto/transcript';
import { Amount } from '../../src/model/Amount';
import type { Proof } from '../../src/model/types';

import { mintInfoResp, mintUrl, unit, useTestServer } from './_setup';

const server = useTestServer();
const privkey = '0000000000000000000000000000000000000000000000000000000000000001';
const pubkey = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const changeKey = '022f8bde4d1a07209355b4a7250a5c5128e88b84bddc619ab7cba8d569b240efe4';
const quote = { quote: 'quote-mint-0001', pubkey };
const melt = {
  method: 'bolt11',
  quote: { quote: 'quote-melt-0001', amount: Amount.from(5), fee_reserve: Amount.from(1) },
};

function serveInfo(xx?: object) {
  server.use(
    http.get(mintUrl + '/v1/info', () =>
      HttpResponse.json({ ...mintInfoResp, nuts: { ...mintInfoResp.nuts, ...(xx && { XX: xx }) } }),
    ),
  );
}

/**
 * Serves `/v1/transaction`, echoing the digest the request's quote input signed, and collects each
 * body.
 */
function serveTransaction(): any[] {
  const bodies: any[] = [];
  server.use(
    http.post(mintUrl + '/v1/transaction', async ({ request }) => {
      const body: any = await request.json();
      bodies.push(body);
      return HttpResponse.json({
        digest: 'ab'.repeat(32),
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
        changeQuoteOutputs: [{ pubkey: changeKey }],
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
      changeQuoteOutputs: [{ pubkey: changeKey }],
    });
    const [body] = bodies;
    expect(result.response.state).toBe('PAID');
    expect(result.proofs).toEqual([]);
    expect(body).toMatchObject({
      proof_inputs: [],
      blinded_outputs: [],
      melt_quote_outputs: [{ quote: 'quote-melt-0001', fee_reserve: 1 }],
      change_quote_outputs: [{ pubkey: changeKey }],
    });
    expect(body.mint_quote_inputs[0]).toMatchObject({ quote: 'quote-mint-0001', amount: 8 });
    // The quote signs over the melt output (amount + fee reserve) and the change key.
    const tx = inputsForPayload({
      mintQuoteInputs: [{ quoteId: 'quote-mint-0001', amount: 8, lockKey: pubkey }],
      meltQuoteOutput: { quoteId: 'quote-melt-0001', amount: 6 },
      changeQuoteOutputs: [{ pubkey: changeKey }],
    });
    const [signature] = JSON.parse(body.mint_quote_inputs[0].witness).signatures;
    expect(schnorrVerifyDigest(signature, tx.quotes.get('quote-mint-0001')!.digest, pubkey)).toBe(
      true,
    );
    // The wallet's own digest wins over the mint's echo.
    expect(result.response.digest).toBe(Buffer.from(tx.transactionDigest).toString('hex'));
  });

  test('a rehydrated preview resends the same transaction', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    const bodies = serveTransaction();
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const preview = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote, amount: 8 }],
      meltQuoteOutput: melt,
      changeQuoteOutputs: [{ pubkey: changeKey }],
    });
    await wallet.completeTransaction(preview, privkey);
    const stored = JSON.parse(JSON.stringify(serializeTransactionPreview(preview)));
    const again = await wallet.completeTransaction(deserializeTransactionPreview(stored), privkey);
    expect(again.response.digest).toBe(preview.digest);
    const strip = (b: any) => ({
      ...b,
      mint_quote_inputs: b.mint_quote_inputs.map((q: any) => q.quote),
    });
    expect(strip(bodies[1])).toEqual(strip(bodies[0]));
  });

  test('checkTransaction polls a pending transaction by its digest', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    let polled: string | undefined;
    server.use(
      http.post(mintUrl + '/v1/transaction', () =>
        HttpResponse.json({
          digest: 'ab'.repeat(32),
          state: 'PENDING',
          signatures: [],
          melt_quotes: [],
          change_quotes: [],
        }),
      ),
      http.get(mintUrl + '/v1/transaction/:digest', ({ params }) => {
        polled = params.digest as string;
        return HttpResponse.json({
          digest: polled,
          state: 'PAID',
          signatures: [],
          melt_quotes: [],
          change_quotes: [],
        });
      }),
    );
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const preview = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote, amount: 8 }],
      changeQuoteOutputs: [{ pubkey: changeKey }],
    });
    const first = await wallet.completeTransaction(preview, privkey);
    expect(first.response.state).toBe('PENDING');
    const settled = await wallet.checkTransaction(preview);
    expect(polled).toBe(preview.digest);
    expect(settled.response.state).toBe('PAID');
  });

  test('waitForSettlementMs polls a PENDING reply until it settles', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    let polls = 0;
    server.use(
      http.post(mintUrl + '/v1/transaction', () =>
        HttpResponse.json({
          digest: 'ab'.repeat(32),
          state: 'PENDING',
          signatures: [],
          melt_quotes: [],
          change_quotes: [],
        }),
      ),
      http.get(mintUrl + '/v1/transaction/:digest', ({ params }) => {
        polls++;
        return HttpResponse.json({
          digest: params.digest,
          state: 'PAID',
          signatures: [],
          melt_quotes: [],
          change_quotes: [],
        });
      }),
    );
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const preview = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote, amount: 8 }],
      changeQuoteOutputs: [{ pubkey: changeKey }],
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
      changeQuoteOutputs: [{ pubkey: changeKey }],
    });
    expect(bodies[0].melt_quote_outputs).toEqual([
      { quote: 'quote-melt-0001', fee_reserve: 3, fee_index: 1 },
    ]);
    const { digest } = inputsForPayload({
      mintQuoteInputs: [{ quoteId: 'quote-mint-0001', amount: 8, lockKey: pubkey }],
      meltQuoteOutput: { quoteId: 'quote-melt-0001', amount: 8 },
      changeQuoteOutputs: [{ pubkey: changeKey }],
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
        changeQuoteOutputs: [{ pubkey: changeKey }],
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
        changeQuoteOutputs: [{ pubkey: changeKey }],
      }),
    ).rejects.toThrow('full melt quote');
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 8 }],
        meltQuoteOutput: {
          method: 'bolt11',
          quote: { quote: 'quote-melt-0001', fee_reserve: Amount.from(1) } as any,
        },
        changeQuoteOutputs: [{ pubkey: changeKey }],
      }),
    ).rejects.toThrow('full melt quote');
    await expect(
      wallet.prepareTransaction({ mintQuoteInputs: [{ quote: { quote: 'q' }, amount: 8 }] }),
    ).rejects.toThrow('must be locked');
    // fee_index belongs only to a quote offering fee_options.
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 8 }],
        meltQuoteOutput: { ...melt, feeIndex: 0 },
        changeQuoteOutputs: [{ pubkey: changeKey }],
      }),
    ).rejects.toThrow('offering fee_options');
  });
  test('a fixed change quote is paid out of the inputs; the remainder quote takes the rest', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    const bodies = serveTransaction();
    const wallet = new Wallet(mintUrl, { unit });
    await wallet.loadMint();
    const other = '03fff97bd5755eeea420453a14355235d382f6472f8568a18b2f057a1460297556';
    // 8 in, 3 to the fixed quote, the remainder quote takes 5: no new proofs by default.
    const preview = await wallet.prepareTransaction({
      mintQuoteInputs: [{ quote, amount: 8 }],
      changeQuoteOutputs: [{ pubkey: changeKey, amount: 3 }, { pubkey: other }],
    });
    expect(preview.amount.isZero()).toBe(true);
    expect(preview.changeQuoteOutputs).toEqual([
      { pubkey: changeKey, amount: Amount.from(3) },
      { pubkey: other },
    ]);
    const stored = JSON.parse(JSON.stringify(serializeTransactionPreview(preview)));
    expect(deserializeTransactionPreview(stored).changeQuoteOutputs).toEqual(
      preview.changeQuoteOutputs,
    );
    await wallet.completeTransaction(preview, privkey);
    expect(bodies[0].change_quote_outputs).toEqual([
      { pubkey: changeKey, amount: 3 },
      { pubkey: other },
    ]);
    // Without a remainder quote the fixed quotes and new proofs must use the inputs exactly.
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 8 }],
        changeQuoteOutputs: [{ pubkey: changeKey, amount: 3 }],
      }),
    ).resolves.toMatchObject({ amount: Amount.from(5) });
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 8 }],
        changeQuoteOutputs: [{ pubkey: changeKey, amount: 9 }],
      }),
    ).rejects.toThrow('do not cover');
    // What the mint would reject is refused before anything is signed.
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 8 }],
        changeQuoteOutputs: [{ pubkey: changeKey }, { pubkey: other }],
      }),
    ).rejects.toThrow('at most one');
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote, amount: 8 }],
        changeQuoteOutputs: [{ pubkey: changeKey, amount: 0 }],
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
          digest: 'ab'.repeat(32),
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
      changeQuoteOutputs: [{ pubkey: changeKey }],
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
        changeQuoteOutputs: [{ pubkey: changeKey }],
      }),
    ).rejects.toThrow('Invalid response from mint');
  });
  test('a melt whose outputs lost their keyset returns them as change, not proofs', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    server.use(
      http.post(mintUrl + '/v1/transaction', () =>
        HttpResponse.json({
          digest: 'ab'.repeat(32),
          state: 'PAID',
          signatures: [],
          melt_quotes: [
            { quote: 'quote-melt-0001', amount: 5, fee_reserve: 1, unit, state: 'PAID', expiry: 0 },
          ],
          change_quotes: [
            {
              quote: 'change-0002',
              request: 'ab'.repeat(32),
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
      changeQuoteOutputs: [{ pubkey: changeKey }],
    });
    expect(preview.outputData).toHaveLength(1);
    const result = await wallet.completeTransaction(preview, privkey);
    expect(result.response.state).toBe('PAID');
    expect(result.proofs).toEqual([]);
    expect(result.response.change_quotes[0]!.amount_paid.toNumber()).toBe(2);
  });

  test('refuses an overdraw of a partly issued quote, and returns the change quote', async () => {
    serveInfo({ supported: true, quote_input_fee_ppk: 0 });
    server.use(
      http.post(mintUrl + '/v1/transaction', () =>
        HttpResponse.json({
          digest: 'ab'.repeat(32),
          state: 'PAID',
          signatures: [],
          melt_quotes: [],
          change_quotes: [
            {
              quote: 'change-0001',
              request: 'ab'.repeat(32),
              unit,
              amount: 3,
              amount_paid: 3,
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
    const partial = { ...quote, unit, amount_paid: Amount.from(8), amount_issued: Amount.from(5) };
    await expect(
      wallet.prepareTransaction({
        mintQuoteInputs: [{ quote: partial, amount: 4 }],
        changeQuoteOutputs: [{ pubkey: changeKey }],
      }),
    ).rejects.toThrow('only 3 available');
    const result = await transact(wallet, {
      mintQuoteInputs: [{ quote: partial, amount: 3 }],
      changeQuoteOutputs: [{ pubkey: changeKey }],
    });
    expect(result.response.change_quotes[0]).toMatchObject({
      quote: 'change-0001',
      method: 'change',
    });
    expect(result.response.change_quotes[0]!.amount_paid.toNumber()).toBe(3);
  });
});
