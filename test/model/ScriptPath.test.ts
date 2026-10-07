import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { describe, expect, test } from 'vitest';

import {
  buildNutrootSecret,
  deriveReceiverKeyedSecret,
  parseNutrootLeaf,
  serializeNutrootLeaf,
  type NutrootLeaf,
  type NutrootConditionLeaf,
  nutrootLeafHash,
  nutrootMerklePath,
} from '../../src/crypto/nutroot';
import { inputDigest, messageForPayload, transcriptContainers } from '../../src/crypto/transcript';
import { Amount } from '../../src/model/Amount';
import { OutputData } from '../../src/model/OutputData';
import { ScriptPath } from '../../src/model/ScriptPath';
import type { ScriptPathSigningPackage } from '../../src/model/ScriptPath';
import type { Proof } from '../../src/model/types';
import { bytesToUtf8, decodeBase64UrlToUint8, encodeUint8ToBase64Url } from '../../src/utils';
import type { MeltPreview, SwapPreview } from '../../src/wallet/types';
import vectors from '../vectors/nutroot-v3.json';

const keysetId = `02${'11'.repeat(32)}`;
const sk = (n: number) => {
  const bytes = new Uint8Array(32);
  bytes[31] = n;
  return bytes;
};
const pub = (n: number) => bytesToHex(secp256k1.getPublicKey(sk(n), true));

// A spend's input digest, recomputed independently from the package transcript (NUT-10).
function spendDigest(pkg: ScriptPathSigningPackage, i = 0): Uint8Array {
  const transcript = hexToBytes(pkg.transcript);
  return inputDigest(sha256(transcript), transcriptContainers(transcript)[pkg.spends[i].input]);
}

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
    sendTotal: Amount.from(0),
    inputs: [proof],
    keepOutputs: [OutputData.createSingleRandomData(1, keysetId)],
  };
  return { alice, leaves, preview, proof };
}

function controlFor(proof: Proof, leafIndex: number) {
  const hashes = proof.spend_info!.tree!.map((leaf) => nutrootLeafHash(hexToBytes(leaf)));
  return {
    K: proof.spend_info!.K!,
    path: nutrootMerklePath(hashes, leafIndex).map((h) => bytesToHex(h)),
  };
}

// Without a usable slot hint, signPackage trial-derives every blinded slot for the signer's key
// (NUTROOT_MAX_SLOTS): tenths of a second locally, seconds on a shared CI runner. Tests that take
// that path get room beyond vitest's 5s default.
const SCAN_TIMEOUT = 30_000;

describe('ScriptPath signing packages', () => {
  test('signs a blinded key at its hinted absolute slot in a later leaf', () => {
    const { alice, preview, proof } = fixture();
    const pkg = ScriptPath.extractSwapPackage(preview, [{ secret: proof.secret, leafIndex: 1 }]);
    // Leaf 0 holds slot 1, so leaf 1's single key sits at slot 2.
    expect(pkg.spends[0].slots).toEqual([2]);
    expect(ScriptPath.signPackage(pkg, alice).spends[0].signatures).toHaveLength(1);
  });

  test('a wrong slot hint still signs through the full scan', { timeout: SCAN_TIMEOUT }, () => {
    const { alice, preview, proof } = fixture();
    const pkg = ScriptPath.extractSwapPackage(preview, [{ secret: proof.secret, leafIndex: 1 }]);
    const misled = { ...pkg, spends: [{ ...pkg.spends[0], slots: [7] }] };
    expect(ScriptPath.signPackage(misled, alice).spends[0].signatures).toHaveLength(1);
  });

  test('refuses a spend that reveals a commit leaf, even one that commits correctly', () => {
    const leaves: NutrootLeaf[] = [
      { type: 'threshold', n: 1, keys: [pub(3)] },
      { type: 'threshold', n: 1, keys: [pub(2)] },
      { type: 'commit', hash: '77'.repeat(32) },
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
      sendTotal: Amount.from(0),
      inputs: [proof],
      keepOutputs: [OutputData.createSingleRandomData(1, keysetId)],
    };
    const pkg = ScriptPath.extractSwapPackage(preview, [{ secret: proof.secret, leafIndex: 1 }]);
    const revealed = {
      ...pkg,
      spends: [{ ...pkg.spends[0], leaf: locked.tree![2], slots: undefined }],
    };
    expect(() => ScriptPath.signPackage(revealed, bytesToHex(sk(2)))).toThrow(/not a spend path/);
  });

  test('merge refuses a leaf that is not in the input spend info', () => {
    const { leaves, preview, proof } = fixture();
    const pkg = ScriptPath.extractSwapPackage(preview, [{ secret: proof.secret, leafIndex: 1 }]);
    const tampered = {
      ...pkg,
      spends: [
        {
          ...pkg.spends[0],
          leaf: bytesToHex(
            serializeNutrootLeaf({ ...(leaves[1] as NutrootConditionLeaf), keys: [pub(6)] }),
          ),
        },
      ],
    };
    expect(() => ScriptPath.mergeSwapPackage(tampered, preview)).toThrow(
      /not in its input proof spend info/,
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
    // The signature is BIP-340 by the leaf key over the spend's input digest (NUT-10).
    expect(
      schnorr.verify(
        hexToBytes(signed.spends[0].signatures[0]),
        spendDigest(pkg),
        hexToBytes(pub(3)).subarray(1),
      ),
    ).toBe(true);
  });

  test('signs a verbatim leaf key written with the opposite parity', () => {
    const opposite = bytesToHex(secp256k1.Point.fromHex(pub(3)).negate().toBytes(true));
    const built = deriveReceiverKeyedSecret(pub(4), {
      leaves: [{ type: 'threshold', n: 1, keys: [opposite] }],
      eBytes: sk(5),
    });
    const proof: Proof = {
      id: keysetId,
      amount: Amount.from(1),
      secret: built.secret,
      C: '11'.repeat(48),
      spend_info: { E: built.E, K: built.K, tree: built.tree },
    };
    const preview: SwapPreview = {
      amount: Amount.from(1),
      fees: Amount.from(0),
      sendTotal: Amount.from(0),
      inputs: [proof],
      keepOutputs: [OutputData.createSingleRandomData(1, keysetId)],
    };
    const pkg = ScriptPath.extractSwapPackage(preview, [{ secret: proof.secret, leafIndex: 0 }]);
    const signed = ScriptPath.signPackage(pkg, bytesToHex(sk(3)));
    expect(signed.spends[0].signatures).toHaveLength(1);
    // BIP-340 is x-only, so the signature must verify against the leaf key as written.
    expect(
      schnorr.verify(
        hexToBytes(signed.spends[0].signatures[0]),
        spendDigest(pkg),
        hexToBytes(opposite).subarray(1),
      ),
    ).toBe(true);
  });

  test('extracts a package when bearer k is the internal-key source', () => {
    const built = buildNutrootSecret(pub(4), [{ type: 'threshold', n: 1, keys: [pub(3)] }]);
    const proof: Proof = {
      id: keysetId,
      amount: Amount.from(1),
      secret: built.secret,
      C: '11'.repeat(48),
      spend_info: { k: bytesToHex(sk(4)), tree: built.tree },
    };
    const preview: SwapPreview = {
      amount: Amount.from(1),
      fees: Amount.from(0),
      sendTotal: Amount.from(0),
      inputs: [proof],
      keepOutputs: [OutputData.createSingleRandomData(1, keysetId)],
    };
    const pkg = ScriptPath.extractSwapPackage(preview, [{ secret: proof.secret, leafIndex: 0 }]);
    const signed = ScriptPath.signPackage(pkg, bytesToHex(sk(3)));
    expect(signed.spends[0].signatures).toHaveLength(1);
    // The merged witness takes K from the bearer key, as the control block needs.
    const merged = ScriptPath.mergeSwapPackage(signed, preview);
    const witness = JSON.parse(merged.inputs[0].witness as string) as { control: { K: string } };
    expect(witness.control.K).toBe(pub(4));
  });

  test('a point-shaped legacy secret cannot replace the v3 input digest', () => {
    const { preview, proof } = fixture();
    const legacy = { ...proof, id: `01${'22'.repeat(32)}` };
    const mixed = { ...preview, inputs: [proof, legacy] };
    const pkg = ScriptPath.extractSwapPackage(mixed, [{ secret: proof.secret, leafIndex: 0 }]);
    const signed = ScriptPath.signPackage(pkg, bytesToHex(sk(3)));
    const digest = spendDigest(pkg);
    expect(
      schnorr.verify(
        hexToBytes(signed.spends[0].signatures[0]),
        digest,
        hexToBytes(pub(3)).subarray(1),
      ),
    ).toBe(true);
  });

  test('the package carries the transcript and no secret', () => {
    const { preview, proof } = fixture();
    const companion: Proof = {
      id: `00${'22'.repeat(7)}`,
      amount: Amount.from(1),
      secret: 'companion-proof-secret',
      C: pub(8),
    };
    // The locked proof second, so its spend must name input 1.
    const mixed: SwapPreview = { ...preview, inputs: [companion, proof] };
    const pkg = ScriptPath.extractSwapPackage(mixed, [{ secret: proof.secret, leafIndex: 0 }]);
    expect(Object.keys(pkg).sort()).toEqual(['spends', 'transcript', 'version']);
    expect(Object.keys(pkg.spends[0]).sort()).toEqual([
      'E',
      'input',
      'leaf',
      'signatures',
      'slots',
    ]);
    expect(pkg.spends[0].input).toBe(1);
    expect(pkg.transcript).toBe(
      bytesToHex(
        messageForPayload({
          inputs: mixed.inputs,
          outputs: mixed.keepOutputs!.map((o) => o.blindedMessage),
        }),
      ),
    );
    const encoded = ScriptPath.serializePackage(pkg);
    const json = bytesToUtf8(decodeBase64UrlToUint8(encoded.slice(6)));
    for (const secret of [companion.secret, proof.secret, proof.spend_info!.K!]) {
      expect(json).not.toContain(secret);
    }
    // The signer derives its input digest from the transcript alone.
    const signed = ScriptPath.signPackage(
      ScriptPath.deserializePackage(encoded),
      bytesToHex(sk(3)),
    );
    expect(
      schnorr.verify(
        hexToBytes(signed.spends[0].signatures[0]),
        spendDigest(signed),
        hexToBytes(pub(3)).subarray(1),
      ),
    ).toBe(true);
    const merged = ScriptPath.mergeSwapPackage(signed, mixed);
    expect(merged.inputs[0]).toEqual(companion);
    expect(merged.inputs[1].witness).toBeDefined();
  });

  test('a hashlock preimage stays with the coordinator and is added at merge', () => {
    const preimage = `${'00'.repeat(31)}01`;
    const built = buildNutrootSecret(pub(4), [
      { type: 'hashlock', n: 1, keys: [pub(3)], hash: bytesToHex(sha256(hexToBytes(preimage))) },
    ]);
    const proof: Proof = {
      id: keysetId,
      amount: Amount.from(1),
      secret: built.secret,
      C: '11'.repeat(48),
      spend_info: { k: bytesToHex(sk(4)), tree: built.tree },
    };
    const preview: SwapPreview = {
      amount: Amount.from(1),
      fees: Amount.from(0),
      sendTotal: Amount.from(0),
      inputs: [proof],
      keepOutputs: [OutputData.createSingleRandomData(1, keysetId)],
    };
    const plans = [{ secret: proof.secret, leafIndex: 0, preimage }];
    const pkg = ScriptPath.extractSwapPackage(preview, plans);
    expect(pkg.spends[0]).not.toHaveProperty('preimage');
    expect(ScriptPath.serializePackage(pkg)).not.toContain(
      encodeUint8ToBase64Url(utf8ToBytes(preimage)),
    );
    const signed = ScriptPath.signPackage(pkg, bytesToHex(sk(3)));
    expect(() => ScriptPath.mergeSwapPackage(signed, preview)).toThrow(/preimage/);
    const merged = ScriptPath.mergeSwapPackage(signed, preview, plans);
    const witness = JSON.parse(merged.inputs[0].witness as string) as { preimage?: string };
    expect(witness.preimage).toBe(preimage);
    expect(JSON.parse(ScriptPath.witnessFor(signed.spends[0], proof, preimage))).toEqual(witness);
  });

  test('signing with a key the tree does not name adds nothing', { timeout: SCAN_TIMEOUT }, () => {
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
    expect(decoded).toEqual(pkg);
    // A signature added remotely survives the trip back.
    const signed = ScriptPath.signPackage(decoded, bytesToHex(sk(2)));
    expect(signed.spends[0].signatures).toHaveLength(1);
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
    const dupKeyPackage =
      'nutspA' + encodeUint8ToBase64Url(utf8ToBytes('{"version":"nutspA","version":"nutspA"}'));
    expect(() => ScriptPath.deserializePackage(dupKeyPackage)).toThrow(/parse/);
    const reserialize = (mangle: (p: typeof pkg) => unknown) =>
      ScriptPath.serializePackage(
        mangle({ ...pkg, spends: pkg.spends.map((s) => ({ ...s })) }) as typeof pkg,
      );
    expect(() =>
      ScriptPath.deserializePackage(reserialize((p) => ({ ...p, version: 'nutspB' }))),
    ).toThrow(/version/);
    expect(() =>
      ScriptPath.deserializePackage(reserialize((p) => ({ ...p, transcript: 'zz' }))),
    ).toThrow(/Malformed/);
    expect(() =>
      ScriptPath.deserializePackage(
        reserialize((p) => ({ ...p, transcript: p.transcript + '00' })),
      ),
    ).toThrow(/transcript is malformed/);
    // Index 1 is the blinded output's container, and 2 is past the end.
    for (const input of [1, 2, -1, 0.5, '0']) {
      expect(() =>
        ScriptPath.deserializePackage(
          reserialize((p) => ({ ...p, spends: [{ ...p.spends[0], input }] })),
        ),
      ).toThrow(/one unique transaction input/);
    }
    expect(() =>
      ScriptPath.deserializePackage(reserialize((p) => ({ ...p, spends: 'none' }))),
    ).toThrow(/Malformed/);
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
    for (const slots of [[], [1, 2], [0], [121], [1.5], 'x']) {
      expect(() =>
        ScriptPath.deserializePackage(
          reserialize((p) => ({ ...p, spends: [{ ...p.spends[0], slots }] })),
        ),
      ).toThrow(/slot hints/);
    }
  });

  test('merge refuses a package whose transaction moved, or another transaction', () => {
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
        quote: { quote: 'q1', amount: Amount.from(1) },
      }),
    ).toThrow(/does not match/);
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
    expect(witness.control).toEqual(controlFor(proof, 1));
    const leaf = parseNutrootLeaf(hexToBytes(witness.leaf)) as NutrootConditionLeaf;
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
      quote: { quote: 'quote-1', amount: Amount.from(1) },
    };
    return { alice, meltPreview, proof, swapPreview: preview };
  }

  test('the melt quote is part of the signed transcript', () => {
    const { meltPreview, swapPreview, proof } = meltFixture();
    const plans = [{ secret: proof.secret, leafIndex: 1 }];
    const melt = ScriptPath.extractMeltPackage(meltPreview, plans);
    // Same inputs and outputs; the melt quote container moves the transcript (NUT-10).
    expect(melt.transcript).not.toBe(ScriptPath.extractSwapPackage(swapPreview, plans).transcript);
    expect(melt.transcript).toContain(bytesToHex(utf8ToBytes('quote-1')));
  });

  test('the transcript carries the melt output amount: quote amount plus the selected fee reserve', () => {
    const { meltPreview, proof } = meltFixture();
    const plans = [{ secret: proof.secret, leafIndex: 1 }];
    const transcriptFor = (amount: bigint) =>
      bytesToHex(
        messageForPayload({
          inputs: meltPreview.inputs,
          outputs: meltPreview.outputData.map((d) => d.blindedMessage),
          meltQuote: { quoteId: 'quote-1', amount },
        }),
      );
    const bolt11 = { ...meltPreview, quote: { ...meltPreview.quote, fee_reserve: Amount.from(2) } };
    expect(ScriptPath.extractMeltPackage(bolt11, plans).transcript).toBe(transcriptFor(3n));
    const onchain = {
      ...meltPreview,
      quote: {
        ...meltPreview.quote,
        fee_options: [
          { fee_index: 0, fee_reserve: Amount.from(2) },
          { fee_index: 1, fee_reserve: Amount.from(50) },
        ],
      },
    };
    expect(ScriptPath.extractMeltPackage(onchain, plans, 1).transcript).toBe(transcriptFor(51n));
    expect(() => ScriptPath.extractMeltPackage(onchain, plans)).toThrow(/feeIndex/);
  });

  test('merge rebuilds the melt transcript with the same fee reserve', () => {
    const { alice, meltPreview, proof } = meltFixture();
    const plans = [{ secret: proof.secret, leafIndex: 1 }];
    const bolt11 = { ...meltPreview, quote: { ...meltPreview.quote, fee_reserve: Amount.from(2) } };
    const signed = ScriptPath.signPackage(ScriptPath.extractMeltPackage(bolt11, plans), alice);
    expect(ScriptPath.mergeMeltPackage(signed, bolt11).inputs[0].witness).toBeDefined();
    const onchain = {
      ...meltPreview,
      quote: {
        ...meltPreview.quote,
        fee_options: [{ fee_index: 1, fee_reserve: Amount.from(50) }],
      },
    };
    const onchainSigned = ScriptPath.signPackage(
      ScriptPath.extractMeltPackage(onchain, plans, 1),
      alice,
    );
    expect(
      ScriptPath.mergeMeltPackage(onchainSigned, onchain, plans, 1).inputs[0].witness,
    ).toBeDefined();
    expect(() => ScriptPath.mergeMeltPackage(onchainSigned, onchain, plans)).toThrow(/feeIndex/);
  });

  test('sign and merge complete a melt spend end to end', () => {
    const { alice, meltPreview, proof, swapPreview } = meltFixture();
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
    // Same inputs and outputs as the swap, but the melt quote is part of what was signed.
    expect(() => ScriptPath.mergeSwapPackage(pkg, swapPreview)).toThrow(/does not match/);
  });
});

describe('ScriptPath.witnessFor', () => {
  test('builds the same witness shape merge produces', () => {
    const { alice, preview, proof } = fixture();
    const signed = ScriptPath.signPackage(
      ScriptPath.extractSwapPackage(preview, [{ secret: proof.secret, leafIndex: 1 }]),
      alice,
    );
    const witness = JSON.parse(ScriptPath.witnessFor(signed.spends[0], proof)) as {
      leaf: string;
      control: { K: string; path: string[] };
      signatures: string[];
    };
    expect(witness.leaf).toBe(signed.spends[0].leaf);
    expect(witness.control).toEqual(controlFor(proof, 1));
    expect(witness.signatures).toEqual(signed.spends[0].signatures);
  });
});

describe('ScriptPath transport vectors', () => {
  test('the shared nutspA vectors decode, and the signature covers the spend input digest', () => {
    const { auditable_lock: lock, transport_strings: wire } = vectors;
    const unsigned = ScriptPath.deserializePackage(wire.signing_package);
    expect(unsigned.transcript).toBe(lock.transcript);
    expect(bytesToHex(spendDigest(unsigned))).toBe(lock.input_digest);
    const signed = ScriptPath.deserializePackage(wire.signing_package_signed);
    const [signature] = signed.spends[0].signatures;
    expect(
      schnorr.verify(hexToBytes(signature), spendDigest(signed), hexToBytes(lock.P).subarray(1)),
    ).toBe(true);
    expect(ScriptPath.serializePackage(signed)).toBe(wire.signing_package_signed);
  });
});
