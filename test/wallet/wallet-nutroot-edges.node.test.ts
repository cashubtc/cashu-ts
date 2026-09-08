import { describe, expect, test, vi } from 'vitest';

import { Amount, OutputData, PaymentRequest, Wallet, type Proof } from '../../src';
import { BLS_G2_GENERATOR, hashToCurveBls } from '../../src/crypto/curve_bls';
import { blindMessage, getPubKeyFromPrivKey } from '../../src/crypto/curve_secp';
import {
  NUTROOT_NUMS_KEY,
  deriveReceiverKeyedSecret,
  serializeNutrootLeafHex,
  type NutrootLeaf,
} from '../../src/crypto/nutroot';
import { bytesToHex, hexToBytes, deriveKeysetId, verifyProofsForReceive } from '../../src/utils';

const priv = (n: number) => n.toString(16).padStart(64, '0');
const pub = (n: number) => bytesToHex(getPubKeyFromPrivKey(hexToBytes(priv(n))));
const mintUrl = 'https://edges.invalid';
const mintInfo = {
  name: 'Edge-case mint',
  pubkey: pub(5),
  version: 'test/1',
  contact: [],
  nuts: { '4': { methods: [], disabled: false }, '5': { methods: [], disabled: false } },
};
const keys = { '1': BLS_G2_GENERATOR.multiply(5n).toHex(true) };
const id = deriveKeysetId(keys, { versionByte: 2, unit: 'sat', input_fee_ppk: 0 });
const legacyKeys = { '1': pub(5) };
const legacyId = deriveKeysetId(legacyKeys, { versionByte: 0 });
const cache = (v3Active = true) => ({
  mintUrl,
  savedAt: Date.now(),
  keysets: [
    { id: legacyId, unit: 'sat', active: true, input_fee_ppk: 0, keys: legacyKeys },
    { id, unit: 'sat', active: v3Active, input_fee_ppk: 0, keys },
  ],
});
const wallet = () => {
  const w = new Wallet(mintUrl);
  w.loadMintFromCache(mintInfo, cache());
  return w;
};
const proofFor = ({
  secret,
  ...spend_info
}: ReturnType<typeof deriveReceiverKeyedSecret>): Proof => ({
  id,
  amount: Amount.from(1),
  secret,
  C: hashToCurveBls(new TextEncoder().encode(secret)).multiply(5n).toHex(true),
  spend_info,
});
const requestFor = (receiverKey: string, leaves: NutrootLeaf[], blindKeys?: string[]) =>
  new PaymentRequest({
    amount: 1,
    unit: 'sat',
    nutroot: { receiverKey, leaves: leaves.map(serializeNutrootLeafHex), blindKeys },
  });
const leaf: NutrootLeaf = { type: 'threshold', n: 1, keys: [pub(1)] };

describe('nutroot edge cases', () => {
  test.each([NUTROOT_NUMS_KEY, pub(1)])(
    'binds blinded owners to their requested conditions with internal key %s',
    (receiverKey) => {
      const w = wallet();
      const leaves: NutrootLeaf[] = [
        leaf,
        { type: 'after', n: 1, time: 4_000_000_000, keys: [pub(2)] },
      ];
      const blindKeys = [pub(1), pub(2)];
      const pr = requestFor(receiverKey, leaves, blindKeys);
      const swapped = leaves.map((l, i) => ({ ...l, keys: [pub(i === 0 ? 2 : 1)] }));
      const swappedOwners = proofFor(
        deriveReceiverKeyedSecret(receiverKey, { leaves: swapped, blindKeys }),
      );
      // The proof is well formed; only the owner assignment differs from the request.
      expect(() => verifyProofsForReceive([swappedOwners], () => ({ id, keys }))).not.toThrow();
      for (const privkeys of [priv(1), [priv(1), priv(2)], [priv(1), priv(1)]]) {
        expect(() =>
          w.isPaymentRequestSatisfied(pr, [swappedOwners], undefined, { privkeys }),
        ).toThrow(/blind-me/);
      }
      const honest = proofFor(deriveReceiverKeyedSecret(receiverKey, { leaves, blindKeys }));
      honest.spend_info!.tree!.reverse();
      // Reordering is valid, and duplicate copies of a held key do not change ownership.
      expect(
        w.isPaymentRequestSatisfied(pr, [honest], undefined, { privkeys: [priv(1), priv(1)] }),
      ).toBe(true);
    },
  );

  test('matches ambiguous same-shape leaves using the owned blinded keys', () => {
    const w = wallet();
    const leaves: NutrootLeaf[] = [leaf, { ...leaf, keys: [pub(2)] }];
    const blindKeys = [pub(1), pub(2)];
    const honest = proofFor(deriveReceiverKeyedSecret(NUTROOT_NUMS_KEY, { leaves, blindKeys }));
    honest.spend_info!.tree!.reverse();
    expect(
      w.isPaymentRequestSatisfied(
        requestFor(NUTROOT_NUMS_KEY, leaves, blindKeys),
        [honest],
        undefined,
        { privkeys: [priv(1), priv(2)] },
      ),
    ).toBe(true);
  });

  test('rejects NUMS metadata that does not reconstruct the proof secret', () => {
    const w = wallet();
    const honest = proofFor(deriveReceiverKeyedSecret(NUTROOT_NUMS_KEY, { leaves: [leaf] }));
    const mismatched = { ...proofFor({ secret: pub(2) }), spend_info: honest.spend_info };
    expect(() =>
      w.isPaymentRequestSatisfied(requestFor(NUTROOT_NUMS_KEY, [leaf]), [mismatched]),
    ).toThrow(/reconstruct/);
    expect(() => w.spendOptions(mismatched, { privkeys: priv(1) })).toThrow(/reconstruct/);
    expect(w.spendOptions(honest, { privkeys: priv(1) }).spendable).toBe(true);
  });

  test('requires a verified internal key before evaluating an E-only disclosed tree', () => {
    const w = wallet();
    const keyed = proofFor(deriveReceiverKeyedSecret(pub(2), { leaves: [leaf] }));
    delete keyed.spend_info!.K;
    expect(() => w.spendOptions(keyed, { privkeys: priv(1) })).toThrow(/internal key/);
    expect(w.spendOptions(keyed, { privkeys: [priv(1), priv(2)] }).spendable).toBe(true);
  });

  test.each(['direct', 'builder'] as const)(
    'executes an explicit script path through %s send',
    async (mode) => {
      const w = wallet();
      const proof = proofFor(deriveReceiverKeyedSecret(NUTROOT_NUMS_KEY, { leaves: [leaf] }));
      const scriptPath = [{ secret: proof.secret, leafIndex: 0 }];
      // Preserve real preparation and check the boundary that constructs transaction witnesses.
      const complete = vi.spyOn(w, 'completeSwap').mockResolvedValue({ send: [], keep: [] });
      if (mode === 'direct') await w.send(1, [proof], { privkey: priv(1), scriptPath });
      else await w.ops.send(1, [proof]).privkey(priv(1)).scriptPath(scriptPath).run();
      expect(complete).toHaveBeenCalledWith(expect.objectContaining({ inputs: [proof] }), priv(1), {
        scriptPath,
      });
    },
  );

  test.each([false, true])(
    'swaps non-bearer v3 inputs even without a script plan (receiver-keyed: %s)',
    async (keyed) => {
      const w = wallet();
      const proof = proofFor(
        deriveReceiverKeyedSecret(keyed ? pub(1) : NUTROOT_NUMS_KEY, { leaves: [leaf] }),
      );
      const complete = vi.spyOn(w, 'completeSwap').mockResolvedValue({ send: [], keep: [] });
      await w.send(1, [proof], { privkey: priv(1) });
      expect(complete).toHaveBeenCalledOnce();
    },
  );

  test('keeps automatic offline transfer for v3 bearer proofs', async () => {
    const w = wallet();
    const proof = { ...proofFor({ secret: pub(4) }), spend_info: { k: priv(4) } };
    const complete = vi.spyOn(w, 'completeSwap');
    const result = await w.send(1, [proof]);
    expect(result.send).toEqual([proof]);
    expect(complete).not.toHaveBeenCalled();
  });

  test.each(['offlineExactOnly', 'offlineCloseMatch'] as const)(
    'rejects a script plan in explicit %s mode',
    async (mode) => {
      const w = wallet();
      const proof = proofFor(deriveReceiverKeyedSecret(NUTROOT_NUMS_KEY, { leaves: [leaf] }));
      await expect(
        w.ops
          .send(1, [proof])
          .scriptPath([{ secret: proof.secret, leafIndex: 0 }])
          [mode]()
          .run(),
      ).rejects.toThrow(/script-path/);
    },
  );

  test.each(['v3', 'legacy'] as const)(
    'rejects independently blinded duplicate custom melt secrets on %s',
    async (family) => {
      const w = wallet();
      const outputs = [0, 1].map(() => {
        if (family === 'v3') return OutputData.createSingleNutrootData(pub(4), 0, id);
        const secret = new TextEncoder().encode('same-secret');
        const { B_, r } = blindMessage(secret);
        return new OutputData(
          { amount: Amount.zero(), id: legacyId, B_: B_.toHex(true) },
          r,
          secret,
        );
      });
      const input: Proof = { id: legacyId, amount: Amount.from(4), secret: 'input', C: pub(5) };
      const preview = await w.prepareMelt(
        'bolt11',
        { quote: 'test', amount: Amount.from(1) },
        [input],
        { keysetId: family === 'v3' ? id : legacyId },
        { type: 'custom', data: outputs },
      );
      expect(outputs[0].blindedMessage.B_).not.toBe(outputs[1].blindedMessage.B_);
      const melt = vi.spyOn(w.mint, 'melt');
      await expect(w.completeMelt(preview)).rejects.toThrow(/Duplicate output secret/);
      expect(melt).not.toHaveBeenCalled();
    },
  );

  test.each(['prepare', 'run'] as const)(
    'pins locked-request output encoding across refresh during %s',
    async (mode) => {
      const w = wallet();
      w.loadMintFromCache(mintInfo, cache(false));
      const pr = new PaymentRequest({
        amount: 1,
        unit: 'sat',
        nut10: { kind: 'P2PK', data: pub(1) },
      });
      const input = { ...proofFor({ secret: pub(4) }), spend_info: { k: priv(4) } };
      const builder = w.ops.sendToRequest(pr, [input]);
      w.loadMintFromCache(mintInfo, cache(true));
      expect(w.keysetId).toBe(id);
      if (mode === 'prepare') {
        const preview = await builder.prepare();
        expect(preview.sendOutputs?.[0].blindedMessage.id).toBe(legacyId);
      } else {
        const complete = vi.spyOn(w, 'completeSwap').mockResolvedValue({ send: [], keep: [] });
        await builder.run();
        expect(complete).toHaveBeenCalledWith(
          expect.objectContaining({
            sendOutputs: [
              expect.objectContaining({
                blindedMessage: expect.objectContaining({ id: legacyId }),
              }),
            ],
          }),
          undefined,
          undefined,
        );
      }
    },
  );
});
