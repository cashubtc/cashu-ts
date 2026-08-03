// Taproot v3 integration tests. Require a nutshell mint with a BLS (v3)
// keyset on port 3338: `DEV=1 make nutshell-bls-down nutshell-bls-up`.

import { randomBytes } from '@noble/hashes/utils.js';
import { test, describe, expect, vi } from 'vitest';

import { Mint, Wallet, isBlsKeyset } from '../src';
import { transactionDigest, verifyTransactionInputWitness } from '../src/crypto/transcript';

const mintUrl = 'http://127.0.0.1:3338';

describe('v3 keyset bring-up', () => {
  test('mint advertises an active BLS (v3) keyset and serves its keys', async () => {
    const mint = new Mint(mintUrl);
    const { keysets } = await mint.getKeySets();
    const v3 = keysets.filter((k) => isBlsKeyset(k.id) && k.active);
    expect(v3.length).toBeGreaterThan(0);
    expect(v3[0].id.startsWith('02')).toBe(true);

    const keysResponse = await mint.getKeys(v3[0].id);
    const keys = keysResponse.keysets.find((k) => k.id === v3[0].id);
    expect(keys).toBeDefined();
    const pubkeys = Object.values(keys!.keys);
    expect(pubkeys.length).toBeGreaterThan(0);
    // BLS12-381 G2 compressed pubkeys: 96 bytes, 192 hex chars
    pubkeys.forEach((pk) => expect(pk).toMatch(/^[0-9a-f]{192}$/));
  });
});

describe('v3 transaction witnesses', () => {
  test(
    'swap inputs carry a valid transcript witness on the wire',
    { timeout: 20_000 },
    async () => {
      const wallet = new Wallet(mintUrl, { bip39seed: randomBytes(64) });
      await wallet.loadMint();
      const quote = await wallet.createMintQuoteBolt11(64);
      await wallet.on.onceMintPaid(quote.quote, { timeoutMs: 10_000 });
      const proofs = await wallet.mintProofsBolt11(64, quote.quote);

      type SwapBody = {
        inputs: Array<{ amount: number; id: string; secret: string; C: string; witness?: string }>;
        outputs: Array<{ amount: number; id: string; B_: string }>;
      };
      let swapBody: SwapBody | undefined;
      const realFetch = globalThis.fetch;
      const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        if (url.endsWith('/v1/swap') && init?.body) {
          swapBody = JSON.parse(init.body as string) as SwapBody;
        }
        return realFetch(input, init);
      });
      try {
        await wallet.send(32n, proofs);
      } finally {
        spy.mockRestore();
      }

      expect(swapBody).toBeDefined();
      const body = swapBody as SwapBody;
      const digest = transactionDigest({
        proofInputs: body.inputs.map((p) => ({
          amount: BigInt(p.amount),
          keysetId: p.id,
          secret: p.secret,
          C: p.C,
        })),
        blindedOutputs: body.outputs.map((o) => ({
          amount: BigInt(o.amount),
          keysetId: o.id,
          B_: o.B_,
        })),
      });
      for (const input of body.inputs) {
        expect(input.witness).toBeDefined();
        expect(verifyTransactionInputWitness(digest, input.secret, input.witness as string)).toBe(
          true,
        );
      }
    },
  );

  test(
    'melt inputs carry a valid transcript witness on the wire',
    { timeout: 30_000 },
    async () => {
      const externalInvoice =
        'lnbc20u1p5tj77hsp5hva2cwk48eajjatzje0wwyanfl2dmu87h7c30mnurfmu5mr6ypjspp53cmmk6mgvdrp7xpuf9vfyqyxjl5ce9dqs4prc6jh6eqf5ldmqvvshp55qf3c2rxuxqahgt2d7yp6xdrjdt5r2sm2uqsatyn3v7u0k09mnhqxq9z0rgqcqpnrzjq0xp6zfjhwvmq6tltd09jcdc82ml6eh3alzvnaw8httxcx7tu78syrvfkqqqm0qqqyqqqqlgqqqvx5qqjq9qxpqysgqunatemrzxl5srnxy4jpqeu4rhdfvkx0agvqeumkmx4mvsusc2er4t4h9jg396mfxp0lu72nueehapde6cv42ldd80pryz8jrxky3k5qqm6f4zx';
      const wallet = new Wallet(mintUrl, { bip39seed: randomBytes(64) });
      await wallet.loadMint();
      const quote = await wallet.createMintQuoteBolt11(3000);
      await wallet.on.onceMintPaid(quote.quote, { timeoutMs: 10_000 });
      const proofs = await wallet.mintProofsBolt11(3000, quote.quote);
      const meltQuote = await wallet.createMeltQuoteBolt11(externalInvoice);
      const sendResponse = await wallet.send(meltQuote.fee_reserve.add(meltQuote.amount), proofs, {
        includeFees: true,
      });

      type MeltBody = {
        quote: string;
        inputs: Array<{ amount: number; id: string; secret: string; C: string; witness?: string }>;
        outputs?: Array<{ amount: number; id: string; B_: string }>;
      };
      let meltBody: MeltBody | undefined;
      const realFetch = globalThis.fetch;
      const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = typeof input === 'string' ? input : (input as Request).url;
        if (url.includes('/v1/melt/bolt11') && init?.body) {
          meltBody = JSON.parse(init.body as string) as MeltBody;
        }
        return realFetch(input, init);
      });
      try {
        await wallet.meltProofsBolt11(meltQuote, sendResponse.send);
      } finally {
        spy.mockRestore();
      }

      expect(meltBody).toBeDefined();
      const body = meltBody as MeltBody;
      const digest = transactionDigest({
        proofInputs: body.inputs.map((p) => ({
          amount: BigInt(p.amount),
          keysetId: p.id,
          secret: p.secret,
          C: p.C,
        })),
        blindedOutputs: (body.outputs ?? []).map((o) => ({
          amount: BigInt(o.amount),
          keysetId: o.id,
          B_: o.B_,
        })),
        meltQuoteOutputs: [{ amount: meltQuote.amount.toBigInt(), quoteId: body.quote }],
      });
      for (const input of body.inputs) {
        expect(input.witness).toBeDefined();
        expect(verifyTransactionInputWitness(digest, input.secret, input.witness as string)).toBe(
          true,
        );
      }
    },
  );
});
