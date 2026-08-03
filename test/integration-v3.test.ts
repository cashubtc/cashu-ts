// Taproot v3 integration tests. Require a nutshell mint with a BLS (v3)
// keyset on port 3338: `DEV=1 make nutshell-bls-down nutshell-bls-up`.

import { randomBytes } from '@noble/hashes/utils.js';
import { test, describe, expect, vi } from 'vitest';

import { CheckStateEnum, Mint, Wallet, isBlsKeyset, sumProofs } from '../src';
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
        'lnbc100u1pjaxuyzpp5wn37d3mx38haqs7nd5he4j7pq4r806e6s83jdksxrd77pnanm3zqdpv2phhwetjv4jzqcneypqyc6t8dp6xu6twva2xjuzzda6qcqzzsxqrrsssp5ayy0uuhwgy8hwphvy7ptzpg2dfn8vt3vlgsk53rsvj76jvafhujs9qyyssqc8aj03s5au3tgu6pj0rm0ws4a838s8ffe3y3qkj77esh7qmgsz7qlvdlzgj6dvx7tx7zn6k352z85rvdqvlszrevvzakp96a4pvyn2cpgaaks6';
      const wallet = new Wallet(mintUrl, { bip39seed: randomBytes(64) });
      await wallet.loadMint();
      const quote = await wallet.createMintQuoteBolt11(11000);
      await wallet.on.onceMintPaid(quote.quote, { timeoutMs: 10_000 });
      const proofs = await wallet.mintProofsBolt11(11000, quote.quote);
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

describe('bearer spend info', () => {
  test(
    'send attaches k; receiver verifies, sweeps, and signs with it',
    { timeout: 30_000 },
    async () => {
      const alice = new Wallet(mintUrl, { bip39seed: randomBytes(64) });
      await alice.loadMint();
      const quote = await alice.createMintQuoteBolt11(64);
      await alice.on.onceMintPaid(quote.quote, { timeoutMs: 10_000 });
      const minted = await alice.mintProofsBolt11(64, quote.quote);
      const { send } = await alice.send(32n, minted);

      // Bearer spend info rides on every sent v3 proof, and k matches the secret.
      for (const proof of send) {
        expect(proof.spend_info?.k).toMatch(/^[0-9a-f]{64}$/);
      }

      // Bob receives; his sweep swap must sign the received inputs with the bearer keys.
      const bob = new Wallet(mintUrl, { bip39seed: randomBytes(64) });
      await bob.loadMint();
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
      let received;
      try {
        received = await bob.receive(send);
      } finally {
        spy.mockRestore();
      }
      const body = swapBody as SwapBody;
      expect(body).toBeDefined();
      // MINT_INPUT_FEE_PPK=100: the sweep pays ceil(inputs * 100 / 1000) in fees.
      const fee = Math.ceil((body.inputs.length * 100) / 1000);
      expect(sumProofs(received).toString()).toBe(String(32 - fee));
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
        // The bearer key itself must never reach the mint.
        expect(JSON.stringify(input)).not.toContain('spend_info');
      }

      // A tampered bearer key is rejected at receive time.
      const tampered = send.map((p) => ({
        ...p,
        spend_info: { k: '11'.repeat(32) },
      }));
      await expect(bob.receive(tampered)).rejects.toThrow(/Spend info key/);
    },
  );
});

describe('M2 roundtrip', () => {
  test(
    'mint -> swap -> melt on the v3 keyset, witnesses on every signed hop',
    { timeout: 40_000 },
    async () => {
      const externalInvoice =
        'lnbc49730n1pjaxuxnpp5zw0ry2w2heyuv7wk4r6z38vvgnaudfst0hl2p5xnv0mjkxtavg2qdpv2phhwetjv4jzqcneypqyc6t8dp6xu6twva2xjuzzda6qcqzzsxqrrsssp5x8tv2ka0m95hgek25kauw540m0dx727stqqr07l8h37v5283sn5q9qyyssqeevcs6vxcdnerk5w5mwfmntsf8nze7nxrf97dywmga7v0742vhmxtjrulgu3kah4f2r6025j974jpjg4mkqhv2gdls5k7e5cvwdf4wcp3ytsvx';
      const seed = randomBytes(64);
      const wallet = new Wallet(mintUrl, { bip39seed: seed });
      await wallet.loadMint();
      const keysetId = wallet.keyChain.getCheapestKeyset().id;
      expect(isBlsKeyset(keysetId)).toBe(true);

      // Mint
      const quote = await wallet.createMintQuoteBolt11(6000);
      await wallet.on.onceMintPaid(quote.quote, { timeoutMs: 10_000 });
      const minted = await wallet.mintProofsBolt11(6000, quote.quote);
      expect(minted.every((p) => /^0[23][0-9a-f]{64}$/.test(p.secret))).toBe(true);

      // Swap (witness-signed; wire shape asserted by the dedicated spy test above)
      const meltQuote = await wallet.createMeltQuoteBolt11(externalInvoice);
      const sendResponse = await wallet.send(meltQuote.fee_reserve.add(meltQuote.amount), minted, {
        includeFees: true,
      });

      // Melt
      const meltResult = await wallet.meltProofsBolt11(meltQuote, sendResponse.send);
      expect(['PAID', 'PENDING']).toContain(meltResult.quote.state);

      // NUT-09/13 restore from the same seed recovers key-path proofs
      const restoreWallet = new Wallet(mintUrl, { bip39seed: seed });
      await restoreWallet.loadMint();
      const restored = await restoreWallet.restoreAll();
      const restoredProofs = restored.proofs;
      expect(restoredProofs.length).toBeGreaterThan(0);
      expect(restoredProofs.every((p) => /^0[23][0-9a-f]{64}$/.test(p.secret))).toBe(true);
      // Every keep-side proof is recovered from seed and still unspent (the melt may leave
      // send-side proofs pending under the fakewallet's delayed external payment).
      const restoredSecrets = new Set(restoredProofs.map((p) => p.secret));
      for (const keep of sendResponse.keep) {
        expect(restoredSecrets.has(keep.secret)).toBe(true);
      }
      const states = await restoreWallet.checkProofsStates(restoredProofs);
      const unspent = restoredProofs.filter((_, i) => states[i].state === CheckStateEnum.UNSPENT);
      const unspentTotal = sumProofs(unspent);
      expect(unspentTotal.greaterThanOrEqual(sumProofs(sendResponse.keep))).toBe(true);
    },
  );
});
