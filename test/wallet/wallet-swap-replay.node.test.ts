import { bls12_381 } from '@noble/curves/bls12-381.js';
import { describe, expect, test, vi } from 'vitest';

import {
  Amount,
  CallerAbortError,
  Mint,
  Wallet,
  deserializeSwapPreview,
  serializeSwapPreview,
  type CosignRequest,
  type MeltQuoteBaseResponse,
  type Proof,
  type RequestFn,
  type SerializedSwapPreview,
  type SwapPreview,
} from '../../src';
import { schnorrSignDigest } from '../../src/crypto/core';
import { hashToCurveBls } from '../../src/crypto/curve_bls';
import { getPubKeyFromPrivKey } from '../../src/crypto/curve_secp';
import { createP2PKsecret } from '../../src/crypto/NUT11';
import { deriveReceiverKeyedSecret, type NutrootLeaf } from '../../src/crypto/nutroot';
import { bytesToHex, deriveKeysetId, hexToBytes } from '../../src/utils';

const priv = (n: number) => n.toString(16).padStart(64, '0');
const pub = (n: number) => bytesToHex(getPubKeyFromPrivKey(hexToBytes(priv(n))));
const mintUrl = 'https://replay.invalid';
const mintInfo = {
  name: 'Replay mint',
  pubkey: pub(5),
  version: 'test/1',
  contact: [],
  nuts: {
    '4': { methods: [], disabled: false },
    '5': { methods: [], disabled: false },
    '11': { supported: true },
  },
};
const blsKeys = { '1': bls12_381.G2.Point.BASE.multiply(5n).toHex(true) };
const v3Id = deriveKeysetId(blsKeys, { versionByte: 2, unit: 'sat', input_fee_ppk: 0 });
const legacyKeys = { '1': pub(5) };
const legacyId = deriveKeysetId(legacyKeys, { versionByte: 0 });

/**
 * A wallet whose mint records each swap body and never answers, as when a response is lost.
 */
function walletCapturingSwaps(activeKeysetId: string) {
  const bodies: string[] = [];
  const customRequest = (async (options: { requestBody?: unknown }) => {
    bodies.push(String(options.requestBody));
    throw new Error('response lost');
  }) as unknown as RequestFn;
  const wallet = new Wallet(new Mint(mintUrl, { customRequest }));
  wallet.loadMintFromCache(mintInfo, {
    mintUrl,
    savedAt: Date.now(),
    keysets: [
      {
        id: legacyId,
        unit: 'sat',
        active: activeKeysetId === legacyId,
        input_fee_ppk: 0,
        keys: legacyKeys,
      },
      { id: v3Id, unit: 'sat', active: activeKeysetId === v3Id, input_fee_ppk: 0, keys: blsKeys },
    ],
  });
  return { wallet, bodies };
}

const v3Proof = (secret: string, spend_info: Proof['spend_info']): Proof => ({
  id: v3Id,
  amount: Amount.from(1),
  secret,
  C: hashToCurveBls(new TextEncoder().encode(secret)).multiply(5n).toHex(true),
  spend_info,
});
const bearer = (n: number) => v3Proof(pub(n), { k: priv(n) });
const locked = (secret: string): Proof => ({
  id: legacyId,
  amount: Amount.from(1),
  secret,
  C: pub(7),
});

const persist = (preview: SwapPreview) => JSON.stringify(serializeSwapPreview(preview));
const restore = (stored: string) =>
  deserializeSwapPreview(JSON.parse(stored) as SerializedSwapPreview);
const completeLosingResponse = async (
  wallet: Wallet,
  preview: SwapPreview,
  privkey?: string,
): Promise<void> => {
  await expect(wallet.completeSwap(preview, privkey)).rejects.toThrow('response lost');
};

const witnessOnWire = (body: string) => (JSON.parse(body) as { inputs: Proof[] }).inputs[0].witness;

describe('swap preview replay', () => {
  test('a bearer v3 preview signed before persisting replays byte-identically', async () => {
    const { wallet, bodies } = walletCapturingSwaps(v3Id);
    const { preview } = await wallet.prepareSwapToSend(1, [bearer(4)]);

    const signed = await wallet.signSwapPreview(preview);
    const stored = persist(signed);
    await completeLosingResponse(wallet, signed);
    await completeLosingResponse(wallet, restore(stored));

    expect(bodies).toHaveLength(2);
    expect(witnessOnWire(bodies[0])).toBeDefined();
    expect(bodies[1]).toBe(bodies[0]);
  });

  test('a preview persisted unsigned signs afresh, so its replay differs', async () => {
    const { wallet, bodies } = walletCapturingSwaps(v3Id);
    const { preview } = await wallet.prepareSwapToSend(1, [bearer(4)]);

    const stored = persist(preview);
    await completeLosingResponse(wallet, preview);
    await completeLosingResponse(wallet, restore(stored));

    expect(bodies[1]).not.toBe(bodies[0]);
  });

  test('a retry of the same preview object sends the same bytes', async () => {
    const { wallet, bodies } = walletCapturingSwaps(v3Id);
    const { preview } = await wallet.prepareSwapToSend(1, [bearer(4)]);

    await completeLosingResponse(wallet, preview);
    await completeLosingResponse(wallet, preview);

    expect(witnessOnWire(bodies[0])).toBeDefined();
    expect(bodies[1]).toBe(bodies[0]);
  });

  test('a P2PK preview replays byte-identically, with or without the key at complete', async () => {
    const { wallet, bodies } = walletCapturingSwaps(legacyId);
    const { preview } = await wallet.prepareSwapToSend(1, [locked(createP2PKsecret(pub(2)))]);

    const signed = await wallet.signSwapPreview(preview, priv(2));
    const stored = persist(signed);
    await completeLosingResponse(wallet, restore(stored));
    await completeLosingResponse(wallet, restore(stored), priv(2));

    expect(witnessOnWire(bodies[0])).toBeDefined();
    expect(bodies[1]).toBe(bodies[0]);
  });

  test('a SIG_ALL preview replays byte-identically', async () => {
    const { wallet, bodies } = walletCapturingSwaps(legacyId);
    const secret = createP2PKsecret(pub(2), [['sigflag', 'SIG_ALL']]);
    const { preview } = await wallet.prepareSwapToSend(1, [locked(secret)]);

    const signed = await wallet.signSwapPreview(preview, priv(2));
    await completeLosingResponse(wallet, restore(persist(signed)));
    await completeLosingResponse(wallet, restore(persist(signed)));

    expect(witnessOnWire(bodies[0])).toBeDefined();
    expect(bodies[1]).toBe(bodies[0]);
  });

  test('a receiver-keyed v3 input needs the key to sign, not to replay', async () => {
    const { wallet, bodies } = walletCapturingSwaps(v3Id);
    const { secret, E } = deriveReceiverKeyedSecret(pub(2));
    const { preview } = await wallet.prepareSwapToSend(1, [v3Proof(secret, { E })]);

    const signed = await wallet.signSwapPreview(preview, priv(2));
    await completeLosingResponse(wallet, restore(persist(signed)));

    expect(bodies).toHaveLength(1);
    expect(witnessOnWire(bodies[0])).toBeDefined();
  });

  test('a script path co-signer is asked once, however often the swap is retried', async () => {
    const { wallet, bodies } = walletCapturingSwaps(v3Id);
    const leaf: NutrootLeaf = { type: 'threshold', n: 1, keys: [pub(2)] };
    const { secret, E, tree, K } = deriveReceiverKeyedSecret(pub(1), { leaves: [leaf] });
    const { preview } = await wallet.prepareSwapToSend(1, [v3Proof(secret, { E, tree, K })]);
    const cosign = vi.fn(({ digest }: CosignRequest) =>
      Promise.resolve([schnorrSignDigest(digest, priv(2))]),
    );
    const options = { scriptPath: [{ secret, leafIndex: 0, cosign }] };

    const signed = await wallet.signSwapPreview(preview, undefined, options);
    await expect(wallet.completeSwap(signed, undefined, options)).rejects.toThrow('response lost');
    await expect(wallet.completeSwap(signed, undefined, options)).rejects.toThrow('response lost');

    expect(cosign).toHaveBeenCalledTimes(1);
    expect(witnessOnWire(bodies[0])).toBeDefined();
    expect(bodies[1]).toBe(bodies[0]);
  });

  test('signing returns a copy and leaves the caller preview unsigned', async () => {
    const { wallet } = walletCapturingSwaps(v3Id);
    const { preview } = await wallet.prepareSwapToSend(1, [bearer(4)]);

    const signed = await wallet.signSwapPreview(preview);

    expect(preview.inputs[0].witness).toBeUndefined();
    expect(signed.inputs[0].witness).toBeDefined();
    expect(signed.inputs[0].spend_info).toEqual({ k: priv(4) });
  });

  test('wallet-side fields stay off the wire after signing', async () => {
    const { wallet, bodies } = walletCapturingSwaps(v3Id);
    const { preview } = await wallet.prepareSwapToSend(1, [bearer(4)]);

    await completeLosingResponse(wallet, await wallet.signSwapPreview(preview));

    expect((JSON.parse(bodies[0]) as { inputs: Proof[] }).inputs[0]).not.toHaveProperty(
      'spend_info',
    );
  });

  test('a signed input spent in a new transaction signs afresh', async () => {
    const { wallet, bodies } = walletCapturingSwaps(v3Id);
    const { preview } = await wallet.prepareSwapToSend(1, [bearer(4)]);
    const signed = await wallet.signSwapPreview(preview);
    await completeLosingResponse(wallet, signed);

    // A wallet that refiled the inputs after the swap failed, then spends them differently.
    const { preview: next } = await wallet.prepareSwapToSend(1, signed.inputs);
    expect(next.inputs[0].witness).toBeUndefined();
    await completeLosingResponse(wallet, next);

    expect(witnessOnWire(bodies[1])).toBeDefined();
    expect(witnessOnWire(bodies[1])).not.toBe(witnessOnWire(bodies[0]));
  });

  test('a signed input that was not selected comes back clean', async () => {
    const { wallet } = walletCapturingSwaps(v3Id);
    const { preview } = await wallet.prepareSwapToSend(1, [bearer(4)]);
    const signed = await wallet.signSwapPreview(preview);

    const { unselected } = await wallet.prepareSwapToSend(1, [bearer(6), ...signed.inputs]);

    expect(unselected.every((p) => p.witness === undefined)).toBe(true);
  });

  test('a signed input spent in a melt signs afresh', async () => {
    const { wallet } = walletCapturingSwaps(v3Id);
    const { preview } = await wallet.prepareSwapToSend(1, [bearer(4)]);
    const signed = await wallet.signSwapPreview(preview);
    const quote = {
      quote: 'q1',
      unit: 'sat',
      state: 'UNPAID',
      amount: Amount.from(1),
    } as MeltQuoteBaseResponse;

    const melt = await wallet.prepareMelt('bolt11', quote, signed.inputs);

    expect(melt.inputs[0].witness).toBeUndefined();
  });

  test('a P2PK witness survives into a new transaction, since it signs the secret', async () => {
    const { wallet } = walletCapturingSwaps(legacyId);
    const { preview } = await wallet.prepareSwapToSend(1, [locked(createP2PKsecret(pub(2)))]);
    const signed = await wallet.signSwapPreview(preview, priv(2));

    const { preview: next } = await wallet.prepareSwapToSend(1, signed.inputs);

    expect(next.inputs[0].witness).toBe(signed.inputs[0].witness);
  });

  test('an aborted signal stops signing and posts nothing', async () => {
    const { wallet, bodies } = walletCapturingSwaps(v3Id);
    const { preview } = await wallet.prepareSwapToSend(1, [bearer(4)]);
    const ac = new AbortController();
    ac.abort();

    await expect(
      wallet.signSwapPreview(preview, undefined, { signal: ac.signal }),
    ).rejects.toBeInstanceOf(CallerAbortError);
    await expect(wallet.completeSwap(preview, undefined, { signal: ac.signal })).rejects.toThrow(
      CallerAbortError,
    );

    expect(preview.inputs[0].witness).toBeUndefined();
    expect(bodies).toHaveLength(0);
  });

  test('an aborted signal stops signing a preview with no v3 inputs', async () => {
    const { wallet } = walletCapturingSwaps(legacyId);
    const { preview } = await wallet.prepareSwapToSend(1, [locked(createP2PKsecret(pub(2)))]);
    const ac = new AbortController();
    ac.abort();

    await expect(
      wallet.signSwapPreview(preview, priv(2), { signal: ac.signal }),
    ).rejects.toBeInstanceOf(CallerAbortError);
  });

  test('a frozen preview still completes', async () => {
    const { wallet, bodies } = walletCapturingSwaps(v3Id);
    const { preview } = await wallet.prepareSwapToSend(1, [bearer(4)]);

    await completeLosingResponse(wallet, Object.freeze(preview));

    expect(witnessOnWire(bodies[0])).toBeDefined();
  });

  test('a frozen signed preview replays byte-identically', async () => {
    const { wallet, bodies } = walletCapturingSwaps(v3Id);
    const { preview } = await wallet.prepareSwapToSend(1, [bearer(4)]);

    const signed = Object.freeze(await wallet.signSwapPreview(preview));
    await completeLosingResponse(wallet, signed);
    await completeLosingResponse(wallet, signed);

    expect(witnessOnWire(bodies[0])).toBeDefined();
    expect(bodies[1]).toBe(bodies[0]);
  });

  test('a frozen signed P2PK preview replays byte-identically with the key at complete', async () => {
    const { wallet, bodies } = walletCapturingSwaps(legacyId);
    const { preview } = await wallet.prepareSwapToSend(1, [locked(createP2PKsecret(pub(2)))]);

    const signed = Object.freeze(await wallet.signSwapPreview(preview, priv(2)));
    await completeLosingResponse(wallet, signed, priv(2));
    await completeLosingResponse(wallet, signed, priv(2));

    expect(witnessOnWire(bodies[0])).toBeDefined();
    expect(bodies[1]).toBe(bodies[0]);
  });

  test('refuses a preview with no inputs', async () => {
    const { wallet } = walletCapturingSwaps(v3Id);
    await expect(wallet.signSwapPreview({} as SwapPreview)).rejects.toThrow(
      'signSwapPreview: preview has no inputs',
    );
  });
});
