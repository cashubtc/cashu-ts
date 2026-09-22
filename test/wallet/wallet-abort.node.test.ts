import { describe, expect, test, vi } from 'vitest';

import {
  Wallet,
  Amount,
  CallerAbortError,
  CheckStateEnum,
  MeltQuoteState,
  type MeltQuoteBolt11Response,
  type MeltQuoteOnchainResponse,
  type MintQuoteBolt11Response,
  type MintQuoteBolt12Response,
  type SwapPreview,
} from '../../src';

import { useTestServer, mint, mintInfoResp, unit, token3sat } from './_setup';

useTestServer();

const quote12 = {
  quote: 'q12',
  request: 'lno1',
  amount: 21,
  unit: 'sat',
} as unknown as MintQuoteBolt12Response;

describe('AbortSignal on wallet operations', () => {
  test('a read passes its signal through to the mint call', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const ac = new AbortController();
    const spy = vi.spyOn(wallet.mint, 'checkMintQuoteBolt12').mockResolvedValue(quote12);

    await wallet.checkMintQuoteBolt12('q12', { signal: ac.signal });

    expect(spy).toHaveBeenCalledWith('q12', { signal: ac.signal });
  });

  test('loadMint forwards the signal to the info request', async () => {
    const wallet = new Wallet(mint, { unit });
    const ac = new AbortController();
    const spy = vi.spyOn(wallet.mint, 'getInfo').mockResolvedValue(mintInfoResp);

    await wallet.loadMint(true, { signal: ac.signal });

    expect(spy).toHaveBeenCalledWith({ signal: ac.signal });
  });

  test('a one-shot send honours the signal while preparing, not for the commit', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const ac = new AbortController();
    const preview = { amount: 5 } as unknown as SwapPreview;
    const prepare = vi.spyOn(wallet, 'prepareSwapToSend').mockResolvedValue(preview);
    const complete = vi.spyOn(wallet, 'completeSwap').mockResolvedValue({ keep: [], send: [] });

    await wallet.ops.send(5, []).signal(ac.signal).run();

    expect(prepare.mock.calls[0][2]).toMatchObject({ signal: ac.signal });
    const completeOptions = complete.mock.calls[0][2];
    expect(completeOptions?.signal).toBeUndefined();
  });

  test('prepareMint fetches an id-only quote with the config signal', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const ac = new AbortController();
    const check = vi.spyOn(wallet, 'checkMintQuote').mockRejectedValue(new Error('stop here'));

    await expect(
      wallet.prepareMint('bolt12', 21, { quote: 'q12' }, { signal: ac.signal }),
    ).rejects.toThrow('stop here');

    expect(check).toHaveBeenCalledWith('bolt12', 'q12', { signal: ac.signal });
  });

  test('completing from a preview forwards the signal to the commit request', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const ac = new AbortController();
    const spy = vi.spyOn(wallet.mint, 'mint').mockResolvedValue({ signatures: [] });

    await wallet.completeMint(
      { method: 'bolt11', quote: { quote: 'q' }, outputData: [] },
      { signal: ac.signal },
    );

    expect(spy.mock.calls[0][2]).toEqual({ signal: ac.signal });
  });

  test('every builder forwards its signal to the wallet config', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const ac = new AbortController();
    const hasSignal = (calls: unknown[][]) =>
      calls[0].some(
        (a) =>
          typeof a === 'object' && a !== null && (a as { signal?: unknown }).signal === ac.signal,
      );
    const stop = new Error('stop here');

    const receive = vi.spyOn(wallet, 'prepareSwapToReceive').mockRejectedValue(stop);
    await expect(wallet.ops.receive('cashuB...').signal(ac.signal).prepare()).rejects.toThrow(stop);
    expect(hasSignal(receive.mock.calls)).toBe(true);

    const mintPrep = vi.spyOn(wallet, 'prepareMint').mockRejectedValue(stop);
    const q11 = { quote: 'q11', unit: 'sat', amount: 21 } as unknown as MintQuoteBolt11Response;
    await expect(wallet.ops.mintBolt11(21, q11).signal(ac.signal).prepare()).rejects.toThrow(stop);
    expect(hasSignal(mintPrep.mock.calls)).toBe(true);

    const meltPrep = vi.spyOn(wallet, 'prepareMelt').mockRejectedValue(stop);
    const mq = { quote: 'mq', amount: 1, unit: 'sat' } as unknown as MeltQuoteBolt11Response;
    await expect(wallet.ops.meltBolt11(mq, []).signal(ac.signal).prepare()).rejects.toThrow(stop);
    expect(hasSignal(meltPrep.mock.calls)).toBe(true);

    const onchain = vi.spyOn(wallet, 'meltProofsOnchain').mockRejectedValue(stop);
    const oq = {
      quote: 'oq',
      amount: 1,
      unit: 'sat',
      fee_options: [{ fee_index: 0, fee: 1 }],
    } as unknown as MeltQuoteOnchainResponse;
    await expect(wallet.ops.meltOnchain(oq, []).signal(ac.signal).run()).rejects.toThrow(stop);
    expect(hasSignal(onchain.mock.calls)).toBe(true);
  });

  test('melt quote checks pass the signal through', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const ac = new AbortController();
    const q = { quote: 'mq12', amount: 1, unit: 'sat' } as unknown as MeltQuoteBolt11Response;
    const spy = vi.spyOn(wallet.mint, 'checkMeltQuoteBolt12').mockResolvedValue(q);

    await wallet.checkMeltQuoteBolt12('mq12', { signal: ac.signal });

    expect(spy).toHaveBeenCalledWith('mq12', { signal: ac.signal });
  });
});

test.each(['send', 'receive', 'mint', 'batchMint', 'melt'] as const)(
  '%s rejects cancellation before and during preparation without committing',
  async (operation) => {
    const wallet = new Wallet(mint, { unit, bip39seed: new Uint8Array(64).fill(1) });
    await wallet.loadMint();
    const proofs = wallet.decodeToken(token3sat).proofs;
    const quote = {
      quote: 'q',
      unit,
      amount: Amount.from(1),
      amount_paid: Amount.from(1),
      amount_issued: Amount.zero(),
    };
    const swap = vi.spyOn(wallet.mint, 'swap');
    const mintCall = vi.spyOn(wallet.mint, 'mint');
    const melt = vi.spyOn(wallet.mint, 'melt');
    const batch = vi.spyOn(wallet.mint, 'mintBatch');
    for (const preAborted of [true, false]) {
      const ac = new AbortController();
      if (preAborted) ac.abort();
      const config = { signal: ac.signal, onCountersReserved: () => ac.abort() };
      const run = () => {
        switch (operation) {
          case 'send':
            return wallet.send(1, proofs, config);
          case 'receive':
            return wallet.receive(proofs, config);
          case 'mint':
            return wallet.mintProofs('bolt11', 1, quote, config);
          case 'batchMint':
            return wallet.prepareBatchMint('bolt11', [{ amount: 1, quote }], config);
          case 'melt':
            return wallet.meltProofs(
              'bolt11',
              { ...quote, state: MeltQuoteState.UNPAID },
              proofs,
              config,
            );
        }
      };
      await expect(run()).rejects.toBeInstanceOf(CallerAbortError);
    }
    expect(swap).not.toHaveBeenCalled();
    expect(mintCall).not.toHaveBeenCalled();
    expect(melt).not.toHaveBeenCalled();
    expect(batch).not.toHaveBeenCalled();
  },
);

test('a one-shot mint finishes when aborted during the commit', async () => {
  const wallet = new Wallet(mint, { unit });
  await wallet.loadMint();
  const ac = new AbortController();
  const commit = vi
    .spyOn(wallet.mint, 'mint')
    .mockImplementation(async (_method, _payload, opts) => {
      ac.abort();
      expect(opts?.signal).toBeUndefined();
      return {
        signatures: _payload.outputs.map((o) => ({
          id: o.id,
          amount: o.amount,
          C_: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
        })),
      };
    });
  await expect(
    wallet.mintProofs(
      'bolt11',
      1,
      {
        quote: 'q',
        unit,
        amount_paid: Amount.from(1),
        amount_issued: Amount.zero(),
      },
      { signal: ac.signal },
    ),
  ).resolves.toHaveLength(1);
  expect(commit).toHaveBeenCalledOnce();
});

test('restore cancels state checks even when every scanned proof is spent', async () => {
  const wallet = new Wallet(mint, { unit, bip39seed: new Uint8Array(64).fill(1) });
  await wallet.loadMint();
  const ac = new AbortController();
  const check = vi.spyOn(wallet.mint, 'check').mockImplementation(async ({ Ys }, opts) => {
    if (opts?.signal?.aborted) throw new CallerAbortError('aborted');
    ac.abort();
    return { states: Ys.map((Y) => ({ Y, state: CheckStateEnum.SPENT, witness: null })) };
  });
  await expect(
    wallet.batchRestore({ signal: ac.signal, gapLimit: 1, batchSize: 1, maxCounter: 1 }),
  ).rejects.toBeInstanceOf(CallerAbortError);
  expect(check).toHaveBeenCalledTimes(2);
});
