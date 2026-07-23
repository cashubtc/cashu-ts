import { randomBytes } from '@noble/hashes/utils.js';
import { HttpResponse, http } from 'msw';
import { test, describe, expect, vi } from 'vitest';

import {
  Wallet,
  type Proof,
  type ProofLike,
  type MeltQuoteBolt11Response,
  MeltQuoteState,
  OutputData,
  type SerializedOutputData,
  type SerializedBlindedSignature,
  type MeltQuoteBolt12Response,
  type AuthProvider,
  type OutputType,
  Amount,
} from '../../src';

import { useTestServer, mint, mintUrl, unit, invoice, logger, mintInfoResp } from './_setup';

const server = useTestServer();
const mintInfoRespWithNut12 = {
  ...mintInfoResp,
  nuts: { ...mintInfoResp.nuts, 12: { supported: true } },
};

describe('melt proofs', () => {
  test('test melt proofs base case', async () => {
    server.use(
      http.post(mintUrl + '/v1/melt/bolt11', () => {
        return HttpResponse.json({
          quote: 'test_melt_quote',
          amount: 10,
          unit: 'sat',
          fee_reserve: 3,
          state: MeltQuoteState.PAID,
          expiry: 1234567890,
          payment_preimage: 'preimage',
          request: 'bolt11request',
          change: [
            {
              id: '00bd033559de27d0',
              amount: 1,
              C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
            },
            {
              id: '00bd033559de27d0',
              amount: 2,
              C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
            },
          ],
        });
      }),
    );
    const wallet = new Wallet(mint, { unit, logger });
    await wallet.loadMint();

    const meltQuote: MeltQuoteBolt11Response = {
      quote: 'test_melt_quote',
      amount: Amount.from(10),
      fee_reserve: Amount.from(3),
      request: 'bolt11request',
      state: MeltQuoteState.UNPAID,
      expiry: 1234567890,
      payment_preimage: null,
      unit: 'sat',
    };
    const proofsToSend: Proof[] = [
      {
        id: '00bd033559de27d0',
        amount: Amount.from(8),
        secret: 'secret1',
        C: 'C1',
      },
      {
        id: '00bd033559de27d0',
        amount: Amount.from(5),
        secret: 'secret2',
        C: 'C2',
      },
    ]; // sum=13, feeReserve=3, amount=10
    const response = await wallet.meltProofsBolt11(meltQuote, proofsToSend);

    expect(response.quote.state).toBe(MeltQuoteState.PAID);
    expect(response.quote.payment_preimage).toBe('preimage');
    expect(response.change).toHaveLength(2);
    expect(response.change[0]).toMatchObject({ amount: Amount.from(1), id: '00bd033559de27d0' });
    expect(response.change[1]).toMatchObject({ amount: Amount.from(2), id: '00bd033559de27d0' });
    expect(/[0-9a-f]{64}/.test(response.change[0].C)).toBe(true);
    expect(/[0-9a-f]{64}/.test(response.change[0].secret)).toBe(true);
  });

  test('test melt proofs no change', async () => {
    server.use(
      http.post(mintUrl + '/v1/melt/bolt11', () => {
        return HttpResponse.json({
          quote: 'test_melt_quote',
          amount: 12,
          unit: 'sat',
          fee_reserve: 0,
          state: MeltQuoteState.PAID,
          expiry: 1234567890,
          payment_preimage: 'preimage',
          request: 'bolt11request',
          change: [],
        });
      }),
    );
    const wallet = new Wallet(mint, { unit, requireSigDleq: true });
    await wallet.loadMint();

    const meltQuote: MeltQuoteBolt11Response = {
      quote: 'test_melt_quote',
      amount: Amount.from(12),
      fee_reserve: Amount.from(0),
      request: 'bolt11request',
      state: MeltQuoteState.UNPAID,
      expiry: 1234567890,
      payment_preimage: null,
      unit: 'sat',
    };
    const proofsToSend: Proof[] = [
      {
        id: '00bd033559de27d0',
        amount: Amount.from(8),
        secret: 'secret1',
        C: 'C1',
      },
      {
        id: '00bd033559de27d0',
        amount: Amount.from(4),
        secret: 'secret2',
        C: 'C2',
      },
    ]; // sum=12, feeReserve=0
    const response = await wallet.meltProofsBolt11(meltQuote, proofsToSend);

    expect(response.quote.state).toBe(MeltQuoteState.PAID);
    expect(response.quote.payment_preimage).toBe('preimage');
    expect(response.change).toHaveLength(0);
  });

  test('rejects missing DLEQ on melt change when mint advertises NUT-12', async () => {
    server.use(
      http.get(mintUrl + '/v1/info', () => HttpResponse.json(mintInfoRespWithNut12)),
      http.post(mintUrl + '/v1/melt/bolt11', () =>
        HttpResponse.json({
          quote: 'test_melt_quote',
          amount: 10,
          unit: 'sat',
          fee_reserve: 3,
          state: MeltQuoteState.PAID,
          expiry: 1234567890,
          payment_preimage: 'preimage',
          request: 'bolt11request',
          change: [
            {
              id: '00bd033559de27d0',
              amount: 1,
              C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
            },
          ],
        }),
      ),
    );
    const wallet = new Wallet(mint, { unit, requireSigDleq: true });
    await wallet.loadMint();

    const meltQuote: MeltQuoteBolt11Response = {
      quote: 'test_melt_quote',
      amount: Amount.from(10),
      fee_reserve: Amount.from(3),
      request: 'bolt11request',
      state: MeltQuoteState.UNPAID,
      expiry: 1234567890,
      payment_preimage: null,
      unit: 'sat',
    };
    const proofsToSend: Proof[] = [
      {
        id: '00bd033559de27d0',
        amount: Amount.from(8),
        secret: 'secret1',
        C: 'C1',
      },
      {
        id: '00bd033559de27d0',
        amount: Amount.from(5),
        secret: 'secret2',
        C: 'C2',
      },
    ];

    await expect(wallet.meltProofsBolt11(meltQuote, proofsToSend)).rejects.toThrow(
      'Mint supports NUT-12, but returned a signature without DLEQ proof',
    );
  });

  test('test melt proofs accepts deserialized ProofLike[] input', async () => {
    server.use(
      http.post(mintUrl + '/v1/melt/bolt11', () => {
        return HttpResponse.json({
          quote: 'test_melt_quote',
          amount: 12,
          unit: 'sat',
          fee_reserve: 0,
          state: MeltQuoteState.PAID,
          expiry: 1234567890,
          payment_preimage: 'preimage',
          request: 'bolt11request',
          change: [],
        });
      }),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const meltQuote: MeltQuoteBolt11Response = {
      quote: 'test_melt_quote',
      amount: Amount.from(12),
      fee_reserve: Amount.from(0),
      request: 'bolt11request',
      state: MeltQuoteState.UNPAID,
      expiry: 1234567890,
      payment_preimage: null,
      unit: 'sat',
    };
    const storedProofs = JSON.parse(
      JSON.stringify([
        {
          id: '00bd033559de27d0',
          amount: Amount.from(8),
          secret: 'secret1',
          C: 'C1',
        },
        {
          id: '00bd033559de27d0',
          amount: Amount.from(4),
          secret: 'secret2',
          C: 'C2',
        },
      ]),
    ) as ProofLike[];

    const response = await wallet.meltProofsBolt11(meltQuote, storedProofs);
    expect(response.quote.state).toBe(MeltQuoteState.PAID);
    expect(response.change).toHaveLength(0);
  });

  test('test melt proofs pending', async () => {
    server.use(
      http.post(mintUrl + '/v1/melt/bolt11', () => {
        return HttpResponse.json({
          quote: 'test_melt_quote',
          amount: 10,
          unit: 'sat',
          fee_reserve: 3,
          state: MeltQuoteState.UNPAID,
          expiry: 1234567890,
          payment_preimage: null,
          request: 'bolt11request',
          change: null,
        });
      }),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const meltQuote: MeltQuoteBolt11Response = {
      quote: 'test_melt_quote',
      amount: Amount.from(10),
      fee_reserve: Amount.from(3),
      request: 'bolt11request',
      state: MeltQuoteState.UNPAID,
      expiry: 1234567890,
      payment_preimage: null,
      unit: 'sat',
    };
    const proofsToSend: Proof[] = [
      {
        id: '00bd033559de27d0',
        amount: Amount.from(8),
        secret: 'secret1',
        C: 'C1',
      },
      {
        id: '00bd033559de27d0',
        amount: Amount.from(5),
        secret: 'secret2',
        C: 'C2',
      },
    ];
    const response = await wallet.meltProofsBolt11(meltQuote, proofsToSend);

    expect(response.quote.state).toBe(MeltQuoteState.UNPAID);
    expect(response.quote.payment_preimage).toBeNull();
    expect(response.change).toHaveLength(0);
  });

  test('custom OutputType is used as-is in prepareMelt', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const data: OutputData[] = [
      new OutputData(
        {
          amount: Amount.zero(),
          B_: '0280999e99569db86fff252e9fe235d5ab0583c5e48e9a6d30b7159ddb2354a664',
          id: '00bd033559de27d0',
        },
        BigInt('98121968294344218843445436832971329830403131138970027258925944949754607239194'),
        Uint8Array.from([
          50, 57, 102, 56, 100, 55, 54, 101, 102, 97, 54, 49, 54, 99, 51, 102, 97, 48, 57, 49, 99,
          100, 55, 48, 98, 57, 57, 99, 98, 99, 53, 52, 51, 52, 56, 99, 57, 101, 51, 98, 101, 100,
          48, 100, 56, 48, 52, 55, 101, 101, 101, 55, 55, 100, 55, 57, 55, 53, 50, 57, 52, 97, 56,
          51,
        ]),
      ),
      new OutputData(
        {
          amount: Amount.zero(),
          B_: '0366a12d8f642a9209b2a2b62dd46133d67c61395758760b037526d8ea6ebb0b58',
          id: '00bd033559de27d0',
        },
        BigInt('91654934695124838981374963092507707719762522706574178484674131180622854636768'),
        Uint8Array.from([
          102, 102, 48, 100, 56, 97, 98, 53, 100, 101, 97, 97, 101, 51, 57, 55, 101, 50, 53, 102,
          57, 51, 53, 55, 54, 100, 102, 51, 100, 102, 52, 102, 102, 97, 100, 50, 102, 52, 50, 98,
          99, 53, 53, 97, 49, 54, 98, 102, 99, 53, 50, 51, 56, 51, 48, 56, 49, 50, 53, 102, 48, 97,
          51, 101,
        ]),
      ),
    ];

    const customOutputType: OutputType = {
      type: 'custom',
      data: data,
    };
    const meltQuote: MeltQuoteBolt11Response = {
      quote: 'test_melt_quote',
      amount: Amount.from(10),
      fee_reserve: Amount.from(3),
      request: 'bolt11request',
      state: MeltQuoteState.UNPAID,
      expiry: 1234567890,
      payment_preimage: null,
      unit: 'sat',
    };

    const proofsToSend: Proof[] = [
      {
        id: '00bd033559de27d0',
        amount: Amount.from(8),
        secret: 'secret1',
        C: 'C1',
      },
      {
        id: '00bd033559de27d0',
        amount: Amount.from(5),
        secret: 'secret2',
        C: 'C2',
      },
    ];

    const meltTxn = await wallet.prepareMelt(
      'bolt11',
      meltQuote,
      proofsToSend,
      undefined,
      customOutputType,
    );

    // Verify that the custom OutputType was used as-is
    expect(meltTxn.outputData.length).toEqual(2);
    expect(meltTxn.outputData[0].blindedMessage).toEqual(customOutputType.data[0].blindedMessage);
    expect(meltTxn.outputData[1].blindedMessage).toEqual(customOutputType.data[1].blindedMessage);
  });

  test('prepareMelt can skip automatic NUT-08 change outputs', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const meltQuote: MeltQuoteBolt11Response = {
      quote: 'test_melt_quote',
      amount: Amount.from(10),
      fee_reserve: Amount.from(3),
      request: 'bolt11request',
      state: MeltQuoteState.UNPAID,
      expiry: 1234567890,
      payment_preimage: null,
      unit: 'sat',
    };
    const proofsToSend: Proof[] = [
      {
        id: '00bd033559de27d0',
        amount: Amount.from(8),
        secret: 'secret1',
        C: 'C1',
      },
      {
        id: '00bd033559de27d0',
        amount: Amount.from(5),
        secret: 'secret2',
        C: 'C2',
      },
    ];

    const meltTxn = await wallet.prepareMelt('bolt11', meltQuote, proofsToSend, {
      nut08Change: false,
    });

    expect(meltTxn.outputData).toHaveLength(0);
    expect(meltTxn.inputs).toHaveLength(2);
    expect(meltTxn.quote.quote).toBe('test_melt_quote');
  });

  test('prepareMelt works on an inactive keyset when no change is created', async () => {
    // A mint unwinding liabilities deactivates keysets but keeps melt open. Withdrawing with
    // no NUT-08 change creates no outputs, so an inactive keyset must not block the melt.
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    (wallet.getKeyset() as unknown as { _active: boolean })._active = false;

    const meltQuote: MeltQuoteBolt11Response = {
      quote: 'test_melt_quote',
      amount: Amount.from(10),
      fee_reserve: Amount.from(3),
      request: 'bolt11request',
      state: MeltQuoteState.UNPAID,
      expiry: 1234567890,
      payment_preimage: null,
      unit: 'sat',
    };
    const proofsToSend: Proof[] = [
      { id: '00bd033559de27d0', amount: Amount.from(8), secret: 'secret1', C: 'C1' },
      { id: '00bd033559de27d0', amount: Amount.from(5), secret: 'secret2', C: 'C2' },
    ];

    // No change requested: must not throw on the inactive keyset
    const meltTxn = await wallet.prepareMelt('bolt11', meltQuote, proofsToSend, {
      nut08Change: false,
    });
    expect(meltTxn.outputData).toHaveLength(0);
    expect(meltTxn.inputs).toHaveLength(2);

    // Change requested with a non-zero fee reserve: the output gate still applies
    await expect(
      wallet.prepareMelt('bolt11', meltQuote, proofsToSend, { nut08Change: true }),
    ).rejects.toThrow('Melt change keyset is inactive');
  });

  test('prepareMelt uses one NUT-08 blank for a 1-sat fee reserve', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const meltQuote: MeltQuoteBolt11Response = {
      quote: 'test_melt_quote',
      amount: Amount.from(10),
      fee_reserve: Amount.from(1),
      request: 'bolt11request',
      state: MeltQuoteState.UNPAID,
      expiry: 1234567890,
      payment_preimage: null,
      unit: 'sat',
    };
    const proofsToSend: Proof[] = [
      {
        id: '00bd033559de27d0',
        amount: Amount.from(11),
        secret: 'secret1',
        C: 'C1',
      },
    ];

    const meltTxn = await wallet.prepareMelt('bolt11', meltQuote, proofsToSend);

    expect(meltTxn.outputData).toHaveLength(1);
    expect(meltTxn.outputData[0].blindedMessage.amount).toEqual(Amount.zero());
  });

  describe('melt, NUT-08 blanks', () => {
    test('includes zero-amount blanks covering fee reserve (bolt11)', async () => {
      const wallet = new Wallet(mint, { unit, bip39seed: randomBytes(32) });
      await wallet.loadMint();
      const meltQuote: MeltQuoteBolt11Response = {
        quote: 'test_melt_quote',
        amount: Amount.from(10),
        fee_reserve: Amount.from(3), // ceil(log2(3)) = 2 blanks expected
        request: 'bolt11...',
        state: MeltQuoteState.UNPAID,
        expiry: 1234567890,
        payment_preimage: null,
        unit,
      };
      const proofsToSend: Proof[] = [
        {
          id: '00bd033559de27d0',
          amount: Amount.from(8),
          secret: 'secret1',
          C: 'C1',
        },
        {
          id: '00bd033559de27d0',
          amount: Amount.from(5),
          secret: 'secret2',
          C: 'C2',
        },
      ];
      let seenBody: any;
      server.use(
        http.post(mintUrl + '/v1/melt/bolt11', async ({ request }) => {
          const body = await request.json();
          seenBody = body;
          return HttpResponse.json({
            quote: meltQuote.quote,
            amount: meltQuote.amount,
            unit: meltQuote.unit,
            fee_reserve: meltQuote.fee_reserve,
            state: MeltQuoteState.PAID,
            expiry: meltQuote.expiry,
            payment_preimage: 'deadbeef',
            request: meltQuote.request,
            change: [
              {
                id: '00bd033559de27d0',
                amount: 1,
                C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
              },
              {
                id: '00bd033559de27d0',
                amount: 2,
                C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
              },
            ],
          });
        }),
      );
      const res = await wallet.meltProofsBolt11(meltQuote, proofsToSend);
      // console.log('MELTres', res);
      // payload assertions
      expect(seenBody.quote).toBe(meltQuote.quote);
      expect(Array.isArray(seenBody.outputs)).toBe(true);
      expect(seenBody.outputs).toHaveLength(2); // ceil(log2(3)) == 2
      expect(seenBody.outputs.every((o: any) => o.amount === 0)).toBe(true);
      // response sanity (v3 contract)
      expect(res.quote.state).toBe(MeltQuoteState.PAID);
    });

    test('includes zero-amount blanks covering fee reserve (bolt12)', async () => {
      const wallet = new Wallet(mint, { unit, bip39seed: randomBytes(32) });
      await wallet.loadMint();
      const meltQuote: MeltQuoteBolt12Response = {
        quote: 'test_melt_quote',
        amount: Amount.from(10),
        fee_reserve: Amount.from(3),
        request: 'bolt12request',
        state: MeltQuoteState.UNPAID,
        expiry: 1234567890,
        payment_preimage: null,
        unit: 'sat',
      };
      const proofsToSend: Proof[] = [
        {
          id: '00bd033559de27d0',
          amount: Amount.from(8),
          secret: 'secret1',
          C: 'C1',
        },
        {
          id: '00bd033559de27d0',
          amount: Amount.from(5),
          secret: 'secret2',
          C: 'C2',
        },
      ];
      let seenBody: any;
      server.use(
        http.post(mintUrl + '/v1/melt/bolt12', async ({ request }) => {
          const body = await request.json();
          seenBody = body;
          return HttpResponse.json({
            quote: meltQuote.quote,
            amount: meltQuote.amount,
            fee_reserve: meltQuote.fee_reserve,
            unit: meltQuote.unit,
            state: MeltQuoteState.PAID,
            expiry: meltQuote.expiry,
            payment_preimage: 'preimage',
            request: meltQuote.request,
            change: [
              {
                id: '00bd033559de27d0',
                amount: 1,
                C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
              },
              {
                id: '00bd033559de27d0',
                amount: 2,
                C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
              },
            ],
          });
        }),
      );
      const res = await wallet.meltProofsBolt12(meltQuote, proofsToSend);
      // payload assertions
      expect(seenBody.quote).toBe(meltQuote.quote);
      expect(Array.isArray(seenBody.outputs)).toBe(true);
      expect(seenBody.outputs).toHaveLength(2); // ceil(log2(3)) == 2
      expect(seenBody.outputs.every((o: any) => o.amount === 0)).toBe(true);

      // response sanity (v3 contract)
      expect(res.quote.state).toBe(MeltQuoteState.PAID);
      expect(res.change).toHaveLength(2);
      expect(res.change[0]).toMatchObject({ amount: Amount.from(1), id: '00bd033559de27d0' });
    });
  });

  test('test melt proofs bolt12 variant', async () => {
    server.use(
      http.post(mintUrl + '/v1/melt/bolt12', () => {
        return HttpResponse.json({
          quote: 'test_melt_quote',
          amount: 10,
          fee_reserve: 3,
          unit: 'sat',
          state: MeltQuoteState.PAID,
          expiry: 1234567890,
          payment_preimage: 'preimage',
          request: 'bolt12request',
          change: [
            {
              id: '00bd033559de27d0',
              amount: 1,
              C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
            },
            {
              id: '00bd033559de27d0',
              amount: 2,
              C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
            },
          ],
        });
      }),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const meltQuote: MeltQuoteBolt12Response = {
      quote: 'test_melt_quote',
      amount: Amount.from(10),
      fee_reserve: Amount.from(3),
      request: 'bolt12request',
      state: MeltQuoteState.UNPAID,
      expiry: 1234567890,
      payment_preimage: null,
      unit: 'sat',
    };
    const proofsToSend: Proof[] = [
      {
        id: '00bd033559de27d0',
        amount: Amount.from(8),
        secret: 'secret1',
        C: 'C1',
      },
      {
        id: '00bd033559de27d0',
        amount: Amount.from(5),
        secret: 'secret2',
        C: 'C2',
      },
    ];
    const response = await wallet.meltProofsBolt12(meltQuote, proofsToSend);

    expect(response.quote.state).toBe(MeltQuoteState.PAID);
    expect(response.quote.payment_preimage).toBe('preimage');
    expect(response.change).toHaveLength(2);
    expect(response.change[0]).toMatchObject({ amount: Amount.from(1), id: '00bd033559de27d0' });
  });

  test('mint.meltBolt11 rejects response missing state', async () => {
    server.use(
      http.post(mintUrl + '/v1/melt/bolt11', () => {
        return HttpResponse.json({
          quote: 'test_melt_quote',
          amount: 10,
          unit: 'sat',
          fee_reserve: 3,
          expiry: 1234567890,
          // no state field
        });
      }),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    await expect(
      wallet.mint.meltBolt11({ quote: 'test_melt_quote', inputs: [], outputs: [] }),
    ).rejects.toThrow('Invalid response from mint');
  });

  test('test melt proofs mismatch signatures', async () => {
    server.use(
      http.post(mintUrl + '/v1/melt/bolt11', () => {
        return HttpResponse.json({
          quote: 'test_melt_quote',
          amount: 10,
          unit: 'sat',
          fee_reserve: 2,
          state: MeltQuoteState.PAID,
          expiry: 1234567890,
          payment_preimage: 'preimage',
          request: 'bolt11request',
          change: [
            {
              id: '00bd033559de27d0',
              amount: 1,
              C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
            },
            {
              id: '00bd033559de27d0',
              amount: 1,
              C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
            },
            {
              id: '00bd033559de27d0',
              amount: 1,
              C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
            },
          ],
        });
      }),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const meltQuote: MeltQuoteBolt11Response = {
      quote: 'test_melt_quote',
      amount: Amount.from(10),
      fee_reserve: Amount.from(2),
      request: 'bolt11request',
      state: MeltQuoteState.UNPAID,
      expiry: 1234567890,
      payment_preimage: null,
      unit: 'sat',
    };
    const proofsToSend: Proof[] = [
      {
        id: '00bd033559de27d0',
        amount: Amount.from(8),
        secret: 'secret1',
        C: 'C1',
      },
      {
        id: '00bd033559de27d0',
        amount: Amount.from(4),
        secret: 'secret2',
        C: 'C2',
      },
    ];
    const result = await wallet.meltProofsBolt11(meltQuote, proofsToSend).catch((e) => e);

    expect(result.message).toContain('Mint returned 3 signatures, but only 1 blanks were provided');
  });
});

describe('async melt preference body', () => {
  test('hydrates async melt change from a later paid quote response', async () => {
    const wallet = new Wallet(mint, { unit, logger });
    await wallet.loadMint();

    const meltQuote: MeltQuoteBolt11Response = {
      quote: 'q-async-hydrate',
      amount: Amount.from(10),
      fee_reserve: Amount.from(3),
      request: invoice,
      state: MeltQuoteState.PENDING,
      expiry: 1234567890,
      payment_preimage: null,
      unit: 'sat',
    };
    const proofsToSend: Proof[] = [
      {
        id: '00bd033559de27d0',
        amount: Amount.from(8),
        secret: 'secret1',
        C: 'C1',
      },
      {
        id: '00bd033559de27d0',
        amount: Amount.from(5),
        secret: 'secret2',
        C: 'C2',
      },
    ];
    const preview = await wallet.prepareMelt('bolt11', meltQuote, proofsToSend);
    // Simulate storing the prepared output data while the melt is pending
    const stored = JSON.stringify(preview.outputData.map((o) => OutputData.serialize(o)));

    const paidQuote: MeltQuoteBolt11Response = {
      ...meltQuote,
      state: MeltQuoteState.PAID,
      payment_preimage: 'preimage',
      change: [
        {
          id: '00bd033559de27d0',
          amount: Amount.from(1),
          C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
        },
        {
          id: '00bd033559de27d0',
          amount: Amount.from(2),
          C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
        },
      ],
    };
    // Restore and hydrate change once the quote pays
    const restored = (JSON.parse(stored) as SerializedOutputData[]).map((s) =>
      OutputData.deserialize(s),
    );
    const change = wallet.createMeltChangeProofs(restored, paidQuote.change ?? []);
    expect(change).toHaveLength(2);
    expect(change[0]).toMatchObject({ amount: Amount.from(1), id: '00bd033559de27d0' });
    expect(change[1]).toMatchObject({ amount: Amount.from(2), id: '00bd033559de27d0' });
    expect(/[0-9a-f]{64}/.test(change[0].C)).toBe(true);
    expect(/[0-9a-f]{64}/.test(change[0].secret)).toBe(true);
  });

  test('createMeltChangeProofs rejects signature/output keyset id mismatch', async () => {
    const wallet = new Wallet(mint, { unit, logger });
    await wallet.loadMint();

    const output = OutputData.createSingleRandomData(0, '00bd033559de27d0');
    const mismatchedSig: SerializedBlindedSignature = {
      id: '009a1f293253e41e', // different keyset id from the output
      amount: Amount.from(1),
      C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
    };

    expect(() => wallet.createMeltChangeProofs([output], [mismatchedSig])).toThrow(
      /signature keyset id at index 0 does not match output/i,
    );
  });

  test('createMeltChangeProofs surfaces NUT-09 recovery hint when keyset is unknown', async () => {
    const wallet = new Wallet(mint, { unit, logger });
    await wallet.loadMint();

    const unknownKeysetId = 'aaaaaaaaaaaaaaaa'; // not loaded by the test mint
    const output = OutputData.createSingleRandomData(0, unknownKeysetId);
    const sig: SerializedBlindedSignature = {
      id: unknownKeysetId, // matches the output, so pair check passes
      amount: Amount.from(1),
      C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
    };

    expect(() => wallet.createMeltChangeProofs([output], [sig])).toThrow(
      /is not loaded in this wallet.*restoring \(NUT-09\)/is,
    );
  });
  test('completeMelt sends prefer_async when { preferAsync: true } is passed', async () => {
    const meltQuote = {
      quote: 'q-async-boolean',
      amount: Amount.from(1),
      unit: 'sat',
      request: invoice,
      state: 'UNPAID',
      fee_reserve: Amount.from(0),
    } as unknown as MeltQuoteBolt11Response;
    const proofs: Proof[] = [
      {
        id: '00bd033559de27d0',
        amount: Amount.from(1),
        secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
        C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
      },
    ];

    server.use(
      http.post(mintUrl + '/v1/melt/bolt11', async ({ request }) => {
        const body = (await request.json()) as { prefer_async?: boolean };
        expect(body.prefer_async).toBe(true);
        return HttpResponse.json({
          quote: meltQuote.quote,
          amount: meltQuote.amount,
          unit: meltQuote.unit,
          request: meltQuote.request,
          state: 'UNPAID',
          expiry: 1234567890,
          fee_reserve: meltQuote.fee_reserve,
          payment_preimage: null,
          change: [],
        });
      }),
    );

    const debug = vi.fn();
    const wallet = new Wallet(mint, {
      unit,
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug, trace: vi.fn() },
    });
    await wallet.loadMint();
    const meltTxn = await wallet.prepareMelt('bolt11', meltQuote, proofs);
    const res = await wallet.completeMelt(meltTxn, undefined, { preferAsync: true });

    expect(res.quote.quote).toBe(meltQuote.quote);
    expect(res.change).toHaveLength(0);
    expect(debug).toHaveBeenCalledWith('ASYNC MELT REQUESTED', {
      state: 'UNPAID',
      changeAmounts: [],
    });
  });

  test('bolt11: does not send prefer_async when preferAsync is not set', async () => {
    const meltQuote = {
      quote: 'q-async-1b',
      amount: Amount.from(1),
      unit: 'sat',
      request: invoice,
      state: 'UNPAID',
      fee_reserve: Amount.from(0),
    } as unknown as MeltQuoteBolt11Response;
    const proofs = [
      {
        id: '00bd033559de27d0',
        amount: Amount.from(1),
        secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
        C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
      },
    ];

    server.use(
      http.post(mintUrl + '/v1/melt/bolt11', async ({ request }) => {
        const prefer = request.headers.get('prefer');
        const body = (await request.json()) as { prefer_async?: boolean };
        expect(prefer).toBeNull();
        expect(body.prefer_async).toBeUndefined();
        return HttpResponse.json({
          quote: meltQuote.quote,
          amount: meltQuote.amount,
          unit: meltQuote.unit,
          request: meltQuote.request,
          state: 'UNPAID',
          expiry: 1234567890,
          fee_reserve: meltQuote.fee_reserve,
          payment_preimage: null,
          change: [],
        });
      }),
    );

    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const res = await wallet.meltProofsBolt11(meltQuote, proofs);
    expect(res.quote.quote).toBe(meltQuote.quote);
    expect(res.change).toHaveLength(0);
  });

  test('bolt12: does not send prefer_async when preferAsync is not set', async () => {
    const meltQuote = {
      quote: 'q-async-12b',
      amount: Amount.from(1),
      fee_reserve: Amount.from(0),
      unit: 'sat',
      request: 'lno1offer...',
    } as any;
    const proofs = [
      {
        id: '00bd033559de27d0',
        amount: Amount.from(1),
        secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
        C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
      },
    ];

    server.use(
      http.post(mintUrl + '/v1/melt/bolt12', async ({ request }) => {
        const prefer = request.headers.get('prefer');
        const body = (await request.json()) as { prefer_async?: boolean };
        expect(prefer).toBeNull();
        expect(body.prefer_async).toBeUndefined();
        return HttpResponse.json({
          quote: meltQuote.quote,
          amount: meltQuote.amount,
          fee_reserve: meltQuote.fee_reserve,
          unit: meltQuote.unit,
          expiry: 9999999999,
          state: 'PAID',
          request: meltQuote.request,
          change: [],
        });
      }),
    );

    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const res = await wallet.meltProofsBolt12(meltQuote, proofs);
    expect(res.quote.quote).toBe(meltQuote.quote);
    expect(res.change).toHaveLength(0);
  });

  test('bolt11: blind auth sends Blind-auth header', async () => {
    const mintInfo = {
      name: 'Testnut mint',
      pubkey: '02abc',
      version: 'Nutshell/x',
      contact: [],
      time: 0,
      nuts: {
        5: { methods: [{ method: 'bolt11', unit: 'sat' }], disabled: false },
        22: {
          bat_max_mint: 1,
          protected_endpoints: [{ method: 'POST', path: '/v1/melt/bolt11' }],
        },
      },
    };
    server.use(http.get(mintUrl + '/v1/info', () => HttpResponse.json(mintInfo)));
    server.use(
      http.post(mintUrl + '/v1/melt/bolt11', async ({ request }) => {
        const prefer = request.headers.get('prefer');
        const blind = request.headers.get('blind-auth');
        expect(prefer).toBeNull();
        expect(blind).toBe('test-token');
        return HttpResponse.json({
          quote: 'q-auth-1',
          amount: 1,
          unit: 'sat',
          request: invoice,
          state: 'UNPAID',
          expiry: 1234567890,
          fee_reserve: 0,
          payment_preimage: null,
          change: [],
        });
      }),
    );

    const mockAuthProvider: AuthProvider = {
      getBlindAuthToken: vi.fn().mockResolvedValue('test-token'),
      getCAT: vi.fn().mockReturnValue(undefined),
      setCAT: vi.fn(),
    };
    const wallet = new Wallet(mintUrl, { unit, authProvider: mockAuthProvider });
    await wallet.loadMint();

    const meltQuote = {
      quote: 'q-auth-1',
      amount: Amount.from(1),
      unit: 'sat',
      request: invoice,
      state: 'UNPAID',
      fee_reserve: Amount.from(0),
    } as unknown as MeltQuoteBolt11Response;
    const proofs = [
      {
        id: '00bd033559de27d0',
        amount: Amount.from(1),
        secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
        C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
      },
    ];

    const res = await wallet.meltProofsBolt11(meltQuote, proofs);
    expect(res.quote.quote).toBe('q-auth-1');
  });

  test('bolt12: blind auth sends Blind-auth header', async () => {
    const mintInfo = {
      name: 'Testnut mint',
      pubkey: '02abc',
      version: 'Nutshell/x',
      contact: [],
      time: 0,
      nuts: {
        5: { methods: [{ method: 'bolt12', unit: 'sat' }], disabled: false },
        22: {
          bat_max_mint: 1,
          protected_endpoints: [{ method: 'POST', path: '/v1/melt/bolt12' }],
        },
      },
    };
    server.use(http.get(mintUrl + '/v1/info', () => HttpResponse.json(mintInfo)));
    server.use(
      http.post(mintUrl + '/v1/melt/bolt12', async ({ request }) => {
        const prefer = request.headers.get('prefer');
        const blind = request.headers.get('blind-auth');
        expect(prefer).toBeNull();
        expect(blind).toBe('test-token');
        return HttpResponse.json({
          quote: 'q-auth-12',
          amount: 1,
          fee_reserve: 0,
          unit: 'sat',
          expiry: 9999999999,
          state: 'PAID',
          request: 'lno1offer...',
          change: [],
        });
      }),
    );

    const mockAuthProvider: AuthProvider = {
      getBlindAuthToken: vi.fn().mockResolvedValue('test-token'),
      getCAT: vi.fn().mockReturnValue(undefined),
      setCAT: vi.fn(),
    };
    const wallet = new Wallet(mintUrl, { unit, authProvider: mockAuthProvider });
    await wallet.loadMint();

    const meltQuote = {
      quote: 'q-auth-12',
      amount: Amount.from(1),
      unit: 'sat',
      request: 'lno1offer...',
    } as any;
    const proofs = [
      {
        id: '00bd033559de27d0',
        amount: Amount.from(1),
        secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
        C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
      },
    ];

    const res = await wallet.meltProofsBolt12(meltQuote, proofs);
    expect(res.quote.quote).toBe('q-auth-12');
  });
});
