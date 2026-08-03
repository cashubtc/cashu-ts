import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes, bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import { tagSchnorr } from '@scure/btc-signer/utils.js';
import { describe, test, expect } from 'vitest';

import {
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
  test('melt_to and after leaves serialize to the vector bytes', () => {
    const meltTo = serializeTaprootLeaf({
      type: 'melt_to',
      n: 1,
      keys: [v62.kid_pub],
      destination: v62.node_pub,
    });
    expect(bytesToHex(meltTo)).toBe(v62.leaf_melt_to);
    const after = serializeTaprootLeaf({
      type: 'after',
      n: 1,
      keys: [v62.kid_pub],
      time: v62.vest_time,
    });
    expect(bytesToHex(after)).toBe(v62.leaf_after);
  });

  test('leaf hashes match the vectors', () => {
    expect(bytesToHex(taprootLeafHash(hexToBytes(v62.leaf_melt_to)))).toBe(v62.leaf_hash_melt_to);
    expect(bytesToHex(taprootLeafHash(hexToBytes(v62.leaf_after)))).toBe(v62.leaf_hash_after);
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
