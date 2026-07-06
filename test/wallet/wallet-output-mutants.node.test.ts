import { hexToBytes } from '@noble/curves/utils.js';
import { HttpResponse, http } from 'msw';
import { test, describe, expect } from 'vitest';

import {
  Wallet,
  Amount,
  OutputData,
  type Proof,
  type OutputConfig,
  type OperationCounters,
} from '../../src';

import { useTestServer, mint, mintUrl, unit } from './_setup';

const server = useTestServer();

// Shared fixtures. The dummy keyset only carries denominations 1 and 2, so every
// output amount below decomposes into 1s and 2s (e.g. 3 -> [2,1], 4 -> [2,2]).
const keysetId = '00bd033559de27d0';
const validC = '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422';
const secret = '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13';
const proofC = '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be';
const seed = hexToBytes(
  'dd44ee516b0647e80b488e8dcc56d736a148f15276bef588b37057476d4b2b25780d3688a32b37353d6995997842c0fd8b412475c891c16310471fbc86dcbda8',
);

function makeProof(amount: number): Proof {
  return { id: keysetId, amount: Amount.from(amount), secret, C: proofC };
}

interface SwapBody {
  inputs: Array<{ amount: number; id: string }>;
  outputs: Array<{ amount: number; B_: string; id: string }>;
}

/**
 * Echo swap handler: one signature per requested output. Optionally records each request body.
 */
function echoSwap(onCall?: (body: SwapBody) => void): { calls: number } {
  const state = { calls: 0 };
  server.use(
    http.post(mintUrl + '/v1/swap', async ({ request }) => {
      const body = (await request.json()) as SwapBody;
      state.calls += 1;
      onCall?.(body);
      return HttpResponse.json({
        signatures: body.outputs.map((o) => ({ id: o.id, amount: o.amount, C_: validC })),
      });
    }),
  );
  return state;
}

/**
 * Secret strings a deterministic batch would derive for (amount, counter) on the wallet keyset.
 */
function detSecrets(w: Wallet, amount: number, counter: number): Set<string> {
  const keyset = w.keyChain.getKeyset(keysetId);
  return new Set(
    OutputData.createDeterministicData(amount, seed, counter, keyset).map((od) =>
      new TextDecoder().decode(od.secret),
    ),
  );
}

const proofSecrets = (proofs: Proof[]): Set<string> => new Set(proofs.map((p) => p.secret));

// -----------------------------------------------------------------
// Counter reservation: reserveFor / countersNeeded / addCountersToOutputTypes
// -----------------------------------------------------------------

describe('deterministic counter reservation', () => {
  test('auto deterministic receive reserves the exact contiguous range from zero', async () => {
    echoSwap();
    const wallet = new Wallet(mint, { unit, bip39seed: seed });
    await wallet.loadMint();

    let used: OperationCounters | undefined;
    // receive 3 (=[2,1]) -> two outputs -> two counters, starting at 0.
    const kept = await wallet.receive(
      [makeProof(2), makeProof(1)],
      { onCountersReserved: (u) => (used = u) },
      { type: 'deterministic', counter: 0 },
    );

    expect(used).toEqual({ keysetId, start: 0, count: 2, next: 2 });
    expect(Amount.sum(kept.map((p) => p.amount)).toBigInt()).toBe(3n);
    expect(kept.map((p) => Number(p.amount.toBigInt())).sort()).toEqual([1, 2]);
    // Secrets are derived at counters 0 and 1 (auto counter 0 == reserved start 0).
    expect(proofSecrets(kept)).toEqual(detSecrets(wallet, 3, 0));
  });

  test('random outputs reserve no counters even when denominations are supplied', async () => {
    echoSwap();
    const wallet = new Wallet(mint, { unit, bip39seed: seed });
    await wallet.loadMint();

    let fired = false;
    const kept = await wallet.receive(
      [makeProof(2), makeProof(1)],
      { onCountersReserved: () => (fired = true) },
      { type: 'random', denominations: [1, 2] },
    );

    // countersNeeded is zero for non-deterministic types, so nothing is reserved.
    expect(fired).toBe(false);
    expect(Amount.sum(kept.map((p) => p.amount)).toBigInt()).toBe(3n);
    expect(kept).toHaveLength(2);
  });

  test('manual send counter advances the cursor before the auto keep reservation', async () => {
    echoSwap();
    const wallet = new Wallet(mint, { unit, bip39seed: seed });
    await wallet.loadMint();

    let used: OperationCounters | undefined;
    const cfg: OutputConfig = {
      // send 3 (=[2,1]) pinned at counter 10 -> occupies [10,12)
      send: { type: 'deterministic', counter: 10 },
      // change 1 (=[1]) auto -> must reserve at 12, after the manual range
      keep: { type: 'deterministic', counter: 0 },
    };
    const result = await wallet.send(
      3,
      [makeProof(2), makeProof(2)],
      { onCountersReserved: (u) => (used = u) },
      cfg,
    );

    expect(used).toEqual({ keysetId, start: 12, count: 1, next: 13 });
    // Send outputs use the manual counters 10,11; the auto keep uses the advanced counter 12.
    expect(proofSecrets(result.send)).toEqual(detSecrets(wallet, 3, 10));
    expect(proofSecrets(result.keep)).toEqual(detSecrets(wallet, 1, 12));
  });

  test('a manual counter on a zero-denomination output does not shift the auto reservation', async () => {
    echoSwap();
    const wallet = new Wallet(mint, { unit, bip39seed: seed });
    await wallet.loadMint();

    let used: OperationCounters | undefined;
    const cfg: OutputConfig = {
      // send 4 (=[2,2]) auto -> two counters from 0
      send: { type: 'deterministic', counter: 0 },
      // exact send leaves zero change: keep gets no denominations, so its manual
      // counter 50 must not be treated as an occupied range.
      keep: { type: 'deterministic', counter: 50 },
    };
    const result = await wallet.send(
      4,
      [makeProof(2), makeProof(2)],
      { onCountersReserved: (u) => (used = u) },
      cfg,
    );

    expect(used).toEqual({ keysetId, start: 0, count: 2, next: 2 });
    expect(result.keep).toHaveLength(0);
    expect(proofSecrets(result.send)).toEqual(detSecrets(wallet, 4, 0));
  });
});

describe('manual counter range validation', () => {
  test('overlapping manual send/keep ranges are rejected', async () => {
    echoSwap();
    const wallet = new Wallet(mint, { unit, bip39seed: seed });
    await wallet.loadMint();

    const cfg: OutputConfig = {
      // send 3 -> [2,1] occupies [10,12)
      send: { type: 'deterministic', counter: 10 },
      // change 1 -> [1] at counter 11 lands inside [10,12): overlap
      keep: { type: 'deterministic', counter: 11 },
    };
    await expect(wallet.send(3, [makeProof(2), makeProof(2)], {}, cfg)).rejects.toThrow(
      'Manual counter ranges overlap',
    );
  });

  test('adjacent manual ranges (start == previous end) are allowed', async () => {
    echoSwap();
    const wallet = new Wallet(mint, { unit, bip39seed: seed });
    await wallet.loadMint();

    let fired = false;
    const cfg: OutputConfig = {
      // send 3 -> [2,1] occupies [10,12)
      send: { type: 'deterministic', counter: 10 },
      // change 1 -> [1] at counter 12 abuts the send range without overlapping
      keep: { type: 'deterministic', counter: 12 },
    };
    const result = await wallet.send(
      3,
      [makeProof(2), makeProof(2)],
      { onCountersReserved: () => (fired = true) },
      cfg,
    );

    // Both ranges are manual, so no auto reservation fires.
    expect(fired).toBe(false);
    expect(proofSecrets(result.send)).toEqual(detSecrets(wallet, 3, 10));
    expect(proofSecrets(result.keep)).toEqual(detSecrets(wallet, 1, 12));
  });
});

// -----------------------------------------------------------------
// createSwapTransaction: ascending sort + keep/send classification
// -----------------------------------------------------------------

describe('createSwapTransaction shaping', () => {
  test('sorts outputs ascending and keeps the keep/send split across the reorder', async () => {
    let body: SwapBody | undefined;
    echoSwap((b) => (body = b));
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    // send 1 from a single 4: send [1], change [2,1] -> keep has two entries
    const result = await wallet.send(1, [makeProof(4)]);

    expect(body!.outputs.map((o) => o.amount)).toEqual([1, 1, 2]);
    expect(result.keep).toHaveLength(2);
    expect(Amount.sum(result.keep.map((p) => p.amount)).toBigInt()).toBe(3n);
    expect(result.send).toHaveLength(1);
    expect(Amount.sum(result.send.map((p) => p.amount)).toBigInt()).toBe(1n);
  });
});

// -----------------------------------------------------------------
// configureOutputs: explicit denominations are honoured
// -----------------------------------------------------------------

describe('configureOutputs denomination handling', () => {
  test('explicit keep denominations are not overridden by proofsWeHave optimization', async () => {
    echoSwap();
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    // change is 3; keep is pinned to three 1s. With five 1s already held, the
    // optimizer would prefer [1,2], so honouring the explicit split is observable.
    const result = await wallet.send(
      1,
      [makeProof(4)],
      { proofsWeHave: [1, 1, 1, 1, 1].map(makeProof) },
      { send: { type: 'random' }, keep: { type: 'random', denominations: [1, 1, 1] } },
    );

    expect(result.keep).toHaveLength(3);
    expect(result.keep.every((p) => p.amount.toBigInt() === 1n)).toBe(true);
  });
});
