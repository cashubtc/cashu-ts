import { http, HttpResponse } from 'msw';
import { describe, expect, test } from 'vitest';

import {
  Amount,
  CTSError,
  MeltQuoteState,
  Mint,
  MintQuoteState,
  OutputData,
  Wallet,
  deserializeBatchMintPreview,
  deserializeMeltPreview,
  deserializeMintPreview,
  deserializeSwapPreview,
  serializeBatchMintPreview,
  serializeMeltPreview,
  serializeMintPreview,
  serializeSwapPreview,
  type MeltQuoteBolt11Response,
  type MintQuoteBolt11Response,
  type Proof,
  type SerializedMintPreview,
  type SerializedOutputData,
  type SerializedProof,
} from '../../src';
import { ABSOLUTE_MAX_ARRAY_LENGTH } from '../../src/utils/limits';

import {
  dummyKeysResp,
  dummyKeysetResp,
  mint,
  mintInfoResp,
  mintUrl,
  unit,
  useTestServer,
} from './_setup';

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
    expect(revived.quote).toEqual({
      quote: 'melt-q',
      amount: Amount.from(10),
      fee_reserve: Amount.from(3),
      request: 'bolt11request',
    });

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

describe('preview array limits', () => {
  const proof: SerializedProof = { id: KEYSET, amount: '1', secret: 's', C: 'C' };
  // Never restored: an oversized list is refused before its entries are read.
  const output = {} as SerializedOutputData;
  const many = <T>(entry: T, count: number): T[] => new Array<T>(count).fill(entry);
  const atLimit = ABSOLUTE_MAX_ARRAY_LENGTH;
  const tooMany = (field: string, count = atLimit + 1) =>
    new RegExp(`: too many ${field}: ${count}, maximum is ${atLimit}$`);

  test('accepts lists at the limit', () => {
    const swap = deserializeSwapPreview({ amount: '0', fees: '0', inputs: many(proof, atLimit) });
    expect(swap.inputs).toHaveLength(atLimit);
    const batch = deserializeBatchMintPreview({
      method: 'bolt11',
      quotes: many('q', atLimit),
      amounts: many('1', atLimit),
      outputData: [],
      signatures: many(null, atLimit),
      legacySignatures: many(null, atLimit),
    });
    expect(batch.quotes).toHaveLength(atLimit);
    const melt = deserializeMeltPreview({
      method: 'bolt11',
      quote: 'q',
      inputs: many(proof, atLimit),
      outputData: [],
    });
    expect(melt.inputs).toHaveLength(atLimit);
  });

  test('rejects an oversized swap preview', () => {
    const base = { amount: '0', fees: '0', inputs: [] };
    const over = () => deserializeSwapPreview({ ...base, inputs: many(proof, atLimit + 1) });
    expect(over).toThrow(CTSError);
    expect(over).toThrow(/^Invalid SerializedSwapPreview: /);
    expect(over).toThrow(tooMany('inputs'));
    expect(() =>
      deserializeSwapPreview({ ...base, sendOutputs: many(output, atLimit + 1) }),
    ).toThrow(tooMany('outputs'));
    expect(() =>
      deserializeSwapPreview({ ...base, keepOutputs: many(output, atLimit + 1) }),
    ).toThrow(tooMany('outputs'));
  });

  test('counts keep and send outputs of a swap preview together', () => {
    expect(() =>
      deserializeSwapPreview({
        amount: '0',
        fees: '0',
        inputs: [],
        sendOutputs: many(output, atLimit / 2),
        keepOutputs: many(output, atLimit / 2 + 1),
      }),
    ).toThrow(tooMany('outputs'));
  });

  test('rejects an oversized mint preview', () => {
    const over = () =>
      deserializeMintPreview({
        method: 'bolt11',
        quote: 'q',
        outputData: many(output, atLimit + 1),
      });
    expect(over).toThrow(CTSError);
    expect(over).toThrow(/^Invalid SerializedMintPreview: /);
    expect(over).toThrow(tooMany('outputData'));
  });

  test.each(['quotes', 'amounts', 'outputData', 'signatures', 'legacySignatures'] as const)(
    'rejects a batch mint preview with oversized %s',
    (field) => {
      const entry = field === 'outputData' ? output : '1';
      const over = () =>
        deserializeBatchMintPreview({
          method: 'bolt11',
          quotes: [],
          amounts: [],
          outputData: [],
          [field]: many(entry, atLimit + 1),
        });
      expect(over).toThrow(CTSError);
      expect(over).toThrow(/^Invalid SerializedBatchMintPreview: /);
      expect(over).toThrow(tooMany(field));
    },
  );

  test('rejects an oversized melt preview', () => {
    const base = { method: 'bolt11', quote: 'q', inputs: [], outputData: [] };
    const over = () => deserializeMeltPreview({ ...base, inputs: many(proof, atLimit + 1) });
    expect(over).toThrow(CTSError);
    expect(over).toThrow(/^Invalid SerializedMeltPreview: /);
    expect(over).toThrow(tooMany('inputs'));
    expect(() =>
      deserializeMeltPreview({ ...base, outputData: many(output, atLimit + 1) }),
    ).toThrow(tooMany('outputData'));
  });
});

describe('preview mint pubkey', () => {
  const OTHER_URL = 'https://other.example';
  const OTHER_PUBKEY = '0283bf290884eed3a7ca2663fc0260de2e2064d6b355ea13f98dec004b7a7ead99';
  const proof: Proof = {
    id: KEYSET,
    amount: Amount.from(3),
    secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a55',
    C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
  };
  const meltQuote: MeltQuoteBolt11Response = {
    quote: 'melt-q',
    amount: Amount.from(1),
    fee_reserve: Amount.from(0),
    request: 'bolt11request',
    state: MeltQuoteState.UNPAID,
    expiry: 1234567890,
    payment_preimage: null,
    unit: 'sat',
    method: 'bolt11',
  };

  // A second endpoint with the test mint's keys, publishing `pubkey`. Signs and records each POST.
  function serveOtherMint(pubkey?: string) {
    const posts: string[] = [];
    server.use(
      http.get(OTHER_URL + '/v1/info', () => HttpResponse.json({ ...mintInfoResp, pubkey })),
      http.get(OTHER_URL + '/v1/keys', () => HttpResponse.json(dummyKeysResp)),
      http.get(OTHER_URL + '/v1/keys/:id', () => HttpResponse.json(dummyKeysResp)),
      http.get(OTHER_URL + '/v1/keysets', () => HttpResponse.json(dummyKeysetResp)),
      http.post(OTHER_URL + '/*', async ({ request }) => {
        posts.push(new URL(request.url).pathname);
        const { outputs } = (await request.json()) as { outputs: Array<{ amount: number }> };
        return HttpResponse.json({
          signatures: outputs.map((o) => ({ id: KEYSET, amount: o.amount, C_ })),
        });
      }),
    );
    return posts;
  }

  async function prepareAll(wallet: Wallet) {
    return {
      swap: (await wallet.prepareSwapToSend(1, [proof])).preview,
      mint: await wallet.prepareMint('bolt11', 3, mintQuote('mint-q', 3)),
      batch: await wallet.prepareBatchMint('bolt11', [
        { amount: 1, quote: mintQuote('batch-a', 1) },
        { amount: 2, quote: mintQuote('batch-b', 2) },
      ]),
      melt: await wallet.prepareMelt('bolt11', meltQuote, [proof]),
    };
  }

  function completeAll(wallet: Wallet, previews: Awaited<ReturnType<typeof prepareAll>>) {
    return [
      () => wallet.completeSwap(previews.swap),
      () => wallet.restoreSwapPreview(previews.swap),
      () => wallet.completeMint(previews.mint),
      () => wallet.completeBatchMint(previews.batch),
      () => wallet.completeMelt(previews.melt),
    ];
  }

  test('every preview records the mint pubkey and keeps it when saved', async () => {
    const { swap, mint, batch, melt } = await prepareAll(await loadWallet());
    const revived = [
      deserializeSwapPreview(roundTrip(serializeSwapPreview(swap))),
      deserializeMintPreview(roundTrip(serializeMintPreview(mint))),
      deserializeBatchMintPreview(roundTrip(serializeBatchMintPreview(batch))),
      deserializeMeltPreview(roundTrip(serializeMeltPreview(melt))),
    ];
    for (const preview of [swap, mint, batch, melt, ...revived]) {
      expect(preview.mintPubkey).toBe(mintInfoResp.pubkey);
    }
  });

  test.each([
    ['a different pubkey', OTHER_PUBKEY],
    ['no pubkey', undefined],
  ])('is not completed at a mint that publishes %s', async (_, pubkey) => {
    const posts = serveOtherMint(pubkey);
    const previews = await prepareAll(await loadWallet());
    const other = new Wallet(new Mint(OTHER_URL), { unit });
    await other.loadMint();

    for (const complete of completeAll(other, previews)) {
      await expect(complete()).rejects.toThrow('Preview was prepared at a different mint');
    }
    expect(posts).toEqual([]);
  });

  test('is not completed on a wallet that has not loaded its mint', async () => {
    const posts = serveOtherMint(OTHER_PUBKEY);
    const previews = await prepareAll(await loadWallet());
    const other = new Wallet(new Mint(OTHER_URL), { unit });

    for (const complete of completeAll(other, previews)) {
      await expect(complete()).rejects.toThrow(/Mint info not initialized/);
    }
    expect(posts).toEqual([]);
  });

  test('is completed at the same mint under another URL', async () => {
    const posts = serveOtherMint(mintInfoResp.pubkey.toUpperCase());
    const { swap } = await prepareAll(await loadWallet());
    const other = new Wallet(new Mint(OTHER_URL), { unit });
    await other.loadMint();

    const { send } = await other.completeSwap(swap);
    expect(send).toHaveLength(1);
    expect(posts).toEqual(['/v1/swap']);
  });

  test('a preview from a mint with no pubkey records none and is not checked', async () => {
    serveOtherMint();
    const source = new Wallet(new Mint(OTHER_URL), { unit });
    await source.loadMint();
    const { swap } = await prepareAll(source);
    expect(swap).not.toHaveProperty('mintPubkey');
    expect(serializeSwapPreview(swap)).not.toHaveProperty('mintPubkey');

    const bodies: string[] = [];
    server.use(signingHandler('/v1/swap', bodies));
    await (await loadWallet()).completeSwap(swap);
    expect(bodies).toHaveLength(1);
  });
});
