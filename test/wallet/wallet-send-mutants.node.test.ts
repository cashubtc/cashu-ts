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

// Shared fixtures
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
 * Registers an echo swap handler that returns one signature per requested output. Optionally
 * records each request body and counts calls.
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

// -----------------------------------------------------------------
// defaultOutputType
// -----------------------------------------------------------------

describe('defaultOutputType policy resolution', () => {
  test("policy 'random' returns random even when a seed is present", async () => {
    const wallet = new Wallet(mint, { unit, bip39seed: seed, secretsPolicy: 'random' });
    await wallet.loadMint();
    expect(wallet.defaultOutputType()).toEqual({ type: 'random' });
  });

  test("policy 'deterministic' with a seed returns deterministic auto counter", async () => {
    const wallet = new Wallet(mint, { unit, bip39seed: seed, secretsPolicy: 'deterministic' });
    await wallet.loadMint();
    expect(wallet.defaultOutputType()).toEqual({ type: 'deterministic', counter: 0 });
  });

  test("policy 'deterministic' without a seed throws", async () => {
    const wallet = new Wallet(mint, { unit, secretsPolicy: 'deterministic' });
    await wallet.loadMint();
    expect(() => wallet.defaultOutputType()).toThrow('Deterministic policy requires a seed');
  });

  test('auto policy falls back to seed presence', async () => {
    const seeded = new Wallet(mint, { unit, bip39seed: seed });
    await seeded.loadMint();
    expect(seeded.defaultOutputType()).toEqual({ type: 'deterministic', counter: 0 });

    const unseeded = new Wallet(mint, { unit });
    await unseeded.loadMint();
    expect(unseeded.defaultOutputType()).toEqual({ type: 'random' });
  });
});

// -----------------------------------------------------------------
// send: offline exact-match vs forced swap routing
// -----------------------------------------------------------------

describe('send offline/swap routing', () => {
  test('plain-random default with exact match settles offline (no swap)', async () => {
    const swap = echoSwap();
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const result = await wallet.send(1, [makeProof(1)]);
    expect(swap.calls).toBe(0);
    expect(result.keep).toHaveLength(0);
    expect(result.send).toHaveLength(1);
    // Offline path returns the original proof secret unchanged
    expect(result.send[0].secret).toBe(secret);
  });

  test('deterministic policy forces a swap even for an exact match', async () => {
    const swap = echoSwap();
    const wallet = new Wallet(mint, { unit, bip39seed: seed });
    await wallet.loadMint();

    const result = await wallet.send(1, [makeProof(1)]);
    expect(swap.calls).toBe(1);
    expect(result.send).toHaveLength(1);
    // Swap produced a fresh deterministic secret, not the input secret
    expect(result.send[0].secret).not.toBe(secret);
  });

  test('keysetId override forces a swap', async () => {
    const swap = echoSwap();
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    await wallet.send(1, [makeProof(1)], { keysetId });
    expect(swap.calls).toBe(1);
  });

  test('non-plain-random send output type forces a swap', async () => {
    const swap = echoSwap();
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    await wallet.send(1, [makeProof(1)], {}, { send: { type: 'random', denominations: [1] } });
    expect(swap.calls).toBe(1);
  });
});

// -----------------------------------------------------------------
// sendOffline: requireDleq filtering
// -----------------------------------------------------------------

describe('sendOffline requireDleq retains dleq-bearing proofs', () => {
  test('v1 proof carrying a DLEQ is kept (not filtered out) under requireDleq', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const dleq = { e: '00'.repeat(32), s: '00'.repeat(32), r: '00'.repeat(32) };
    const proof: Proof = { ...makeProof(1), dleq };

    const { send } = wallet.sendOffline(1, [proof], { requireDleq: true });
    expect(send).toHaveLength(1);
    // requireDleq keeps the DLEQ on the outgoing proof
    expect(send[0].dleq).toMatchObject(dleq);
  });
});

// -----------------------------------------------------------------
// createSwapTransaction: keep/send split and ascending output ordering
// -----------------------------------------------------------------

describe('createSwapTransaction output shaping', () => {
  test('sorts swap outputs ascending and splits keep/send correctly', async () => {
    let body: SwapBody | undefined;
    echoSwap((b) => {
      body = b;
    });
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    // send 3 from [2,2]: send outputs [2,1], change (keep) [1]
    const result = await wallet.send(3, [makeProof(2), makeProof(2)]);

    // Payload outputs sorted ascending by amount for privacy
    const amounts = body!.outputs.map((o) => o.amount);
    for (let i = 1; i < amounts.length; i++) {
      expect(amounts[i]).toBeGreaterThanOrEqual(amounts[i - 1]);
    }
    expect(amounts).toEqual([1, 1, 2]);

    // keep/send classification survives the sort + reorder
    expect(Amount.sum(result.send.map((p) => p.amount)).toBigInt()).toBe(3n);
    expect(Amount.sum(result.keep.map((p) => p.amount)).toBigInt()).toBe(1n);
    expect(result.keep).toHaveLength(1);
    expect(result.send).toHaveLength(2);
  });
});

// -----------------------------------------------------------------
// validateReturnedSignatures
// -----------------------------------------------------------------

describe('validateReturnedSignatures', () => {
  test('rejects a returned signature with a downgraded (wrong) amount', async () => {
    server.use(
      http.post(mintUrl + '/v1/swap', () =>
        HttpResponse.json({
          // output expects amount 1, mint returns amount 2 (non-zero mismatch)
          signatures: [{ id: keysetId, amount: 2, C_: validC }],
        }),
      ),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    await expect(wallet.receive([makeProof(1)])).rejects.toThrow(
      'Mint returned signature with wrong amount',
    );
  });

  test('completeSwap rejects a signature count that differs from outputs', async () => {
    server.use(
      http.post(mintUrl + '/v1/swap', () =>
        HttpResponse.json({
          // one output requested, two signatures returned
          signatures: [
            { id: keysetId, amount: 1, C_: validC },
            { id: keysetId, amount: 1, C_: validC },
          ],
        }),
      ),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    await expect(wallet.receive([makeProof(1)])).rejects.toThrow(
      'Mint returned 2 signatures, expected 1',
    );
  });
});

// -----------------------------------------------------------------
// configureOutputs: custom output validation
// -----------------------------------------------------------------

describe('configureOutputs custom validation', () => {
  test('custom output type rejects automatic fee inclusion', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const data = OutputData.createRandomData(1, wallet.keyChain.getKeyset(keysetId));

    await expect(
      wallet.send(1, [makeProof(1)], { includeFees: true }, { send: { type: 'custom', data } }),
    ).rejects.toThrow('custom OutputType does not support automatic fee inclusion');
  });

  test('custom output data whose total mismatches the amount throws', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    // data sums to 1, but we ask to send 2
    const data = OutputData.createRandomData(1, wallet.keyChain.getKeyset(keysetId));

    await expect(
      wallet.send(2, [makeProof(2)], {}, { send: { type: 'custom', data } }),
    ).rejects.toThrow('Custom output data total (1) does not match amount (2)');
  });
});

// -----------------------------------------------------------------
// onCountersReserved callbacks (send + receive)
// -----------------------------------------------------------------

describe('onCountersReserved reservation callbacks', () => {
  test('receive fires onCountersReserved with the reserved range', async () => {
    echoSwap();
    const wallet = new Wallet(mint, { unit, bip39seed: seed });
    await wallet.loadMint();

    let used: OperationCounters | undefined;
    await wallet.receive(
      [makeProof(1)],
      { onCountersReserved: (u) => (used = u) },
      { type: 'deterministic', counter: 0 },
    );

    expect(used).toBeDefined();
    expect(used).toMatchObject({ keysetId, start: 0, count: 1, next: 1 });
  });

  test('prepareSwapToSend fires onCountersReserved for deterministic outputs', async () => {
    const wallet = new Wallet(mint, { unit, bip39seed: seed });
    await wallet.loadMint();

    let used: OperationCounters | undefined;
    const cfg: OutputConfig = {
      send: { type: 'deterministic', counter: 0 },
      keep: { type: 'deterministic', counter: 0 },
    };
    await wallet.prepareSwapToSend(
      3,
      [makeProof(2), makeProof(2)],
      { onCountersReserved: (u) => (used = u) },
      cfg,
    );

    expect(used).toBeDefined();
    // send 3 from [2,2]: send split [1,2] (2 counters) + keep [1] (1 counter) = 3
    expect(used).toMatchObject({ keysetId, start: 0, count: 3 });
    expect(used!.next).toBe(used!.start + used!.count);
  });
});

// -----------------------------------------------------------------
// send: includeFees on a fee-charging keyset
// -----------------------------------------------------------------

describe('send includeFees fee direction', () => {
  test('sender covers the receiver fee on a non-zero input_fee_ppk keyset', async () => {
    // Keyset charges 1 sat per proof (input_fee_ppk 1000). Sending 1 sat with includeFees
    // pads the bundle to [1,2] (total 3): the extra 2 sat are the fee the receiver pays to
    // spend those 2 proofs, so they net the intended 1 sat. Sender pays it, not receiver.
    server.use(
      http.get(mintUrl + '/v1/keysets', () =>
        HttpResponse.json({
          keysets: [
            {
              id: keysetId,
              unit: 'sat',
              active: true,
              input_fee_ppk: 1000,
              final_expiry: undefined,
            },
          ],
        }),
      ),
    );
    echoSwap();
    const wallet = new Wallet(mint, { unit, bip39seed: seed });
    await wallet.loadMint();

    const result = await wallet.send(1, [makeProof(4)], { includeFees: true });
    // 1 (amount) + 2 (fee for the 2 send proofs) = 3
    expect(Amount.sum(result.send.map((p) => p.amount)).equals(3)).toBe(true);
  });
});

// -----------------------------------------------------------------
// prepareSwapToSend: insufficient selection
// -----------------------------------------------------------------

describe('prepareSwapToSend selection', () => {
  test('throws when no proofs can cover the send', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    await expect(wallet.prepareSwapToSend(10, [makeProof(1)])).rejects.toThrow(
      'Not enough funds available to send',
    );
  });
});
