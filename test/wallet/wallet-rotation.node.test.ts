// Rotation suite: what happens to a live Wallet when the mint rotates keysets.
//
// Contract: every async wallet op that consumes keyset ids must make the
// snapshot operable at op entry (see Wallet.ensureOperableKeysets). When you
// add such an op, add its rotation scenario to this file.

import { HttpResponse, http } from 'msw';
import type { SetupServer } from 'msw/node';
import { test, describe, expect } from 'vitest';

import {
  Wallet,
  UnknownKeysetError,
  Amount,
  MeltQuoteState,
  type KeyChainCache,
  type MintKeyset,
  type MintKeys,
  type ProofLike,
  type Proof,
  type MeltQuoteBolt11Response,
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
});

describe('receive across a rotation', () => {
  const proofOnA: ProofLike = {
    id: '00bd033559de27d0',
    amount: 1,
    secret: '407915bc212be61a77e3e6d2aeb4c727980bda51cd06a6afc29e2861768a7837',
    C: '02bc9097997d81afb2cc7346b5e4345a9346bd2a506eb7958598a72f0cf85163ea',
  };
  const proofOnB: ProofLike = { ...proofOnA, id: '009a1f293253e41e' };
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
