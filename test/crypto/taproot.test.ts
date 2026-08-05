import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { numberToBytesBE } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes, bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { tagSchnorr } from '@scure/btc-signer/utils.js';
import { describe, test, expect } from 'vitest';

import { deriveP2BKBlindedPubkeyAtSlot } from '../../src/crypto/NUT28';
import {
  buildScriptPathWitness,
  buildTaprootSecret,
  deriveReceiverKeyedSecret,
  enumerateLeafKeySlots,
  recoverLeafKeySecretKeys,
  recoverReceiverKeyedSecretKey,
  type TaprootLeaf,
  TAPROOT_NUMS_KEY,
  verifyTaprootSpendInfo,
  taggedHash,
  tlvRecord,
  readTlvRecords,
  minimalBE,
  readMinimalBE,
  serializeTaprootLeaf,
  parseTaprootLeaf,
  taprootLeafHash,
  taprootBranchHash,
  taprootMerkleRoot,
  taprootMerklePath,
  taprootRootFromPath,
  taprootTweak,
  taprootTweakPubkey,
  taprootTweakSeckey,
  verifyTaprootCommitment,
  TAPROOT_LEAF_TAG,
  TAPROOT_BRANCH_TAG,
  TAPROOT_TWEAK_TAG,
} from '../../src/crypto/taproot';
import vectors from '../vectors/taproot-v3.json';

const v61 = vectors.example_6_1;
const v62 = vectors.example_6_2;

describe('tagged hashes', () => {
  test('match the @scure/btc-signer oracle for the Cashu tags', () => {
    const msg = utf8ToBytes('cross-check message');
    for (const tag of [TAPROOT_LEAF_TAG, TAPROOT_BRANCH_TAG, TAPROOT_TWEAK_TAG]) {
      expect(bytesToHex(taggedHash(tag, msg))).toBe(bytesToHex(tagSchnorr(tag, msg)));
    }
  });

  test('vector tags are the module tags', () => {
    expect(vectors.tags.leaf).toBe(TAPROOT_LEAF_TAG);
    expect(vectors.tags.branch).toBe(TAPROOT_BRANCH_TAG);
    expect(vectors.tags.tweak).toBe(TAPROOT_TWEAK_TAG);
  });
});

describe('TLV primitives', () => {
  test('record roundtrip and canonical stream rules', () => {
    const stream = new Uint8Array([
      ...tlvRecord(0x02, new Uint8Array([1])),
      ...tlvRecord(0x04, hexToBytes(v61.carol_pub)),
    ]);
    const records = readTlvRecords(stream, true);
    expect(records).toHaveLength(2);
    expect(records[0].type).toBe(0x02);
    expect(bytesToHex(records[1].value)).toBe(v61.carol_pub);
  });

  test('rejects descending and duplicate types in unique streams', () => {
    const descending = new Uint8Array([
      ...tlvRecord(0x04, new Uint8Array([1])),
      ...tlvRecord(0x02, new Uint8Array([1])),
    ]);
    expect(() => readTlvRecords(descending, true)).toThrow(/ascend/);
    const duplicate = new Uint8Array([
      ...tlvRecord(0x02, new Uint8Array([1])),
      ...tlvRecord(0x02, new Uint8Array([1])),
    ]);
    expect(() => readTlvRecords(duplicate, true)).toThrow(/ascend/);
  });

  test('rejects truncated records', () => {
    const rec = tlvRecord(0x02, new Uint8Array([1, 2, 3]));
    expect(() => readTlvRecords(rec.subarray(0, 2))).toThrow(/Truncated/);
    expect(() => readTlvRecords(rec.subarray(0, 5))).toThrow(/Truncated/);
  });

  test('minimal big-endian integers', () => {
    expect(minimalBE(0n)).toHaveLength(0);
    expect(bytesToHex(minimalBE(BigInt(v61.refund_time)))).toBe('68a3be80');
    expect(readMinimalBE(hexToBytes('68a3be80'))).toBe(BigInt(v61.refund_time));
    expect(() => readMinimalBE(new Uint8Array([0, 1]))).toThrow(/minimal/);
  });
});

describe('leaf serialization (vectors 6.1)', () => {
  test('after leaf serializes to the vector bytes', () => {
    const leaf = serializeTaprootLeaf({
      type: 'after',
      n: 1,
      keys: [v61.alice_refund_pub],
      time: v61.refund_time,
    });
    expect(bytesToHex(leaf)).toBe(v61.leaf_after);
  });

  test('after leaf parses back', () => {
    const parsed = parseTaprootLeaf(hexToBytes(v61.leaf_after));
    expect(parsed).toEqual({
      type: 'after',
      n: 1,
      keys: [v61.alice_refund_pub],
      time: v61.refund_time,
    });
  });

  test('leaf hash matches the vector root (single leaf tree)', () => {
    expect(bytesToHex(taprootLeafHash(hexToBytes(v61.leaf_after)))).toBe(v61.merkle_root);
  });
});

describe('leaf serialization (vectors 6.2)', () => {
  test('after leaf serializes to the vector bytes', () => {
    const after = serializeTaprootLeaf({
      type: 'after',
      n: 1,
      keys: [v62.kid_pub],
      time: v62.vest_time,
    });
    expect(bytesToHex(after)).toBe(v62.leaf_after);
  });

  test('leaf hashes match the vectors (melt_to leaf as opaque bytes)', () => {
    // The 6.2 melt_to covenant is a spec extensibility example, not an
    // implemented leaf type; its bytes still pin the tree and tweak math.
    expect(bytesToHex(taprootLeafHash(hexToBytes(v62.leaf_melt_to)))).toBe(v62.leaf_hash_melt_to);
    expect(bytesToHex(taprootLeafHash(hexToBytes(v62.leaf_after)))).toBe(v62.leaf_hash_after);
  });

  test('the example melt_to leaf type (0x04) is unknown and fails closed', () => {
    expect(() => parseTaprootLeaf(hexToBytes(v62.leaf_melt_to))).toThrow(/type/);
  });
});

describe('leaf parsing fails closed', () => {
  test('unknown leaf version', () => {
    const bytes = hexToBytes(v61.leaf_after);
    const bad = new Uint8Array(bytes);
    bad[0] = 0x01;
    expect(() => parseTaprootLeaf(bad)).toThrow(/version/);
  });

  test('unknown leaf type', () => {
    const bytes = hexToBytes(v61.leaf_after);
    const bad = new Uint8Array(bytes);
    bad[1] = 0x7f;
    expect(() => parseTaprootLeaf(bad)).toThrow(/type/);
  });

  test('unknown even field is a constraint and rejects', () => {
    const body = new Uint8Array([
      ...tlvRecord(0x02, new Uint8Array([1])),
      ...tlvRecord(0x04, hexToBytes(v61.carol_pub)),
      ...tlvRecord(0x0c, new Uint8Array([1])),
    ]);
    const leaf = new Uint8Array([0x00, 0x01, ...body]);
    expect(() => parseTaprootLeaf(leaf)).toThrow(/constraint/);
  });

  test('unknown odd field is an annotation and is ignored', () => {
    const body = new Uint8Array([
      ...tlvRecord(0x02, new Uint8Array([1])),
      ...tlvRecord(0x04, hexToBytes(v61.carol_pub)),
      ...tlvRecord(0x0d, utf8ToBytes('label')),
    ]);
    const leaf = new Uint8Array([0x00, 0x01, ...body]);
    expect(parseTaprootLeaf(leaf)).toEqual({ type: 'threshold', n: 1, keys: [v61.carol_pub] });
  });

  test('a key and its parity twin reject: one signature would satisfy both', () => {
    // Signatures verify against the x-only key, so listing both parities of one key would let an
    // n-of-m be satisfied by fewer signatures than it names.
    const key = v61.carol_pub;
    const twin = (key.startsWith('02') ? '03' : '02') + key.slice(2);
    const body = new Uint8Array([
      ...tlvRecord(0x02, new Uint8Array([2])),
      ...tlvRecord(0x04, new Uint8Array([...hexToBytes(key), ...hexToBytes(twin)])),
    ]);
    expect(() => parseTaprootLeaf(new Uint8Array([0x00, 0x01, ...body]))).toThrow(/distinct keys/);
  });

  test('keys length not a multiple of 33 rejects', () => {
    const body = new Uint8Array([
      ...tlvRecord(0x02, new Uint8Array([1])),
      ...tlvRecord(0x04, hexToBytes(v61.carol_pub).subarray(0, 32)),
    ]);
    expect(() => parseTaprootLeaf(new Uint8Array([0x00, 0x01, ...body]))).toThrow(/multiple of 33/);
  });
});

describe('merkle tree (vectors 6.2)', () => {
  test('two-leaf root matches, pair sorted', () => {
    const hMelt = hexToBytes(v62.leaf_hash_melt_to);
    const hAfter = hexToBytes(v62.leaf_hash_after);
    expect(bytesToHex(taprootBranchHash(hMelt, hAfter))).toBe(v62.merkle_root);
    expect(bytesToHex(taprootBranchHash(hAfter, hMelt))).toBe(v62.merkle_root);
    expect(bytesToHex(taprootMerkleRoot([hMelt, hAfter]))).toBe(v62.merkle_root);
  });

  test('merkle paths recompute the root', () => {
    const hMelt = hexToBytes(v62.leaf_hash_melt_to);
    const hAfter = hexToBytes(v62.leaf_hash_after);
    const leaves = [hMelt, hAfter];
    const pathMelt = taprootMerklePath(leaves, 0);
    expect(pathMelt.map(bytesToHex)).toEqual(v62.melt_witness.control.path);
    expect(bytesToHex(taprootRootFromPath(hMelt, pathMelt))).toBe(v62.merkle_root);
    const pathAfter = taprootMerklePath(leaves, 1);
    expect(pathAfter.map(bytesToHex)).toEqual(v62.after_witness_path);
    expect(bytesToHex(taprootRootFromPath(hAfter, pathAfter))).toBe(v62.merkle_root);
  });

  test('four leaves fold as the spec diagram and paths verify', () => {
    const hashes = [1, 2, 3, 4].map((i) => sha256(new Uint8Array([i])));
    const b12 = taprootBranchHash(hashes[0], hashes[1]);
    const b34 = taprootBranchHash(hashes[2], hashes[3]);
    const root = taprootBranchHash(b12, b34);
    expect(bytesToHex(taprootMerkleRoot(hashes))).toBe(bytesToHex(root));
    for (let i = 0; i < 4; i++) {
      const path = taprootMerklePath(hashes, i);
      expect(path).toHaveLength(2);
      expect(bytesToHex(taprootRootFromPath(hashes[i], path))).toBe(bytesToHex(root));
    }
  });

  test('three leaves: odd leaf promoted, single-sibling path', () => {
    const hashes = [1, 2, 3].map((i) => sha256(new Uint8Array([i])));
    const root = taprootBranchHash(taprootBranchHash(hashes[0], hashes[1]), hashes[2]);
    expect(bytesToHex(taprootMerkleRoot(hashes))).toBe(bytesToHex(root));
    const path = taprootMerklePath(hashes, 2);
    expect(path).toHaveLength(1);
    expect(bytesToHex(taprootRootFromPath(hashes[2], path))).toBe(bytesToHex(root));
  });
});

describe('tweak math (vectors)', () => {
  test('6.1 tweak and P', () => {
    const K = hexToBytes(v61.internal_key);
    const root = hexToBytes(v61.merkle_root);
    expect(taprootTweak(K, root).toString(16).padStart(64, '0')).toBe(v61.tweak);
    expect(bytesToHex(taprootTweakPubkey(K, root))).toBe(v61.secret);
  });

  test('6.2 tweak and P', () => {
    const K = hexToBytes(v62.internal_key);
    const root = hexToBytes(v62.merkle_root);
    expect(taprootTweak(K, root).toString(16).padStart(64, '0')).toBe(v62.tweak);
    expect(bytesToHex(taprootTweakPubkey(K, root))).toBe(v62.secret);
  });

  test('6.1 tweaked seckey lands on P and signs for it', () => {
    const carolFull =
      (BigInt('0x' + v61.carol_priv) + BigInt('0x' + v61.p2bk_r)) % secp256k1.Point.Fn.ORDER;
    const internalSeckey = carolFull.toString(16).padStart(64, '0');
    const pPrime = taprootTweakSeckey(hexToBytes(internalSeckey), hexToBytes(v61.merkle_root));
    expect(bytesToHex(pPrime)).toBe(v61.keypath_priv);
    expect(bytesToHex(secp256k1.getPublicKey(pPrime, true))).toBe(v61.secret);
    const sig = schnorr.sign(hexToBytes(v61.transcript_digest), pPrime, new Uint8Array(32));
    expect(bytesToHex(sig)).toBe(v61.keypath_signature);
    expect(
      schnorr.verify(sig, hexToBytes(v61.transcript_digest), hexToBytes(v61.secret).subarray(1)),
    ).toBe(true);
  });

  test('script-path witness signatures verify (vectors)', () => {
    const sig61 = hexToBytes(v61.scriptpath_witness.signatures[0]);
    expect(
      schnorr.verify(
        sig61,
        hexToBytes(v61.transcript_digest),
        hexToBytes(v61.alice_refund_pub).subarray(1),
      ),
    ).toBe(true);
    const sig62 = hexToBytes(v62.melt_witness.signatures[0]);
    expect(
      schnorr.verify(sig62, hexToBytes(v62.transcript_digest), hexToBytes(v62.kid_pub).subarray(1)),
    ).toBe(true);
  });
});

describe('script-path commitment verification', () => {
  test('6.1 single-leaf witness verifies', () => {
    expect(
      verifyTaprootCommitment(
        hexToBytes(v61.secret),
        hexToBytes(v61.scriptpath_witness.control.K),
        hexToBytes(v61.scriptpath_witness.leaf),
        v61.scriptpath_witness.control.path.map(hexToBytes),
      ),
    ).toBe(true);
  });

  test('6.2 melt witness verifies', () => {
    expect(
      verifyTaprootCommitment(
        hexToBytes(v62.secret),
        hexToBytes(v62.melt_witness.control.K),
        hexToBytes(v62.melt_witness.leaf),
        v62.melt_witness.control.path.map(hexToBytes),
      ),
    ).toBe(true);
  });

  test('wrong merkle path fails', () => {
    expect(
      verifyTaprootCommitment(
        hexToBytes(v62.secret),
        hexToBytes(v62.melt_witness.control.K),
        hexToBytes(v62.melt_witness.leaf),
        [hexToBytes(v62.leaf_hash_melt_to)],
      ),
    ).toBe(false);
  });

  test('wrong internal key fails', () => {
    expect(
      verifyTaprootCommitment(
        hexToBytes(v62.secret),
        hexToBytes(v61.internal_key),
        hexToBytes(v62.melt_witness.leaf),
        v62.melt_witness.control.path.map(hexToBytes),
      ),
    ).toBe(false);
  });

  test('path deeper than the depth cap throws', () => {
    const filler = sha256(new Uint8Array([9]));
    expect(() => taprootRootFromPath(filler, new Array(9).fill(filler) as Uint8Array[])).toThrow(
      /depth/,
    );
  });
});

describe('bearer contrast (vectors 6.1)', () => {
  test('bare secret is the untweaked pubkey of k', () => {
    expect(bytesToHex(secp256k1.getPublicKey(hexToBytes(v61.bearer_contrast.k), true))).toBe(
      v61.bearer_contrast.secret,
    );
  });
});

describe('locked secret construction and spend info cascade', () => {
  test('buildTaprootSecret reproduces the 6.1 locked secret', () => {
    const internalKey = v61.internal_key;
    const { secret, tree } = buildTaprootSecret(internalKey, [
      { type: 'after', n: 1, keys: [v61.alice_refund_pub], time: v61.refund_time },
    ]);
    expect(secret).toBe(v61.secret);
    expect(tree).toEqual([v61.leaf_after]);
  });

  test('buildScriptPathWitness reproduces the 6.1 witness shape', () => {
    const witness = JSON.parse(
      buildScriptPathWitness(
        [v61.leaf_after],
        0,
        v61.internal_key,
        v61.scriptpath_witness.signatures,
      ),
    ) as { leaf: string; control: { K: string; path: string[] }; signatures: string[] };
    expect(witness.leaf).toBe(v61.scriptpath_witness.leaf);
    expect(witness.control).toEqual(v61.scriptpath_witness.control);
    expect(witness.signatures).toEqual(v61.scriptpath_witness.signatures);
  });

  test('cascade: bare key, tweaked with k, tweaked with K', () => {
    const n13 = vectors.nut13_v3.outputs[0];
    expect(verifyTaprootSpendInfo(n13.secret, { k: n13.secret_key })).toBe('bare');
    // 6.1: k = (carol + r) mod n, tree discloses the after leaf.
    const carolFull = (
      (BigInt('0x' + v61.carol_priv) + BigInt('0x' + v61.p2bk_r)) %
      secp256k1.Point.Fn.ORDER
    )
      .toString(16)
      .padStart(64, '0');
    expect(verifyTaprootSpendInfo(v61.secret, { k: carolFull, tree: [v61.leaf_after] })).toBe(
      'tweaked',
    );
    // Script-only: explicit K.
    expect(
      verifyTaprootSpendInfo(v61.secret, { K: v61.internal_key, tree: [v61.leaf_after] }),
    ).toBe('tweaked');
  });

  test('cascade rejects spend info carrying both k and E', () => {
    // Spec 2.5.2: k and E are mutually exclusive, and both-at-once is the shape a re-gifted
    // receiver-keyed scalar takes, which hands the receiver's static key back to the sender.
    const n13 = vectors.nut13_v3.outputs[0];
    expect(() =>
      verifyTaprootSpendInfo(n13.secret, { k: n13.secret_key, E: v61.ephemeral_pub }),
    ).toThrow(/both k and E/);
  });

  test('cascade rejects partial disclosure, wrong keys, unknown leaves', () => {
    // Tree-only spend info: no key source.
    expect(() => verifyTaprootSpendInfo(v61.secret, { tree: [v61.leaf_after] })).toThrow(
      /incomplete/,
    );
    // Wrong bearer key.
    expect(() => verifyTaprootSpendInfo(v61.secret, { k: '11'.repeat(32) })).toThrow(/match/);
    // Partial (empty vs actual tree): bare check fails because the secret is tweaked.
    expect(() => verifyTaprootSpendInfo(v61.secret, { K: v61.internal_key, tree: [] })).toThrow(
      /incomplete/,
    );
    // Wrong tree does not reconstruct.
    expect(() =>
      verifyTaprootSpendInfo(v61.secret, { K: v61.internal_key, tree: [v62.leaf_after] }),
    ).toThrow(/reconstruct/);
    // 6.2 tree contains the unknown melt_to leaf: acceptance policy fails closed.
    expect(() =>
      verifyTaprootSpendInfo(v62.secret, {
        K: v62.internal_key,
        tree: [v62.leaf_melt_to, v62.leaf_after],
      }),
    ).toThrow(/type/);
  });

  test('NUMS key: script-only secret verifies and key is the BIP-341 H point', () => {
    expect(TAPROOT_NUMS_KEY.slice(0, 2)).toBe('02');
    const { secret, tree } = buildTaprootSecret(TAPROOT_NUMS_KEY, [
      { type: 'threshold', n: 1, keys: [v61.carol_pub] },
    ]);
    expect(verifyTaprootSpendInfo(secret, { K: TAPROOT_NUMS_KEY, tree })).toBe('tweaked');
  });
});

describe('receiver-keyed derivation (2.7, vectors 6.1)', () => {
  const eBytes = (() => {
    const b = new Uint8Array(32);
    b[31] = 5;
    return b;
  })();

  test('sender derivation reproduces the 6.1 locked secret, E and tree', () => {
    const out = deriveReceiverKeyedSecret(v61.carol_pub, {
      leaves: [{ type: 'after', n: 1, keys: [v61.alice_refund_pub], time: v61.refund_time }],
      eBytes,
    });
    expect(out.secret).toBe(v61.secret);
    expect(out.E).toBe(v61.ephemeral_pub);
    expect(out.tree).toEqual([v61.leaf_after]);
  });

  test('bare receiver-keyed secret is the internal key K', () => {
    const out = deriveReceiverKeyedSecret(v61.carol_pub, { eBytes });
    expect(out.secret).toBe(v61.internal_key);
    expect(out.tree).toBeUndefined();
  });

  test('trial-match recovers the pinned key-path key', () => {
    const hit = recoverReceiverKeyedSecretKey(v61.secret, v61.ephemeral_pub, v61.carol_priv, [
      v61.leaf_after,
    ]);
    expect(hit).toBeDefined();
    expect(hit?.secretKey).toBe(v61.keypath_priv);
    expect(hit?.internalKey).toBe(v61.internal_key);
    // Bare form matches too.
    const bare = recoverReceiverKeyedSecretKey(v61.internal_key, v61.ephemeral_pub, v61.carol_priv);
    expect(bare?.secretKey).toBeDefined();
    expect(bytesToHex(secp256k1.getPublicKey(hexToBytes(bare!.secretKey), true))).toBe(
      v61.internal_key,
    );
  });

  test('trial-match misses for a foreign static key', () => {
    expect(
      recoverReceiverKeyedSecretKey(v61.secret, v61.ephemeral_pub, v61.alice_refund_priv, [
        v61.leaf_after,
      ]),
    ).toBeUndefined();
  });

  test('cascade classifies E-carrying spend info as receiver-keyed', () => {
    expect(
      verifyTaprootSpendInfo(v61.secret, { E: v61.ephemeral_pub, tree: [v61.leaf_after] }),
    ).toBe('receiver-keyed');
    expect(() => verifyTaprootSpendInfo(v61.secret, { E: 'zz' })).toThrow(/ephemeral/);
  });
});

describe('leaf-key blinding: the positional slot map (2.7)', () => {
  const eBytes = hexToBytes(v61.ephemeral_priv);
  const carolPub = v61.carol_pub;
  const alicePub = v61.alice_refund_pub;
  // A third static key, to sit in a leaf beside the other two.
  const bobPriv = '0000000000000000000000000000000000000000000000000000000000000007';
  const bobPub = bytesToHex(secp256k1.getPublicKey(hexToBytes(bobPriv), true));

  test('slots number the base key 0, then leaves in order, keys within a leaf in order', () => {
    const slots = enumerateLeafKeySlots([
      { type: 'threshold', n: 2, keys: [carolPub, alicePub] },
      { type: 'after', n: 1, keys: [bobPub], time: v61.refund_time },
    ]);
    expect(slots.map((s) => s.slot)).toEqual([1, 2, 3]);
    expect(slots.map((s) => s.key)).toEqual([carolPub, alicePub, bobPub]);
    expect(slots.map((s) => [s.leafIndex, s.keyIndex])).toEqual([
      [0, 0],
      [0, 1],
      [1, 0],
    ]);
  });

  test('slot cap keeps the index inside one byte', () => {
    const keys = Array.from({ length: 254 }, (_, i) =>
      bytesToHex(secp256k1.getPublicKey(numberToBytesBE(BigInt(i + 2), 32), true)),
    );
    expect(enumerateLeafKeySlots([{ type: 'threshold', n: 1, keys }])).toHaveLength(254);
    expect(() =>
      enumerateLeafKeySlots([
        { type: 'threshold', n: 1, keys },
        { type: 'threshold', n: 1, keys: [carolPub] },
      ]),
    ).toThrow(/255 slots/);
  });

  test('sender blinds only the tagged keys, at their own slot', () => {
    const leaves: TaprootLeaf[] = [
      { type: 'threshold', n: 2, keys: [carolPub, alicePub] },
      { type: 'after', n: 1, keys: [bobPub], time: v61.refund_time },
    ];
    const verbatim = deriveReceiverKeyedSecret(carolPub, { leaves, eBytes });
    const blinded = deriveReceiverKeyedSecret(carolPub, { leaves, eBytes, blindKeys: [bobPub] });
    expect(blinded.E).toBe(verbatim.E);
    // Same slot 0, so the internal key is unchanged; the tree (hence the secret) is not.
    expect(blinded.tree).toHaveLength(2);
    expect(blinded.tree?.[0]).toBe(verbatim.tree?.[0]);
    expect(blinded.tree?.[1]).not.toBe(verbatim.tree?.[1]);
    expect(blinded.secret).not.toBe(verbatim.secret);
    // The blinded key is bob's key at slot 3, and the leaf is otherwise untouched.
    const leaf = parseTaprootLeaf(hexToBytes(blinded.tree![1]));
    expect(leaf.keys).toEqual([deriveP2BKBlindedPubkeyAtSlot(bobPub, eBytes, 3)]);
    expect(leaf.time).toBe(v61.refund_time);
    // The caller's leaves are not mutated.
    expect(leaves[1].keys).toEqual([bobPub]);
  });

  test('the same static key at two slots gets distinct tweaks', () => {
    const leaves: TaprootLeaf[] = [
      { type: 'threshold', n: 1, keys: [bobPub] },
      { type: 'after', n: 1, keys: [bobPub], time: v61.refund_time },
    ];
    const out = deriveReceiverKeyedSecret(carolPub, { leaves, eBytes, blindKeys: [bobPub] });
    const first = parseTaprootLeaf(hexToBytes(out.tree![0])).keys[0];
    const second = parseTaprootLeaf(hexToBytes(out.tree![1])).keys[0];
    expect(first).not.toBe(second);
    expect(first).not.toBe(bobPub);
    // Both are recovered, one per occurrence, each with its own key.
    const hits = recoverLeafKeySecretKeys(out.tree!, out.E, [bobPriv]);
    expect(hits.map((h) => h.slot)).toEqual([1, 2]);
    expect(hits[0].secretKey).not.toBe(hits[1].secretKey);
    for (const hit of hits) {
      expect(hit.blinded).toBe(true);
      const leafKey = parseTaprootLeaf(hexToBytes(out.tree![hit.leafIndex])).keys[hit.keyIndex];
      expect(bytesToHex(secp256k1.getPublicKey(hexToBytes(hit.secretKey), true))).toBe(leafKey);
    }
  });

  test('receiver walk resolves a tree mixing blinded and verbatim keys of two owners', () => {
    const leaves: TaprootLeaf[] = [
      { type: 'threshold', n: 2, keys: [carolPub, alicePub] },
      { type: 'after', n: 1, keys: [bobPub], time: v61.refund_time },
    ];
    const out = deriveReceiverKeyedSecret(carolPub, {
      leaves,
      eBytes,
      blindKeys: [bobPub, alicePub],
    });
    // Bob holds one blinded key; Alice holds the other; Carol's leaf key stayed verbatim.
    expect(recoverLeafKeySecretKeys(out.tree!, out.E, [bobPriv])).toEqual([
      { leafIndex: 1, keyIndex: 0, slot: 3, secretKey: expect.any(String), blinded: true },
    ]);
    expect(recoverLeafKeySecretKeys(out.tree!, out.E, [v61.alice_refund_priv])).toEqual([
      { leafIndex: 0, keyIndex: 1, slot: 2, secretKey: expect.any(String), blinded: true },
    ]);
    expect(recoverLeafKeySecretKeys(out.tree!, out.E, [v61.carol_priv])).toEqual([
      { leafIndex: 0, keyIndex: 0, slot: 1, secretKey: v61.carol_priv, blinded: false },
    ]);
    // All three at once, in slot order per key held.
    expect(
      recoverLeafKeySecretKeys(out.tree!, out.E, [v61.carol_priv, v61.alice_refund_priv, bobPriv])
        .length,
    ).toBe(3);
  });

  test('a stranger key matches nothing, and neither does the right key at the wrong slot', () => {
    const leaves: TaprootLeaf[] = [{ type: 'threshold', n: 1, keys: [bobPub] }];
    const out = deriveReceiverKeyedSecret(carolPub, { leaves, eBytes, blindKeys: [bobPub] });
    const strangerPriv = bytesToHex(secp256k1.utils.randomSecretKey());
    expect(recoverLeafKeySecretKeys(out.tree!, out.E, [strangerPriv])).toEqual([]);
    // Same key, wrong slot: the tweak is index-bound, so an off-by-one finds nothing.
    const shifted = buildTaprootSecret(v61.internal_key, [
      { type: 'threshold', n: 1, keys: [deriveP2BKBlindedPubkeyAtSlot(bobPub, eBytes, 2)] },
    ]).tree;
    expect(recoverLeafKeySecretKeys(shifted, out.E, [bobPriv])).toEqual([]);
    // Verbatim keys still resolve with no ephemeral in play.
    const plain = buildTaprootSecret(v61.internal_key, leaves).tree;
    expect(recoverLeafKeySecretKeys(plain, undefined, [bobPriv, strangerPriv])).toEqual([
      { leafIndex: 0, keyIndex: 0, slot: 1, secretKey: bobPriv, blinded: false },
    ]);
  });

  test('a blind-me key that is nowhere in the tree is an error, not a silent no-op', () => {
    expect(() =>
      deriveReceiverKeyedSecret(carolPub, {
        leaves: [{ type: 'threshold', n: 1, keys: [bobPub] }],
        eBytes,
        blindKeys: [alicePub],
      }),
    ).toThrow(/not in the tree/);
  });

  test('a blinded leaf key does not disturb key-path recovery for the base key', () => {
    const leaves: TaprootLeaf[] = [
      { type: 'after', n: 1, keys: [alicePub], time: v61.refund_time },
    ];
    const out = deriveReceiverKeyedSecret(carolPub, { leaves, eBytes, blindKeys: [alicePub] });
    const hit = recoverReceiverKeyedSecretKey(out.secret, out.E, v61.carol_priv, out.tree);
    expect(hit?.internalKey).toBe(v61.internal_key);
    expect(bytesToHex(secp256k1.getPublicKey(hexToBytes(hit!.secretKey), true))).toBe(out.secret);
  });
});
