import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/curves/utils.js';
import { describe, expect, test } from 'vitest';

import {
  deriveReceiverKeyedSecret,
  serializeTaprootLeaf,
  type TaprootLeaf,
} from '../../src/crypto/taproot';
import { Amount } from '../../src/model/Amount';
import { OutputData } from '../../src/model/OutputData';
import { ScriptPath } from '../../src/model/ScriptPath';
import type { Proof } from '../../src/model/types';
import type { SwapPreview } from '../../src/wallet/types';

const keysetId = `02${'11'.repeat(32)}`;
const sk = (n: number) => {
  const bytes = new Uint8Array(32);
  bytes[31] = n;
  return bytes;
};
const pub = (n: number) => bytesToHex(secp256k1.getPublicKey(sk(n), true));

function fixture() {
  const alice = bytesToHex(sk(2));
  const leaves: TaprootLeaf[] = [
    { type: 'threshold', n: 1, keys: [pub(3)] },
    { type: 'threshold', n: 1, keys: [pub(2)] },
  ];
  const locked = deriveReceiverKeyedSecret(pub(4), {
    leaves,
    blindKeys: [pub(2)],
    eBytes: sk(5),
  });
  const proof: Proof = {
    id: keysetId,
    amount: Amount.from(1),
    secret: locked.secret,
    C: '11'.repeat(48),
    spend_info: { E: locked.E, K: locked.K, tree: locked.tree },
  };
  const preview: SwapPreview = {
    amount: Amount.from(1),
    fees: Amount.from(0),
    keysetId,
    inputs: [proof],
    keepOutputs: [OutputData.createSingleRandomData(1, keysetId)],
  };
  return { alice, leaves, preview, proof };
}

describe('ScriptPath signing packages', () => {
  test('uses absolute slots for a blinded key in a later leaf', () => {
    const { alice, preview, proof } = fixture();
    const pkg = ScriptPath.extractSwapPackage(preview, [{ secret: proof.secret, leafIndex: 1 }]);
    expect(pkg.spends[0].keySlots).toEqual([2]);
    expect(ScriptPath.signPackage(pkg, alice).spends[0].signatures).toHaveLength(1);
  });

  test('refuses to sign a leaf that is not committed by the input secret', () => {
    const { alice, leaves, preview, proof } = fixture();
    const pkg = ScriptPath.extractSwapPackage(preview, [{ secret: proof.secret, leafIndex: 1 }]);
    const tampered = {
      ...pkg,
      spends: [
        {
          ...pkg.spends[0],
          leaf: bytesToHex(serializeTaprootLeaf({ ...leaves[1], keys: [pub(6)] })),
        },
      ],
    };
    expect(() => ScriptPath.signPackage(tampered, alice)).toThrow(/does not commit/);
    expect(() => ScriptPath.deserializePackage(ScriptPath.serializePackage(tampered))).toThrow(
      /does not commit/,
    );
  });

  test('merge counts valid leaf signers, not signature-shaped strings', () => {
    const { preview, proof } = fixture();
    const pkg = ScriptPath.extractSwapPackage(preview, [{ secret: proof.secret, leafIndex: 1 }]);
    pkg.spends[0].signatures = ['00'.repeat(64)];
    expect(() => ScriptPath.mergeSwapPackage(pkg, preview)).toThrow(/valid signatures/);
  });
});
