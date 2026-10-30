import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { describe, expect, test } from 'vitest';

import {
  buildNutrootSecret,
  deriveReceiverKeyedSecret,
  parseNutrootLeaf,
  serializeNutrootLeaf,
  serializeNutrootLeafHex,
  type NutrootLeaf,
  type NutrootConditionLeaf,
  nutrootLeafHash,
  nutrootMerklePath,
  nutrootMerkleRoot,
  nutrootTweakPubkey,
  readTlvRecords,
  tlvRecord,
  verifyNutrootCommitment,
} from '../../src/crypto/nutroot';
import { inputDigest, messageForPayload, transcriptContainers } from '../../src/crypto/transcript';
import { Amount } from '../../src/model/Amount';
import { OutputData } from '../../src/model/OutputData';
import { ScriptPath } from '../../src/model/ScriptPath';
import type { ScriptPathSigningPackage } from '../../src/model/ScriptPath';
import type { MintQuoteBaseResponse, Proof } from '../../src/model/types';
import { bytesToUtf8, decodeBase64UrlToUint8, encodeUint8ToBase64Url } from '../../src/utils';
import type {
  BatchMintPreview,
  MeltPreview,
  MintPreview,
  SwapPreview,
} from '../../src/wallet/types';
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
    const hashes = locked.tree!.map((leaf) => nutrootLeafHash(hexToBytes(leaf)));
    const revealed = {
      ...pkg,
      spends: [
        {
          ...pkg.spends[0],
          leaf: locked.tree![2],
          control: { K: locked.K!, path: nutrootMerklePath(hashes, 2).map(bytesToHex) },
          slots: undefined,
        },
      ],
    };
    expect(() => ScriptPath.signPackage(revealed, bytesToHex(sk(2)))).toThrow(/not a spend path/);
  });

  test('refuses to sign a leaf that is not committed by the input secret', () => {
    const { alice, leaves, preview, proof } = fixture();
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
    expect(() => ScriptPath.signPackage(tampered, alice)).toThrow(/does not commit/);
    expect(() => ScriptPath.deserializePackage(ScriptPath.serializePackage(tampered))).toThrow(
      /does not commit/,
    );
  });

  test('refuses a spend whose secret is not the input it names', () => {
    const { alice, leaves, preview, proof } = fixture();
    const otherLocked = deriveReceiverKeyedSecret(pub(4), {
      leaves,
      blindKeys: [pub(2)],
      eBytes: sk(6),
    });
    const other: Proof = {
      ...proof,
      secret: otherLocked.secret,
      spend_info: { E: otherLocked.E, K: otherLocked.K, tree: otherLocked.tree },
    };
    const both: SwapPreview = { ...preview, inputs: [other, proof] };
    const pkg = ScriptPath.extractSwapPackage(both, [{ secret: proof.secret, leafIndex: 1 }]);
    expect(pkg.spends[0].input).toBe(1);
    // The leaf opens to proof's secret, but the spend points at the other input.
    const moved = { ...pkg, spends: [{ ...pkg.spends[0], input: 0 }] };
    expect(() => ScriptPath.signPackage(moved, alice)).toThrow(/does not match its v3 input/);
  });

  test('a quote input spend must open the lock key its container commits', () => {
    const { alice, preview, proof } = fixture();
    const pkg = ScriptPath.extractSwapPackage(preview, [{ secret: proof.secret, leafIndex: 1 }]);
    // A quote locked to a nutroot point: the same tree as the proof, for brevity.
    const quoteSpend = (lockKey: string) => ({
      ...pkg,
      transcript: bytesToHex(
        messageForPayload({
          proofInputs: preview.inputs,
          mintQuoteInputs: [{ quoteId: 'quote-1', amount: 1, lockKey, issued: 0 }],
          blindedOutputs: preview.keepOutputs!.map((o) => o.blindedMessage),
        }),
      ),
      spends: [{ ...pkg.spends[0], input: 1 }],
    });
    const signed = ScriptPath.signPackage(quoteSpend(proof.secret), alice);
    const [leafKey] = (parseNutrootLeaf(hexToBytes(signed.spends[0].leaf)) as NutrootConditionLeaf)
      .keys;
    const [signature] = signed.spends[0].signatures;
    expect(
      schnorr.verify(hexToBytes(signature), spendDigest(signed), hexToBytes(leafKey).subarray(1)),
    ).toBe(true);
    expect(() => ScriptPath.signPackage(quoteSpend(pub(9)), alice)).toThrow(
      /not its quote input lock key/,
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

  test('the package carries the transcript and only the secrets it spends', () => {
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
      'control',
      'input',
      'leaf',
      'secret',
      'signatures',
      'slots',
    ]);
    expect(pkg.spends[0].input).toBe(1);
    expect(pkg.transcript).toBe(
      bytesToHex(
        messageForPayload({
          proofInputs: mixed.inputs,
          blindedOutputs: mixed.keepOutputs!.map((o) => o.blindedMessage),
        }),
      ),
    );
    const encoded = ScriptPath.serializePackage(pkg);
    const json = bytesToUtf8(decodeBase64UrlToUint8(encoded.slice(6)));
    expect(json).not.toContain(companion.secret);
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
    expect(JSON.parse(ScriptPath.witnessFor(signed.spends[0], built.tree, 0, preimage))).toEqual(
      witness,
    );
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
    const treeless: SwapPreview = { ...preview, inputs: [{ ...proof, spend_info: undefined }] };
    expect(() =>
      ScriptPath.extractSwapPackage(treeless, [{ secret: proof.secret, leafIndex: 0 }]),
    ).toThrow(/not disclosed/);
    const keyless: SwapPreview = {
      ...preview,
      inputs: [{ ...proof, spend_info: { E: proof.spend_info!.E, tree: proof.spend_info!.tree } }],
    };
    expect(() =>
      ScriptPath.extractSwapPackage(keyless, [{ secret: proof.secret, leafIndex: 0 }]),
    ).toThrow(/internal key/);
  });

  test('malformed spends and inputs fail closed at extract, sign and merge', () => {
    const { alice, preview, proof } = fixture();
    const tree = proof.spend_info!.tree!;
    const badBearer: SwapPreview = {
      ...preview,
      inputs: [{ ...proof, spend_info: { k: 'ff'.repeat(32), tree } }],
    };
    expect(() =>
      ScriptPath.extractSwapPackage(badBearer, [{ secret: proof.secret, leafIndex: 1 }]),
    ).toThrow(/not a valid private key/);
    const pkg = ScriptPath.extractSwapPackage(preview, [{ secret: proof.secret, leafIndex: 1 }]);
    expect(() =>
      ScriptPath.signPackage({ ...pkg, spends: [{ ...pkg.spends[0], secret: 'zz' }] }, alice),
    ).toThrow(/secret is malformed/);
    const signed = ScriptPath.signPackage(pkg, alice);
    // The input's spend info no longer discloses the leaf the package opens.
    const undisclosed: SwapPreview = {
      ...preview,
      inputs: [{ ...proof, spend_info: { ...proof.spend_info, tree: [tree[0]] } }],
    };
    expect(() => ScriptPath.mergeSwapPackage(signed, undisclosed)).toThrow(
      /not in its input proof spend info/,
    );
  });

  test.each([0x02, 0x03])('refuses a proof input missing field %i', (missing) => {
    const { alice, preview, proof } = fixture();
    const pkg = ScriptPath.extractSwapPackage(preview, [{ secret: proof.secret, leafIndex: 1 }]);
    const containers = transcriptContainers(hexToBytes(pkg.transcript));
    const input = containers[0];
    const fields = readTlvRecords(input.subarray(3))
      .filter(({ type }) => type !== missing)
      .map(({ type, value }) => tlvRecord(type, value));
    containers[0] = tlvRecord(input[0], concatBytes(...fields));
    const malformed = { ...pkg, transcript: bytesToHex(concatBytes(...containers)) };
    expect(() => ScriptPath.signPackage(malformed, alice)).toThrow(/does not match its v3 input/);
  });

  test('merge refuses a proof whose spend info is no longer available', () => {
    const { alice, preview, proof } = fixture();
    const pkg = ScriptPath.extractSwapPackage(preview, [{ secret: proof.secret, leafIndex: 1 }]);
    const signed = ScriptPath.signPackage(pkg, alice);
    const undisclosed: SwapPreview = {
      ...preview,
      inputs: [{ ...proof, spend_info: undefined }],
    };
    expect(() => ScriptPath.mergeSwapPackage(signed, undisclosed)).toThrow(
      /not in its input proof spend info/,
    );
  });

  test('merges when the proof discloses its tree in uppercase hex', () => {
    const { alice, preview, proof } = fixture();
    const upper: Proof = {
      ...proof,
      spend_info: {
        ...proof.spend_info,
        tree: proof.spend_info!.tree!.map((l) => l.toUpperCase()),
      },
    };
    const shouted: SwapPreview = { ...preview, inputs: [upper] };
    const pkg = ScriptPath.extractSwapPackage(shouted, [{ secret: proof.secret, leafIndex: 1 }]);
    const signed = ScriptPath.signPackage(pkg, alice);
    expect(ScriptPath.mergeSwapPackage(signed, shouted).inputs[0].witness).toBeDefined();
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
    expect(() => ScriptPath.deserializePackage(reserialize((p) => ({ ...p, spends: [] })))).toThrow(
      /Malformed/,
    );
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
          proofInputs: meltPreview.inputs,
          blindedOutputs: meltPreview.outputData.map((d) => d.blindedMessage),
          meltQuoteOutput: { quoteId: 'quote-1', amount },
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
    const witness = JSON.parse(
      ScriptPath.witnessFor(signed.spends[0], proof.spend_info!.tree!, 1),
    ) as {
      leaf: string;
      control: { K: string; path: string[] };
      signatures: string[];
    };
    expect(witness.leaf).toBe(signed.spends[0].leaf);
    expect(witness.control).toEqual(signed.spends[0].control);
    expect(witness.signatures).toEqual(signed.spends[0].signatures);
  });
});

describe('ScriptPath mint packages', () => {
  // A quote locked 2-of-2 by script path: its lock key commits to one threshold leaf under K.
  const tree = [serializeNutrootLeafHex({ type: 'threshold', n: 2, keys: [pub(2), pub(3)] })];
  const K = pub(9);
  const lockKey = bytesToHex(
    nutrootTweakPubkey(hexToBytes(K), nutrootMerkleRoot([nutrootLeafHash(hexToBytes(tree[0]))])),
  );
  const quote = (id: string, pubkey = lockKey) =>
    ({ quote: id, pubkey, amount_issued: Amount.from(3) }) as MintQuoteBaseResponse;
  const plan = { quote: 'q-1', tree, K, leafIndex: 0 };
  const mintPreview = (): MintPreview => ({
    method: 'bolt11',
    quote: quote('q-1'),
    outputData: [OutputData.createSingleRandomData(2, keysetId)],
  });

  test('a co-signed quote witness lands in the preview signature', () => {
    const preview = mintPreview();
    const pkg = ScriptPath.extractMintPackage(preview, [plan]);
    // The digest the wallet's own key path would sign: the quote input under this transcript.
    const expected = messageForPayload({
      mintQuoteInputs: [{ quoteId: 'q-1', amount: 2, lockKey, issued: 3 }],
      blindedOutputs: preview.outputData.map((d) => d.blindedMessage),
    });
    expect(pkg.transcript).toBe(bytesToHex(expected));
    const alice = ScriptPath.signPackage(pkg, bytesToHex(sk(2)));
    expect(() => ScriptPath.mergeMintPackage(alice, preview)).toThrow(/valid signatures/);
    const both = ScriptPath.signPackage(alice, bytesToHex(sk(3)));
    const merged = ScriptPath.mergeMintPackage(both, preview);
    const witness = JSON.parse(merged.signature!) as {
      leaf: string;
      control: { K: string; path: string[] };
      signatures: string[];
    };
    expect(witness.leaf).toBe(tree[0]);
    expect(
      verifyNutrootCommitment(
        hexToBytes(lockKey),
        hexToBytes(witness.control.K),
        hexToBytes(witness.leaf),
        witness.control.path.map((h) => hexToBytes(h)),
      ),
    ).toBe(true);
    const digest = spendDigest(both);
    for (const [i, key] of [pub(2), pub(3)].entries()) {
      expect(
        schnorr.verify(hexToBytes(witness.signatures[i]), digest, hexToBytes(key).subarray(1)),
      ).toBe(true);
    }
    // A co-signer's extra control fields never reach the mint request.
    const padded = {
      ...both,
      spends: [{ ...both.spends[0], control: { ...both.spends[0].control, extra: 'x' } }],
    };
    expect(
      Object.keys(JSON.parse(ScriptPath.mergeMintPackage(padded, preview).signature!).control),
    ).toEqual(['K', 'path']);
    // The package belongs to these outputs only.
    const moved = { ...preview, outputData: [OutputData.createSingleRandomData(2, keysetId)] };
    expect(() => ScriptPath.mergeMintPackage(both, moved)).toThrow(/does not match/);
  });

  test('a plan whose tree does not open the lock key is refused at extraction', () => {
    expect(() => ScriptPath.extractMintPackage(mintPreview(), [{ ...plan, K: pub(8) }])).toThrow();
    expect(() => ScriptPath.extractMintPackage(mintPreview(), [{ ...plan, quote: 'q-2' }])).toThrow(
      /not in this mint/,
    );
  });

  test('extraction refuses a mint the package could not describe', () => {
    expect(() => ScriptPath.extractMintPackage(mintPreview(), [])).toThrow(/at least one plan/);
    const unlocked = { ...mintPreview(), quote: { quote: 'q-1' } as MintQuoteBaseResponse };
    expect(() => ScriptPath.extractMintPackage(unlocked, [plan])).toThrow(/amount_issued/);
    const legacy = {
      ...mintPreview(),
      outputData: [OutputData.createSingleRandomData(2, '00bd033559de27d0')],
    };
    expect(() => ScriptPath.extractMintPackage(legacy, [plan])).toThrow(/v3 keyset/);
  });

  test('a hashlock quote takes its preimage from the plans at merge', () => {
    const preimage = `${'00'.repeat(31)}01`;
    const hashTree = [
      serializeNutrootLeafHex({
        type: 'hashlock',
        n: 1,
        keys: [pub(3)],
        hash: bytesToHex(sha256(hexToBytes(preimage))),
      }),
    ];
    const hashKey = bytesToHex(
      nutrootTweakPubkey(
        hexToBytes(K),
        nutrootMerkleRoot([nutrootLeafHash(hexToBytes(hashTree[0]))]),
      ),
    );
    const preview = { ...mintPreview(), quote: quote('q-1', hashKey) };
    const hashPlan = { ...plan, tree: hashTree, preimage };
    const signed = ScriptPath.signPackage(
      ScriptPath.extractMintPackage(preview, [hashPlan]),
      bytesToHex(sk(3)),
    );
    expect(() => ScriptPath.mergeMintPackage(signed, preview)).toThrow(/preimage/);
    expect(() =>
      ScriptPath.mergeMintPackage(signed, preview, [{ ...hashPlan, preimage: '01' }]),
    ).toThrow(/32 bytes/);
    const merged = ScriptPath.mergeMintPackage(signed, preview, [hashPlan]);
    expect(JSON.parse(merged.signature!).preimage).toBe(preimage);
  });

  test('a batch keeps its key-path signatures and fills the co-signed quote', () => {
    const preview: BatchMintPreview = {
      method: 'bolt11',
      quotes: [quote('q-0', pub(4)), quote('q-1')],
      amounts: [Amount.from(1), Amount.from(2)],
      outputData: [OutputData.createSingleRandomData(3, keysetId)],
      signatures: ['aa'.repeat(64), null],
    };
    const pkg = ScriptPath.extractMintPackage(preview, [plan]);
    expect(pkg.spends[0].input).toBe(1);
    const signed = ScriptPath.signPackage(
      ScriptPath.signPackage(pkg, bytesToHex(sk(2))),
      bytesToHex(sk(3)),
    );
    const merged = ScriptPath.mergeMintPackage(signed, preview);
    expect(merged.signatures![0]).toBe('aa'.repeat(64));
    expect(JSON.parse(merged.signatures![1]!).leaf).toBe(tree[0]);
    // A batch prepared with no key-path signatures gets null for the quotes the package skips.
    const unsigned = ScriptPath.mergeMintPackage(signed, { ...preview, signatures: undefined });
    expect(unsigned.signatures![0]).toBeNull();
  });
});

describe('ScriptPath transport vectors', () => {
  test('the shared nutspA vectors decode, and the signature covers the spend input digest', () => {
    const sp = vectors.signing_package;
    const key3 = vectors.commit_leaf.leaf_threshold.slice(-64);
    const unsigned = ScriptPath.deserializePackage(sp.package_string);
    expect(unsigned).toEqual(sp.package);
    expect(bytesToHex(spendDigest(unsigned))).toBe(sp.input_digest);
    const signed = ScriptPath.deserializePackage(sp.signed_string);
    const [signature] = signed.spends[0].signatures;
    expect(schnorr.verify(hexToBytes(signature), spendDigest(signed), hexToBytes(key3))).toBe(true);
    expect(signed.spends[0].signatures).toEqual(sp.witness.signatures);
    expect(ScriptPath.serializePackage(signed)).toBe(sp.signed_string);
  });
});
