import { describe, expect, test, vi } from 'vitest';

import { Wallet, type MintQuoteBolt12Response, type SwapPreview } from '../../src';

import { useTestServer, mint, mintInfoResp, unit } from './_setup';

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
});
