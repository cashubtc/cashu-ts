// Nutroot v3 integration tests. Require a nutshell mint with a BLS (v3)
// keyset on port 3338: `DEV=1 make nutshell-bls-down nutshell-bls-up`.

import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils.js';
import { test, describe, expect, vi } from 'vitest';

import {
  Amount,
  type AmountLike,
  CheckStateEnum,
  Mint,
  OutputData,
  PaymentRequest,
  ScriptPath,
  Wallet,
  getDecodedToken,
  getEncodedToken,
  isBlsKeyset,
  sumProofs,
} from '../src';
import {
  buildScriptPathWitness,
  buildNutrootSecret,
  deriveReceiverKeyedSecret,
  parseNutrootLeaf,
  recoverLeafKeySecretKeys,
  serializeNutrootLeaf,
  recoverReceiverKeyedSecretKey,
  NUTROOT_NUMS_KEY,
  nutrootLeafHash,
  nutrootMerkleRoot,
  nutrootTweakSeckey,
  type NutrootLeaf,
  verifyNutrootSpendInfo,
} from '../src/crypto/nutroot';
import { transactionDigest, verifyTransactionInputWitness } from '../src/crypto/transcript';

const mintUrl = 'http://127.0.0.1:3338';

// The v3 suite needs a mint serving a BLS (02) keyset. CI also runs this file against
// stock nutshell and CDK mints, which have none; skip there rather than fail.
const hasV3Keyset = await fetch(`${mintUrl}/v1/keysets`)
  .then(async (res) => {
    const { keysets } = (await res.json()) as { keysets: Array<{ id: string }> };
    return keysets.some((k) => k.id.startsWith('02'));
  })
  .catch(() => false);
const describeV3 = hasV3Keyset ? describe : describe.skip;

describeV3('v3 keyset bring-up', () => {
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

describeV3('v3 transaction witnesses', () => {
  test(
    'swap inputs carry a valid transcript witness on the wire',
    { timeout: 20_000 },
    async () => {
      const wallet = new Wallet(mintUrl, { bip39seed: randomBytes(64) });
      await wallet.loadMint();
      const quote = await wallet.createMintQuoteBolt11(64);
      await wallet.on.onceMintPaid(quote.quote, { timeoutMs: 10_000 });
      const proofs = await wallet.mintProofsBolt11(64, quote);

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
      const proofs = await wallet.mintProofsBolt11(11000, quote);
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

describeV3('bearer spend info', () => {
  test(
    'send attaches k; receiver verifies, sweeps, and signs with it',
    { timeout: 30_000 },
    async () => {
      const alice = new Wallet(mintUrl, { bip39seed: randomBytes(64) });
      await alice.loadMint();
      const quote = await alice.createMintQuoteBolt11(64);
      await alice.on.onceMintPaid(quote.quote, { timeoutMs: 10_000 });
      const minted = await alice.mintProofsBolt11(64, quote);
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

describeV3('M2 roundtrip', () => {
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
      const minted = await wallet.mintProofsBolt11(6000, quote);
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

describeV3('M3 nutroot conditions', () => {
  const sk = (n: number) => {
    const b = new Uint8Array(32);
    b[31] = n;
    return b;
  };
  const pk = (n: number) => bytesToHex(secp256k1.getPublicKey(sk(n), true));

  async function mintPointProofs(amount: number) {
    const wallet = new Wallet(mintUrl, { bip39seed: randomBytes(64) });
    await wallet.loadMint();
    const quote = await wallet.createMintQuoteBolt11(amount);
    await wallet.on.onceMintPaid(quote.quote, { timeoutMs: 10_000 });
    const proofs = await wallet.mintProofsBolt11(amount, quote);
    return { wallet, proofs, keysetId: wallet.keyChain.getCheapestKeyset().id };
  }

  /**
   * Swap a single locked proof for random outputs via the raw mint API. Returns the mint response
   * promise so callers can assert acceptance or rejection.
   */
  async function manualSwapLockedProof(
    keysetId: string,
    locked: { amount: bigint; secret: string; C: string },
    buildWitness: (digest: Uint8Array) => string,
  ) {
    const mint = new Mint(mintUrl);
    const fee = 1n; // one input at 100 ppk
    // Power-of-two denominations for input - fee (31 = 16+8+4+2+1).
    const outputAmounts = [16n, 8n, 4n, 2n, 1n];
    expect(outputAmounts.reduce((a, b) => a + b, 0n)).toBe(locked.amount - fee);
    // v3 outputs carry point secrets; the swap's outputs are never spent here.
    const outputs = outputAmounts.map((a) =>
      OutputData.createSingleNutrootData(
        bytesToHex(secp256k1.getPublicKey(randomBytes(32), true)),
        a,
        keysetId,
      ),
    );
    const payloadInputs = [
      { amount: locked.amount, id: keysetId, secret: locked.secret, C: locked.C },
    ];
    const payloadOutputs = outputs.map((o) => o.blindedMessage);
    const digest = transactionDigest({
      proofInputs: payloadInputs.map((p) => ({
        amount: p.amount,
        keysetId: p.id,
        secret: p.secret,
        C: p.C,
      })),
      blindedOutputs: payloadOutputs.map((o) => ({
        amount: Amount.from(o.amount).toBigInt(),
        keysetId: o.id,
        B_: o.B_,
      })),
    });
    const witness = buildWitness(digest);
    return mint.swap({
      inputs: [{ ...payloadInputs[0], amount: Amount.from(locked.amount), witness }] as never,
      outputs: payloadOutputs,
    });
  }

  /**
   * Mint, then swap one proof into a locked output with the given secret. Returns the locked proof
   * fields.
   */
  async function createLockedProof(secretHex: string) {
    const { wallet, proofs, keysetId } = await mintPointProofs(64);
    const factory = (a: AmountLike, k: { id: string }) =>
      OutputData.createSingleNutrootData(secretHex, a, k.id);
    // Send exactly 32 (one denomination) so the factory mints a single locked output.
    const { send } = await wallet.send(32n, proofs, undefined, {
      send: { type: 'factory', factory },
    });
    expect(send).toHaveLength(1);
    expect(send[0].secret).toBe(secretHex);
    return { locked: send[0], keysetId };
  }

  test(
    'key-path sweep of a locked proof: mint sees only a key and one signature',
    {
      timeout: 30_000,
    },
    async () => {
      const internalPriv = bytesToHex(sk(21));
      const internalPub = pk(21);
      const { secret, tree } = buildNutrootSecret(internalPub, [
        { type: 'after', n: 1, keys: [pk(22)], time: 4102444800 }, // far-future refund
      ]);
      const { locked } = await createLockedProof(secret);

      // Bearer handoff: k + tree.
      locked.spend_info = { k: internalPriv, tree };

      const bob = new Wallet(mintUrl, { bip39seed: randomBytes(64) });
      await bob.loadMint();
      type SwapBody = {
        inputs: Array<{ secret: string; witness?: string }>;
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
        received = await bob.receive([locked]);
      } finally {
        spy.mockRestore();
      }
      expect(received.length).toBeGreaterThan(0);
      // The wire witness is a bare key-path signature: no leaf, no control block, one signature.
      const wireInput = (swapBody as SwapBody).inputs.find((i) => i.secret === secret);
      expect(wireInput?.witness).toBeDefined();
      const parsed = JSON.parse(wireInput?.witness as string) as Record<string, unknown>;
      expect(Object.keys(parsed)).toEqual(['signatures']);
      expect((parsed.signatures as string[]).length).toBe(1);
    },
  );

  test('refund via the after leaf (script path)', { timeout: 30_000 }, async () => {
    const refundPriv = sk(23);
    const { secret, tree } = buildNutrootSecret(pk(24), [
      { type: 'after', n: 1, keys: [pk(23)], time: 1700000000 }, // past locktime
    ]);
    const { locked, keysetId } = await createLockedProof(secret);
    await expect(
      manualSwapLockedProof(keysetId, { amount: 32n, secret, C: locked.C }, (digest) =>
        buildScriptPathWitness(tree, 0, pk(24), [bytesToHex(schnorr.sign(digest, refundPriv))]),
      ),
    ).resolves.toBeDefined();
  });

  test('hashlock spend (script path)', { timeout: 30_000 }, async () => {
    const preimage = new Uint8Array(32).fill(7);
    const holderPriv = sk(25);
    const { secret, tree } = buildNutrootSecret(pk(26), [
      { type: 'hashlock', n: 1, keys: [pk(25)], hash: bytesToHex(sha256(preimage)) },
    ]);
    const { locked, keysetId } = await createLockedProof(secret);
    await expect(
      manualSwapLockedProof(keysetId, { amount: 32n, secret, C: locked.C }, (digest) =>
        buildScriptPathWitness(
          tree,
          0,
          pk(26),
          [bytesToHex(schnorr.sign(digest, holderPriv))],
          bytesToHex(preimage),
        ),
      ),
    ).resolves.toBeDefined();
  });

  test('2-of-3 threshold spend (script path)', { timeout: 30_000 }, async () => {
    const { secret, tree } = buildNutrootSecret(pk(27), [
      { type: 'threshold', n: 2, keys: [pk(31), pk(32), pk(33)] },
    ]);
    const { locked, keysetId } = await createLockedProof(secret);
    await expect(
      manualSwapLockedProof(keysetId, { amount: 32n, secret, C: locked.C }, (digest) =>
        buildScriptPathWitness(tree, 0, pk(27), [
          bytesToHex(schnorr.sign(digest, sk(31))),
          bytesToHex(schnorr.sign(digest, sk(33))),
        ]),
      ),
    ).resolves.toBeDefined();
  });

  test('NUMS script-only proof spends via its leaf', { timeout: 30_000 }, async () => {
    // The internal key is the offset H + u*G, not H, so the control block carries the offset key.
    const { secret, tree, K, u } = buildNutrootSecret(NUTROOT_NUMS_KEY, [
      { type: 'threshold', n: 1, keys: [pk(34)] },
    ]);
    expect(u).toBeDefined();
    expect(verifyNutrootSpendInfo(secret, { K, u, tree })).toBe('tweaked');
    const { locked, keysetId } = await createLockedProof(secret);
    await expect(
      manualSwapLockedProof(keysetId, { amount: 32n, secret, C: locked.C }, (digest) =>
        buildScriptPathWitness(tree, 0, K, [bytesToHex(schnorr.sign(digest, sk(34)))]),
      ),
    ).resolves.toBeDefined();
  });

  test('wrong merkle path is rejected by the mint', { timeout: 30_000 }, async () => {
    const { secret, tree } = buildNutrootSecret(pk(28), [
      { type: 'threshold', n: 1, keys: [pk(35)] },
      { type: 'after', n: 1, keys: [pk(35)], time: 1700000000 },
    ]);
    const { locked, keysetId } = await createLockedProof(secret);
    await expect(
      manualSwapLockedProof(keysetId, { amount: 32n, secret, C: locked.C }, (digest) => {
        const good = JSON.parse(
          buildScriptPathWitness(tree, 0, pk(28), [bytesToHex(schnorr.sign(digest, sk(35)))]),
        ) as { control: { path: string[] } };
        good.control.path = ['00'.repeat(32)];
        return JSON.stringify(good);
      }),
    ).rejects.toThrow(/script path/i);
  });

  test('mixed transaction: the v3 input is verified per input', { timeout: 40_000 }, async () => {
    // NUT-10: rules follow the proof's keyset and verification is per input, so a legacy input
    // alongside a v3 one must not excuse the v3 input from carrying a witness.
    const { keysets } = await new Mint(mintUrl).getKeySets();
    const legacyKeyset = keysets.find((k) => k.unit === 'sat' && k.active && !isBlsKeyset(k.id));
    expect(legacyKeyset, 'mint must serve a pre-v3 keyset for this test').toBeDefined();

    const seed = randomBytes(64);
    const v3Wallet = new Wallet(mintUrl, { bip39seed: seed });
    await v3Wallet.loadMint();
    const v3Quote = await v3Wallet.createMintQuoteBolt11(32);
    await v3Wallet.on.onceMintPaid(v3Quote.quote, { timeoutMs: 10_000 });
    const v3Proofs = await v3Wallet.mintProofsBolt11(32, v3Quote);

    const legacyWallet = new Wallet(mintUrl, { bip39seed: seed, keysetId: legacyKeyset!.id });
    await legacyWallet.loadMint();
    const legacyQuote = await legacyWallet.createMintQuoteBolt11(32);
    await legacyWallet.on.onceMintPaid(legacyQuote.quote, { timeoutMs: 10_000 });
    const legacyProofs = await legacyWallet.mintProofsBolt11(32, legacyQuote);

    const v3KeysetId = v3Proofs[0].id;
    expect(isBlsKeyset(v3KeysetId)).toBe(true);
    expect(isBlsKeyset(legacyProofs[0].id)).toBe(false);

    // 64 in, 2 inputs at 100 ppk = 1 sat of fees, so 63 out.
    const outputs = [32n, 16n, 8n, 4n, 2n, 1n].map((a) =>
      OutputData.createSingleNutrootData(
        bytesToHex(secp256k1.getPublicKey(randomBytes(32), true)),
        a,
        v3KeysetId,
      ),
    );
    const inputs = [...v3Proofs, ...legacyProofs];
    const digest = transactionDigest({
      proofInputs: inputs.map((p) => ({
        amount: Amount.from(p.amount).toBigInt(),
        keysetId: p.id,
        secret: p.secret,
        C: p.C,
      })),
      blindedOutputs: outputs.map((o) => ({
        amount: Amount.from(o.blindedMessage.amount).toBigInt(),
        keysetId: o.blindedMessage.id,
        B_: o.blindedMessage.B_,
      })),
    });

    // Unsigned v3 input beside a legacy input: the mint must still demand its witness.
    // Before per-input verification the whole check was skipped whenever any input was not a
    // v3 point secret, so this swap went through and the lock was bypassed.
    await expect(
      new Mint(mintUrl).swap({
        inputs: inputs.map((p) => ({ ...p })),
        outputs: outputs.map((o) => o.blindedMessage),
      }),
    ).rejects.toThrow(/witness/i);
    // The digest is well-formed over the mixed inputs (legacy secret carried verbatim).
    expect(digest).toHaveLength(32);
  });

  test('a NUT-10 secret is refused on a v3 keyset', { timeout: 30_000 }, async () => {
    // One secret format per keyset version: NUT-10 well-known secrets live on
    // legacy/v1/v2 keysets, v3 takes points. The wallet refuses to build one,
    // and the mint refuses to accept one as an input.
    const { locked, keysetId } = await createLockedProof(
      buildNutrootSecret(pk(45), [{ type: 'threshold', n: 1, keys: [pk(45)] }]).secret,
    );
    expect(() =>
      OutputData.createSingleP2PKData({ kind: 'P2PK', data: pk(45) }, 1n, keysetId),
    ).toThrow();

    const nut10Secret = JSON.stringify(['P2PK', { nonce: '00'.repeat(16), data: pk(45) }]);
    const outputs = [16n, 8n, 4n, 2n, 1n].map((a) =>
      OutputData.createSingleNutrootData(
        bytesToHex(secp256k1.getPublicKey(randomBytes(32), true)),
        a,
        keysetId,
      ),
    );
    await expect(
      new Mint(mintUrl).swap({
        inputs: [{ amount: 32n, id: keysetId, secret: nut10Secret, C: locked.C }],
        outputs: outputs.map((o) => o.blindedMessage),
      } as never),
    ).rejects.toThrow(/point secret/i);
  });

  test('partial tree disclosure is rejected on receive', { timeout: 30_000 }, async () => {
    const internalPriv = bytesToHex(sk(29));
    const { secret, tree } = buildNutrootSecret(pk(29), [
      { type: 'threshold', n: 1, keys: [pk(36)] },
      { type: 'after', n: 1, keys: [pk(36)], time: 1700000000 },
    ]);
    const { locked } = await createLockedProof(secret);
    const bob = new Wallet(mintUrl, { bip39seed: randomBytes(64) });
    await bob.loadMint();
    // Only one of the two leaves disclosed: reconstruction misses the secret.
    locked.spend_info = { k: internalPriv, tree: [tree[0]] };
    await expect(bob.receive([locked])).rejects.toThrow(/reconstruct/);
  });
});

describeV3('M4 locked quotes', () => {
  const sk = (n: number) => {
    const b = new Uint8Array(32);
    b[31] = n;
    return b;
  };
  const pk = (n: number) => bytesToHex(secp256k1.getPublicKey(sk(n), true));

  test(
    'cardless ATM: recipient key-path mint, payer script-path reclaim after expiry',
    { timeout: 40_000 },
    async () => {
      const wallet = new Wallet(mintUrl, { bip39seed: randomBytes(64) });
      await wallet.loadMint();
      const keysetId = wallet.keyChain.getCheapestKeyset().id;

      // Path A: quote locked to recipient with a far-future refund leaf; the
      // recipient mints via key path (p' = k + t) before expiry.
      const recipientPriv = sk(41);
      const lockA = buildNutrootSecret(pk(41), [
        { type: 'after', n: 1, keys: [pk(42)], time: 4102444800 },
      ]);
      const quoteA = await wallet.createLockedMintQuote(32, lockA.secret);
      await wallet.on.onceMintPaid(quoteA.quote, { timeoutMs: 10_000 });
      const rootA = nutrootMerkleRoot(lockA.tree.map((l) => nutrootLeafHash(hexToBytes(l))));
      const tweakedPriv = nutrootTweakSeckey(recipientPriv, rootA);
      const proofs = await wallet.mintProofsBolt11(32, quoteA, {
        privkey: bytesToHex(tweakedPriv),
      });
      expect(proofs.length).toBeGreaterThan(0);

      // Path B: refund leaf already expired; the payer reclaims via script path.
      const payerPriv = sk(43);
      const lockB = buildNutrootSecret(pk(44), [
        { type: 'after', n: 1, keys: [pk(43)], time: 1700000000 },
      ]);
      const quoteB = await wallet.createLockedMintQuote(32, lockB.secret);
      await wallet.on.onceMintPaid(quoteB.quote, { timeoutMs: 10_000 });
      const outputsB = [
        OutputData.createSingleNutrootData(
          bytesToHex(secp256k1.getPublicKey(randomBytes(32), true)),
          32n,
          keysetId,
        ),
      ];
      const digestB = transactionDigest({
        mintQuoteInputs: [{ amount: 32n, quoteId: quoteB.quote }],
        blindedOutputs: outputsB.map((o) => ({
          amount: Amount.from(o.blindedMessage.amount).toBigInt(),
          keysetId: o.blindedMessage.id,
          B_: o.blindedMessage.B_,
        })),
      });
      const mint = new Mint(mintUrl);
      const response = await mint.mintBolt11({
        quote: quoteB.quote,
        outputs: outputsB.map((o) => o.blindedMessage),
        signature: buildScriptPathWitness(lockB.tree, 0, pk(44), [
          bytesToHex(schnorr.sign(digestB, payerPriv)),
        ]),
      });
      expect(response.signatures).toHaveLength(1);

      // Negative: reclaim before expiry fails (locktime not reached).
      const lockC = buildNutrootSecret(pk(44), [
        { type: 'after', n: 1, keys: [pk(43)], time: 4102444800 },
      ]);
      const quoteC = await wallet.createLockedMintQuote(32, lockC.secret);
      await wallet.on.onceMintPaid(quoteC.quote, { timeoutMs: 10_000 });
      const outputsC = [
        OutputData.createSingleNutrootData(
          bytesToHex(secp256k1.getPublicKey(randomBytes(32), true)),
          32n,
          keysetId,
        ),
      ];
      const digestC = transactionDigest({
        mintQuoteInputs: [{ amount: 32n, quoteId: quoteC.quote }],
        blindedOutputs: outputsC.map((o) => ({
          amount: Amount.from(o.blindedMessage.amount).toBigInt(),
          keysetId: o.blindedMessage.id,
          B_: o.blindedMessage.B_,
        })),
      });
      await expect(
        mint.mintBolt11({
          quote: quoteC.quote,
          outputs: outputsC.map((o) => o.blindedMessage),
          signature: buildScriptPathWitness(lockC.tree, 0, pk(44), [
            bytesToHex(schnorr.sign(digestC, payerPriv)),
          ]),
        }),
      ).rejects.toThrow();
    },
  );
});

describeV3('M4 receiver-keyed sends', () => {
  test(
    'receiver-keyed send, trial-matched receive, sweep (bare and locked)',
    { timeout: 40_000 },
    async () => {
      const bobPriv = randomBytes(32);
      const bobPub = bytesToHex(secp256k1.getPublicKey(bobPriv, true));
      const strangerPriv = randomBytes(32);

      // Sender derives per-output secrets keyed to Bob: one bare, one with a refund tree.
      const bare = deriveReceiverKeyedSecret(bobPub);
      const locked = deriveReceiverKeyedSecret(bobPub, {
        leaves: [
          {
            type: 'after',
            n: 1,
            keys: [bobPub],
            time: 4102444800,
          },
        ],
      });

      const { wallet, proofs } = await (async () => {
        const w = new Wallet(mintUrl, { bip39seed: randomBytes(64) });
        await w.loadMint();
        const quote = await w.createMintQuoteBolt11(128);
        await w.on.onceMintPaid(quote.quote, { timeoutMs: 10_000 });
        return { wallet: w, proofs: await w.mintProofsBolt11(128, quote) };
      })();

      let available = proofs;
      const sendOne = async (secretHex: string) => {
        const factory = (a: AmountLike, k: { id: string }) =>
          OutputData.createSingleNutrootData(secretHex, a, k.id);
        const { send, keep } = await wallet.send(32n, available, undefined, {
          send: { type: 'factory', factory },
        });
        available = keep;
        expect(send).toHaveLength(1);
        return send[0];
      };
      const bareProof = await sendOne(bare.secret);
      const lockedProof = await sendOne(locked.secret);
      bareProof.spend_info = { E: bare.E };
      lockedProof.spend_info = { E: locked.E, tree: locked.tree };

      // A stranger's trial-match misses both.
      expect(
        recoverReceiverKeyedSecretKey(bareProof.secret, bare.E!, bytesToHex(strangerPriv)),
      ).toBeUndefined();

      // Bob trial-matches, recovers key-path keys, and sweeps both proofs.
      const bob = new Wallet(mintUrl, { bip39seed: randomBytes(64) });
      await bob.loadMint();
      for (const proof of [bareProof, lockedProof]) {
        const hit = recoverReceiverKeyedSecretKey(
          proof.secret,
          proof.spend_info?.E as string,
          bytesToHex(bobPriv),
          proof.spend_info?.tree,
        );
        expect(hit).toBeDefined();
        // Sweep with the recovered key-path key: witness signs via spend_info.k.
        proof.spend_info = { k: hit?.secretKey };
      }
      const received = await bob.receive([bareProof, lockedProof]);
      expect(received.length).toBeGreaterThan(0);
      // 64 sent minus the sweep's input fee (2 inputs at 100 ppk -> 1 sat).
      expect(sumProofs(received).toString()).toBe('63');
    },
  );
});

describeV3('M6 leaf-key blinding through the wallet', () => {
  test(
    'blinded leaf key: payee sweeps by key path, leaf owner recognises its slot, stranger does not',
    { timeout: 40_000 },
    async () => {
      // Carol is paid; Alice keeps a refund leaf whose key she tags blind-me.
      const carolPriv = bytesToHex(randomBytes(32));
      const carolPub = bytesToHex(secp256k1.getPublicKey(hexToBytes(carolPriv), true));
      const alicePriv = bytesToHex(randomBytes(32));
      const alicePub = bytesToHex(secp256k1.getPublicKey(hexToBytes(alicePriv), true));
      const strangerPriv = bytesToHex(randomBytes(32));

      const payer = new Wallet(mintUrl, { bip39seed: randomBytes(64) });
      await payer.loadMint();
      const quote = await payer.createMintQuoteBolt11(128);
      await payer.on.onceMintPaid(quote.quote, { timeoutMs: 10_000 });
      const funds = await payer.mintProofsBolt11(128, quote);

      // Carol's request: pay my static key, under a refund leaf, and blind my key in it.
      const pr = PaymentRequest.builder()
        .amount(32, 'sat')
        .requestNutroot({
          receiverKey: carolPub,
          leaves: [
            bytesToHex(
              serializeNutrootLeaf({ type: 'after', n: 1, keys: [alicePub], time: 4102444800 }),
            ),
          ],
          blindKeys: [alicePub],
        })
        .build();

      const { send } = await payer.ops.sendToRequest(pr, funds).run();
      expect(send.length).toBeGreaterThan(0);
      for (const proof of send) {
        expect(isBlsKeyset(proof.id)).toBe(true);
        const tree = proof.spend_info?.tree;
        expect(tree).toHaveLength(1);
        // The leaf carries a blinded key, not Alice's key verbatim.
        expect(parseNutrootLeaf(hexToBytes(tree![0])).keys[0]).not.toBe(alicePub);

        // Alice recognises her own key at slot 1; a stranger's key matches nothing.
        const mine = recoverLeafKeySecretKeys(tree!, proof.spend_info?.E, [alicePriv]);
        expect(mine).toHaveLength(1);
        expect(mine[0]).toMatchObject({ leafIndex: 0, keyIndex: 0, slot: 1, blinded: true });
        expect(bytesToHex(secp256k1.getPublicKey(hexToBytes(mine[0].secretKey), true))).toBe(
          parseNutrootLeaf(hexToBytes(tree![0])).keys[0],
        );
        expect(recoverLeafKeySecretKeys(tree!, proof.spend_info?.E, [strangerPriv])).toEqual([]);
      }

      // Carol sweeps by key path, with only her static key: the mint accepts the witnesses.
      const carol = new Wallet(mintUrl, { bip39seed: randomBytes(64) });
      await carol.loadMint();
      const received = await carol.receive(send, { privkey: carolPriv });
      expect(sumProofs(received).toBigInt()).toBeGreaterThan(0n);

      // A stranger's key sweeps nothing: unsigned v3 inputs are refused.
      const stranger = new Wallet(mintUrl, { bip39seed: randomBytes(64) });
      await stranger.loadMint();
      await expect(stranger.receive(send, { privkey: strangerPriv })).rejects.toThrow();
    },
  );
});

describeV3('M7 mixed-keyset transactions through the wallet API', () => {
  /**
   * The mint serves a v3 (BLS) keyset beside a pre-v3 one; both are active for sat.
   */
  async function keysetPair() {
    const { keysets } = await new Mint(mintUrl).getKeySets();
    const v3 = keysets.find((k) => k.unit === 'sat' && k.active && isBlsKeyset(k.id));
    const legacy = keysets.find((k) => k.unit === 'sat' && k.active && !isBlsKeyset(k.id));
    expect(v3, 'mint must serve a v3 keyset').toBeDefined();
    expect(legacy, 'mint must serve a pre-v3 keyset').toBeDefined();
    return { v3: v3!.id, legacy: legacy!.id };
  }

  async function fund(keysetId: string, amount: number, seed: Uint8Array) {
    const wallet = new Wallet(mintUrl, { bip39seed: seed, keysetId });
    await wallet.loadMint();
    const quote = await wallet.createMintQuoteBolt11(amount);
    // Poll rather than subscribe: this helper funds several wallets per test, and a socket each
    // is what the mint's connection limits notice first.
    for (let i = 0; i < 40; i++) {
      const state = await wallet.checkMintQuoteBolt11(quote.quote);
      if (state.state === 'PAID') break;
      await new Promise((r) => setTimeout(r, 250));
    }
    return { wallet, proofs: await wallet.mintProofsBolt11(amount, quote) };
  }

  test('pre-v3 inputs with v3 outputs: the migration shape', { timeout: 60_000 }, async () => {
    const { v3, legacy } = await keysetPair();
    const seed = randomBytes(64);
    const v3Side = await fund(v3, 32, seed);
    const legacySide = await fund(legacy, 32, seed);
    expect(legacySide.proofs.every((p) => !isBlsKeyset(p.id))).toBe(true);

    const mixed = [...v3Side.proofs, ...legacySide.proofs];
    const { send, keep } = await v3Side.wallet.send(48, mixed);
    // Every output landed on the v3 keyset and carries a point secret.
    for (const proof of [...send, ...keep]) {
      expect(isBlsKeyset(proof.id)).toBe(true);
      expect(proof.secret).toMatch(/^0[23][0-9a-f]{64}$/);
    }
    // Value is conserved net of the input fee over BOTH keysets.
    const fee = v3Side.wallet.getFeesForProofs(mixed);
    expect(sumProofs([...send, ...keep]).toBigInt()).toBe(64n - fee.toBigInt());
    // The inputs are spent, and the outputs are live.
    const states = await v3Side.wallet.checkProofsStates(mixed);
    expect(states.every((s) => s.state === CheckStateEnum.SPENT)).toBe(true);
    const live = await v3Side.wallet.checkProofsStates(send);
    expect(live.every((s) => s.state === CheckStateEnum.UNSPENT)).toBe(true);
  });

  test('v3 inputs with pre-v3 outputs: the reverse direction', { timeout: 60_000 }, async () => {
    const { v3, legacy } = await keysetPair();
    const seed = randomBytes(64);
    const v3Side = await fund(v3, 32, seed);
    const legacySide = await fund(legacy, 32, seed);

    const mixed = [...v3Side.proofs, ...legacySide.proofs];
    const { send, keep } = await legacySide.wallet.send(48, mixed);
    // Outputs are pre-v3, so they carry ordinary random string secrets.
    for (const proof of [...send, ...keep]) {
      expect(isBlsKeyset(proof.id)).toBe(false);
      expect(proof.secret).not.toMatch(/^0[23][0-9a-f]{64}$/);
    }
    const fee = legacySide.wallet.getFeesForProofs(mixed);
    expect(sumProofs([...send, ...keep]).toBigInt()).toBe(64n - fee.toBigInt());
    const states = await legacySide.wallet.checkProofsStates(mixed);
    expect(states.every((s) => s.state === CheckStateEnum.SPENT)).toBe(true);
  });

  test(
    'one request, two rule sets: a NUT-11 locked pre-v3 input beside a v3 input',
    { timeout: 60_000 },
    async () => {
      // NUT-10: rules follow the proof's keyset. The legacy input needs a NUT-11 signature over
      // its own secret; the v3 input needs a transaction witness over the transcript. Both in one
      // swap, from one call.
      const { v3, legacy } = await keysetPair();
      const seed = randomBytes(64);
      const v3Side = await fund(v3, 32, seed);
      const legacySide = await fund(legacy, 32, seed);

      const bobPriv = bytesToHex(randomBytes(32));
      const bobPub = bytesToHex(secp256k1.getPublicKey(hexToBytes(bobPriv), true));
      const { send: locked } = await legacySide.wallet.ops
        .send(16, legacySide.proofs)
        .asLocked({ mainKeys: [bobPub] })
        .run();
      expect(locked.every((p) => p.secret.includes('P2PK'))).toBe(true);

      // The v3 wallet receives the locked pre-v3 proofs together with its own v3 proofs, whose
      // keys it re-derives from its seed. One wallet, one request, both rule sets.
      const bob = v3Side.wallet;
      const mixed = [...locked, ...v3Side.proofs];
      const received = await bob.receive(mixed, { privkey: bobPriv });
      const fee = bob.getFeesForProofs(mixed);
      expect(sumProofs(received).toBigInt()).toBe(sumProofs(mixed).toBigInt() - fee.toBigInt());
      expect(received.every((p) => isBlsKeyset(p.id))).toBe(true);
      const states = await bob.checkProofsStates(mixed);
      expect(states.every((s) => s.state === CheckStateEnum.SPENT)).toBe(true);
    },
  );

  test('melt with mixed inputs pays and returns change', { timeout: 60_000 }, async () => {
    const { v3, legacy } = await keysetPair();
    const seed = randomBytes(64);
    const v3Side = await fund(v3, 6000, seed);
    const legacySide = await fund(legacy, 2000, seed);
    const mixed = [...v3Side.proofs, ...legacySide.proofs];

    // Melt an invoice this mint issued, so the test is repeatable: a fixed external invoice can
    // only be paid once per mint, and mint state outlives a single run.
    const payee = new Wallet(mintUrl, { bip39seed: randomBytes(64), keysetId: legacy });
    await payee.loadMint();
    const target = await payee.createMintQuoteBolt11(1000);
    const quote = await v3Side.wallet.createMeltQuoteBolt11(target.request);
    const result = await v3Side.wallet.meltProofsBolt11(quote, mixed);
    expect(result.quote.state).toBe('PAID');
    // Change comes back on the wallet's own (v3) keyset, whatever the inputs were.
    expect(result.change.every((p) => isBlsKeyset(p.id))).toBe(true);
    const states = await v3Side.wallet.checkProofsStates(mixed);
    expect(states.every((s) => s.state === CheckStateEnum.SPENT)).toBe(true);
  });

  test(
    'restoreAll recovers a wallet holding both keysets, unspent only',
    { timeout: 60_000 },
    async () => {
      // One seed, proofs on both keysets: restore has to walk each keyset's own counter branch,
      // and v3 keys come from a different derivation than pre-v3 secrets.
      const { v3, legacy } = await keysetPair();
      const seed = randomBytes(64);
      const v3Side = await fund(v3, 32, seed);
      const legacySide = await fund(legacy, 32, seed);
      expect(sumProofs(v3Side.proofs).toBigInt()).toBe(32n);
      // Spend the legacy half, so restore must also tell live proofs from dead ones.
      await legacySide.wallet.send(16, legacySide.proofs);

      const fresh = new Wallet(mintUrl, { bip39seed: seed, keysetId: v3 });
      await fresh.loadMint();
      const { proofs, lastCounters } = await fresh.restoreAll({ batchSize: 50, gapLimit: 50 });
      // Restore reports where each keyset's counter ended; advancing them is the caller's job,
      // and skipping it re-derives outputs the mint has already signed.
      for (const [keysetId, last] of Object.entries(lastCounters)) {
        await fresh.counters.setNext?.(keysetId, last + 1);
      }
      const byKeyset = new Map<string, bigint>();
      for (const p of proofs) {
        byKeyset.set(p.id, (byKeyset.get(p.id) ?? 0n) + Amount.from(p.amount).toBigInt());
      }
      // The v3 half is intact; the legacy half restored only what the send left unspent.
      expect(byKeyset.get(v3)).toBe(32n);
      expect(byKeyset.get(legacy) ?? 0n).toBeGreaterThan(0n);
      expect(byKeyset.get(legacy)).toBeLessThan(32n);
      // Restored v3 proofs carry point secrets and are spendable: their keys re-derived.
      const restoredV3 = proofs.filter((p) => p.id === v3);
      expect(restoredV3.every((p) => /^0[23][0-9a-f]{64}$/.test(p.secret))).toBe(true);
      const swept = await fresh.receive(restoredV3);
      expect(sumProofs(swept).toBigInt()).toBeGreaterThan(0n);
    },
  );
});

describeV3('M8 tokens end to end with spend_info', () => {
  async function fundV3(amount: number) {
    const wallet = new Wallet(mintUrl, { bip39seed: randomBytes(64) });
    await wallet.loadMint();
    const quote = await wallet.createMintQuoteBolt11(amount);
    for (let i = 0; i < 40; i++) {
      const state = await wallet.checkMintQuoteBolt11(quote.quote);
      if (state.state === 'PAID') break;
      await new Promise((r) => setTimeout(r, 250));
    }
    return { wallet, proofs: await wallet.mintProofsBolt11(amount, quote) };
  }

  test(
    'bearer k: token string carries the key, a keyless receiver sweeps it',
    { timeout: 60_000 },
    async () => {
      const { wallet, proofs } = await fundV3(64);
      const { send } = await wallet.send(32, proofs);
      const token = getEncodedToken({ mint: mintUrl, proofs: send, unit: 'sat' });
      expect(token.startsWith('cashuB')).toBe(true);

      // The token is the only thing that crosses: decode it fresh and check the key survived.
      const decoded = getDecodedToken(
        token,
        send.map((p) => p.id),
      );
      expect(decoded.proofs.every((p) => /^[0-9a-f]{64}$/.test(p.spend_info?.k ?? ''))).toBe(true);
      expect(decoded.proofs).toEqual(send);

      // A wallet with no keys and no seed relationship sweeps it from the string alone.
      const receiver = new Wallet(mintUrl, { bip39seed: randomBytes(64) });
      await receiver.loadMint();
      const received = await receiver.receive(token);
      expect(sumProofs(received).toBigInt()).toBeGreaterThan(0n);
      expect(received.every((p) => isBlsKeyset(p.id))).toBe(true);
    },
  );

  test(
    'receiver-keyed E, bare and under a blinded tree: only the payee sweeps',
    { timeout: 60_000 },
    async () => {
      const carolPriv = bytesToHex(randomBytes(32));
      const carolPub = bytesToHex(secp256k1.getPublicKey(hexToBytes(carolPriv), true));
      const alicePriv = bytesToHex(randomBytes(32));
      const alicePub = bytesToHex(secp256k1.getPublicKey(hexToBytes(alicePriv), true));
      const { wallet, proofs } = await fundV3(64);

      for (const leaves of [
        undefined,
        [{ type: 'after' as const, n: 1, keys: [alicePub], time: 4102444800 }],
      ]) {
        const { send, keep } = await wallet.ops
          .send(16, proofs)
          .asLocked({ mainKeys: [carolPub], leaves, ...(leaves && { blindKeys: [alicePub] }) })
          .run();
        proofs.length = 0;
        proofs.push(...keep);
        const token = getEncodedToken({ mint: mintUrl, proofs: send, unit: 'sat' });
        const decoded = getDecodedToken(
          token,
          send.map((p) => p.id),
        );
        for (const p of decoded.proofs) {
          expect(p.spend_info?.E).toMatch(/^0[23][0-9a-f]{64}$/);
          expect(p.spend_info?.k).toBeUndefined();
          expect(p.spend_info?.tree?.length ?? 0).toBe(leaves ? 1 : 0);
          // The cascade classifies it without needing any key.
          expect(verifyNutrootSpendInfo(p.secret, p.spend_info!)).toBe('receiver-keyed');
        }

        // Carol sweeps from the token string with her static key.
        const carol = new Wallet(mintUrl, { bip39seed: randomBytes(64) });
        await carol.loadMint();
        const stranger = new Wallet(mintUrl, { bip39seed: randomBytes(64) });
        await stranger.loadMint();
        await expect(
          stranger.receive(token, { privkey: bytesToHex(randomBytes(32)) }),
        ).rejects.toThrow();
        const received = await carol.receive(token, { privkey: carolPriv });
        expect(sumProofs(received).toBigInt()).toBeGreaterThan(0n);
      }
    },
  );

  test(
    'explicit K: a script-only token discloses its tree and spends through a leaf',
    { timeout: 60_000 },
    async () => {
      // No key path at all: K is a NUMS offset, so every spend goes through a leaf (NUT-10).
      const ownerPriv = randomBytes(32);
      const ownerPub = bytesToHex(secp256k1.getPublicKey(ownerPriv, true));
      const { secret, tree, K, u } = buildNutrootSecret(NUTROOT_NUMS_KEY, [
        { type: 'threshold', n: 1, keys: [ownerPub] },
      ]);
      const { wallet, proofs } = await fundV3(64);
      const { send } = await wallet.ops
        .send(32, proofs)
        .asFactory((a, k) => OutputData.createSingleNutrootData(secret, a, k.id), [32])
        .run();
      expect(send).toHaveLength(1);
      send[0].spend_info = { K, u, tree };

      const token = getEncodedToken({ mint: mintUrl, proofs: send, unit: 'sat' });
      const decoded = getDecodedToken(token, [send[0].id]);
      const proof = decoded.proofs[0];
      // The offset survives the token round-trip: without it the payee cannot tell that no key
      // path exists, since K alone is just a point.
      expect(proof.spend_info?.K).toBe(K);
      expect(proof.spend_info?.u).toBe(u);
      expect(proof.spend_info?.tree).toEqual(tree);
      // Tree plus internal key reconstruct the secret, so the disclosure is provably complete.
      expect(verifyNutrootSpendInfo(proof.secret, proof.spend_info!)).toBe('tweaked');

      // Spending it goes through the wallet: a script-only proof has no key path at all, so
      // the plan is the only way it moves.
      const spender = new Wallet(mintUrl, { bip39seed: randomBytes(64) });
      await spender.loadMint();
      const options = await spender.spendOptions(proof, { privkeys: bytesToHex(ownerPriv) });
      expect(options.keyPath).toBe(false);
      expect(options.script[0]).toMatchObject({ satisfiable: true, leafIndex: 0 });
      const received = await spender.receive([proof], {
        privkey: bytesToHex(ownerPriv),
        scriptPath: [{ secret: proof.secret, leafIndex: 0 }],
      });
      expect(sumProofs(received).toBigInt()).toBe(31n);
    },
  );
});

describeV3('audit: spend info carrying both k and E', () => {
  test(
    'a re-gifted derived scalar beside its ephemeral is refused, melt path included',
    { timeout: 60_000 },
    async () => {
      // NUT-10: `k` and `E` are mutually exclusive, and a receiver-keyed proof's scalar is
      // `p_static + r_i`. A proof carrying both means someone holds that scalar AND knows r_i, so
      // they can recover the receiver's static private key. The cascade rejects the shape, but the
      // cascade only runs on receive: melt reaches key collection directly.
      const carolPriv = bytesToHex(randomBytes(32));
      const carolPub = bytesToHex(secp256k1.getPublicKey(hexToBytes(carolPriv), true));
      const payer = new Wallet(mintUrl, { bip39seed: randomBytes(64) });
      await payer.loadMint();
      const quote = await payer.createMintQuoteBolt11(64);
      for (let i = 0; i < 40; i++) {
        if ((await payer.checkMintQuoteBolt11(quote.quote)).state === 'PAID') break;
        await new Promise((r) => setTimeout(r, 250));
      }
      const funds = await payer.mintProofsBolt11(64, quote);
      const { send } = await payer.ops
        .send(32, funds)
        .asLocked({ mainKeys: [carolPub] }, [32])
        .run();
      const proof = send[0];

      // The dangerous shape: the derived scalar re-gifted as a bearer key beside its ephemeral.
      const derived = recoverReceiverKeyedSecretKey(proof.secret, proof.spend_info!.E!, carolPriv);
      expect(derived).toBeDefined();
      const poisoned = [
        { ...proof, spend_info: { k: derived!.secretKey, E: proof.spend_info!.E } },
      ];

      const carol = new Wallet(mintUrl, { bip39seed: randomBytes(64) });
      await carol.loadMint();
      // Receive already refused it (the cascade). Melt must refuse it too.
      await expect(carol.receive(poisoned, { privkey: carolPriv })).rejects.toThrow(/both k and E/);
      const payee = new Wallet(mintUrl, { bip39seed: randomBytes(64) });
      await payee.loadMint();
      const target = await payee.createMintQuoteBolt11(8);
      const meltQuote = await carol.createMeltQuoteBolt11(target.request);
      await expect(
        carol.meltProofsBolt11(meltQuote, poisoned, { privkey: carolPriv }),
      ).rejects.toThrow(/both k and E/);
    },
  );
});

describeV3('M9 script path through the wallet API', () => {
  async function fundV3(amount: number) {
    const wallet = new Wallet(mintUrl, { bip39seed: randomBytes(64) });
    await wallet.loadMint();
    const quote = await wallet.createMintQuoteBolt11(amount);
    for (let i = 0; i < 40; i++) {
      if ((await wallet.checkMintQuoteBolt11(quote.quote)).state === 'PAID') break;
      await new Promise((r) => setTimeout(r, 250));
    }
    return { wallet, proofs: await wallet.mintProofsBolt11(amount, quote) };
  }

  test(
    'refund: the leaf owner spends a blinded leaf key through receive()',
    { timeout: 60_000 },
    async () => {
      // The M6 circuit, now driven by the wallet instead of a hand-built payload.
      const carolPub = bytesToHex(secp256k1.getPublicKey(randomBytes(32), true));
      const alicePriv = bytesToHex(randomBytes(32));
      const alicePub = bytesToHex(secp256k1.getPublicKey(hexToBytes(alicePriv), true));
      const { wallet, proofs } = await fundV3(64);
      const leaf: NutrootLeaf = { type: 'after', n: 1, keys: [alicePub], time: 1 };
      const { send } = await wallet.ops
        .send(32, proofs)
        .asLocked({ mainKeys: [carolPub], leaves: [leaf], blindKeys: [alicePub] }, [32])
        .run();
      const proof = send[0];

      // Alice asks what she can do with it, then does exactly that.
      const alice = new Wallet(mintUrl, { bip39seed: randomBytes(64) });
      await alice.loadMint();
      const options = await alice.spendOptions(proof, { privkeys: alicePriv });
      expect(options.keyPath).toBe(false); // the key path is Carol's
      expect(options.script).toHaveLength(1);
      expect(options.script[0]).toMatchObject({ satisfiable: true, leafIndex: 0 });
      expect(options.script[0].keys[0].blinded).toBe(true);

      const received = await alice.receive([proof], {
        privkey: alicePriv,
        scriptPath: [{ secret: proof.secret, leafIndex: 0 }],
      });
      expect(sumProofs(received).toBigInt()).toBe(31n); // 32 less one input fee
    },
  );

  test(
    'a locktime the mint has not reached is refused, and spendOptions said so',
    { timeout: 60_000 },
    async () => {
      const carolPub = bytesToHex(secp256k1.getPublicKey(randomBytes(32), true));
      const alicePriv = bytesToHex(randomBytes(32));
      const alicePub = bytesToHex(secp256k1.getPublicKey(hexToBytes(alicePriv), true));
      const { wallet, proofs } = await fundV3(64);
      const leaf: NutrootLeaf = { type: 'after', n: 1, keys: [alicePub], time: 4102444800 };
      const { send } = await wallet.ops
        .send(32, proofs)
        .asLocked({ mainKeys: [carolPub], leaves: [leaf] }, [32])
        .run();
      const proof = send[0];

      const alice = new Wallet(mintUrl, { bip39seed: randomBytes(64) });
      await alice.loadMint();
      const options = await alice.spendOptions(proof, { privkeys: alicePriv });
      expect(options.script[0]).toMatchObject({
        satisfiable: false,
        blockedBy: 'locktime',
        availableAt: 4102444800,
      });
      // The wallet still builds it if asked; the mint is the one that says no.
      await expect(
        alice.receive([proof], {
          privkey: alicePriv,
          scriptPath: [{ secret: proof.secret, leafIndex: 0 }],
        }),
      ).rejects.toThrow();
    },
  );

  test(
    '2-of-3 threshold: the wallet signs with its key and a co-signer supplies the rest',
    { timeout: 60_000 },
    async () => {
      const carolPub = bytesToHex(secp256k1.getPublicKey(randomBytes(32), true));
      const alicePriv = bytesToHex(randomBytes(32));
      const alicePub = bytesToHex(secp256k1.getPublicKey(hexToBytes(alicePriv), true));
      const bobPriv = bytesToHex(randomBytes(32));
      const bobPub = bytesToHex(secp256k1.getPublicKey(hexToBytes(bobPriv), true));
      const idlePub = bytesToHex(secp256k1.getPublicKey(randomBytes(32), true));
      const leaf: NutrootLeaf = { type: 'threshold', n: 2, keys: [alicePub, bobPub, idlePub] };
      const { wallet, proofs } = await fundV3(64);
      const { send } = await wallet.ops
        .send(32, proofs)
        .asLocked({ mainKeys: [carolPub], leaves: [leaf] }, [32])
        .run();
      const proof = send[0];

      const alice = new Wallet(mintUrl, { bip39seed: randomBytes(64) });
      await alice.loadMint();
      // Alice alone cannot meet the threshold, and the wallet says so before it builds anything.
      expect((await alice.spendOptions(proof, { privkeys: alicePriv })).script[0]).toMatchObject({
        satisfiable: false,
        blockedBy: 'threshold',
      });
      await expect(
        alice.receive([proof], {
          privkey: alicePriv,
          scriptPath: [{ secret: proof.secret, leafIndex: 0 }],
        }),
      ).rejects.toThrow(/needs 2 signatures/);

      // Bob co-signs. He only ever sees the digest, never Alice's key or the proof's.
      let sawDigest: Uint8Array | undefined;
      const received = await alice.receive([proof], {
        privkey: alicePriv,
        scriptPath: [
          {
            secret: proof.secret,
            leafIndex: 0,
            cosign: async (digest, signingLeaf) => {
              sawDigest = digest;
              expect(signingLeaf.keys).toContain(bobPub);
              return [bytesToHex(schnorr.sign(digest, hexToBytes(bobPriv)))];
            },
          },
        ],
      });
      expect(sawDigest).toHaveLength(32);
      expect(sumProofs(received).toBigInt()).toBe(31n);
    },
  );

  test(
    'signing package: a co-signer signs out of band and the ceremony survives serialization',
    { timeout: 60_000 },
    async () => {
      // The shape a phone needs: extract, put it down, sign somewhere else, merge, complete.
      const carolPub = bytesToHex(secp256k1.getPublicKey(randomBytes(32), true));
      const alicePriv = bytesToHex(randomBytes(32));
      const alicePub = bytesToHex(secp256k1.getPublicKey(hexToBytes(alicePriv), true));
      const bobPriv = bytesToHex(randomBytes(32));
      const bobPub = bytesToHex(secp256k1.getPublicKey(hexToBytes(bobPriv), true));
      const leaf: NutrootLeaf = { type: 'threshold', n: 2, keys: [alicePub, bobPub] };
      const { wallet, proofs } = await fundV3(64);
      const { send } = await wallet.ops
        .send(32, proofs)
        .asLocked({ mainKeys: [carolPub], leaves: [leaf], blindKeys: [alicePub] }, [32])
        .run();
      const proof = send[0];

      const alice = new Wallet(mintUrl, { bip39seed: randomBytes(64) });
      await alice.loadMint();
      const preview = await alice.prepareSwapToReceive([proof]);
      const plan = { secret: proof.secret, leafIndex: 0 };
      const pkg = ScriptPath.extractSwapPackage(preview, [plan]);
      expect(pkg.spends[0].signatures).toHaveLength(0);
      expect(pkg.spends[0].control.K).toBe(proof.spend_info?.K);

      // Round-trip through the wire, twice, signed by a different party each time. Nothing but
      // the string crosses, and it carries no secret and no blinding factor.
      const wire = ScriptPath.serializePackage(pkg);
      expect(wire.startsWith('nutspA')).toBe(true);
      expect(wire).not.toContain(alicePriv);
      let carried = ScriptPath.signPackage(ScriptPath.deserializePackage(wire), alicePriv);
      carried = ScriptPath.signPackage(
        ScriptPath.deserializePackage(ScriptPath.serializePackage(carried)),
        bobPriv,
      );
      expect(carried.spends[0].signatures).toHaveLength(2);
      // Alice's key was blinded into the leaf, so a verbatim signature would not have counted.
      expect(parseNutrootLeaf(hexToBytes(carried.spends[0].leaf)).keys).not.toContain(alicePub);

      const signed = ScriptPath.mergeSwapPackage(carried, preview);
      const { keep } = await alice.completeSwap(signed);
      expect(sumProofs(keep).toBigInt()).toBe(31n);
    },
  );

  test(
    'a signing package refuses a transaction whose outputs moved under it',
    { timeout: 60_000 },
    async () => {
      const carolPub = bytesToHex(secp256k1.getPublicKey(randomBytes(32), true));
      const alicePriv = bytesToHex(randomBytes(32));
      const alicePub = bytesToHex(secp256k1.getPublicKey(hexToBytes(alicePriv), true));
      const leaf: NutrootLeaf = { type: 'threshold', n: 1, keys: [alicePub] };
      const { wallet, proofs } = await fundV3(64);
      const { send } = await wallet.ops
        .send(32, proofs)
        .asLocked({ mainKeys: [carolPub], leaves: [leaf] }, [32])
        .run();
      const proof = send[0];

      const alice = new Wallet(mintUrl, { bip39seed: randomBytes(64) });
      await alice.loadMint();
      const preview = await alice.prepareSwapToReceive([proof]);
      const pkg = ScriptPath.signPackage(
        ScriptPath.extractSwapPackage(preview, [{ secret: proof.secret, leafIndex: 0 }]),
        alicePriv,
      );
      // A second preview builds different outputs, so the signatures do not cover it. Caught
      // here rather than by the mint, which would only say the witness was invalid.
      const other = await alice.prepareSwapToReceive([proof]);
      expect(() => ScriptPath.mergeSwapPackage(pkg, other)).toThrow(/does not match/);
      // And a package whose digest was edited is refused when it is read back.
      const tampered = { ...pkg, digest: 'ab'.repeat(32) };
      expect(() => ScriptPath.deserializePackage(ScriptPath.serializePackage(tampered))).toThrow(
        /digest does not match/,
      );
    },
  );

  test('a hashlock leaf spends with its preimage, not without', { timeout: 60_000 }, async () => {
    const carolPub = bytesToHex(secp256k1.getPublicKey(randomBytes(32), true));
    const alicePriv = bytesToHex(randomBytes(32));
    const alicePub = bytesToHex(secp256k1.getPublicKey(hexToBytes(alicePriv), true));
    const preimage = bytesToHex(randomBytes(32));
    const leaf: NutrootLeaf = {
      type: 'hashlock',
      n: 1,
      keys: [alicePub],
      hash: bytesToHex(sha256(hexToBytes(preimage))),
    };
    const { wallet, proofs } = await fundV3(64);
    const { send } = await wallet.ops
      .send(32, proofs)
      .asLocked({ mainKeys: [carolPub], leaves: [leaf] }, [32])
      .run();
    const proof = send[0];

    const alice = new Wallet(mintUrl, { bip39seed: randomBytes(64) });
    await alice.loadMint();
    expect((await alice.spendOptions(proof, { privkeys: alicePriv })).script[0].blockedBy).toBe(
      'preimage',
    );
    // No preimage in the plan: refused before a request is built.
    await expect(
      alice.receive([proof], {
        privkey: alicePriv,
        scriptPath: [{ secret: proof.secret, leafIndex: 0 }],
      }),
    ).rejects.toThrow(/preimage/);
    // The wrong preimage reaches the mint and is refused there.
    await expect(
      alice.receive([proof], {
        privkey: alicePriv,
        scriptPath: [{ secret: proof.secret, leafIndex: 0, preimage: 'ab'.repeat(32) }],
      }),
    ).rejects.toThrow();
    const received = await alice.receive([proof], {
      privkey: alicePriv,
      scriptPath: [{ secret: proof.secret, leafIndex: 0, preimage }],
    });
    expect(sumProofs(received).toBigInt()).toBe(31n);
  });
});
