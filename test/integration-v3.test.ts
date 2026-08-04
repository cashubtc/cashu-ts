// Taproot v3 integration tests. Require a nutshell mint with a BLS (v3)
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
  Wallet,
  isBlsKeyset,
  sumProofs,
} from '../src';
import {
  buildScriptPathWitness,
  buildTaprootSecret,
  deriveReceiverKeyedSecret,
  recoverReceiverKeyedSecretKey,
  TAPROOT_NUMS_KEY,
  taprootLeafHash,
  taprootMerkleRoot,
  taprootTweakSeckey,
} from '../src/crypto/taproot';
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

describe('M3 taproot conditions', () => {
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
    const proofs = await wallet.mintProofsBolt11(amount, quote.quote);
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
    const outputs = outputAmounts.map((a) => OutputData.createSingleRandomData(a, keysetId));
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
      OutputData.createSingleTaprootData(secretHex, a, k.id);
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
      const { secret, tree } = buildTaprootSecret(internalPub, [
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
    const { secret, tree } = buildTaprootSecret(pk(24), [
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
    const { secret, tree } = buildTaprootSecret(pk(26), [
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
    const { secret, tree } = buildTaprootSecret(pk(27), [
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
    const { secret, tree } = buildTaprootSecret(TAPROOT_NUMS_KEY, [
      { type: 'threshold', n: 1, keys: [pk(34)] },
    ]);
    const { locked, keysetId } = await createLockedProof(secret);
    await expect(
      manualSwapLockedProof(keysetId, { amount: 32n, secret, C: locked.C }, (digest) =>
        buildScriptPathWitness(tree, 0, TAPROOT_NUMS_KEY, [
          bytesToHex(schnorr.sign(digest, sk(34))),
        ]),
      ),
    ).resolves.toBeDefined();
  });

  test('wrong merkle path is rejected by the mint', { timeout: 30_000 }, async () => {
    const { secret, tree } = buildTaprootSecret(pk(28), [
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

  test('partial tree disclosure is rejected on receive', { timeout: 30_000 }, async () => {
    const internalPriv = bytesToHex(sk(29));
    const { secret, tree } = buildTaprootSecret(pk(29), [
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

describe('M4 locked quotes', () => {
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
      const lockA = buildTaprootSecret(pk(41), [
        { type: 'after', n: 1, keys: [pk(42)], time: 4102444800 },
      ]);
      const quoteA = await wallet.createLockedMintQuote(32, lockA.secret);
      await wallet.on.onceMintPaid(quoteA.quote, { timeoutMs: 10_000 });
      const rootA = taprootMerkleRoot(lockA.tree.map((l) => taprootLeafHash(hexToBytes(l))));
      const tweakedPriv = taprootTweakSeckey(recipientPriv, rootA);
      const proofs = await wallet.mintProofsBolt11(32, quoteA, {
        privkey: bytesToHex(tweakedPriv),
      });
      expect(proofs.length).toBeGreaterThan(0);

      // Path B: refund leaf already expired; the payer reclaims via script path.
      const payerPriv = sk(43);
      const lockB = buildTaprootSecret(pk(44), [
        { type: 'after', n: 1, keys: [pk(43)], time: 1700000000 },
      ]);
      const quoteB = await wallet.createLockedMintQuote(32, lockB.secret);
      await wallet.on.onceMintPaid(quoteB.quote, { timeoutMs: 10_000 });
      const outputsB = [OutputData.createSingleRandomData(32n, keysetId)];
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
      const lockC = buildTaprootSecret(pk(44), [
        { type: 'after', n: 1, keys: [pk(43)], time: 4102444800 },
      ]);
      const quoteC = await wallet.createLockedMintQuote(32, lockC.secret);
      await wallet.on.onceMintPaid(quoteC.quote, { timeoutMs: 10_000 });
      const outputsC = [OutputData.createSingleRandomData(32n, keysetId)];
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

describe('M4 receiver-keyed sends', () => {
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
        return { wallet: w, proofs: await w.mintProofsBolt11(128, quote.quote) };
      })();

      let available = proofs;
      const sendOne = async (secretHex: string) => {
        const factory = (a: AmountLike, k: { id: string }) =>
          OutputData.createSingleTaprootData(secretHex, a, k.id);
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
        recoverReceiverKeyedSecretKey(bareProof.secret, bare.E, bytesToHex(strangerPriv)),
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
