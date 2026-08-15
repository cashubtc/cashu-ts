// Rotation suite: what happens to a live Wallet when the mint rotates keysets.
//
// Contract: every async wallet op that consumes keyset ids must make the
// snapshot operable at op entry, or where the ids first become known (see
// Wallet.ensureOperableKeysets). When you add such an op, add its rotation
// scenario to this file.

import { randomBytes } from '@noble/hashes/utils.js';
import { HttpResponse, http } from 'msw';
import type { SetupServer } from 'msw/node';
import { test, describe, expect, vi } from 'vitest';

import {
  Wallet,
  MintOperationError,
  StaleKeysetError,
  UnknownKeysetError,
  Amount,
  MeltQuoteState,
  MintQuoteState,
  type KeyChainCache,
  type MintKeyset,
  type MintKeys,
  type ProofLike,
  type Proof,
  type MeltQuoteBolt11Response,
  type MintQuoteBolt11Response,
} from '../../src';
import { DUMMY_TEST_KEYSET, DUMMY_TEST_KEYS, PUBKEYS } from '../consts';

import { mintUrl, mint, unit, useTestServer } from './_setup';

const server = useTestServer();

// Rotation fixtures: mint starts with A active, then A goes inactive and B appears.
const keysetAInactive: MintKeyset = { ...DUMMY_TEST_KEYSET, active: false };
const keysetB: MintKeyset = { id: '009a1f293253e41e', unit: 'sat', active: true, input_fee_ppk: 0 };
const keysB: MintKeys = { ...keysetB, keys: PUBKEYS };

function useRotatedMint(server: SetupServer) {
  let keysetsRequests = 0;
  let keysARequests = 0;
  server.use(
    http.get(mintUrl + '/v1/keysets', () => {
      keysetsRequests++;
      return HttpResponse.json({ keysets: [keysetAInactive, keysetB] });
    }),
    http.get(mintUrl + '/v1/keys', () => HttpResponse.json({ keysets: [keysB] })),
    http.get(mintUrl + '/v1/keys/00bd033559de27d0', () => {
      keysARequests++;
      return HttpResponse.json({ keysets: [DUMMY_TEST_KEYS] });
    }),
    http.get(mintUrl + '/v1/keys/009a1f293253e41e', () => HttpResponse.json({ keysets: [keysB] })),
  );
  return { counts: () => ({ keysetsRequests, keysARequests }) };
}

// Shared across describes below: a proof on the pre-rotation keyset (A) and its
// counterpart on the post-rotation keyset (B).
const proofOnA: ProofLike = {
  id: '00bd033559de27d0',
  amount: 1,
  secret: '407915bc212be61a77e3e6d2aeb4c727980bda51cd06a6afc29e2861768a7837',
  C: '02bc9097997d81afb2cc7346b5e4345a9346bd2a506eb7958598a72f0cf85163ea',
};
const proofOnB: ProofLike = { ...proofOnA, id: '009a1f293253e41e' };

describe('rebind on refresh', () => {
  test('auto-bound wallet follows the mint after a rotation', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    expect(wallet.keysetId).toBe('00bd033559de27d0');

    useRotatedMint(server);
    await wallet.loadMint(true);
    expect(wallet.keysetId).toBe('009a1f293253e41e');
  });

  test('pinned wallet stays put after a rotation', async () => {
    const wallet = new Wallet(mint, { unit, keysetId: '00bd033559de27d0' });
    await wallet.loadMint();

    useRotatedMint(server);
    await wallet.loadMint(true);
    expect(wallet.keysetId).toBe('00bd033559de27d0');
  });

  test('bindKeyset makes the binding explicit', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    wallet.bindKeyset('00bd033559de27d0');

    useRotatedMint(server);
    await wallet.loadMint(true);
    expect(wallet.keysetId).toBe('00bd033559de27d0');
  });

  test('auto-bound wallet keeps its binding when the mint has no active replacement', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    server.use(
      http.get(mintUrl + '/v1/keysets', () => HttpResponse.json({ keysets: [keysetAInactive] })),
      http.get(mintUrl + '/v1/keys', () => HttpResponse.json({ keysets: [] })),
    );
    await wallet.loadMint(true);
    expect(wallet.keysetId).toBe('00bd033559de27d0'); // still there; melt remains possible
  });

  test('auto-bound wallet unbinds when its keyset vanishes and no active replacement exists', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    expect(wallet.keysetId).toBe('00bd033559de27d0');

    server.use(
      http.get(mintUrl + '/v1/keysets', () => HttpResponse.json({ keysets: [] })),
      http.get(mintUrl + '/v1/keys', () => HttpResponse.json({ keysets: [] })),
    );
    await wallet.loadMint(true);
    expect(() => wallet.keysetId).toThrow(/no bound keyset/i);
  });

  test('auto-bound wallet follows the cheapest active keyset on refresh', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    expect(wallet.keysetId).toBe('00bd033559de27d0');

    // A stays active alongside B: same version, same fee, but B has no final_expiry
    // (never expiring) while A does, so getCheapestKeyset's expiry tie-break prefers
    // B. Re-selection on every refresh means the wallet follows it even though A is
    // still perfectly usable.
    server.use(
      http.get(mintUrl + '/v1/keysets', () =>
        HttpResponse.json({ keysets: [DUMMY_TEST_KEYSET, keysetB] }),
      ),
      http.get(mintUrl + '/v1/keys', () => HttpResponse.json({ keysets: [keysB] })),
    );
    await wallet.loadMint(true);
    expect(wallet.keysetId).toBe('009a1f293253e41e');
  });
});

describe('receive across a rotation', () => {
  const proofOnAlien: ProofLike = { ...proofOnA, id: '00deadbeefdeadbe' };

  test('receives a pre-rotation token by loading the old keys once', async () => {
    const { counts } = useRotatedMint(server);
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint(); // first ever load, post-rotation: A inactive and keyless, B active
    expect(counts().keysARequests).toBe(0); // baseline: loadMint alone doesn't fetch A's keys

    const preview = await wallet.prepareSwapToReceive([proofOnA]);
    expect(preview.keysetId).toBe('009a1f293253e41e'); // outputs on the active keyset
    expect(counts().keysARequests).toBe(1); // one /v1/keys/A fetch, then cached

    await wallet.prepareSwapToReceive([proofOnA]);
    expect(counts().keysARequests).toBe(1); // still one: ensure is idempotent
  });

  test('repairs a stale snapshot once when a proof names an unknown keyset', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint(); // knows only A
    const { counts } = useRotatedMint(server);

    const updates: KeyChainCache[] = [];
    wallet.on.keychainUpdated(({ cache }) => updates.push(cache));

    const preview = await wallet.prepareSwapToReceive([proofOnB]);
    expect(preview.keysetId).toBe('009a1f293253e41e');
    expect(counts().keysetsRequests).toBe(1); // exactly one repair refresh
    expect(updates).toHaveLength(1);
    expect(updates[0].keysets.map((k) => k.id)).toContain('009a1f293253e41e');
  });

  test('concurrent ops share one repair refresh', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const { counts } = useRotatedMint(server);

    await Promise.all([
      wallet.prepareSwapToReceive([proofOnB]),
      wallet.prepareSwapToReceive([proofOnB]),
    ]);
    expect(counts().keysetsRequests).toBe(1);
  });

  test('a genuinely alien keyset id throws UnknownKeysetError after the repair', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const { counts } = useRotatedMint(server);

    const err = await wallet.prepareSwapToReceive([proofOnAlien]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnknownKeysetError);
    expect((err as UnknownKeysetError).keysetId).toBe('00deadbeefdeadbe');
    expect(counts().keysetsRequests).toBe(1); // it did try
  });

  test('a failed repair surfaces UnknownKeysetError with the transport failure as cause', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    server.use(http.get(mintUrl + '/v1/keysets', () => HttpResponse.error()));

    const err = await wallet.prepareSwapToReceive([proofOnB]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnknownKeysetError);
    expect((err as UnknownKeysetError).cause).toBeDefined();
  });

  test('a completed repair still emits when the trailing keyless fetch fails', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint(); // knows only A, with keys
    wallet.keyChain.getKeyset('00bd033559de27d0').keys = {}; // A is now known but keyless
    const { counts } = useRotatedMint(server); // B is unknown until the repair
    server.use(http.get(mintUrl + '/v1/keys/00bd033559de27d0', () => HttpResponse.error()));

    const updates: KeyChainCache[] = [];
    wallet.on.keychainUpdated(({ cache }) => updates.push(cache));

    // proofOnB forces the unknown-keyset repair; proofOnA then needs a keyless
    // fetch that fails, after the repair already succeeded.
    await expect(wallet.prepareSwapToReceive([proofOnA, proofOnB])).rejects.toThrow();
    expect(counts().keysetsRequests).toBe(1); // repair ran once
    expect(updates).toHaveLength(1); // repair's change was still persisted
    expect(updates[0].keysets.map((k) => k.id)).toContain('009a1f293253e41e');
  });

  test('a keyless fetch failure without a prior repair emits nothing', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint(); // pre-rotation defaults: A active with keys
    wallet.keyChain.getKeyset('00bd033559de27d0').keys = {}; // A is now known but keyless

    let keysetsRequests = 0;
    server.use(
      http.get(mintUrl + '/v1/keysets', () => {
        keysetsRequests++;
        return HttpResponse.json({ keysets: [] });
      }),
      http.get(mintUrl + '/v1/keys/00bd033559de27d0', () => HttpResponse.error()),
    );

    const updates: KeyChainCache[] = [];
    wallet.on.keychainUpdated(({ cache }) => updates.push(cache));

    // proofOnA names a known keyset, so no unknown-id repair fires; the keyless
    // fetch fails with nothing having changed beforehand.
    await expect(wallet.prepareSwapToReceive([proofOnA])).rejects.toThrow();
    expect(updates).toHaveLength(0); // no repair ran, nothing to persist
    expect(keysetsRequests).toBe(0); // the unknown-id repair path was never invoked
  });

  test('a never-loaded wallet rejects honestly, without a hidden repair', async () => {
    const wallet = new Wallet(mint, { unit });
    const spyKeySets = vi.spyOn(wallet.mint, 'getKeySets');

    await expect(wallet.receive([proofOnA])).rejects.toThrow(/unrecognised keyset/i);
    expect(spyKeySets).not.toHaveBeenCalled(); // no hidden loadMint(true)

    // The public entry point says so outright rather than quietly doing nothing
    await expect(wallet.ensureOperableKeysets(['00bd033559de27d0'])).rejects.toThrow(
      /Mint info not initialized; call loadMint/,
    );
    expect(spyKeySets).not.toHaveBeenCalled();

    spyKeySets.mockRestore();
  });
});

describe('mint rejection as rotation evidence', () => {
  // A wallet loaded before the rotation has no unknown id to trip the repair: its
  // snapshot still calls A active, so the outputs are built on A and the mint is the
  // only thing that knows better.
  function useRejectingSwap(server: SetupServer) {
    let swapRequests = 0;
    server.use(
      http.post(mintUrl + '/v1/swap', () => {
        swapRequests++;
        if (swapRequests === 1) {
          return HttpResponse.json(
            { detail: 'Keyset is inactive, cannot sign messages', code: 12002 },
            { status: 400 },
          );
        }
        return HttpResponse.json({
          signatures: [
            {
              id: '009a1f293253e41e',
              amount: 1,
              C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
            },
          ],
        });
      }),
    );
    return { swaps: () => swapRequests };
  }

  test('receive heals the snapshot and succeeds when the caller runs it again', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint(); // pre-rotation: A is active and bound
    expect(wallet.keysetId).toBe('00bd033559de27d0');

    const { counts } = useRotatedMint(server); // the mint has moved on, the snapshot has not
    const { swaps } = useRejectingSwap(server);

    const err = await wallet.receive([proofOnA]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StaleKeysetError);
    expect((err as StaleKeysetError).repaired).toBe(true);
    expect(counts().keysetsRequests).toBe(1); // exactly one repair refresh
    expect(wallet.keysetId).toBe('009a1f293253e41e');

    const proofs = await wallet.receive([proofOnA]); // the caller's retry, on the fresh snapshot
    expect(proofs[0].id).toBe('009a1f293253e41e');
    expect(counts().keysetsRequests).toBe(1); // nothing refreshed a second time
    expect(swaps()).toBe(2);
  });

  test('a retry that meets the same rejection reports an unrepaired snapshot', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const { counts } = useRotatedMint(server);

    let swaps = 0;
    server.use(
      http.post(mintUrl + '/v1/swap', () => {
        swaps++;
        return HttpResponse.json(
          { detail: 'Keyset is inactive, cannot sign messages', code: 12002 },
          { status: 400 },
        );
      }),
    );

    const first = await wallet.receive([proofOnA]).catch((e: unknown) => e);
    expect((first as StaleKeysetError).repaired).toBe(true);

    const second = await wallet.receive([proofOnA]).catch((e: unknown) => e);
    expect(second).toBeInstanceOf(StaleKeysetError);
    expect((second as StaleKeysetError).repaired).toBe(false); // rate limited, so nothing changed
    expect(swaps).toBe(2);
    expect(counts().keysetsRequests).toBe(1);
  });

  test('completeBatchMint reports a rejected batch as a stale keyset', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint(); // pre-rotation: the batch outputs are built on A

    const quote = (id: string): MintQuoteBolt11Response => ({
      quote: id,
      request: 'lnbc...',
      amount: Amount.from(2),
      unit: 'sat',
      state: MintQuoteState.PAID,
      amount_paid: Amount.from(2),
      amount_issued: Amount.from(0),
      updated_at: null,
      expiry: null,
    });
    const preview = await wallet.prepareBatchMint('bolt11', [
      { amount: 2, quote: quote('batch-a') },
      { amount: 2, quote: quote('batch-b') },
    ]);

    const { counts } = useRotatedMint(server);
    server.use(
      http.post(mintUrl + '/v1/mint/bolt11/batch', () =>
        HttpResponse.json(
          { detail: 'Keyset is inactive, cannot sign messages', code: 12002 },
          { status: 400 },
        ),
      ),
    );

    const err = await wallet.completeBatchMint(preview).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StaleKeysetError);
    expect((err as StaleKeysetError).repaired).toBe(true);
    expect(counts().keysetsRequests).toBe(1);
    expect(wallet.keysetId).toBe('009a1f293253e41e'); // ready for a re-prepared batch
  });

  test('completeSwap hands the split flow a repaired snapshot to re-prepare against', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const { counts } = useRotatedMint(server);
    const { swaps } = useRejectingSwap(server);

    const updates: KeyChainCache[] = [];
    wallet.on.keychainUpdated(({ cache }) => updates.push(cache));

    const stale = await wallet.prepareSwapToReceive([proofOnA]); // outputs on A
    const err = await wallet.completeSwap(stale).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StaleKeysetError);
    expect((err as StaleKeysetError).repaired).toBe(true);
    expect((err as StaleKeysetError).cause).toBeInstanceOf(MintOperationError);
    expect(((err as StaleKeysetError).cause as MintOperationError).code).toBe(12002);
    expect(counts().keysetsRequests).toBe(1);
    expect(updates).toHaveLength(1); // the refreshed snapshot is worth persisting
    expect(wallet.keyChain.hasKeyset('009a1f293253e41e')).toBe(true);
    expect(wallet.keysetId).toBe('009a1f293253e41e');

    const fresh = await wallet.prepareSwapToReceive([proofOnA]); // outputs on B
    const { keep } = await wallet.completeSwap(fresh);
    expect(keep[0].id).toBe('009a1f293253e41e');
    expect(swaps()).toBe(2);
  });

  test('strict wallets report the rejection without repairing', async () => {
    const wallet = new Wallet(mint, { unit, strictCachedKeysets: true });
    await wallet.loadMint();
    const { counts } = useRotatedMint(server);
    const { swaps } = useRejectingSwap(server);

    const err = await wallet.receive([proofOnA]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StaleKeysetError);
    expect((err as StaleKeysetError).repaired).toBe(false);
    expect(((err as StaleKeysetError).cause as MintOperationError).code).toBe(12002);
    expect(counts().keysetsRequests).toBe(0);
    expect(swaps()).toBe(1); // one attempt, and the caller is told not to bother repeating it
  });

  test('a failed refresh reports the rejection as unrepaired', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const { swaps } = useRejectingSwap(server);
    server.use(http.get(mintUrl + '/v1/keysets', () => HttpResponse.error()));

    const err = await wallet.receive([proofOnA]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StaleKeysetError);
    expect((err as StaleKeysetError).repaired).toBe(false);
    expect(swaps()).toBe(1);
  });

  test('a rejection outside the keyset error class propagates untouched', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const { counts } = useRotatedMint(server);
    server.use(
      http.post(mintUrl + '/v1/swap', () =>
        HttpResponse.json({ detail: 'Token already spent', code: 11001 }, { status: 400 }),
      ),
    );

    const err = await wallet.receive([proofOnA]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MintOperationError);
    expect((err as MintOperationError).code).toBe(11001);
    expect(counts().keysetsRequests).toBe(0);
  });

  test('a look-alike error with a non-finite code propagates untouched', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const { counts } = useRotatedMint(server);

    // A custom request layer can raise a MintOperationError look-alike whose code never got
    // parsed: absent, or NaN from a `Number(body.code)` on a missing field. isMintOperationError
    // accepts both by name, and every range comparison against them is false, so without the
    // finite check they would read as a keyset rejection.
    for (const code of [undefined, NaN]) {
      const lookAlike = Object.assign(new Error('mint said no'), {
        name: 'MintOperationError',
        code,
      });
      const spy = vi.spyOn(wallet.mint, 'swap').mockRejectedValue(lookAlike);

      const err = await wallet.receive([proofOnA]).catch((e: unknown) => e);
      expect(err).toBe(lookAlike); // not wrapped in StaleKeysetError
      expect(counts().keysetsRequests).toBe(0); // and no repair fired

      spy.mockRestore();
    }
  });
});

describe('repair rate limit', () => {
  test('a second implicit repair inside the cooldown window is skipped', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const { counts } = useRotatedMint(server);

    const first = await wallet
      .receive([{ ...proofOnA, id: '00deadbeefdeadbe' }])
      .catch((e: unknown) => e);
    expect(first).toBeInstanceOf(UnknownKeysetError);
    expect(counts().keysetsRequests).toBe(1);

    const second = await wallet
      .receive([{ ...proofOnA, id: '00c0ffeec0ffee00' }])
      .catch((e: unknown) => e);
    expect(second).toBeInstanceOf(UnknownKeysetError);
    expect(counts().keysetsRequests).toBe(1); // no second refresh for the second alien id
  });

  test('the cooldown also gates the repair a mint rejection asks for', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const { counts } = useRotatedMint(server);

    // Spend the window on an alien id, then meet a rejection on the way out
    await expect(wallet.receive([{ ...proofOnA, id: '00deadbeefdeadbe' }])).rejects.toThrow(
      UnknownKeysetError,
    );
    expect(counts().keysetsRequests).toBe(1);

    let swaps = 0;
    server.use(
      http.post(mintUrl + '/v1/swap', () => {
        swaps++;
        return HttpResponse.json(
          { detail: 'Keyset is inactive, cannot sign messages', code: 12002 },
          { status: 400 },
        );
      }),
    );

    const err = await wallet.receive([proofOnA]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StaleKeysetError);
    expect((err as StaleKeysetError).repaired).toBe(false);
    expect(counts().keysetsRequests).toBe(1); // rate limited, no refresh
    expect(swaps).toBe(1);
  });
});

describe('public ensureOperableKeysets', () => {
  test('backfills keys for a strict wallet on request', async () => {
    const { counts } = useRotatedMint(server);
    const wallet = new Wallet(mint, { unit, strictCachedKeysets: true });
    await wallet.loadMint(); // single load against rotated handlers: A known-but-keyless
    server.use(
      http.post(mintUrl + '/v1/swap', () =>
        HttpResponse.json({
          signatures: [
            {
              id: '009a1f293253e41e',
              amount: 1,
              C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
            },
          ],
        }),
      ),
    );

    const updates: KeyChainCache[] = [];
    wallet.on.keychainUpdated(({ cache }) => updates.push(cache));

    await wallet.ensureOperableKeysets(['00bd033559de27d0']);
    expect(counts().keysARequests).toBe(1); // explicit call, so strict mode does not block it
    expect(updates).toHaveLength(0); // the caller asked, so the caller persists

    const proofs = await wallet.receive([proofOnA]);
    expect(proofs[0].id).toBe('009a1f293253e41e');
    expect(counts().keysARequests).toBe(1); // the op itself fetched nothing
    expect(counts().keysetsRequests).toBe(1); // just the initial load
    expect(updates).toHaveLength(0);
  });

  test('repairs an unknown id for a strict wallet', async () => {
    const wallet = new Wallet(mint, { unit, strictCachedKeysets: true });
    await wallet.loadMint(); // pre-rotation: knows only A
    const { counts } = useRotatedMint(server);

    await wallet.ensureOperableKeysets(['009a1f293253e41e']);
    expect(counts().keysetsRequests).toBe(1);
    expect(wallet.keyChain.hasKeyset('009a1f293253e41e')).toBe(true);
  });

  test('bypasses the repair cooldown', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const { counts } = useRotatedMint(server);

    await expect(wallet.receive([{ ...proofOnA, id: '00deadbeefdeadbe' }])).rejects.toThrow(
      UnknownKeysetError,
    );
    expect(counts().keysetsRequests).toBe(1); // implicit repair, which starts the window

    await expect(wallet.ensureOperableKeysets(['00c0ffeec0ffee00'])).rejects.toThrow(
      UnknownKeysetError,
    );
    expect(counts().keysetsRequests).toBe(2); // asked for, so not rate limited
  });

  test('rejects a non-array argument', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    await expect(
      wallet.ensureOperableKeysets('00bd033559de27d0' as unknown as string[]),
    ).rejects.toThrow(/must be an array/);
  });
});

describe('melt change across a rotation', () => {
  const meltQuote: MeltQuoteBolt11Response = {
    quote: 'melt-rotation',
    amount: Amount.from(10),
    fee_reserve: Amount.from(3),
    request: 'bolt11request',
    state: MeltQuoteState.UNPAID,
    expiry: 1234567890,
    payment_preimage: null,
    unit: 'sat',
  };
  const proofsForMelt: Proof[] = [
    { id: '00bd033559de27d0', amount: Amount.from(8), secret: 'secret1', C: 'C1' },
    { id: '00bd033559de27d0', amount: Amount.from(5), secret: 'secret2', C: 'C2' },
  ]; // sum=13, feeReserve=3, amount=10
  const paidResponseWithChangeOnA = {
    quote: 'melt-rotation',
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
  };

  test('completeMelt reconstructs change on a keyset it holds keyless', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const preview = await wallet.prepareMelt('bolt11', meltQuote, proofsForMelt);

    // Rotate underneath the in-flight melt: A goes inactive and keyless in the snapshot
    const { counts } = useRotatedMint(server);
    await wallet.loadMint(true);
    // Sanity: the refresh kept A's keys (Task 2); blank them to simulate a wallet
    // built fresh from post-rotation data, which is the failing production case.
    wallet.keyChain.getKeyset('00bd033559de27d0').keys = {};

    // Mint answers with change signed on A (the keyset the blanks were built on)
    server.use(
      http.post(mintUrl + '/v1/melt/bolt11', () => HttpResponse.json(paidResponseWithChangeOnA)),
    );

    const { change } = await wallet.completeMelt(preview);
    expect(change.length).toBeGreaterThan(0);
    expect(counts().keysARequests).toBe(1); // keys were fetched, not assumed
  });
});

describe('strictCachedKeysets', () => {
  test('unknown id throws typed, zero fetches', async () => {
    const wallet = new Wallet(mint, { unit, strictCachedKeysets: true });
    await wallet.loadMint(); // pre-rotation defaults: knows only A

    const { counts } = useRotatedMint(server);
    const updates: KeyChainCache[] = [];
    wallet.on.keychainUpdated(({ cache }) => updates.push(cache));

    const err = await wallet.prepareSwapToReceive([proofOnB]).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(UnknownKeysetError);
    expect((err as UnknownKeysetError).keysetId).toBe('009a1f293253e41e');
    expect(counts().keysetsRequests).toBe(0); // strict mode never repairs
    expect(updates).toHaveLength(0); // nothing internal mutated the snapshot
  });

  test('keyless receive throws legibly, zero fetches', async () => {
    const { counts } = useRotatedMint(server);
    const wallet = new Wallet(mint, { unit, strictCachedKeysets: true });
    await wallet.loadMint(); // single load against rotated handlers: A known-but-keyless

    await expect(wallet.prepareSwapToReceive([proofOnA])).rejects.toThrow(
      /No keys loaded for keyset 00bd033559de27d0/,
    );
    expect(counts().keysARequests).toBe(0); // strict mode never backfills keys
  });

  test('explicit backfill still works', async () => {
    const { counts } = useRotatedMint(server);
    const wallet = new Wallet(mint, { unit, strictCachedKeysets: true });
    await wallet.loadMint();

    await wallet.keyChain.ensureKeysetKeys('00bd033559de27d0'); // consumer's explicit call
    expect(counts().keysARequests).toBe(1);

    const preview = await wallet.prepareSwapToReceive([proofOnA]);
    expect(preview.keysetId).toBe('009a1f293253e41e');
    expect(counts().keysARequests).toBe(1); // no extra fetch from the op itself
  });

  test('strict restore surfaces keyless', async () => {
    const { counts } = useRotatedMint(server);
    const wallet = new Wallet(mint, {
      unit,
      bip39seed: randomBytes(32),
      strictCachedKeysets: true,
    });
    await wallet.loadMint(); // single load against rotated handlers: A known-but-keyless

    await expect(wallet.restore(0, 5, { keysetId: '00bd033559de27d0' })).rejects.toThrow(
      /Keyset has no keys loaded/,
    );
    expect(counts().keysARequests).toBe(0); // strict mode never backfills keys
  });

  test('withKeyset derivative inherits strictCachedKeysets', async () => {
    const wallet = new Wallet(mint, { unit, strictCachedKeysets: true });
    await wallet.loadMint(); // pre-rotation defaults: A active with keys
    const { counts } = useRotatedMint(server); // now A is inactive, B is active

    const derived = wallet.withKeyset('00bd033559de27d0'); // seeded from the parent's cache
    const err = await derived
      .prepareSwapToReceive([proofOnB], { keysetId: '009a1f293253e41e' })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(UnknownKeysetError);
    expect(counts().keysetsRequests).toBe(0); // strict inherited: no repair fired
  });
});
