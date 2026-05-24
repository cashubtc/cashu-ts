import { HttpResponse, http } from 'msw';
import { describe, expect, test } from 'vitest';

import { Amount, Mint, OutputData, Wallet, type Proof } from '../../src';
import { DUMMY_TEST_KEYS } from '../consts';

import { mint, mintUrl, useTestServer } from './_setup';

const server = useTestServer();

const CONDITION_ID = 'aa'.repeat(32);
const OUTCOME_COLLECTION_ID = 'cc'.repeat(32);
const CONDITIONAL_KEYSET_ID = '0170110f06b9bb85565a6746ca5715f877b99db14d87219f6e9030cb529f61e6ea';
const REDEEM_SIGNATURE = '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422';

function conditionalProof(amount: number, secret: string): Proof {
  return {
    id: CONDITIONAL_KEYSET_ID,
    amount: Amount.from(amount),
    secret,
    C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
  };
}

function conditionalKeys(inputFeePpk = 0) {
  return {
    ...DUMMY_TEST_KEYS,
    id: CONDITIONAL_KEYSET_ID,
    input_fee_ppk: inputFeePpk,
  };
}

describe('Wallet.swapConditional', () => {
  test('exposes the optional wallet.ctf facade only when CTF is enabled', () => {
    expect(new Wallet(mint).ctf).toBeUndefined();

    const wallet = new Wallet(mint, { enableCtf: true });

    expect(wallet.ctf).toBeDefined();
    expect(typeof wallet.ctf?.swapConditional).toBe('function');
  });

  test('pins every output to the source conditional keyset instead of the wallet regular keyset', async () => {
    const seenOutputs: Array<{ amount: string | number; id: string }> = [];
    server.use(
      http.get(mintUrl + '/v1/conditional_keysets', () =>
        HttpResponse.json({
          keysets: [
            {
              id: CONDITIONAL_KEYSET_ID,
              unit: 'sat',
              active: true,
              input_fee_ppk: 0,
              final_expiry: 1754296607,
              condition_id: CONDITION_ID,
              outcome_collection: 'YES',
              outcome_collection_id: OUTCOME_COLLECTION_ID,
              registered_at: 1_700_000_000,
            },
          ],
        }),
      ),
      http.get(mintUrl + '/v1/keys/' + CONDITIONAL_KEYSET_ID, () =>
        HttpResponse.json({ keysets: [conditionalKeys()] }),
      ),
      http.post(mintUrl + '/v1/swap', async ({ request }) => {
        const body = (await request.json()) as {
          outputs: Array<{ amount: string | number; id: string }>;
        };
        seenOutputs.push(...body.outputs);
        return HttpResponse.json({
          signatures: body.outputs.map((output) => ({
            id: output.id,
            amount: output.amount,
            C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
          })),
        });
      }),
    );
    const wallet = new Wallet(mint);

    const result = await wallet.swapConditional({
      inputs: [conditionalProof(136, 'conditional-input')],
      outputs: [
        { label: 'lock', kind: 'random', amount: 100 },
        { label: 'change', kind: 'random', amount: 36 },
      ],
    });

    expect(seenOutputs.length).toBeGreaterThan(2);
    expect(seenOutputs.every((output) => output.id === CONDITIONAL_KEYSET_ID)).toBe(true);
    expect(seenOutputs.every((output) => typeof output.amount === 'number')).toBe(true);
    expect(result.lock.every((proof) => proof.id === CONDITIONAL_KEYSET_ID)).toBe(true);
    expect(result.change.every((proof) => proof.id === CONDITIONAL_KEYSET_ID)).toBe(true);
    expect(Amount.sum(result.lock.map((proof) => proof.amount))).toEqual(Amount.from(100));
    expect(Amount.sum(result.change.map((proof) => proof.amount))).toEqual(Amount.from(36));
  });

  test('rejects mixed input keysets before preparing conditional outputs', async () => {
    const wallet = new Wallet(mint);

    await expect(
      wallet.swapConditional({
        inputs: [
          conditionalProof(100, 'conditional-input-a'),
          { ...conditionalProof(36, 'conditional-input-b'), id: '01' + 'bb'.repeat(32) },
        ],
        outputs: [{ label: 'lock', kind: 'random', amount: 136 }],
      }),
    ).rejects.toThrow(/inputs must use one keyset/);
  });

  test('can create P2PK-locked conditional outputs and unlocked same-keyset change', async () => {
    server.use(
      http.get(mintUrl + '/v1/conditional_keysets', () =>
        HttpResponse.json({
          keysets: [
            {
              id: CONDITIONAL_KEYSET_ID,
              unit: 'sat',
              active: true,
              input_fee_ppk: 0,
              final_expiry: 1754296607,
              condition_id: CONDITION_ID,
              outcome_collection: 'YES',
              outcome_collection_id: OUTCOME_COLLECTION_ID,
              registered_at: 1_700_000_000,
            },
          ],
        }),
      ),
      http.get(mintUrl + '/v1/keys/' + CONDITIONAL_KEYSET_ID, () =>
        HttpResponse.json({ keysets: [conditionalKeys()] }),
      ),
      http.post(mintUrl + '/v1/swap', async ({ request }) => {
        const body = (await request.json()) as {
          outputs: Array<{ amount: string | number; id: string }>;
        };
        return HttpResponse.json({
          signatures: body.outputs.map((output) => ({
            id: output.id,
            amount: output.amount,
            C_: '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422',
          })),
        });
      }),
    );
    const wallet = new Wallet(mint);
    const pubkeyA = '02' + 'aa'.repeat(32);
    const pubkeyB = '02' + 'bb'.repeat(32);

    const result = await wallet.swapConditional({
      inputs: [conditionalProof(136, 'conditional-input')],
      outputs: [
        {
          label: 'lock',
          kind: 'p2pk',
          amount: 100,
          p2pk: {
            pubkey: [pubkeyA, pubkeyB],
            requiredSignatures: 2,
            locktime: 1_700_000_100,
            refundKeys: [pubkeyA],
          },
        },
        { label: 'change', kind: 'random', amount: 36 },
      ],
    });

    expect(JSON.parse(result.lock[0].secret)).toEqual([
      'P2PK',
      expect.objectContaining({
        data: pubkeyA,
        tags: expect.arrayContaining([
          ['pubkeys', pubkeyB],
          ['n_sigs', '2'],
          ['locktime', '1700000100'],
          ['refund', pubkeyA],
        ]),
      }),
    ]);
    expect(result.change[0].id).toBe(CONDITIONAL_KEYSET_ID);
  });
});

describe('CTF outcome redemption', () => {
  test('Mint.redeemOutcome posts to the CTF redeem endpoint and normalizes signatures', async () => {
    const seenBodies: unknown[] = [];
    const mintClient = new Mint(mintUrl, {
      customRequest: (async (options: {
        endpoint: string;
        method?: string;
        requestBody?: unknown;
      }) => {
        expect(options.endpoint).toBe(mintUrl + '/v1/redeem_outcome');
        expect(options.method).toBe('POST');
        seenBodies.push(options.requestBody);
        return {
          signatures: [{ id: DUMMY_TEST_KEYS.id, amount: 100, C_: REDEEM_SIGNATURE }],
        };
      }) as never,
    });

    const response = await mintClient.redeemOutcome({
      inputs: [{ ...conditionalProof(100, 'conditional-input'), witness: '{"sig":"ok"}' }],
      outputs: [
        {
          id: DUMMY_TEST_KEYS.id,
          amount: Amount.from(100),
          B_: '02'.padEnd(66, 'a'),
        },
      ],
    });

    expect(response.signatures[0].amount).toEqual(Amount.from(100));
    expect(seenBodies).toEqual([
      {
        inputs: [{ ...conditionalProof(100, 'conditional-input'), witness: '{"sig":"ok"}' }],
        outputs: [
          {
            id: DUMMY_TEST_KEYS.id,
            amount: 100,
            B_: '02'.padEnd(66, 'a'),
          },
        ],
      },
    ]);
  });

  test('Wallet.redeemOutcomeProofs converts witnessed CTF proofs into regular proofs', async () => {
    const seenRedeemBodies: Array<{
      inputs: Array<Proof & { witness?: string }>;
      outputs: Array<{ id: string; amount: number }>;
    }> = [];
    server.use(
      http.get(mintUrl + '/v1/keys/' + DUMMY_TEST_KEYS.id, () =>
        HttpResponse.json({ keysets: [DUMMY_TEST_KEYS] }),
      ),
      http.post(mintUrl + '/v1/redeem_outcome', async ({ request }) => {
        const body = (await request.json()) as {
          inputs: Array<Proof & { witness?: string }>;
          outputs: Array<{ id: string; amount: number }>;
        };
        seenRedeemBodies.push(body);
        expect(body.inputs[0].witness).toBe('{"sig":"ok"}');
        expect(body.outputs.every((output) => typeof output.amount === 'number')).toBe(true);
        return HttpResponse.json({
          signatures: body.outputs.map((output) => ({
            id: output.id,
            amount: output.amount,
            C_: REDEEM_SIGNATURE,
          })),
        });
      }),
    );
    const wallet = new Wallet(mint);
    const outputData = OutputData.createRandomData(100, DUMMY_TEST_KEYS);

    const result = await wallet.redeemOutcomeProofs({
      inputs: [{ ...conditionalProof(100, 'conditional-input'), witness: '{"sig":"ok"}' }],
      outputs: outputData,
    });

    expect(seenRedeemBodies).toHaveLength(1);
    expect(Amount.sum(result.map((proof) => proof.amount))).toEqual(Amount.from(100));
    expect(result.every((proof) => proof.id === DUMMY_TEST_KEYS.id)).toBe(true);
  });
});
