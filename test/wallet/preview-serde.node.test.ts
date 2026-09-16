import { http, HttpResponse } from 'msw';
import { describe, expect, test } from 'vitest';

import {
  Amount,
  CTSError,
  MeltQuoteState,
  MintQuoteState,
  OutputData,
  Wallet,
  deserializeBatchMintPreview,
  deserializeMeltPreview,
  deserializeMintPreview,
  serializeBatchMintPreview,
  serializeMeltPreview,
  serializeMintPreview,
  type MeltQuoteBolt11Response,
  type MintQuoteBolt11Response,
  type Proof,
  type SerializedMintPreview,
} from '../../src';

import { mint, mintUrl, unit, useTestServer } from './_setup';

const server = useTestServer();
const KEYSET = '00bd033559de27d0';
const C_ = '0361a2725cfd88f60ded718378e8049a4a6cee32e214a9870b44c3ffea2dc9e625';

function mintQuote(quote: string, amount: number): MintQuoteBolt11Response {
  return {
    quote,
    request: 'lnbc...',
    amount: Amount.from(amount),
    unit: 'sat',
    method: 'bolt11',
    state: MintQuoteState.PAID,
    amount_paid: Amount.from(amount),
    amount_issued: Amount.from(0),
    updated_at: null,
    expiry: null,
  };
}

// Signs every output it is sent and records the raw bodies so replays can be compared bytewise.
function signingHandler(path: string, bodies: string[]) {
  return http.post(mintUrl + path, async ({ request }) => {
    const body = await request.text();
    bodies.push(body);
    const { outputs } = JSON.parse(body) as { outputs: Array<{ amount: number }> };
    return HttpResponse.json({
      signatures: outputs.map((o) => ({ id: KEYSET, amount: o.amount, C_ })),
    });
  });
}

async function loadWallet() {
  const wallet = new Wallet(mint, { unit });
  await wallet.loadMint();
  return wallet;
}

function roundTrip<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe('mint preview serde', () => {
  test('replays a byte-identical mint request and revives the quote amounts', async () => {
    const bodies: string[] = [];
    server.use(signingHandler('/v1/mint/bolt11', bodies));
    const wallet = await loadWallet();
    const preview = await wallet.prepareMint('bolt11', 3, mintQuote('mint-q', 3));

    const revived = deserializeMintPreview(roundTrip(serializeMintPreview(preview)));
    expect(revived.quote).toEqual({ quote: 'mint-q' });
    expect(revived).not.toHaveProperty('signature');
    expect(revived.outputData[0].secret).toEqual(preview.outputData[0].secret);

    const first = await wallet.completeMint(preview);
    const replayed = await wallet.completeMint(revived);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    expect(replayed.map((p) => p.secret)).toEqual(first.map((p) => p.secret));
  });

  test('keeps the signatures and only the quote id', () => {
    const preview = {
      method: 'bolt12',
      quote: { quote: 'q', amount: null, pubkey: '02ab', localRef: 'keep' },
      outputData: [OutputData.createSingleRandomData(2, KEYSET)],
      signature: 'sig',
      legacySignature: 'legacy',
    };
    const revived = deserializeMintPreview(roundTrip(serializeMintPreview(preview)));
    expect(revived).toMatchObject({
      method: 'bolt12',
      quote: { quote: 'q' },
      signature: 'sig',
      legacySignature: 'legacy',
    });
    expect(revived.quote).not.toHaveProperty('pubkey');
    expect(revived.outputData.map((o) => o.blindedMessage.B_)).toEqual(
      preview.outputData.map((o) => o.blindedMessage.B_),
    );
  });

  test('rejects malformed output data with a prefixed CTSError', () => {
    const bad: SerializedMintPreview = {
      method: 'bolt11',
      quote: 'q',
      outputData: [
        {
          blindedMessage: { amount: '1', B_: '02beef', id: KEYSET },
          blindingFactor: 'not-a-number',
          secret: 'abcd',
        },
      ],
    };
    expect(() => deserializeMintPreview(bad)).toThrow(CTSError);
    expect(() => deserializeMintPreview(bad)).toThrow(/^Invalid SerializedMintPreview: /);
  });

  test('wraps non-Error throws', () => {
    const bad: SerializedMintPreview = {
      method: 'bolt11',
      quote: 'q',
      get outputData(): never {
        // eslint-disable-next-line @typescript-eslint/only-throw-error -- exercising the non-Error path
        throw 'not-an-error';
      },
    };
    expect(() => deserializeMintPreview(bad)).toThrow(
      'Invalid SerializedMintPreview: not-an-error',
    );
  });
});

describe('batch mint preview serde', () => {
  test('replays a byte-identical batch request', async () => {
    const bodies: string[] = [];
    server.use(signingHandler('/v1/mint/bolt11/batch', bodies));
    const wallet = await loadWallet();
    const preview = await wallet.prepareBatchMint('bolt11', [
      { amount: 1, quote: mintQuote('batch-a', 1) },
      { amount: 2, quote: mintQuote('batch-b', 2) },
    ]);

    const revived = deserializeBatchMintPreview(roundTrip(serializeBatchMintPreview(preview)));
    expect(revived.amounts.map((a) => a.toString())).toEqual(['1', '2']);
    expect(revived.quotes).toEqual([{ quote: 'batch-a' }, { quote: 'batch-b' }]);
    expect(revived).not.toHaveProperty('signatures');

    await wallet.completeBatchMint(preview);
    await wallet.completeBatchMint(revived);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
  });

  test('keeps the per-quote signatures', () => {
    const preview = {
      method: 'bolt11',
      quotes: [{ quote: 'a' }, { quote: 'b', pubkey: '02ab' }],
      amounts: [Amount.from(1), Amount.from(2)],
      outputData: [
        OutputData.createSingleRandomData(1, KEYSET),
        OutputData.createSingleRandomData(2, KEYSET),
      ],
      signatures: [null, 'sig'],
      legacySignatures: [null, 'legacy'],
    };
    const revived = deserializeBatchMintPreview(roundTrip(serializeBatchMintPreview(preview)));
    expect(revived).toMatchObject({
      quotes: [{ quote: 'a' }, { quote: 'b' }],
      signatures: [null, 'sig'],
      legacySignatures: [null, 'legacy'],
    });
    expect(() =>
      deserializeBatchMintPreview({ ...serializeBatchMintPreview(preview), amounts: ['x'] }),
    ).toThrow(/^Invalid SerializedBatchMintPreview: /);
  });
});

describe('melt preview serde', () => {
  test('replays a byte-identical melt request and revives inputs and quote amounts', async () => {
    const bodies: string[] = [];
    server.use(
      http.post(mintUrl + '/v1/melt/bolt11', async ({ request }) => {
        bodies.push(await request.text());
        return HttpResponse.json({
          quote: 'melt-q',
          amount: 10,
          unit: 'sat',
          fee_reserve: 3,
          state: MeltQuoteState.PAID,
          expiry: 1234567890,
          payment_preimage: 'preimage',
          request: 'bolt11request',
          change: [],
        });
      }),
    );
    const wallet = await loadWallet();
    const quote: MeltQuoteBolt11Response = {
      quote: 'melt-q',
      amount: Amount.from(10),
      fee_reserve: Amount.from(3),
      request: 'bolt11request',
      state: MeltQuoteState.UNPAID,
      expiry: 1234567890,
      payment_preimage: null,
      unit: 'sat',
      method: 'bolt11',
    };
    const proofs: Proof[] = [
      { id: KEYSET, amount: Amount.from(8), secret: 'secret1', C: 'C1' },
      { id: KEYSET, amount: Amount.from(5), secret: 'secret2', C: 'C2' },
    ];
    const preview = await wallet.prepareMelt('bolt11', quote, proofs);
    expect(preview.outputData.length).toBeGreaterThan(0);

    const revived = deserializeMeltPreview(roundTrip(serializeMeltPreview(preview)));
    expect(revived.inputs[0].amount).toBeInstanceOf(Amount);
    expect(revived.quote).toEqual({ quote: 'melt-q', amount: Amount.from(10) });

    await wallet.completeMelt(preview);
    await wallet.completeMelt(revived);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
  });

  test('omits the amount when the quote has none', () => {
    const serialized = serializeMeltPreview({
      method: 'bolt11',
      quote: { quote: 'q' },
      inputs: [],
      outputData: [],
    });
    expect(serialized).not.toHaveProperty('amount');
    expect(deserializeMeltPreview(roundTrip(serialized)).quote).toEqual({ quote: 'q' });
  });

  test('rejects a malformed input amount with a prefixed CTSError', () => {
    expect(() =>
      deserializeMeltPreview({
        method: 'bolt11',
        quote: 'q',
        inputs: [{ id: KEYSET, amount: 'nope', secret: 's', C: 'C' }],
        outputData: [],
      }),
    ).toThrow(/^Invalid SerializedMeltPreview: /);
  });
});
