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
});
