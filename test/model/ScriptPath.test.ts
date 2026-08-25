import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import { describe, expect, test } from 'vitest';

import {
  deriveReceiverKeyedSecret,
  parseNutrootLeaf,
  serializeNutrootLeaf,
  type NutrootLeaf,
} from '../../src/crypto/nutroot';
import { Amount } from '../../src/model/Amount';
import { OutputData } from '../../src/model/OutputData';
import { ScriptPath } from '../../src/model/ScriptPath';
import type { Proof } from '../../src/model/types';
import type { MeltPreview, SwapPreview } from '../../src/wallet/types';

const keysetId = `02${'11'.repeat(32)}`;
const sk = (n: number) => {
  const bytes = new Uint8Array(32);
  bytes[31] = n;
  return bytes;
};
const pub = (n: number) => bytesToHex(secp256k1.getPublicKey(sk(n), true));

function fixture() {
  const alice = bytesToHex(sk(2));
  const leaves: NutrootLeaf[] = [
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
  test('signs a blinded key at its absolute slot in a later leaf', () => {
    const { alice, preview, proof } = fixture();
    const pkg = ScriptPath.extractSwapPackage(preview, [{ secret: proof.secret, leafIndex: 1 }]);
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
          leaf: bytesToHex(serializeNutrootLeaf({ ...leaves[1], keys: [pub(6)] })),
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

  // Each signPackage on a receiver-keyed proof trial-matches 255 blinding slots, so these
  // stay one call per test to fit slow CI runners inside the default timeout.
  test('signs a verbatim leaf key', () => {
    const { preview, proof } = fixture();
    const pkg = ScriptPath.extractSwapPackage(preview, [{ secret: proof.secret, leafIndex: 0 }]);
    const signed = ScriptPath.signPackage(pkg, bytesToHex(sk(3)));
    expect(signed.spends[0].signatures).toHaveLength(1);
    // The signature is BIP-340 by the leaf key over the package digest.
    expect(
      schnorr.verify(
        hexToBytes(signed.spends[0].signatures[0]),
        hexToBytes(pkg.digest),
        hexToBytes(pub(3)).subarray(1),
      ),
    ).toBe(true);
  });

  test('signing with a key the tree does not name adds nothing', () => {
    const { preview, proof } = fixture();
    const pkg = ScriptPath.extractSwapPackage(preview, [{ secret: proof.secret, leafIndex: 0 }]);
    // Leaf 0 names pub(3) verbatim; sk(9) appears nowhere in the tree.
    expect(ScriptPath.signPackage(pkg, bytesToHex(sk(9))).spends[0].signatures).toHaveLength(0);
  });

  test('round-trips through the nutspA transport string', () => {
    const { preview, proof } = fixture();
    const pkg = ScriptPath.extractSwapPackage(preview, [{ secret: proof.secret, leafIndex: 1 }]);
    const encoded = ScriptPath.serializePackage(pkg);
    expect(encoded.startsWith('nutspA')).toBe(true);
    const decoded = ScriptPath.deserializePackage(encoded);
    expect(decoded.digest).toBe(pkg.digest);
    expect(decoded.spends).toEqual(pkg.spends);
    expect(decoded.type).toBe('swap');
    // A signature added remotely survives the trip back.
    const signed = ScriptPath.signPackage(decoded, bytesToHex(sk(2)));
    expect(signed.spends[0].signatures).toHaveLength(1);
  });

  test('deserialize rehydrates amounts to their model types', () => {
    const { preview, proof } = fixture();
    const pkg = ScriptPath.extractSwapPackage(preview, [{ secret: proof.secret, leafIndex: 1 }]);
    const decoded = ScriptPath.deserializePackage(ScriptPath.serializePackage(pkg));
    // JSONInt flattens Amount to bare integers; the other side must get Amounts back.
    expect(decoded.inputs[0].amount).toBeInstanceOf(Amount);
    expect(decoded.inputs[0].amount.toBigInt()).toBe(1n);
    expect(decoded.outputs[0].amount).toBeInstanceOf(Amount);
  });

  test('extract refuses plans it cannot honour', () => {
    const { preview, proof } = fixture();
    expect(() => ScriptPath.extractSwapPackage(preview, [])).toThrow(/at least one plan/);
    expect(() =>
      ScriptPath.extractSwapPackage(preview, [{ secret: pub(9), leafIndex: 0 }]),
    ).toThrow(/not in this transaction/);
    expect(() =>
      ScriptPath.extractSwapPackage(preview, [{ secret: proof.secret, leafIndex: 2 }]),
    ).toThrow(/not disclosed/);
    const keyless: SwapPreview = {
      ...preview,
      inputs: [{ ...proof, spend_info: { E: proof.spend_info!.E, tree: proof.spend_info!.tree } }],
    };
    expect(() =>
      ScriptPath.extractSwapPackage(keyless, [{ secret: proof.secret, leafIndex: 0 }]),
    ).toThrow(/internal key/);
  });

  test('deserialize fails closed on malformed transport strings', () => {
    const { preview, proof } = fixture();
    const pkg = ScriptPath.extractSwapPackage(preview, [{ secret: proof.secret, leafIndex: 1 }]);
    expect(() => ScriptPath.deserializePackage('cashuA0000')).toThrow(/must start with/);
    expect(() => ScriptPath.deserializePackage('nutspA!!!not-base64!!!')).toThrow(/parse/);
    // Shallow clone: structuredClone would strip the Amount prototypes off the inputs.
    const reserialize = (mangle: (p: typeof pkg) => unknown) =>
      ScriptPath.serializePackage(
        mangle({ ...pkg, spends: pkg.spends.map((s) => ({ ...s })) }) as typeof pkg,
      );
    expect(() =>
      ScriptPath.deserializePackage(reserialize((p) => ({ ...p, version: 'nutspB' }))),
    ).toThrow(/version/);
    expect(() =>
      ScriptPath.deserializePackage(reserialize((p) => ({ ...p, type: 'mint' }))),
    ).toThrow(/type/);
    expect(() =>
      ScriptPath.deserializePackage(reserialize((p) => ({ ...p, spends: 'none' }))),
    ).toThrow(/Malformed/);
    expect(() =>
      ScriptPath.deserializePackage(reserialize((p) => ({ ...p, digest: 'abcd' }))),
    ).toThrow(/32 bytes hex/);
    // A digest that is well-formed but wrong: the package no longer matches its own contents.
    const flipped = `${pkg.digest.slice(0, -1)}${pkg.digest.endsWith('0') ? '1' : '0'}`;
    expect(() =>
      ScriptPath.deserializePackage(reserialize((p) => ({ ...p, digest: flipped }))),
    ).toThrow(/does not match its inputs/);
    expect(() =>
      ScriptPath.deserializePackage(
        reserialize((p) => ({ ...p, spends: [p.spends[0], p.spends[0]] })),
      ),
    ).toThrow(/one unique transaction input/);
    expect(() =>
      ScriptPath.deserializePackage(
        reserialize((p) => ({ ...p, spends: [{ ...p.spends[0], signatures: 'sig' }] })),
      ),
    ).toThrow(/signatures must be an array/);
  });

  test('merge refuses a package whose transaction moved, and the wrong package type', () => {
    const { alice, preview, proof } = fixture();
    const pkg = ScriptPath.signPackage(
      ScriptPath.extractSwapPackage(preview, [{ secret: proof.secret, leafIndex: 1 }]),
      alice,
    );
    const moved: SwapPreview = {
      ...preview,
      keepOutputs: [OutputData.createSingleRandomData(1, keysetId)],
    };
    expect(() => ScriptPath.mergeSwapPackage(pkg, moved)).toThrow(/moved since it was extracted/);
    expect(() =>
      ScriptPath.mergeMeltPackage(pkg, {
        method: 'bolt11',
        inputs: preview.inputs,
        outputData: [],
        keysetId,
        quote: { quote: 'q1', amount: Amount.from(1) },
      }),
    ).toThrow(/Cannot merge a swap package into a melt/);
  });

  test('merge applies a complete spend as the input witness', () => {
    const { alice, preview, proof } = fixture();
    const pkg = ScriptPath.signPackage(
      ScriptPath.extractSwapPackage(preview, [{ secret: proof.secret, leafIndex: 1 }]),
      alice,
    );
    const merged = ScriptPath.mergeSwapPackage(pkg, preview);
    expect(proof.witness).toBeUndefined(); // the preview is not mutated
    const witness = JSON.parse(merged.inputs[0].witness as string) as {
      leaf: string;
      control: { K: string; path: string[] };
      signatures: string[];
    };
    expect(witness.leaf).toBe(pkg.spends[0].leaf);
    expect(witness.control).toEqual(pkg.spends[0].control);
    const leaf = parseNutrootLeaf(hexToBytes(witness.leaf));
    expect(witness.signatures).toHaveLength(leaf.n);
  });
});

describe('ScriptPath melt packages', () => {
  function meltFixture() {
    const { alice, preview, proof } = fixture();
    const meltPreview: MeltPreview<{ quote: string; amount: Amount }> = {
      method: 'bolt11',
      inputs: preview.inputs,
      outputData: [OutputData.createSingleRandomData(1, keysetId)],
      keysetId,
      quote: { quote: 'quote-1', amount: Amount.from(1) },
    };
    return { alice, meltPreview, proof, swapPreview: preview };
  }

  test('the melt quote is part of the signed digest', () => {
    const { meltPreview, swapPreview, proof } = meltFixture();
    const melt = ScriptPath.extractMeltPackage(meltPreview, [
      { secret: proof.secret, leafIndex: 1 },
    ]);
    expect(melt.type).toBe('melt');
    expect(melt.quote).toBe('quote-1');
    const swap = ScriptPath.extractSwapPackage(swapPreview, [
      { secret: proof.secret, leafIndex: 1 },
    ]);
    // Same inputs; the quote container must move the digest (NUT-10 melt transcript).
    expect(melt.digest).not.toBe(swap.digest);
  });

  test('deserialize rehydrates the melt quote amount as bigint', () => {
    const { meltPreview, proof } = meltFixture();
    const pkg = ScriptPath.extractMeltPackage(meltPreview, [
      { secret: proof.secret, leafIndex: 1 },
    ]);
    const decoded = ScriptPath.deserializePackage(ScriptPath.serializePackage(pkg));
    expect(typeof decoded.quoteAmount).toBe('bigint');
    expect(decoded.quoteAmount).toBe(1n);
  });

  test('sign and merge complete a melt spend end to end', () => {
    const { alice, meltPreview, proof } = meltFixture();
    const pkg = ScriptPath.signPackage(
      ScriptPath.deserializePackage(
        ScriptPath.serializePackage(
          ScriptPath.extractMeltPackage(meltPreview, [{ secret: proof.secret, leafIndex: 1 }]),
        ),
      ),
      alice,
    );
    const merged = ScriptPath.mergeMeltPackage(pkg, meltPreview);
    const witness = JSON.parse(merged.inputs[0].witness as string) as { signatures: string[] };
    expect(witness.signatures).toHaveLength(1);
    expect(() => ScriptPath.mergeSwapPackage(pkg, meltPreview as unknown as SwapPreview)).toThrow(
      /Cannot merge a melt package into a swap/,
    );
  });

  test('a melt package without its quote is rejected', () => {
    const { meltPreview, proof } = meltFixture();
    const pkg = ScriptPath.extractMeltPackage(meltPreview, [
      { secret: proof.secret, leafIndex: 1 },
    ]);
    const stripped = { ...pkg, quote: undefined, quoteAmount: undefined };
    expect(() =>
      ScriptPath.deserializePackage(ScriptPath.serializePackage(stripped as typeof pkg)),
    ).toThrow(/needs a quote and amount/);
  });
});

describe('ScriptPath.witnessFor', () => {
  test('builds the same witness shape merge produces', () => {
    const { alice, preview, proof } = fixture();
    const signed = ScriptPath.signPackage(
      ScriptPath.extractSwapPackage(preview, [{ secret: proof.secret, leafIndex: 1 }]),
      alice,
    );
    const witness = JSON.parse(
      ScriptPath.witnessFor(signed.spends[0], proof.spend_info!.tree!, 1),
    ) as { leaf: string; control: { K: string; path: string[] }; signatures: string[] };
    expect(witness.leaf).toBe(signed.spends[0].leaf);
    expect(witness.control).toEqual(signed.spends[0].control);
    expect(witness.signatures).toEqual(signed.spends[0].signatures);
  });
});
