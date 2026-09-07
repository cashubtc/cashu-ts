import { describe, expect, test } from 'vitest';

import {
  Amount,
  KeyChain,
  Mint,
  OutputData,
  Wallet,
  createBlindSignature,
  createNewMintKeys,
  hashToCurve,
  pointFromHex,
  serializeMintKeys,
  type KeysetPair,
  type Proof,
  type RequestArgs,
  type SerializedBlindedMessage,
} from '../../src';

import { mintInfoResp } from './_setup';

// Two active keysets on one synthetic mint: the wallet prefers the cheaper one, so custom
// outputs built under the dearer one no longer match the wallet's own keyset choice.
const mintUrl = 'https://mint.test';
const unit = 'sat';
const dear = createNewMintKeys(8, new Uint8Array(32).fill(2), { input_fee_ppk: 1000 });
const cheap = createNewMintKeys(8, new Uint8Array(32).fill(3), { input_fee_ppk: 0 });
const retired = createNewMintKeys(8, new Uint8Array(32).fill(4), { input_fee_ppk: 0 });
const usd = createNewMintKeys(8, new Uint8Array(32).fill(5), { input_fee_ppk: 0, unit: 'usd' });
const unknown = createNewMintKeys(8, new Uint8Array(32).fill(6), { input_fee_ppk: 0 });
const pairs = [dear, cheap, retired, usd, unknown];
const seed = new Uint8Array(64).fill(1);

function keysFor(pair: KeysetPair, keysetUnit = unit) {
  return { id: pair.keysetId, unit: keysetUnit, keys: serializeMintKeys(pair.pubKeys) };
}

function signatureFor(pair: KeysetPair, secret: string, amount: Amount): string {
  const key = pair.privKeys[amount.toString()];
  return createBlindSignature(
    hashToCurve(new TextEncoder().encode(secret)),
    key,
    pair.keysetId,
  ).C_.toHex(true);
}

function inputUnder(pair: KeysetPair, amount: number, secret: string): Proof {
  return {
    id: pair.keysetId,
    secret,
    amount: Amount.from(amount),
    C: signatureFor(pair, secret, Amount.from(amount)),
  };
}

function proofIsValid(p: Proof): boolean {
  const pair = pairs.find((k) => k.keysetId === p.id);
  return pair !== undefined && p.C === signatureFor(pair, p.secret, p.amount);
}

// A mint that signs every output under the keyset the output names.
function makeWallet() {
  const calls: string[] = [];
  const mint = new Mint(mintUrl, {
    customRequest: async <T>(args: RequestArgs): Promise<T> => {
      calls.push(args.endpoint);
      // The transport serialises the body before handing it over.
      const body = JSON.parse(args.requestBody as string) as {
        outputs: SerializedBlindedMessage[];
      };
      const signatures = body.outputs.map((o) => {
        const pair = pairs.find((k) => k.keysetId === o.id);
        if (!pair) throw new Error(`mint does not know keyset ${o.id}`);
        const amount = Amount.from(o.amount);
        const C_ = createBlindSignature(
          pointFromHex(o.B_),
          pair.privKeys[amount.toString()],
          o.id,
        ).C_.toHex(true);
        return { id: o.id, amount: amount.toString(), C_ };
      });
      return { signatures } as T;
    },
  });
  const wallet = new Wallet(mint, { unit });
  const info = {
    ...mintInfoResp,
    nuts: { 4: { methods: [{ method: 'bolt11', unit }], disabled: false } },
  };
  wallet.loadMintFromCache(
    info,
    KeyChain.mintToCacheDTO(
      mintUrl,
      [
        { id: dear.keysetId, unit, active: true, input_fee_ppk: 1000 },
        { id: cheap.keysetId, unit, active: true, input_fee_ppk: 0 },
        { id: retired.keysetId, unit, active: false, input_fee_ppk: 0 },
        { id: usd.keysetId, unit: 'usd', active: true, input_fee_ppk: 0 },
      ],
      [keysFor(dear), keysFor(cheap), keysFor(retired), keysFor(usd, 'usd')],
    ),
  );
  return { wallet, calls };
}

describe('custom outputs on a keyset other than the wallet default', () => {
  test('send unblinds each output with the keyset that signed it', async () => {
    const { wallet, calls } = makeWallet();
    const keep = OutputData.createDeterministicData(Amount.from(7), seed, 0, keysFor(dear));
    const send = OutputData.createDeterministicData(
      Amount.from(8),
      seed,
      keep.length,
      keysFor(dear),
    );
    const input = inputUnder(dear, 16, 'custom-send-input');

    const result = await wallet.send(8, [input], undefined, {
      keep: { type: 'custom', data: keep },
      send: { type: 'custom', data: send },
    });

    expect(calls).toHaveLength(1);
    expect([...result.keep, ...result.send].every(proofIsValid)).toBe(true);
    expect(result.send.map((p) => p.id)).toEqual([dear.keysetId]);
  });

  test('send accepts a plan that mixes active keysets', async () => {
    const { wallet } = makeWallet();
    const keep = OutputData.createDeterministicData(Amount.from(7), seed, 0, keysFor(cheap));
    const send = OutputData.createDeterministicData(
      Amount.from(8),
      seed,
      keep.length,
      keysFor(dear),
    );
    const input = inputUnder(dear, 16, 'custom-mixed-input');

    const result = await wallet.send(8, [input], undefined, {
      keep: { type: 'custom', data: keep },
      send: { type: 'custom', data: send },
    });

    expect([...result.keep, ...result.send].every(proofIsValid)).toBe(true);
    expect(new Set(result.keep.map((p) => p.id))).toEqual(new Set([cheap.keysetId]));
    expect(new Set(result.send.map((p) => p.id))).toEqual(new Set([dear.keysetId]));
  });

  test('receive unblinds custom outputs with the keyset that signed them', async () => {
    const { wallet } = makeWallet();
    const input = inputUnder(dear, 16, 'custom-receive-input');
    // The 16 sat input pays 1 sat in fees under the dearer keyset.
    const data = OutputData.createDeterministicData(Amount.from(15), seed, 0, keysFor(dear));

    const proofs = await wallet.receive([input], undefined, { type: 'custom', data });

    expect(proofs.every(proofIsValid)).toBe(true);
    expect(new Set(proofs.map((p) => p.id))).toEqual(new Set([dear.keysetId]));
  });

  test('mint unblinds custom outputs with the keyset that signed them', async () => {
    const { wallet } = makeWallet();
    const data = OutputData.createDeterministicData(Amount.from(16), seed, 0, keysFor(dear));

    const proofs = await wallet.mintProofsBolt11(16, 'quote-id', undefined, {
      type: 'custom',
      data,
    });

    expect(proofs.every(proofIsValid)).toBe(true);
    expect(new Set(proofs.map((p) => p.id))).toEqual(new Set([dear.keysetId]));
  });

  test('batch mint unblinds custom outputs with the keyset that signed them', async () => {
    const { wallet } = makeWallet();
    const data = OutputData.createDeterministicData(Amount.from(16), seed, 0, keysFor(dear));

    const preview = await wallet.prepareBatchMint(
      'bolt11',
      [{ amount: 16, quote: { quote: 'quote-id' } }],
      undefined,
      { type: 'custom', data },
    );
    const proofs = await wallet.completeBatchMint(preview);

    expect(proofs.every(proofIsValid)).toBe(true);
    expect(new Set(proofs.map((p) => p.id))).toEqual(new Set([dear.keysetId]));
  });

  test.each([
    ['unknown', unknown, /Keyset '/],
    ['inactive', retired, /Inactive keyset/],
    ['other-unit', usd, /Keyset unit does not match wallet unit/],
  ])('rejects a custom plan on an %s keyset before calling the mint', async (_, pair, msg) => {
    const { wallet, calls } = makeWallet();
    const keep = OutputData.createDeterministicData(Amount.from(7), seed, 0, keysFor(dear));
    const send = OutputData.createDeterministicData(
      Amount.from(8),
      seed,
      keep.length,
      keysFor(pair),
    );
    const input = inputUnder(dear, 16, `custom-${pair.keysetId}`);

    await expect(
      wallet.send(8, [input], undefined, {
        keep: { type: 'custom', data: keep },
        send: { type: 'custom', data: send },
      }),
    ).rejects.toThrow(msg);
    expect(calls).toHaveLength(0);
  });
});
