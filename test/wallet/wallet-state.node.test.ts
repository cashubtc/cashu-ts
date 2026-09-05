import { HttpResponse, http } from 'msw';
import { test, describe, expect } from 'vitest';

import { Wallet, CheckStateEnum, Amount, hashToCurve } from '../../src';

import { mint, unit, mintUrl, mintInfoResp, useTestServer } from './_setup';

const server = useTestServer();

describe('checkProofsStates', () => {
  const proofs = [
    {
      id: '00bd033559de27d0',
      amount: 1n,
      secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
      C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
    },
  ];
  test('test checkProofsStates - get proofs that are NOT spendable', async () => {
    server.use(
      http.post(mintUrl + '/v1/checkstate', () => {
        return HttpResponse.json({
          states: [
            {
              Y: '02d5dd71f59d917da3f73defe997928e9459e9d67d8bdb771e4989c2b5f50b2fff',
              state: 'UNSPENT',
              witness: 'witness-asd',
            },
          ],
        });
      }),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const result = await wallet.checkProofsStates(proofs);
    result.forEach((r) => {
      expect(r.state).toEqual(CheckStateEnum.UNSPENT);
      expect(r.witness).toEqual('witness-asd');
    });
  });

  test('checkProofsStates uses a custom hashToCurve for Y', async () => {
    const fakeY = '02' + 'ab'.repeat(32);
    const seen: string[][] = [];
    server.use(
      http.post(mintUrl + '/v1/checkstate', async ({ request }) => {
        const body = (await request.json()) as { Ys: string[] };
        seen.push(body.Ys);
        return HttpResponse.json({
          states: body.Ys.map((Y) => ({ Y, state: 'SPENT', witness: null })),
        });
      }),
    );
    const calls: Array<[string, string]> = [];
    const wallet = new Wallet(mint, {
      unit,
      hashToCurve: (secret, keysetId) => {
        calls.push([secret, keysetId]);
        return fakeY;
      },
    });
    await wallet.loadMint();

    const result = await wallet.checkProofsStates(proofs);
    expect(calls).toEqual([[proofs[0].secret, proofs[0].id]]);
    expect(seen).toEqual([[fakeY]]);
    expect(result[0].state).toEqual(CheckStateEnum.SPENT);
  });
  test('checkProofsStates with omitted witness coerces undefined → null', async () => {
    server.use(
      http.post(mintUrl + '/v1/checkstate', () => {
        return HttpResponse.json({
          states: [
            {
              Y: '02d5dd71f59d917da3f73defe997928e9459e9d67d8bdb771e4989c2b5f50b2fff',
              state: 'UNSPENT',
              // witness omitted — spec says `<str | null>`
            },
          ],
        });
      }),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const result = await wallet.checkProofsStates(proofs);
    expect(result[0].witness).toBeNull();
  });
});

describe('checkProofsStates batching', () => {
  test('pools large proof sets into 500-Y batches, preserving order', async () => {
    const requestSizes: number[] = [];
    server.use(
      http.post(mintUrl + '/v1/checkstate', async ({ request }) => {
        const body = (await request.json()) as { Ys: string[] };
        requestSizes.push(body.Ys.length);
        return HttpResponse.json({
          states: body.Ys.map((Y) => ({ Y, state: CheckStateEnum.UNSPENT, witness: null })),
        });
      }),
    );
    const many = Array.from({ length: 1250 }, (_, i) => ({
      id: '00bd033559de27d0',
      secret: `probe-secret-${i}`,
    }));
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    const states = await wallet.checkProofsStates(many);

    // three batches (concurrent, so arrival order may vary)
    expect(requestSizes.sort((a, b) => b - a)).toEqual([500, 500, 250]);
    expect(states).toHaveLength(1250);
    // states come back in input order regardless of batch completion order
    const enc = new TextEncoder();
    many.forEach((p, i) => {
      expect(states[i].Y).toBe(hashToCurve(enc.encode(p.secret)).toHex(true));
    });
  });

  test("sizes batches from the mint's advertised max_array_length", async () => {
    const requestSizes: number[] = [];
    server.use(
      http.get(mintUrl + '/v1/info', () => {
        return HttpResponse.json({ ...mintInfoResp, max_array_length: 100 });
      }),
      http.post(mintUrl + '/v1/checkstate', async ({ request }) => {
        const body = (await request.json()) as { Ys: string[] };
        requestSizes.push(body.Ys.length);
        return HttpResponse.json({
          states: body.Ys.map((Y) => ({ Y, state: CheckStateEnum.UNSPENT, witness: null })),
        });
      }),
    );
    const many = Array.from({ length: 250 }, (_, i) => ({
      id: '00bd033559de27d0',
      secret: `probe-secret-${i}`,
    }));
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    await wallet.checkProofsStates(many);

    expect(requestSizes.sort((a, b) => b - a)).toEqual([100, 100, 50]);
  });

  test('falls back to the library default before mint info is loaded', async () => {
    const requestSizes: number[] = [];
    server.use(
      http.post(mintUrl + '/v1/checkstate', async ({ request }) => {
        const body = (await request.json()) as { Ys: string[] };
        requestSizes.push(body.Ys.length);
        return HttpResponse.json({
          states: body.Ys.map((Y) => ({ Y, state: CheckStateEnum.UNSPENT, witness: null })),
        });
      }),
    );
    const many = Array.from({ length: 600 }, (_, i) => ({
      id: '00bd033559de27d0',
      secret: `unloaded-secret-${i}`,
    }));
    // no loadMint(): checkProofsStates needs no keys, so the wallet has no mint info to size from
    const wallet = new Wallet(mint, { unit });

    await wallet.checkProofsStates(many);

    expect(requestSizes.sort((a, b) => b - a)).toEqual([500, 100]);
  });
});

describe('groupProofsByState', () => {
  test('test groupProofsByState groups proofs by state', async () => {
    const proofs = [
      {
        id: '00bd033559de27d0',
        amount: Amount.from(2),
        secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
        C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
      },
      {
        id: '00bd033559de27d0',
        amount: Amount.from(8),
        secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a14',
        C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
      },
      {
        id: '00bd033559de27d0',
        amount: Amount.from(128),
        secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a15',
        C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
      },
      {
        id: '00bd033559de27d0',
        amount: Amount.from(4),
        secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a16',
        C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
      },
      {
        id: '00bd033559de27d0',
        amount: Amount.from(1),
        secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a17',
        C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
      },
      {
        id: '00bd033559de27d0',
        amount: Amount.from(16),
        secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a18',
        C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
      },
    ];
    server.use(
      http.post(mintUrl + '/v1/checkstate', () => {
        return HttpResponse.json({
          states: [
            {
              Y: '02d5dd71f59d917da3f73defe997928e9459e9d67d8bdb771e4989c2b5f50b2fff',
              state: 'SPENT',
              witness: 'witness-asd',
            },
            {
              Y: '02c2c185f0c66b6de36443623fd83d14c6a4725a98f7d9bf6a07f85356574f9068',
              state: 'UNSPENT',
              witness: 'witness-asd',
            },
            {
              Y: '02c801497e8c184b0b041fcd2aff4cd2f3ad35d88f6788afe1591a4540b37a0567',
              state: 'SPENT',
              witness: 'witness-asd',
            },
            {
              Y: '02120df194276661363da9a2fc558975c45ffefc06b094b228074886cddff59470',
              state: 'UNSPENT',
              witness: 'witness-asd',
            },
            {
              Y: '02e7e7e6b59cb8de7e32a9e43dd4329922ff6c93fd30a0a604f08fd3a0bc820c93',
              state: 'PENDING',
              witness: 'witness-asd',
            },
            {
              Y: '029279de78447f77619b2c6905b9140eb4fff110908359bf9efd06f8e17e354099',
              state: 'SPENT',
              witness: 'witness-asd',
            },
          ],
        });
      }),
    );
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const result = await wallet.groupProofsByState(proofs);
    expect(result.unspent[0].amount.equals(8n)).toBeTruthy();
    expect(result.unspent[1].amount.equals(4n)).toBeTruthy();
    expect(result.spent[0].amount.equals(2n)).toBeTruthy();
    expect(result.spent[1].amount.equals(128n)).toBeTruthy();
    expect(result.spent[2].amount.equals(16n)).toBeTruthy();
    expect(result.pending[0].amount.equals(1n)).toBeTruthy();
  });
});
