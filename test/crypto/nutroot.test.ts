import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { numberToBytesBE } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes, bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { tagSchnorr } from '@scure/btc-signer/utils.js';
import { describe, test, expect } from 'vitest';

import { deriveP2BKBlindedPubkeyAtSlot } from '../../src/crypto/NUT28';
import {
  buildScriptPathWitness,
  buildNutrootSecret,
  countLeafSigners,
  deriveReceiverKeyedSecret,
  enumerateLeafKeySlots,
  recoverLeafKeySecretKeys,
  recoverReceiverKeyedSecretKey,
  type NutrootLeaf,
  NUTROOT_NUMS_KEY,
  NUTROOT_MAX_LEAF_TIME,
  NUTROOT_MAX_TREE_DEPTH,
  verifyNutrootSpendInfo,
  verifyNutrootRequestTree,
  taggedHash,
  tlvRecord,
  readTlvRecords,
  minimalBE,
  readMinimalBE,
  serializeNutrootLeaf,
  serializeNutrootLeafHex,
  numsOffsetKey,
  parseNutrootLeaf,
  selectLeafSignatures,
  parseNutrootLeafHex,
  nutrootLeafHash,
  nutrootBranchHash,
  nutrootMerkleRoot,
  nutrootMerklePath,
  nutrootRootFromPath,
  nutrootTweak,
  nutrootTweakPubkey,
  nutrootTweakSeckey,
  verifyNutrootCommitment,
  NUTROOT_LEAF_TAG,
  NUTROOT_BRANCH_TAG,
  NUTROOT_TWEAK_TAG,
} from '../../src/crypto/nutroot';
import vectors from '../vectors/nutroot-v3.json';

const v61 = vectors.example_6_1;
const v62 = vectors.example_6_2;

// The scalar an x-only (nostr) import may hold: n - d, whose pubkey is the negated point.
const negate = (priv: string) =>
  bytesToHex(numberToBytesBE(secp256k1.Point.Fn.ORDER - BigInt('0x' + priv), 32));

describe('tagged hashes', () => {
  test('match the @scure/btc-signer oracle for the Cashu tags', () => {
    const msg = utf8ToBytes('cross-check message');
    for (const tag of [NUTROOT_LEAF_TAG, NUTROOT_BRANCH_TAG, NUTROOT_TWEAK_TAG]) {
      expect(bytesToHex(taggedHash(tag, msg))).toBe(bytesToHex(tagSchnorr(tag, msg)));
    }
  });

  test('vector tags are the module tags', () => {
    expect(vectors.tags.leaf).toBe(NUTROOT_LEAF_TAG);
    expect(vectors.tags.branch).toBe(NUTROOT_BRANCH_TAG);
    expect(vectors.tags.tweak).toBe(NUTROOT_TWEAK_TAG);
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
    const leaf = serializeNutrootLeaf({
      type: 'after',
      n: 1,
      keys: [v61.alice_refund_pub],
      time: v61.refund_time,
    });
    expect(bytesToHex(leaf)).toBe(v61.leaf_after);
  });

  test('after leaf parses back', () => {
    const parsed = parseNutrootLeaf(hexToBytes(v61.leaf_after));
    expect(parsed).toEqual({
      type: 'after',
      n: 1,
      keys: [v61.alice_refund_pub],
      time: v61.refund_time,
    });
  });

  test('leaf hash matches the vector root (single leaf tree)', () => {
    expect(bytesToHex(nutrootLeafHash(hexToBytes(v61.leaf_after)))).toBe(v61.merkle_root);
  });

  test('hex wrappers round-trip the wire form', () => {
    const leaf = parseNutrootLeafHex(v61.leaf_after);
    expect(leaf).toEqual({
      type: 'after',
      n: 1,
      keys: [v61.alice_refund_pub],
      time: v61.refund_time,
    });
    expect(serializeNutrootLeafHex(leaf)).toBe(v61.leaf_after);
  });
});

describe('leaf serialization (vectors 6.2)', () => {
  test('after leaf serializes to the vector bytes', () => {
    const after = serializeNutrootLeaf({
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
    expect(bytesToHex(nutrootLeafHash(hexToBytes(v62.leaf_melt_to)))).toBe(v62.leaf_hash_melt_to);
    expect(bytesToHex(nutrootLeafHash(hexToBytes(v62.leaf_after)))).toBe(v62.leaf_hash_after);
  });

  test('the example melt_to leaf type (0x04) is unknown and fails closed', () => {
    expect(() => parseNutrootLeaf(hexToBytes(v62.leaf_melt_to))).toThrow(/type/);
  });
});

describe('leaf parsing fails closed', () => {
  test('unknown leaf version', () => {
    const bytes = hexToBytes(v61.leaf_after);
    const bad = new Uint8Array(bytes);
    bad[0] = 0x01;
    expect(() => parseNutrootLeaf(bad)).toThrow(/version/);
  });

  test('unknown leaf type', () => {
    const bytes = hexToBytes(v61.leaf_after);
    const bad = new Uint8Array(bytes);
    bad[1] = 0x7f;
    expect(() => parseNutrootLeaf(bad)).toThrow(/type/);
  });

  test('unknown even field rejects', () => {
    const body = new Uint8Array([
      ...tlvRecord(0x02, new Uint8Array([1])),
      ...tlvRecord(0x04, hexToBytes(v61.carol_pub)),
      ...tlvRecord(0x0c, new Uint8Array([1])),
    ]);
    const leaf = new Uint8Array([0x00, 0x01, ...body]);
    expect(() => parseNutrootLeaf(leaf)).toThrow(/field/);
  });

  test('unknown odd field rejects: odd types are reserved, not ignorable', () => {
    // The NUT-10 rejection vector (shared JSON): threshold_1of1_key3 with field 0x09 appended.
    const leaf = new Uint8Array([
      ...hexToBytes(vectors.leaf_forms.threshold_1of1),
      ...tlvRecord(0x09, hexToBytes('deadbeef')),
    ]);
    expect(bytesToHex(leaf)).toBe(vectors.leaf_forms.leaf_unknown_field);
    expect(() => parseNutrootLeaf(leaf)).toThrow(/field/);
  });

  test('the 1024-byte cap applies to the body, excluding the version byte', () => {
    const fields = new Uint8Array([
      ...tlvRecord(0x02, new Uint8Array([1])),
      ...tlvRecord(0x04, hexToBytes(v61.carol_pub)),
    ]);
    const atLimit = new Uint8Array([
      0x00,
      0x01,
      ...fields,
      ...tlvRecord(0x0d, new Uint8Array(1024 - 1 - fields.length - 3)),
    ]);
    expect(atLimit).toHaveLength(1025);
    // At the cap the length check passes and parsing reaches the padding field, which rejects as
    // unknown; one byte more and the length check itself fires first.
    expect(() => parseNutrootLeaf(atLimit)).toThrow(/Unknown leaf field/);

    const overLimit = new Uint8Array([
      0x00,
      0x01,
      ...fields,
      ...tlvRecord(0x0d, new Uint8Array(1024 - fields.length - 3)),
    ]);
    expect(() => parseNutrootLeaf(overLimit)).toThrow(/body exceeds/);

    // Bounded so both implementations read the same leaf: unbounded here means a leaf a mint
    // commits and spends that a wallet cannot parse, which strands the proof with its holder.
    const hugeTime = new Uint8Array([
      0x00,
      0x02,
      ...tlvRecord(0x02, new Uint8Array([1])),
      ...tlvRecord(0x04, hexToBytes(v61.carol_pub)),
      ...tlvRecord(0x06, hexToBytes('0fffffffffffffff')),
    ]);
    expect(() => parseNutrootLeaf(hugeTime)).toThrow(/time out of range/);
    expect(() =>
      serializeNutrootLeaf({
        type: 'after',
        n: 1,
        keys: [v61.carol_pub],
        time: NUTROOT_MAX_LEAF_TIME + 2,
      }),
    ).toThrow(/time out of range/);
  });

  test('known fields not defined for the selected leaf type reject', () => {
    const thresholdWithTime = new Uint8Array([
      0x00,
      0x01,
      ...tlvRecord(0x02, new Uint8Array([1])),
      ...tlvRecord(0x04, hexToBytes(v61.carol_pub)),
      ...tlvRecord(0x06, new Uint8Array([1])),
    ]);
    expect(() => parseNutrootLeaf(thresholdWithTime)).toThrow(/must not carry a time/);

    const afterWithHash = new Uint8Array([
      0x00,
      0x02,
      ...tlvRecord(0x02, new Uint8Array([1])),
      ...tlvRecord(0x04, hexToBytes(v61.carol_pub)),
      ...tlvRecord(0x06, new Uint8Array([1])),
      ...tlvRecord(0x08, new Uint8Array(32)),
    ]);
    expect(() => parseNutrootLeaf(afterWithHash)).toThrow(/must not carry a hash/);
    expect(() =>
      serializeNutrootLeaf({
        type: 'threshold',
        n: 1,
        keys: [v61.carol_pub],
        time: 1,
      }),
    ).toThrow(/must not carry a time/);
  });

  test('leaf keys must be actual compressed curve points', () => {
    const invalid = `02${'ff'.repeat(32)}`;
    const body = new Uint8Array([
      ...tlvRecord(0x02, new Uint8Array([1])),
      ...tlvRecord(0x04, hexToBytes(invalid)),
    ]);
    expect(() => parseNutrootLeaf(new Uint8Array([0x00, 0x01, ...body]))).toThrow(/valid/);
    expect(() => serializeNutrootLeaf({ type: 'threshold', n: 1, keys: [invalid] })).toThrow();
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
    expect(() => parseNutrootLeaf(new Uint8Array([0x00, 0x01, ...body]))).toThrow(/distinct keys/);
    expect(() => serializeNutrootLeaf({ type: 'threshold', n: 2, keys: [key, twin] })).toThrow(
      /distinct/,
    );
  });

  test('keys length not a multiple of 33 rejects', () => {
    const body = new Uint8Array([
      ...tlvRecord(0x02, new Uint8Array([1])),
      ...tlvRecord(0x04, hexToBytes(v61.carol_pub).subarray(0, 32)),
    ]);
    expect(() => parseNutrootLeaf(new Uint8Array([0x00, 0x01, ...body]))).toThrow(/multiple of 33/);
  });

  test('threshold cannot exceed the key count', () => {
    const body = new Uint8Array([
      ...tlvRecord(0x02, new Uint8Array([2])),
      ...tlvRecord(0x04, hexToBytes(v61.carol_pub)),
    ]);
    expect(() => parseNutrootLeaf(new Uint8Array([0x00, 0x01, ...body]))).toThrow(/key count/);
    expect(() => serializeNutrootLeaf({ type: 'threshold', n: 2, keys: [v61.carol_pub] })).toThrow(
      /key count/,
    );
  });
});

describe('merkle tree (vectors 6.2)', () => {
  test('two-leaf root matches, pair sorted', () => {
    const hMelt = hexToBytes(v62.leaf_hash_melt_to);
    const hAfter = hexToBytes(v62.leaf_hash_after);
    expect(bytesToHex(nutrootBranchHash(hMelt, hAfter))).toBe(v62.merkle_root);
    expect(bytesToHex(nutrootBranchHash(hAfter, hMelt))).toBe(v62.merkle_root);
    expect(bytesToHex(nutrootMerkleRoot([hMelt, hAfter]))).toBe(v62.merkle_root);
  });

  test('merkle paths recompute the root', () => {
    const hMelt = hexToBytes(v62.leaf_hash_melt_to);
    const hAfter = hexToBytes(v62.leaf_hash_after);
    const leaves = [hMelt, hAfter];
    const pathMelt = nutrootMerklePath(leaves, 0);
    expect(pathMelt.map(bytesToHex)).toEqual(v62.melt_witness.control.path);
    expect(bytesToHex(nutrootRootFromPath(hMelt, pathMelt))).toBe(v62.merkle_root);
    const pathAfter = nutrootMerklePath(leaves, 1);
    expect(pathAfter.map(bytesToHex)).toEqual(v62.after_witness_path);
    expect(bytesToHex(nutrootRootFromPath(hAfter, pathAfter))).toBe(v62.merkle_root);
  });

  test('four leaves fold as the spec diagram and paths verify', () => {
    const hashes = [1, 2, 3, 4].map((i) => sha256(new Uint8Array([i])));
    // The fold sorts, so build the expected tree over the sorted list.
    const sorted = [...hashes].sort((a, b) => (bytesToHex(a) < bytesToHex(b) ? -1 : 1));
    const b12 = nutrootBranchHash(sorted[0], sorted[1]);
    const b34 = nutrootBranchHash(sorted[2], sorted[3]);
    const root = nutrootBranchHash(b12, b34);
    expect(bytesToHex(nutrootMerkleRoot(hashes))).toBe(bytesToHex(root));
    for (let i = 0; i < 4; i++) {
      const path = nutrootMerklePath(hashes, i);
      expect(path).toHaveLength(2);
      expect(bytesToHex(nutrootRootFromPath(hashes[i], path))).toBe(bytesToHex(root));
    }
  });

  test('three leaves: odd leaf promoted, single-sibling path', () => {
    const hashes = [1, 2, 3].map((i) => sha256(new Uint8Array([i])));
    const sorted = [...hashes].sort((a, b) => (bytesToHex(a) < bytesToHex(b) ? -1 : 1));
    const root = nutrootBranchHash(nutrootBranchHash(sorted[0], sorted[1]), sorted[2]);
    expect(bytesToHex(nutrootMerkleRoot(hashes))).toBe(bytesToHex(root));
    // The promoted (last sorted) leaf has the single-sibling path.
    const promoted = hashes.findIndex((h) => h === sorted[2]);
    const path = nutrootMerklePath(hashes, promoted);
    expect(path).toHaveLength(1);
    expect(bytesToHex(nutrootRootFromPath(hashes[promoted], path))).toBe(bytesToHex(root));
  });

  test('the root is a function of the leaf set: every permutation folds identically', () => {
    // Before the sorted fold, a 3-leaf tree had three distinct roots across its six orders; a
    // wallet reordering leaves in storage broke its own proofs. Every permutation must now fold
    // to one root, with every path still verifying.
    const hashes = [1, 2, 3].map((i) => sha256(new Uint8Array([i])));
    const root = bytesToHex(nutrootMerkleRoot(hashes));
    const perms = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    for (const perm of perms) {
      const order = perm.map((i) => hashes[i]);
      expect(bytesToHex(nutrootMerkleRoot(order))).toBe(root);
      for (let i = 0; i < order.length; i++) {
        const path = nutrootMerklePath(order, i);
        expect(bytesToHex(nutrootRootFromPath(order[i], path))).toBe(root);
      }
    }
  });
});

describe('tweak math (vectors)', () => {
  test('6.1 tweak and P', () => {
    const K = hexToBytes(v61.internal_key);
    const root = hexToBytes(v61.merkle_root);
    expect(nutrootTweak(K, root).toString(16).padStart(64, '0')).toBe(v61.tweak);
    expect(bytesToHex(nutrootTweakPubkey(K, root))).toBe(v61.secret);
  });

  test('6.2 tweak and P', () => {
    const K = hexToBytes(v62.internal_key);
    const root = hexToBytes(v62.merkle_root);
    expect(nutrootTweak(K, root).toString(16).padStart(64, '0')).toBe(v62.tweak);
    expect(bytesToHex(nutrootTweakPubkey(K, root))).toBe(v62.secret);
  });

  test('6.1 tweaked seckey lands on P and signs for it', () => {
    const carolFull =
      (BigInt('0x' + v61.carol_priv) + BigInt('0x' + v61.p2bk_r)) % secp256k1.Point.Fn.ORDER;
    const internalSeckey = carolFull.toString(16).padStart(64, '0');
    const pPrime = nutrootTweakSeckey(hexToBytes(internalSeckey), hexToBytes(v61.merkle_root));
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
      verifyNutrootCommitment(
        hexToBytes(v61.secret),
        hexToBytes(v61.scriptpath_witness.control.K),
        hexToBytes(v61.scriptpath_witness.leaf),
        v61.scriptpath_witness.control.path.map(hexToBytes),
      ),
    ).toBe(true);
  });

  test('6.2 melt witness verifies', () => {
    expect(
      verifyNutrootCommitment(
        hexToBytes(v62.secret),
        hexToBytes(v62.melt_witness.control.K),
        hexToBytes(v62.melt_witness.leaf),
        v62.melt_witness.control.path.map(hexToBytes),
      ),
    ).toBe(true);
  });

  test('wrong merkle path fails', () => {
    expect(
      verifyNutrootCommitment(
        hexToBytes(v62.secret),
        hexToBytes(v62.melt_witness.control.K),
        hexToBytes(v62.melt_witness.leaf),
        [hexToBytes(v62.leaf_hash_melt_to)],
      ),
    ).toBe(false);
  });

  test('wrong internal key fails', () => {
    expect(
      verifyNutrootCommitment(
        hexToBytes(v62.secret),
        hexToBytes(v61.internal_key),
        hexToBytes(v62.melt_witness.leaf),
        v62.melt_witness.control.path.map(hexToBytes),
      ),
    ).toBe(false);
  });

  test('path deeper than the depth cap throws', () => {
    const filler = sha256(new Uint8Array([9]));
    expect(() => nutrootRootFromPath(filler, new Array(9).fill(filler) as Uint8Array[])).toThrow(
      /depth/,
    );
  });

  test('path hashes must be exactly 32 bytes', () => {
    const filler = sha256(new Uint8Array([9]));
    expect(() => nutrootRootFromPath(filler, [filler.subarray(1)])).toThrow(/32 bytes/);
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
  test('buildNutrootSecret reproduces the 6.1 locked secret', () => {
    const internalKey = v61.internal_key;
    const { secret, tree } = buildNutrootSecret(internalKey, [
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

  test('buildScriptPathWitness enforces the NUT-10 witness bounds', () => {
    const sig = v61.scriptpath_witness.signatures[0];
    // The 6.1 leaf lists one key: more signature entries than keys is a witness
    // every conforming mint rejects, so refuse to emit it.
    expect(() => buildScriptPathWitness([v61.leaf_after], 0, v61.internal_key, [sig, sig])).toThrow(
      /signature/,
    );
    // A preimage is at most 32 bytes.
    expect(() =>
      buildScriptPathWitness([v61.leaf_after], 0, v61.internal_key, [sig], 'ab'.repeat(33)),
    ).toThrow(/preimage/);
  });

  test('selectLeafSignatures keeps one valid signature per key, dropping duplicates and extras', () => {
    const digest = hexToBytes(v61.transcript_digest);
    const leaf: NutrootLeaf = {
      type: 'after',
      n: 1,
      keys: [v61.alice_refund_pub],
      time: v61.refund_time,
    };
    const valid = v61.scriptpath_witness.signatures[0];
    const garbage = '00'.repeat(64);
    expect(selectLeafSignatures(leaf, digest, [garbage, valid, valid])).toEqual([valid]);
    expect(selectLeafSignatures(leaf, digest, [garbage])).toEqual([]);
  });

  test('cascade: bare key, tweaked with k, tweaked with K', () => {
    const n13 = vectors.nut13_v3.outputs[0];
    expect(verifyNutrootSpendInfo(n13.secret, { k: n13.secret_key })).toBe('bare');
    // 6.1: k = (carol + r) mod n, tree discloses the after leaf.
    const carolFull = (
      (BigInt('0x' + v61.carol_priv) + BigInt('0x' + v61.p2bk_r)) %
      secp256k1.Point.Fn.ORDER
    )
      .toString(16)
      .padStart(64, '0');
    expect(verifyNutrootSpendInfo(v61.secret, { k: carolFull, tree: [v61.leaf_after] })).toBe(
      'tweaked',
    );
    // Script-only: explicit K.
    expect(
      verifyNutrootSpendInfo(v61.secret, { K: v61.internal_key, tree: [v61.leaf_after] }),
    ).toBe('tweaked');
  });

  test('cascade rejects spend info carrying both k and E', () => {
    // NUT-10: k and E are mutually exclusive, and both-at-once is the shape a re-gifted
    // receiver-keyed scalar takes, which hands the receiver's static key back to the sender.
    const n13 = vectors.nut13_v3.outputs[0];
    expect(() =>
      verifyNutrootSpendInfo(n13.secret, { k: n13.secret_key, E: v61.ephemeral_pub }),
    ).toThrow(/both k and E/);
  });

  test('cascade rejects a redundant K that disagrees with k', () => {
    const n13 = vectors.nut13_v3.outputs[0];
    expect(() =>
      verifyNutrootSpendInfo(n13.secret, {
        k: n13.secret_key,
        K: v61.alice_refund_pub,
      }),
    ).toThrow(/does not match/);
  });

  test('the empty tweak: an aggregated key with no tree (NUT-10)', () => {
    const v = vectors.empty_tweak;
    expect(bytesToHex(nutrootTweakPubkey(hexToBytes(v.internal_key)))).toBe(v.secret);
    expect(nutrootTweak(hexToBytes(v.internal_key)).toString(16).padStart(64, '0')).toBe(v.tweak);
    // 2.5.1 inserts this step between the bare and tweaked branches, so both the disclosed-key
    // and bearer-scalar forms must reach it: an aggregate has no single holder of the scalar,
    // but a single-party key may use the same form.
    expect(verifyNutrootSpendInfo(v.secret, { K: v.internal_key })).toBe('aggregated');
    expect(verifyNutrootSpendInfo(v.secret, { k: v61.carol_priv })).toBe('aggregated');
    // The key that signs it is (k + t) mod n, which is the tweak with no root.
    expect(bytesToHex(nutrootTweakSeckey(hexToBytes(v61.carol_priv)))).toBe(v.keypath_priv);
    // A bare key is still bare: the empty tweak is only reached when the plain check fails.
    expect(verifyNutrootSpendInfo(v61.carol_pub, { k: v61.carol_priv })).toBe('bare');
    // And a key that commits to neither is still refused.
    expect(() => verifyNutrootSpendInfo(v.secret, { K: v61.alice_refund_pub })).toThrow(
      /does not commit/,
    );
  });

  test('cascade rejects partial disclosure, wrong keys, unknown leaves', () => {
    // Tree-only spend info: no key source.
    expect(() => verifyNutrootSpendInfo(v61.secret, { tree: [v61.leaf_after] })).toThrow(
      /incomplete/,
    );
    // Wrong bearer key.
    expect(() => verifyNutrootSpendInfo(v61.secret, { k: '11'.repeat(32) })).toThrow(/match/);
    // Partial (empty vs actual tree): K alone would be complete only if the secret were its
    // empty tweak (NUT-10), and this secret is tweaked over a real tree instead.
    expect(() => verifyNutrootSpendInfo(v61.secret, { K: v61.internal_key, tree: [] })).toThrow(
      /does not commit/,
    );
    // Wrong tree does not reconstruct.
    expect(() =>
      verifyNutrootSpendInfo(v61.secret, { K: v61.internal_key, tree: [v62.leaf_after] }),
    ).toThrow(/reconstruct/);
    // 6.2 tree contains the unknown melt_to leaf: acceptance policy fails closed.
    expect(() =>
      verifyNutrootSpendInfo(v62.secret, {
        K: v62.internal_key,
        tree: [v62.leaf_melt_to, v62.leaf_after],
      }),
    ).toThrow(/type/);
  });

  test('receiver-keyed disclosure parses every leaf even without K', () => {
    expect(() =>
      verifyNutrootSpendInfo(v62.secret, {
        E: v61.ephemeral_pub,
        tree: [v62.leaf_melt_to, v62.leaf_after],
      }),
    ).toThrow(/type/);
  });

  test('slot cap is enforced when building and receiving a full tree', () => {
    const leaves: NutrootLeaf[] = Array.from({ length: 256 }, () => ({
      type: 'threshold',
      n: 1,
      keys: [v61.carol_pub],
    }));
    expect(() => buildNutrootSecret(v61.internal_key, leaves)).toThrow(/slots/);

    const tree = leaves.map((leaf) => bytesToHex(serializeNutrootLeaf(leaf)));
    const root = nutrootMerkleRoot(tree.map((leaf) => nutrootLeafHash(hexToBytes(leaf))));
    const secret = bytesToHex(nutrootTweakPubkey(hexToBytes(v61.internal_key), root));
    expect(() => verifyNutrootSpendInfo(secret, { K: v61.internal_key, tree })).toThrow(/slots/);
  });

  test('NUMS base: H is lift_x(SHA256(G uncompressed))', () => {
    expect(NUTROOT_NUMS_KEY.slice(0, 2)).toBe('02');
    const G = secp256k1.Point.BASE.toBytes(false);
    expect(NUTROOT_NUMS_KEY.slice(2)).toBe(bytesToHex(sha256(G)));
  });

  test('a script-only secret offsets H per proof and discloses r', () => {
    const leaves: NutrootLeaf[] = [{ type: 'threshold', n: 1, keys: [v61.carol_pub] }];
    const { secret, tree, K, u } = buildNutrootSecret(NUTROOT_NUMS_KEY, leaves);
    expect(u).toMatch(/^[0-9a-f]{64}$/);
    expect(K).not.toBe(NUTROOT_NUMS_KEY);
    // K - u*G == H: the offset is what proves there is no key path.
    expect(bytesToHex(numsOffsetKey(hexToBytes(u!)))).toBe(K);
    expect(verifyNutrootSpendInfo(secret, { K, u, tree })).toBe('tweaked');
    // Fresh r per proof, so the same tree yields a different secret every time.
    expect(buildNutrootSecret(NUTROOT_NUMS_KEY, leaves).secret).not.toBe(secret);
  });

  test('a claimed NUMS offset that does not reduce to H is refused', () => {
    const leaves: NutrootLeaf[] = [{ type: 'threshold', n: 1, keys: [v61.carol_pub] }];
    const { secret, tree, u } = buildNutrootSecret(NUTROOT_NUMS_KEY, leaves);
    // Same secret, but K claimed as an offset of something else.
    expect(() => verifyNutrootSpendInfo(secret, { K: v61.internal_key, u, tree })).toThrow(
      /not the claimed NUMS offset/,
    );
    expect(() => verifyNutrootSpendInfo(secret, { u, tree })).toThrow(/without its internal key/);
    expect(() => verifyNutrootSpendInfo(secret, { K: v61.internal_key, u: '00', tree })).toThrow(
      /32-byte scalar/,
    );
  });

  test('the NUMS base is not reachable as a verbatim internal key', () => {
    const leaves: NutrootLeaf[] = [{ type: 'threshold', n: 1, keys: [v61.carol_pub] }];
    const { K } = buildNutrootSecret(NUTROOT_NUMS_KEY, leaves);
    expect(K).not.toBe(NUTROOT_NUMS_KEY);
    // An offset only applies to the base; asking for one anywhere else is a mistake, not a no-op.
    expect(() =>
      buildNutrootSecret(v61.internal_key, leaves, { u: new Uint8Array(32).fill(1) }),
    ).toThrow(/only to the NUMS base/);
  });
});

describe('receiver-keyed derivation (NUT-28, vectors 6.1)', () => {
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

  test('a NUMS receiver key is offset per proof and needs no blinded leaf', () => {
    const leaves: NutrootLeaf[] = [
      { type: 'after', n: 1, keys: [v61.alice_refund_pub], time: v61.refund_time },
    ];
    // The NUMS base is offset, not ECDH-blinded (NUT-10): nobody holds its scalar for the
    // receiver's half of the DH. Uniqueness comes from u, so the tree travels unchanged, and with
    // nothing blinded there is no ephemeral at all (NUT-18).
    const out = deriveReceiverKeyedSecret(NUTROOT_NUMS_KEY, { leaves: [...leaves] });
    expect(out.E).toBeUndefined();
    expect(out.K).not.toBe(NUTROOT_NUMS_KEY);
    expect(bytesToHex(numsOffsetKey(hexToBytes(out.u!)))).toBe(out.K);
    expect(out.tree).toEqual([v61.leaf_after]);
    expect(verifyNutrootSpendInfo(out.secret, { K: out.K, u: out.u, tree: out.tree })).toBe(
      'tweaked',
    );
    // Same tree, different proof: u is what makes the secret fresh.
    const again = deriveReceiverKeyedSecret(NUTROOT_NUMS_KEY, { leaves: [...leaves] });
    expect(again.secret).not.toBe(out.secret);
    // Leaves are still required: with no key path, nothing else could spend the proof.
    expect(() => deriveReceiverKeyedSecret(NUTROOT_NUMS_KEY, { eBytes })).toThrow(
      /requires leaves/,
    );
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

  test('an odd-parity import of the static key still trial-matches (NUT-28)', () => {
    const negCarol = negate(v61.carol_priv);
    expect(
      recoverReceiverKeyedSecretKey(v61.secret, v61.ephemeral_pub, negCarol, [v61.leaf_after]),
    ).toEqual(
      recoverReceiverKeyedSecretKey(v61.secret, v61.ephemeral_pub, v61.carol_priv, [
        v61.leaf_after,
      ]),
    );
    const bare = recoverReceiverKeyedSecretKey(v61.internal_key, v61.ephemeral_pub, negCarol);
    expect(bare?.internalKey).toBe(v61.internal_key);
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
      verifyNutrootSpendInfo(v61.secret, { E: v61.ephemeral_pub, tree: [v61.leaf_after] }),
    ).toBe('receiver-keyed');
    expect(() => verifyNutrootSpendInfo(v61.secret, { E: 'zz' })).toThrow(/ephemeral/);
  });
});

describe('the leaf forms the worked examples never show', () => {
  const lf = vectors.leaf_forms;

  test('threshold and hashlock leaves serialize to the vector bytes', () => {
    expect(
      bytesToHex(serializeNutrootLeaf({ type: 'threshold', n: 1, keys: [v61.carol_pub] })),
    ).toBe(lf.threshold_1of1);
    expect(
      bytesToHex(
        serializeNutrootLeaf({
          type: 'threshold',
          n: 2,
          keys: [v61.carol_pub, v61.alice_refund_pub],
        }),
      ),
    ).toBe(lf.threshold_2of2);
    expect(
      bytesToHex(
        serializeNutrootLeaf({
          type: 'hashlock',
          n: 1,
          keys: [v61.carol_pub],
          hash: lf.hashlock_hash,
        }),
      ),
    ).toBe(lf.hashlock);
  });

  test('the odd-count fold: leaf 2 is promoted, so its path is one sibling', () => {
    const hashes = lf.three_leaf_tree.map((l) => nutrootLeafHash(hexToBytes(l)));
    expect(bytesToHex(nutrootMerkleRoot(hashes))).toBe(lf.three_leaf_root);
    expect(nutrootMerklePath(hashes, 2).map(bytesToHex)).toEqual(lf.three_leaf_path_index_2);
    // A promoted leaf still proves membership, which is what makes the fold shape safe to fix.
    expect(
      verifyNutrootCommitment(
        hexToBytes(lf.three_leaf_secret),
        hexToBytes(v61.internal_key),
        hexToBytes(lf.three_leaf_tree[2]),
        nutrootMerklePath(hashes, 2),
      ),
    ).toBe(true);
  });

  test('duplicate leaves fold without deduplication and stay spendable', () => {
    // NUT-10 duplicate-pair vector (shared JSON): the fold commits the leaf multiset.
    const [leaf] = lf.duplicate_pair_tree;
    expect(lf.duplicate_pair_tree).toEqual([lf.threshold_1of1, lf.threshold_1of1]);
    const h = nutrootLeafHash(hexToBytes(leaf));
    expect(bytesToHex(h)).toBe(lf.duplicate_pair_leaf_hash);
    const dupRoot = nutrootMerkleRoot([h, h]);
    expect(bytesToHex(dupRoot)).toBe(lf.duplicate_pair_root);
    expect(bytesToHex(dupRoot)).not.toBe(bytesToHex(nutrootMerkleRoot([h])));
    const K6 = lf.duplicate_pair_internal_key;
    const secret = lf.duplicate_pair_secret;
    for (const index of [0, 1]) {
      const path = nutrootMerklePath([h, h], index);
      expect(path.map(bytesToHex)).toEqual([bytesToHex(h)]);
      expect(
        verifyNutrootCommitment(hexToBytes(secret), hexToBytes(K6), hexToBytes(leaf), path),
      ).toBe(true);
    }
    // Receive-time reconstruction accepts the duplicated disclosure.
    expect(verifyNutrootSpendInfo(secret, { K: K6, tree: [leaf, leaf] })).toBe('tweaked');
    // Promotion, not self-pairing: appending a duplicate always moves the root.
    const h2 = nutrootLeafHash(hexToBytes(lf.three_leaf_tree[1]));
    const h3 = nutrootLeafHash(hexToBytes(lf.three_leaf_tree[2]));
    expect(bytesToHex(nutrootMerkleRoot([h, h2, h3]))).not.toBe(
      bytesToHex(nutrootMerkleRoot([h, h2, h3, h3])),
    );
  });

  test('the NUMS key is BIP-341 H, and a blinded slot-1 key matches', () => {
    expect(NUTROOT_NUMS_KEY).toBe(lf.nums_key);
    expect(
      deriveP2BKBlindedPubkeyAtSlot(lf.blind_slot1_key, hexToBytes(v61.ephemeral_priv), 1),
    ).toBe(lf.blind_slot1_result);
  });
});

describe('leaf-key blinding: the positional slot map (NUT-28)', () => {
  const eBytes = hexToBytes(v61.ephemeral_priv);
  const carolPub = v61.carol_pub;
  const alicePub = v61.alice_refund_pub;
  // A third static key, to sit in a leaf beside the other two.
  const bobPriv = '0000000000000000000000000000000000000000000000000000000000000007';
  const bobPub = bytesToHex(secp256k1.getPublicKey(hexToBytes(bobPriv), true));

  test('slots number the internal key 0, then leaves in order, keys within a leaf in order', () => {
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
    const keys = Array.from({ length: 255 }, (_, i) =>
      bytesToHex(secp256k1.getPublicKey(numberToBytesBE(BigInt(i + 2), 32), true)),
    );
    expect(enumerateLeafKeySlots([{ type: 'threshold', n: 1, keys }])).toHaveLength(255);
    expect(() =>
      enumerateLeafKeySlots([
        { type: 'threshold', n: 1, keys },
        { type: 'threshold', n: 1, keys: [carolPub] },
      ]),
    ).toThrow(/256 slots/);
  });

  test('sender blinds only the tagged keys, at their own slot', () => {
    const leaves: NutrootLeaf[] = [
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
    const leaf = parseNutrootLeaf(hexToBytes(blinded.tree![1]));
    expect(leaf.keys).toEqual([deriveP2BKBlindedPubkeyAtSlot(bobPub, eBytes, 3)]);
    expect(leaf.time).toBe(v61.refund_time);
    // The caller's leaves are not mutated.
    expect(leaves[1].keys).toEqual([bobPub]);
  });

  test('the same static key at two slots gets distinct tweaks', () => {
    const leaves: NutrootLeaf[] = [
      { type: 'threshold', n: 1, keys: [bobPub] },
      { type: 'after', n: 1, keys: [bobPub], time: v61.refund_time },
    ];
    const out = deriveReceiverKeyedSecret(carolPub, { leaves, eBytes, blindKeys: [bobPub] });
    const first = parseNutrootLeaf(hexToBytes(out.tree![0])).keys[0];
    const second = parseNutrootLeaf(hexToBytes(out.tree![1])).keys[0];
    expect(first).not.toBe(second);
    expect(first).not.toBe(bobPub);
    // Both are recovered, one per occurrence, each with its own key.
    const hits = recoverLeafKeySecretKeys(out.tree!, out.E, [bobPriv]);
    expect(hits.map((h) => h.slot)).toEqual([1, 2]);
    expect(hits[0].secretKey).not.toBe(hits[1].secretKey);
    for (const hit of hits) {
      expect(hit.blinded).toBe(true);
      const leafKey = parseNutrootLeaf(hexToBytes(out.tree![hit.leafIndex])).keys[hit.keyIndex];
      expect(bytesToHex(secp256k1.getPublicKey(hexToBytes(hit.secretKey), true))).toBe(leafKey);
    }
  });

  test('receiver walk resolves a tree mixing blinded and verbatim keys of two owners', () => {
    const leaves: NutrootLeaf[] = [
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
    const leaves: NutrootLeaf[] = [{ type: 'threshold', n: 1, keys: [bobPub] }];
    const out = deriveReceiverKeyedSecret(carolPub, { leaves, eBytes, blindKeys: [bobPub] });
    const strangerPriv = bytesToHex(secp256k1.utils.randomSecretKey());
    expect(recoverLeafKeySecretKeys(out.tree!, out.E, [strangerPriv])).toEqual([]);
    // Same key, wrong slot: the tweak is index-bound, so an off-by-one finds nothing.
    const shifted = buildNutrootSecret(v61.internal_key, [
      { type: 'threshold', n: 1, keys: [deriveP2BKBlindedPubkeyAtSlot(bobPub, eBytes, 2)] },
    ]).tree;
    expect(recoverLeafKeySecretKeys(shifted, out.E, [bobPriv])).toEqual([]);
    // Verbatim keys still resolve with no ephemeral in play.
    const plain = buildNutrootSecret(v61.internal_key, leaves).tree;
    expect(recoverLeafKeySecretKeys(plain, undefined, [bobPriv, strangerPriv])).toEqual([
      { leafIndex: 0, keyIndex: 0, slot: 1, secretKey: bobPriv, blinded: false },
    ]);
  });

  test('an odd-parity import matches blinded and verbatim leaf keys alike (NUT-28)', () => {
    const leaves: NutrootLeaf[] = [
      { type: 'threshold', n: 2, keys: [carolPub, alicePub] },
      { type: 'after', n: 1, keys: [bobPub], time: v61.refund_time },
    ];
    const out = deriveReceiverKeyedSecret(carolPub, { leaves, eBytes, blindKeys: [bobPub] });
    // Blinded (bob) and verbatim (carol) keys: the negated import yields the same hits.
    expect(recoverLeafKeySecretKeys(out.tree!, out.E, [negate(bobPriv)])).toEqual(
      recoverLeafKeySecretKeys(out.tree!, out.E, [bobPriv]),
    );
    expect(recoverLeafKeySecretKeys(out.tree!, out.E, [negate(v61.carol_priv)])).toEqual(
      recoverLeafKeySecretKeys(out.tree!, out.E, [v61.carol_priv]),
    );
    // A negated stranger is still a stranger.
    const strangerPriv = bytesToHex(secp256k1.utils.randomSecretKey());
    expect(recoverLeafKeySecretKeys(out.tree!, out.E, [negate(strangerPriv)])).toEqual([]);
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

  test('a blinded leaf key does not disturb key-path recovery for the internal key', () => {
    const leaves: NutrootLeaf[] = [
      { type: 'after', n: 1, keys: [alicePub], time: v61.refund_time },
    ];
    const out = deriveReceiverKeyedSecret(carolPub, { leaves, eBytes, blindKeys: [alicePub] });
    const hit = recoverReceiverKeyedSecretKey(out.secret, out.E!, v61.carol_priv, out.tree);
    expect(hit?.internalKey).toBe(v61.internal_key);
    expect(bytesToHex(secp256k1.getPublicKey(hexToBytes(hit!.secretKey), true))).toBe(out.secret);
  });
});

describe('tree caps are enforced on a disclosed tree, not only on a witness path', () => {
  const key = (i: number) =>
    bytesToHex(secp256k1.getPublicKey(hexToBytes(i.toString(16).padStart(64, '0')), true));

  test('a tree deeper than the cap has no usable script path, so it is refused', () => {
    // Past 2^8 leaves every merkle path is longer than a verifier accepts, so the fallbacks a
    // holder was told they had do not exist. NUT-10 makes the cap normative when verifying a
    // disclosed tree, not only when building one.
    const hashes = Array.from({ length: 2 ** NUTROOT_MAX_TREE_DEPTH }, (_, i) =>
      nutrootLeafHash(hexToBytes(i.toString(16).padStart(64, '0'))),
    );
    expect(() => nutrootMerkleRoot(hashes)).not.toThrow();
    expect(() => nutrootMerkleRoot([...hashes, hashes[0]])).toThrow(/depth/);
  });

  test('the slot cap keeps a build inside the depth cap', () => {
    const leaves: NutrootLeaf[] = Array.from({ length: 256 }, (_, i) => ({
      type: 'threshold' as const,
      n: 1,
      keys: [key(i + 1)],
    }));
    expect(() => buildNutrootSecret(NUTROOT_NUMS_KEY, leaves)).toThrow(/slots/);
    const ok = buildNutrootSecret(NUTROOT_NUMS_KEY, leaves.slice(0, 255));
    expect(
      nutrootMerklePath(
        ok.tree.map((leaf) => nutrootLeafHash(hexToBytes(leaf))),
        0,
      ).length,
    ).toBeLessThanOrEqual(NUTROOT_MAX_TREE_DEPTH);
  });
});

describe('leaf key recovery does not depend on the transmitted tree order', () => {
  const priv = (i: number) => i.toString(16).padStart(64, '0');
  const pub = (i: number) => bytesToHex(secp256k1.getPublicKey(hexToBytes(priv(i)), true));

  test('a reordered tree still resolves every blinded leaf key', () => {
    // The root commits the leaf set, not an arrangement: the fold sorts, so a reordered list
    // still reconstructs `P` and still passes the 2.5.1 completeness check. Slots are assigned by
    // walking the transmitted order, so matching a key by its position would put every blinded key
    // on the wrong slot and its owner would quietly lose the leaf. Match by value instead. Sorting
    // the transmitted list to assign slots is not an option: blinding rewrites the leaf bytes, so
    // a canonical order over them is only known after the slots it would decide have been assigned
    // (the fold's sort is over the leaf HASHES, after blinding, which is why it is not circular).
    const leaves: NutrootLeaf[] = [
      { type: 'threshold', n: 1, keys: [pub(3)] },
      { type: 'after', n: 1, keys: [pub(4)], time: 1755561600 },
      { type: 'hashlock', n: 1, keys: [pub(5)], hash: 'a1'.repeat(32) },
    ];
    const sent = deriveReceiverKeyedSecret(pub(9), {
      leaves,
      blindKeys: [pub(3), pub(4), pub(5)],
    });
    const tree = sent.tree as string[];
    // Reversing three leaves changes which leaves pair, so the old transmitted-order fold
    // produced a different root here: this is a permutation the sort has to absorb.
    const reordered = [...tree].reverse();

    // Both orders reconstruct the secret: the fold sorts, so order carries no meaning.
    expect(verifyNutrootSpendInfo(sent.secret, { E: sent.E, K: sent.K, tree })).toBe(
      'receiver-keyed',
    );
    expect(verifyNutrootSpendInfo(sent.secret, { E: sent.E, K: sent.K, tree: reordered })).toBe(
      'receiver-keyed',
    );

    for (const order of [tree, reordered]) {
      for (const i of [3, 4, 5]) {
        const hits = recoverLeafKeySecretKeys(order, sent.E, [priv(i)]);
        expect(hits).toHaveLength(1);
        expect(hits[0].blinded).toBe(true);
        // The recovered key is the one the leaf actually names, wherever it sits.
        const leaf = parseNutrootLeaf(hexToBytes(order[hits[0].leafIndex]));
        expect(bytesToHex(secp256k1.getPublicKey(hexToBytes(hits[0].secretKey), true))).toBe(
          leaf.keys[hits[0].keyIndex],
        );
      }
    }
  });

  test('a stranger still matches nothing, in either order', () => {
    const leaves: NutrootLeaf[] = [
      { type: 'threshold', n: 1, keys: [pub(3)] },
      { type: 'after', n: 1, keys: [pub(4)], time: 1755561600 },
    ];
    const sent = deriveReceiverKeyedSecret(pub(9), { leaves, blindKeys: [pub(3), pub(4)] });
    const tree = sent.tree as string[];
    expect(recoverLeafKeySecretKeys(tree, sent.E, [priv(7)])).toHaveLength(0);
    expect(recoverLeafKeySecretKeys([...tree].reverse(), sent.E, [priv(7)])).toHaveLength(0);
  });
});

describe('verifyNutrootRequestTree (NUT-18 exact match)', () => {
  const eBytes = numberToBytesBE(5n, 32);
  const reqLeaves: NutrootLeaf[] = [
    { type: 'after', n: 1, keys: [v61.alice_refund_pub], time: v61.refund_time },
    { type: 'threshold', n: 1, keys: [v61.carol_pub] },
  ];
  const option = { receiverPub: v61.carol_pub, leaves: reqLeaves, blindKeys: [v61.carol_pub] };
  const derive = () =>
    deriveReceiverKeyedSecret(v61.carol_pub, {
      leaves: reqLeaves,
      blindKeys: [v61.carol_pub],
      eBytes,
    });

  test('NUMS payment proofs reproduce the NUT-18 vectors', () => {
    // tests/18-tests.md "NUMS (leaves-only) request": leaf keyed to test key 4,
    // paid with ephemeral 5 / u = 7 (blind-me set), then with u = 9 and no blinding.
    const requestedLeaf =
      '00020200010104002102e493dbf1c10d80f3581e4904930b1404cc6c13900ee0758474fa94abe8c4cd1306000468a3be80';
    const blindedLeaf =
      '000202000101040021039ca57991c48db95252bff61e02c31cf9b1e9ec2ef27d9dee33db6f0324e6ca8106000468a3be80';
    const numsOption = {
      receiverPub: NUTROOT_NUMS_KEY,
      leaves: [parseNutrootLeafHex(requestedLeaf)],
      blindKeys: ['02e493dbf1c10d80f3581e4904930b1404cc6c13900ee0758474fa94abe8c4cd13'],
    };
    const blinded = buildNutrootSecret(NUTROOT_NUMS_KEY, [parseNutrootLeafHex(blindedLeaf)], {
      u: numberToBytesBE(7n, 32),
    });
    expect(blinded.secret).toBe(
      '02fb23814e330739413a6e3982a21916002962002bc101ac105a28e0cf3bcb46d1',
    );
    expect(blinded.K).toBe('028edfebd6fdea3e1d89359af20868a2e76315b36cdb1a79de497a1757ca7bd407');
    const siBlinded = {
      E: '022f8bde4d1a07209355b4a7250a5c5128e88b84bddc619ab7cba8d569b240efe4',
      K: blinded.K,
      u: blinded.u,
      tree: blinded.tree,
    };
    expect(() => verifyNutrootRequestTree(numsOption, siBlinded)).not.toThrow();
    expect(verifyNutrootSpendInfo(blinded.secret, siBlinded)).toBe('receiver-keyed');

    // Without the blind-me entry: verbatim leaf, no ephemeral travels.
    const plain = buildNutrootSecret(NUTROOT_NUMS_KEY, [parseNutrootLeafHex(requestedLeaf)], {
      u: numberToBytesBE(9n, 32),
    });
    expect(plain.secret).toBe('030b5dc180dd2ef76be0f0319fc5c254511fede8c8563a823d3b0fcd6f9012a0b2');
    expect(plain.K).toBe('03b948fab26606a34380c4515ece4c27d25fcf53eb95d1041630ab44f2be4f7331');
    const siPlain = { K: plain.K, u: plain.u, tree: plain.tree };
    expect(() =>
      verifyNutrootRequestTree({ ...numsOption, blindKeys: undefined }, siPlain),
    ).not.toThrow();
    expect(verifyNutrootSpendInfo(plain.secret, siPlain)).toBe('tweaked');
  });

  test('a faithful payment passes, in any leaf order', () => {
    const out = derive();
    const si = { E: out.E, K: out.K, tree: out.tree };
    expect(() => verifyNutrootRequestTree(option, si)).not.toThrow();
    expect(() =>
      verifyNutrootRequestTree(option, { ...si, tree: [...(out.tree as string[])].reverse() }),
    ).not.toThrow();
  });

  test('an appended or missing leaf rejects', () => {
    const out = derive();
    const extra = bytesToHex(
      serializeNutrootLeaf({ type: 'after', n: 1, keys: [v61.alice_refund_pub], time: 1 }),
    );
    const tree = out.tree as string[];
    expect(() =>
      verifyNutrootRequestTree(option, { E: out.E, K: out.K, tree: [...tree, extra] }),
    ).toThrow(/expected 2 leaves/);
    expect(() => verifyNutrootRequestTree(option, { E: out.E, K: out.K, tree: [tree[0]] })).toThrow(
      /expected 2 leaves/,
    );
  });

  test('a tree the payee never requested rejects', () => {
    const out = derive();
    expect(() =>
      verifyNutrootRequestTree(
        { receiverPub: v61.carol_pub },
        { E: out.E, K: out.K, tree: out.tree },
      ),
    ).toThrow(/none was requested/);
  });

  test('a verbatim key where blind-me was tagged rejects', () => {
    const out = deriveReceiverKeyedSecret(v61.carol_pub, { leaves: reqLeaves, eBytes });
    expect(() => verifyNutrootRequestTree(option, { E: out.E, K: out.K, tree: out.tree })).toThrow(
      /does not match/,
    );
  });

  test('bearer and absent spend info reject', () => {
    const out = derive();
    expect(() => verifyNutrootRequestTree(option, undefined)).toThrow(/no spend info/);
    expect(() => verifyNutrootRequestTree(option, { k: '11'.repeat(32), tree: out.tree })).toThrow(
      /bearer/,
    );
  });

  test('a NUMS request requires an internal key that reduces to H', () => {
    // No blind-me tag: the offset supplies uniqueness, the requested tree comes back unchanged,
    // and no ephemeral travels (NUT-18: E is present iff it blinded something).
    const numsOpt = { receiverPub: NUTROOT_NUMS_KEY, leaves: reqLeaves };
    const out = deriveReceiverKeyedSecret(NUTROOT_NUMS_KEY, { leaves: reqLeaves });
    expect(() =>
      verifyNutrootRequestTree(numsOpt, { K: out.K, u: out.u, tree: out.tree }),
    ).not.toThrow();
    // An ephemeral that blinded nothing is a signal the payee cannot act on.
    expect(() =>
      verifyNutrootRequestTree(numsOpt, {
        E: v61.ephemeral_pub,
        K: out.K,
        u: out.u,
        tree: out.tree,
      }),
    ).toThrow(/blinds nothing/);
    // K without its offset is just a point: the payee cannot tell a key path from none.
    expect(() => verifyNutrootRequestTree(numsOpt, { K: out.K, tree: out.tree })).toThrow(
      /requires the internal key and its offset/,
    );
    expect(() =>
      verifyNutrootRequestTree(numsOpt, {
        K: v61.internal_key,
        u: out.u,
        tree: out.tree,
      }),
    ).toThrow(/not the claimed NUMS offset/);
    // An offset where the request asked for a receiver-keyed send is a different lock entirely.
    expect(() =>
      verifyNutrootRequestTree(option, {
        E: v61.ephemeral_pub,
        K: out.K,
        u: out.u,
        tree: out.tree,
      }),
    ).toThrow(/NUMS offset on a receiver-keyed request/);
  });

  test('a NUMS request with blind-me keys keeps the ephemeral, both directions', () => {
    const numsOptB = {
      receiverPub: NUTROOT_NUMS_KEY,
      leaves: reqLeaves,
      blindKeys: [v61.alice_refund_pub],
    };
    const out = deriveReceiverKeyedSecret(NUTROOT_NUMS_KEY, {
      leaves: reqLeaves,
      blindKeys: [v61.alice_refund_pub],
      eBytes,
    });
    expect(out.E).toBeDefined();
    const si = { E: out.E, K: out.K, u: out.u, tree: out.tree };
    expect(() => verifyNutrootRequestTree(numsOptB, si)).not.toThrow();
    expect(() => verifyNutrootRequestTree(numsOptB, { ...si, E: undefined })).toThrow(
      /missing the ephemeral/,
    );
  });
});

describe('validation fails closed (constructor and verifier guards)', () => {
  const pubOf = (n: number) =>
    bytesToHex(secp256k1.getPublicKey(numberToBytesBE(BigInt(n), 32), true));
  const P1 = pubOf(11);
  const P2 = pubOf(12);
  const K1 = numberToBytesBE(11n, 32);
  const ORDER = secp256k1.Point.Fn.ORDER;

  test('tlvRecord rejects invalid types and oversized values', () => {
    expect(() => tlvRecord(-1, new Uint8Array(1))).toThrow(/Invalid TLV type/);
    expect(() => tlvRecord(256, new Uint8Array(1))).toThrow(/Invalid TLV type/);
    expect(() => tlvRecord(1.5, new Uint8Array(1))).toThrow(/Invalid TLV type/);
    expect(() => tlvRecord(1, new Uint8Array(0x10000))).toThrow(/too long/);
  });

  test('serializeNutrootLeaf rejects malformed leaves', () => {
    const base: NutrootLeaf = { type: 'threshold', n: 1, keys: [P1] };
    expect(() => serializeNutrootLeaf({ ...base, type: 'weird' as NutrootLeaf['type'] })).toThrow(
      /Unknown leaf type/,
    );
    expect(() => serializeNutrootLeaf({ ...base, n: 0 })).toThrow(/Invalid threshold/);
    expect(() => serializeNutrootLeaf({ ...base, n: 1.5 })).toThrow(/Invalid threshold/);
    expect(() => serializeNutrootLeaf({ ...base, n: 256 })).toThrow(/Invalid threshold/);
    expect(() => serializeNutrootLeaf({ ...base, keys: [] })).toThrow(/at least one key/);
    expect(() => serializeNutrootLeaf({ ...base, keys: ['aabb'] })).toThrow(/33 bytes/);
    expect(() => serializeNutrootLeaf({ type: 'after', n: 1, keys: [P1], time: -1 })).toThrow(
      /unix time/,
    );
    expect(() => serializeNutrootLeaf({ type: 'after', n: 1, keys: [P1], time: 1.5 })).toThrow(
      /unix time/,
    );
    expect(() =>
      serializeNutrootLeaf({ type: 'hashlock', n: 1, keys: [P1], hash: 'aabb' }),
    ).toThrow(/32-byte hash/);
    // A hash on a leaf type that has no hash semantics is a foreign field, not decoration.
    expect(() => serializeNutrootLeaf({ ...base, hash: '00'.repeat(32) })).toThrow(
      /must not carry a hash/,
    );
  });

  test('serializeNutrootLeaf enforces the 1024-byte body cap', () => {
    const keys = Array.from({ length: 31 }, (_, i) => pubOf(i + 1));
    expect(() => serializeNutrootLeaf({ type: 'threshold', n: 1, keys })).toThrow(/1024 bytes/);
  });

  test('parseNutrootLeaf rejects structurally broken bodies', () => {
    expect(() => parseNutrootLeaf(new Uint8Array([0x00]))).toThrow(/too short/);
    const body = (fields: Uint8Array[]) =>
      new Uint8Array([0x00, 0x01, ...fields.flatMap((f) => [...f])]);
    const nRec = tlvRecord(0x02, new Uint8Array([1]));
    const keysRec = tlvRecord(0x04, hexToBytes(P1));
    // n must be exactly one nonzero byte.
    expect(() => parseNutrootLeaf(body([tlvRecord(0x02, new Uint8Array([0])), keysRec]))).toThrow(
      /Invalid threshold/,
    );
    expect(() =>
      parseNutrootLeaf(body([tlvRecord(0x02, new Uint8Array([0, 1])), keysRec])),
    ).toThrow(/Invalid threshold/);
    expect(() => parseNutrootLeaf(body([nRec]))).toThrow(/missing required n or keys/);
    expect(() => parseNutrootLeaf(body([keysRec]))).toThrow(/missing required n or keys/);
    // after (0x02) without time; hashlock (0x03) without hash; hash of the wrong width.
    const afterBody = new Uint8Array([0x00, 0x02, ...nRec, ...keysRec]);
    expect(() => parseNutrootLeaf(afterBody)).toThrow(/missing time/);
    const hashlockBody = new Uint8Array([0x00, 0x03, ...nRec, ...keysRec]);
    expect(() => parseNutrootLeaf(hashlockBody)).toThrow(/missing hash/);
    const shortHash = tlvRecord(0x08, new Uint8Array(31));
    expect(() =>
      parseNutrootLeaf(new Uint8Array([0x00, 0x03, ...nRec, ...keysRec, ...shortHash])),
    ).toThrow(/32 bytes/);
  });

  test('merkle helpers reject empty trees and out-of-range indices', () => {
    expect(() => nutrootMerkleRoot([])).toThrow(/zero leaves/);
    const hashes = [nutrootLeafHash(serializeNutrootLeaf({ type: 'threshold', n: 1, keys: [P1] }))];
    expect(() => nutrootMerklePath(hashes, 1)).toThrow(/out of range/);
    expect(() => nutrootMerklePath(hashes, -1)).toThrow(/out of range/);
  });

  test('tweak functions validate their key material', () => {
    expect(() => nutrootTweakPubkey(new Uint8Array(32))).toThrow(/33 bytes/);
    expect(() => nutrootTweakSeckey(new Uint8Array(31))).toThrow(/32 bytes/);
    expect(() => nutrootTweakSeckey(new Uint8Array(32))).toThrow(/Invalid secret key/);
    expect(() => nutrootTweakSeckey(numberToBytesBE(ORDER, 32))).toThrow(/Invalid secret key/);
  });

  test('verifyNutrootCommitment requires a 33-byte secret', () => {
    expect(() =>
      verifyNutrootCommitment(new Uint8Array(32), hexToBytes(P1), new Uint8Array(2), []),
    ).toThrow(/33 bytes/);
  });

  test('numsOffsetKey requires a valid scalar', () => {
    expect(() => numsOffsetKey(new Uint8Array(32))).toThrow(/valid scalar/);
    expect(() => numsOffsetKey(numberToBytesBE(ORDER, 32))).toThrow(/valid scalar/);
  });

  test('buildNutrootSecret requires at least one leaf', () => {
    expect(() => buildNutrootSecret(P1, [])).toThrow(/at least one leaf/);
  });

  test('countLeafSigners counts distinct satisfied keys, skipping garbage signatures', () => {
    const leaf: NutrootLeaf = { type: 'threshold', n: 1, keys: [P1] };
    const digest = sha256(utf8ToBytes('digest'));
    const sig = bytesToHex(schnorr.sign(digest, K1));
    expect(countLeafSigners(leaf, digest, ['not-hex!', sig])).toBe(1);
    expect(countLeafSigners(leaf, digest, ['not-hex!'])).toBe(0);
  });

  test('verifyNutrootSpendInfo rejects malformed secrets and key material', () => {
    const built = buildNutrootSecret(P1, [{ type: 'threshold', n: 1, keys: [P2] }]);
    expect(() => verifyNutrootSpendInfo('zz', {})).toThrow();
    expect(() => verifyNutrootSpendInfo('00'.repeat(33), {})).toThrow(/not a 33-byte point/);
    expect(() => verifyNutrootSpendInfo(built.secret, { k: 'zz' })).toThrow(
      /not a valid private key/,
    );
    expect(() =>
      verifyNutrootSpendInfo(built.secret, { k: bytesToHex(K1), K: '00'.repeat(33) }),
    ).toThrow(/33-byte point/);
    // K alone must be 33 bytes before any reconstruction is attempted.
    expect(() => verifyNutrootSpendInfo(built.secret, { K: 'aabb', tree: built.tree })).toThrow(
      /33 bytes/,
    );
  });

  test('verifyNutrootSpendInfo checks a receiver-keyed disclosure reconstructs the secret', () => {
    const keyed = deriveReceiverKeyedSecret(P1, {
      leaves: [{ type: 'threshold', n: 1, keys: [P2] }],
    });
    // Faithful disclosure passes as receiver-keyed.
    expect(verifyNutrootSpendInfo(keyed.secret, { E: keyed.E, K: keyed.K, tree: keyed.tree })).toBe(
      'receiver-keyed',
    );
    // A substituted internal key no longer reconstructs the secret.
    expect(() =>
      verifyNutrootSpendInfo(keyed.secret, { E: keyed.E, K: P2, tree: keyed.tree }),
    ).toThrow(/does not reconstruct/);
    expect(() =>
      verifyNutrootSpendInfo(keyed.secret, { E: keyed.E, K: 'aabb', tree: keyed.tree }),
    ).toThrow(/33 bytes/);
  });

  test('verifyNutrootRequestTree rejects malformed ephemerals, offsets and phantom trees', () => {
    const keyed = deriveReceiverKeyedSecret(P1);
    expect(() => verifyNutrootRequestTree({ receiverPub: P1 }, { E: 'zz' })).toThrow(
      /33-byte point/,
    );
    expect(() =>
      verifyNutrootRequestTree({ receiverPub: NUTROOT_NUMS_KEY }, { K: NUTROOT_NUMS_KEY, u: 'zz' }),
    ).toThrow(/32-byte scalar/);
    // A tree disclosed on a request that asked for none is extra spend power.
    expect(() =>
      verifyNutrootRequestTree({ receiverPub: P1 }, { E: keyed.E, tree: ['00'.repeat(40)] }),
    ).toThrow(/none was requested/);
    // The bare faithful payment: nothing requested, nothing disclosed.
    expect(() => verifyNutrootRequestTree({ receiverPub: P1 }, { E: keyed.E })).not.toThrow();
  });

  test('recoverReceiverKeyedSecretKey returns undefined on undecodable inputs', () => {
    expect(recoverReceiverKeyedSecretKey(P1, 'zz', bytesToHex(K1))).toBeUndefined();
  });
});
