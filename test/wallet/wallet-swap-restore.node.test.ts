import { HttpResponse, http } from 'msw';
import { describe, expect, test } from 'vitest';

import {
  Amount,
  CallerAbortError,
  Wallet,
  deserializeSwapPreview,
  serializeSwapPreview,
  type Proof,
  type SerializedBlindedMessage,
  type SerializedSwapPreview,
  type SwapPreview,
} from '../../src';

import { useTestServer, mint, mintUrl, mintInfoResp, unit } from './_setup';

const server = useTestServer();
const keysetId = '00bd033559de27d0';
const VALID_POINT = '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422';
const LOCK_PUBKEY = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const input = (amount: number): Proof => ({
  id: keysetId,
  amount: Amount.from(amount),
  secret: '1f98e6837a434644c9411825d7c6d6e13974b931f8f0652217cea29010674a13',
  C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
});

type Signer = (outputs: SerializedBlindedMessage[]) => {
  outputs: SerializedBlindedMessage[];
  signatures: Array<{ id: string; amount: number; C_: string }>;
};

/**
 * A mint that answers /v1/restore with whatever the signer decides it signed.
 */
function restoringMint(signer: Signer) {
  let requests = 0;
  server.use(
    http.post(`${mintUrl}/v1/restore`, async ({ request }) => {
      requests += 1;
      const { outputs } = (await request.json()) as { outputs: SerializedBlindedMessage[] };
      return HttpResponse.json(signer(outputs));
    }),
  );
  return { requests: () => requests };
}

const signAll: Signer = (outputs) => ({
  outputs,
  signatures: outputs.map((o) => ({ id: o.id, amount: Number(o.amount), C_: VALID_POINT })),
});

async function sendPreview(): Promise<SwapPreview> {
  const wallet = new Wallet(mint, { unit });
  await wallet.loadMint();
  const { preview } = await wallet.prepareSwapToSend(2, [input(3)]);
  return preview;
}

const total = (proofs: Proof[]) => proofs.reduce((a, p) => a.add(p.amount), Amount.zero());
const secretOf = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

describe('restoreSwapPreview', () => {
  test('recovers a lost swap as keep and send, with no seed', async () => {
    restoringMint(signAll);
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const preview = await sendPreview();

    const { keep, send } = await wallet.restoreSwapPreview(preview);

    expect(total(send).equals(2)).toBe(true);
    expect(total(keep).equals(1)).toBe(true);
    const sent = new Set(preview.sendOutputs!.map((o) => secretOf(o.secret)));
    expect(send.every((p) => sent.has(p.secret))).toBe(true);
  });

  test('works from a preview persisted and restored from disk', async () => {
    restoringMint(signAll);
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const stored = JSON.stringify(serializeSwapPreview(await sendPreview()));

    const { keep, send } = await wallet.restoreSwapPreview(
      deserializeSwapPreview(JSON.parse(stored) as SerializedSwapPreview),
    );

    expect(total(send).equals(2)).toBe(true);
    expect(total(keep).equals(1)).toBe(true);
  });

  test('matches a partial, reordered reply by B_ and leaves out what the mint never signed', async () => {
    restoringMint((outputs) => signAll([...outputs].reverse().slice(0, outputs.length - 1)));
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const preview = await sendPreview();
    const outputCount = preview.keepOutputs!.length + preview.sendOutputs!.length;

    const { keep, send } = await wallet.restoreSwapPreview(preview);

    expect(keep.length + send.length).toBe(outputCount - 1);
    const kept = new Set(preview.keepOutputs!.map((o) => secretOf(o.secret)));
    expect(keep.every((p) => kept.has(p.secret))).toBe(true);
    expect(send.every((p) => !kept.has(p.secret))).toBe(true);
  });

  test('attributes a same-amount output by B_, not by amount', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    // A 4-sat input sending 2 gives one 2-sat send output and one 2-sat keep output.
    const { preview } = await wallet.prepareSwapToSend(2, [input(4)]);
    const sendB_ = preview.sendOutputs![0].blindedMessage.B_;
    restoringMint((outputs) => signAll(outputs.filter((o) => o.B_ === sendB_)));

    const { keep, send } = await wallet.restoreSwapPreview(preview);

    expect(keep).toHaveLength(0);
    expect(send.map((p) => p.secret)).toEqual([secretOf(preview.sendOutputs![0].secret)]);
  });

  test('refuses a preview that repeats an output, as completeSwap does', async () => {
    const mintCalls = restoringMint(signAll);
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const preview = await sendPreview();
    const repeated = {
      ...preview,
      sendOutputs: [...preview.sendOutputs!, preview.sendOutputs![0]],
    };

    await expect(wallet.restoreSwapPreview(repeated)).rejects.toThrow(/Duplicate output secret/);
    expect(mintCalls.requests()).toBe(0);
  });

  test('refuses a signature naming a different keyset than the output', async () => {
    restoringMint((outputs) => ({
      outputs,
      signatures: outputs.map((o) => ({
        id: '00ffffffffffffff',
        amount: Number(o.amount),
        C_: VALID_POINT,
      })),
    }));
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    await expect(wallet.restoreSwapPreview(await sendPreview())).rejects.toThrow(
      /keyset id at index 0 does not match/,
    );
  });

  test('ignores outputs the mint returns that were never asked for', async () => {
    restoringMint((outputs) => signAll(outputs.map((o) => ({ ...o, B_: VALID_POINT }))));
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    expect(await wallet.restoreSwapPreview(await sendPreview())).toEqual({ keep: [], send: [] });
  });

  test('loads the keys a signature needs when the wallet holds none yet', async () => {
    restoringMint(signAll);
    const preview = await sendPreview();
    // Keyset metadata only, as a wallet restarted from a keyless cache would hold.
    const wallet = new Wallet(mint, { unit });
    wallet.loadMintFromCache(mintInfoResp, {
      mintUrl,
      savedAt: Date.now(),
      keysets: [{ id: keysetId, unit, active: true, input_fee_ppk: 0 }],
    });

    const { keep, send } = await wallet.restoreSwapPreview(preview);

    expect(total(send).equals(2)).toBe(true);
    expect(total(keep).equals(1)).toBe(true);
  });

  test('returns nothing when the mint signed none, so the swap did not complete', async () => {
    restoringMint(() => ({ outputs: [], signatures: [] }));
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    expect(await wallet.restoreSwapPreview(await sendPreview())).toEqual({ keep: [], send: [] });
  });

  test('refuses a signature for a different amount than the output asked for', async () => {
    restoringMint((outputs) => ({
      outputs,
      signatures: outputs.map((o) => ({ id: o.id, amount: Number(o.amount) * 2, C_: VALID_POINT })),
    }));
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();

    await expect(wallet.restoreSwapPreview(await sendPreview())).rejects.toThrow(/wrong amount/);
  });

  test('recovers locked send outputs too, still locked to the recipient', async () => {
    restoringMint(signAll);
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const { preview } = await wallet.ops
      .send(2, [input(3)])
      .asLocked({ mainKeys: [LOCK_PUBKEY] })
      .prepare();

    const { send } = await wallet.restoreSwapPreview(preview);

    expect(send.length).toBeGreaterThan(0);
    expect(send.every((p) => p.secret.includes(LOCK_PUBKEY))).toBe(true);
  });

  test('an aborted signal posts nothing', async () => {
    const mintCalls = restoringMint(signAll);
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    const ac = new AbortController();
    ac.abort();

    await expect(
      wallet.restoreSwapPreview(await sendPreview(), { signal: ac.signal }),
    ).rejects.toBeInstanceOf(CallerAbortError);
    expect(mintCalls.requests()).toBe(0);
  });

  test('refuses a preview with no outputs', async () => {
    const wallet = new Wallet(mint, { unit });
    await wallet.loadMint();
    await expect(wallet.restoreSwapPreview({} as SwapPreview)).rejects.toThrow(
      'restoreSwapPreview: preview has no outputs',
    );
  });
});
