import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { numberToBytesBE } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

import { CTSError } from '../model/Errors';
import { Bytes } from '../utils';

import { getPubKeyFromPrivKey, pointFromBytes, pointFromHex } from './curve_secp';
import {
  deriveP2BKBlindedPubkeyAtSlot,
  deriveP2BKBlindedPubkeys,
  deriveP2BKSlotSecretKeyCandidates,
} from './NUT28';

/**
 * Nutroot secrets (v3 keysets) crypto core: tagged hashes, canonical TLV, leaf serialization,
 * merkle tree, and tweak math.
 *
 * @remarks
 * BIP341's commitment machinery with Cashu tags and compressed (not x-only) keys. Spec: NUT-10.
 */

export const NUTROOT_LEAF_TAG = 'Cashu_NutrootLeaf';
export const NUTROOT_BRANCH_TAG = 'Cashu_NutrootBranch';
export const NUTROOT_TWEAK_TAG = 'Cashu_NutrootTweak';

/**
 * Current leaf version for the declarative leaf family.
 */
export const NUTROOT_LEAF_VERSION = 0x00;

/**
 * Leaf type registry (version 0x00). A number means one thing forever.
 */
export const NUTROOT_LEAF_TYPE = {
  threshold: 0x01,
  after: 0x02,
  hashlock: 0x03,
} as const;

/**
 * Leaf body field types. Allocated types are even; odd types are reserved, unknown fails closed.
 */
const FIELD_N = 0x02;
const FIELD_KEYS = 0x04;
const FIELD_TIME = 0x06;
const FIELD_HASH = 0x08;

/**
 * Normative caps from NUT-10. The leaf body excludes the leading version byte.
 */
export const NUTROOT_MAX_LEAF_BYTES = 1024;
export const NUTROOT_MAX_TREE_DEPTH = 8;

/**
 * Largest unix time an `after` leaf may name (2^53 - 1).
 *
 * @remarks
 * The point where implementations built on IEEE-754 integers stop counting exactly. Bounded so
 * every implementation reads the same leaf: without it a leaf is valid at a mint and unparsable in
 * a wallet, which strands the proof with its holder.
 */
export const NUTROOT_MAX_LEAF_TIME = Number.MAX_SAFE_INTEGER;

/**
 * Enumerated blinding slots per secret (NUT-28): exactly one index byte.
 */
export const NUTROOT_MAX_SLOTS = 256;

/**
 * A parsed declarative leaf (version 0x00).
 *
 * @remarks
 * `keys` are 33-byte compressed SEC1 hex. `time` is unix seconds. `hash` is 32 bytes hex.
 */
export type NutrootLeaf = {
  type: keyof typeof NUTROOT_LEAF_TYPE;
  n: number;
  keys: string[];
  time?: number;
  hash?: string;
};

/**
 * The parsed working form of a wire `NutrootOption`: same option, leaves parsed.
 */
export type ParsedNutrootOption = {
  receiverKey: string;
  leaves?: NutrootLeaf[];
  blindKeys?: string[];
};

/**
 * BIP340-style tagged hash: `SHA256(SHA256(tag) || SHA256(tag) || messages)`.
 */
export function taggedHash(tag: string, ...messages: Uint8Array[]): Uint8Array {
  const tagHash = sha256(utf8ToBytes(tag));
  return sha256(Bytes.concat(tagHash, tagHash, ...messages));
}

/**
 * Encode one TLV record: type (1 byte) || length (2 bytes BE) || value.
 */
export function tlvRecord(type: number, value: Uint8Array): Uint8Array {
  if (!Number.isInteger(type) || type < 0 || type > 0xff) {
    throw new CTSError(`Invalid TLV type: ${type}`);
  }
  if (value.length > 0xffff) {
    throw new CTSError(`TLV value too long: ${value.length} bytes`);
  }
  const out = new Uint8Array(3 + value.length);
  out[0] = type;
  out[1] = (value.length >> 8) & 0xff;
  out[2] = value.length & 0xff;
  out.set(value, 3);
  return out;
}

/**
 * Decode a TLV stream into records.
 *
 * @remarks
 * Canonical rules enforced: no truncated records; when `uniqueAscending` is set (leaf field
 * streams) types must strictly ascend, which also forces uniqueness. Container streams
 * (transcripts) repeat types, so they decode with the flag off.
 */
export function readTlvRecords(
  data: Uint8Array,
  uniqueAscending = false,
): Array<{ type: number; value: Uint8Array }> {
  const records: Array<{ type: number; value: Uint8Array }> = [];
  let offset = 0;
  let prevType = -1;
  while (offset < data.length) {
    if (data.length - offset < 3) {
      throw new CTSError('Truncated TLV record header');
    }
    const type = data[offset];
    const length = (data[offset + 1] << 8) | data[offset + 2];
    offset += 3;
    if (data.length - offset < length) {
      throw new CTSError('Truncated TLV record value');
    }
    if (uniqueAscending && type <= prevType) {
      throw new CTSError('TLV types must strictly ascend');
    }
    prevType = type;
    records.push({ type, value: data.subarray(offset, offset + length) });
    offset += length;
  }
  return records;
}

/**
 * Minimal big-endian encoding of a non-negative integer. Zero encodes to zero bytes.
 */
export function minimalBE(value: bigint): Uint8Array {
  return Bytes.minimalBE(value);
}

/**
 * Decode a minimal big-endian integer; rejects leading zero bytes.
 */
export function readMinimalBE(bytes: Uint8Array): bigint {
  if (bytes.length > 0 && bytes[0] === 0) {
    throw new CTSError('Non-minimal integer encoding');
  }
  if (bytes.length === 0) return 0n;
  return Bytes.toBigInt(bytes);
}

/**
 * Serialize a leaf to its wire form: leaf_version || leaf_type || field TLVs.
 *
 * @remarks
 * The returned bytes are the leaf everywhere: spend info, witness, and hash preimage.
 */
export function serializeNutrootLeaf(leaf: NutrootLeaf): Uint8Array {
  const typeByte = NUTROOT_LEAF_TYPE[leaf.type];
  if (typeByte === undefined) {
    throw new CTSError(`Unknown leaf type: ${leaf.type}`);
  }
  if (!Number.isInteger(leaf.n) || leaf.n < 1 || leaf.n > 0xff) {
    throw new CTSError(`Invalid threshold n: ${leaf.n}`);
  }
  if (!Array.isArray(leaf.keys) || leaf.keys.length === 0) {
    throw new CTSError('Leaf requires at least one key');
  }
  const keyBytes = leaf.keys.map((k) => {
    const b = Bytes.fromHex(k);
    if (b.length !== 33) {
      throw new CTSError(`Leaf key must be 33 bytes, got ${b.length}`);
    }
    pointFromBytes(b);
    return b;
  });
  if (new Set(keyBytes.map((key) => Bytes.toHex(key).slice(2))).size !== keyBytes.length) {
    throw new CTSError('Leaf must list distinct keys');
  }
  if (leaf.n > keyBytes.length) {
    throw new CTSError('Threshold exceeds leaf key count');
  }
  const fields: Uint8Array[] = [
    tlvRecord(FIELD_N, new Uint8Array([leaf.n])),
    tlvRecord(FIELD_KEYS, Bytes.concat(...keyBytes)),
  ];
  if (leaf.type === 'after') {
    if (!Number.isInteger(leaf.time) || (leaf.time as number) < 0) {
      throw new CTSError('after leaf requires a unix time');
    }
    if ((leaf.time as number) > NUTROOT_MAX_LEAF_TIME) {
      throw new CTSError('time out of range');
    }
    fields.push(tlvRecord(FIELD_TIME, minimalBE(BigInt(leaf.time as number))));
  } else if (leaf.time !== undefined) {
    throw new CTSError(`${leaf.type} leaf must not carry a time field`);
  }
  if (leaf.type === 'hashlock') {
    const h = Bytes.fromHex(leaf.hash ?? '');
    if (h.length !== 32) {
      throw new CTSError('hashlock leaf requires a 32-byte hash');
    }
    fields.push(tlvRecord(FIELD_HASH, h));
  } else if (leaf.hash !== undefined) {
    throw new CTSError(`${leaf.type} leaf must not carry a hash field`);
  }
  const out = Bytes.concat(new Uint8Array([NUTROOT_LEAF_VERSION, typeByte]), ...fields);
  if (out.length - 1 > NUTROOT_MAX_LEAF_BYTES) {
    throw new CTSError(`Leaf body exceeds ${NUTROOT_MAX_LEAF_BYTES} bytes`);
  }
  return out;
}

/**
 * Parse a serialized leaf.
 *
 * @remarks
 * Fails closed: unknown leaf version, type or field, missing required fields, and non-canonical
 * streams all throw. Odd field types are reserved, so unknown rejects regardless of parity.
 */
export function parseNutrootLeaf(bytes: Uint8Array): NutrootLeaf {
  if (bytes.length < 2) {
    throw new CTSError('Leaf too short');
  }
  if (bytes.length - 1 > NUTROOT_MAX_LEAF_BYTES) {
    throw new CTSError(`Leaf body exceeds ${NUTROOT_MAX_LEAF_BYTES} bytes`);
  }
  if (bytes[0] !== NUTROOT_LEAF_VERSION) {
    throw new CTSError(`Unknown leaf version: ${bytes[0]}`);
  }
  const typeByte = bytes[1];
  const typeName = (Object.keys(NUTROOT_LEAF_TYPE) as Array<keyof typeof NUTROOT_LEAF_TYPE>).find(
    (k) => NUTROOT_LEAF_TYPE[k] === typeByte,
  );
  if (!typeName) {
    throw new CTSError(`Unknown leaf type: ${typeByte}`);
  }
  const records = readTlvRecords(bytes.subarray(2), true);
  let n: number | undefined;
  let keys: string[] | undefined;
  let time: number | undefined;
  let hash: string | undefined;
  for (const rec of records) {
    switch (rec.type) {
      case FIELD_N:
        if (rec.value.length !== 1 || rec.value[0] === 0) {
          throw new CTSError('Invalid threshold n');
        }
        n = rec.value[0];
        break;
      case FIELD_KEYS: {
        if (rec.value.length === 0 || rec.value.length % 33 !== 0) {
          throw new CTSError('keys field length must be a positive multiple of 33');
        }
        keys = [];
        for (let i = 0; i < rec.value.length; i += 33) {
          const key = rec.value.subarray(i, i + 33);
          try {
            pointFromBytes(key);
          } catch {
            throw new CTSError('Leaf key must be a valid compressed secp256k1 point');
          }
          keys.push(Bytes.toHex(key));
        }
        // Signatures verify against the x-only key, so two entries sharing an x coordinate are one
        // signer wearing two hats: a threshold counting them separately would be satisfied by
        // fewer signatures than it names.
        if (new Set(keys.map((k) => k.slice(2))).size !== keys.length) {
          throw new CTSError('keys field must list distinct keys');
        }
        break;
      }
      case FIELD_TIME: {
        const t = readMinimalBE(rec.value);
        if (t > BigInt(NUTROOT_MAX_LEAF_TIME)) {
          throw new CTSError('time out of range');
        }
        time = Number(t);
        break;
      }
      case FIELD_HASH:
        if (rec.value.length !== 32) {
          throw new CTSError('hash field must be 32 bytes');
        }
        hash = Bytes.toHex(rec.value);
        break;
      default:
        // Odd types are reserved, so an unknown field of either parity rejects.
        throw new CTSError(`Unknown leaf field: ${rec.type}`);
    }
  }
  if (n === undefined || keys === undefined) {
    throw new CTSError('Leaf missing required n or keys field');
  }
  if (n > keys.length) {
    throw new CTSError('Threshold exceeds leaf key count');
  }
  if (typeName === 'after' && time === undefined) {
    throw new CTSError('after leaf missing time field');
  }
  if (typeName === 'hashlock' && hash === undefined) {
    throw new CTSError('hashlock leaf missing hash field');
  }
  if (typeName !== 'after' && time !== undefined) {
    throw new CTSError(`${typeName} leaf must not carry a time field`);
  }
  if (typeName !== 'hashlock' && hash !== undefined) {
    throw new CTSError(`${typeName} leaf must not carry a hash field`);
  }
  const leaf: NutrootLeaf = { type: typeName, n, keys };
  if (time !== undefined) leaf.time = time;
  if (hash !== undefined) leaf.hash = hash;
  return leaf;
}

/**
 * Parse a hex-serialized leaf to its declarative form.
 */
export function parseNutrootLeafHex(leafHex: string): NutrootLeaf {
  return parseNutrootLeaf(Bytes.fromHex(leafHex));
}

/**
 * Serialize a leaf to its hex wire form, the shape spend info and payment requests carry.
 */
export function serializeNutrootLeafHex(leaf: NutrootLeaf): string {
  return Bytes.toHex(serializeNutrootLeaf(leaf));
}

/**
 * Hash a serialized leaf: `tagged_hash("Cashu_NutrootLeaf", leaf)`.
 */
export function nutrootLeafHash(serializedLeaf: Uint8Array): Uint8Array {
  return taggedHash(NUTROOT_LEAF_TAG, serializedLeaf);
}

/**
 * Hash a branch of two child hashes, sorted pair, no left/right flags.
 */
export function nutrootBranchHash(a: Uint8Array, b: Uint8Array): Uint8Array {
  const sorted = Bytes.compare(a, b) <= 0 ? [a, b] : [b, a];
  return taggedHash(NUTROOT_BRANCH_TAG, sorted[0], sorted[1]);
}

/**
 * Fold leaf hashes to a merkle root: sorted ascending, then pairwise per level, odd hash promoted.
 *
 * @remarks
 * The sort makes the root a function of the leaf set: any transmitted order reconstructs, so a
 * store or codec that does not preserve list order cannot invalidate a proof. Slot assignment (spec
 * 2.7) still walks the transmitted order; receivers match slot keys by value.
 *
 * Depth is a property of the tree, not of one leaf, so the cap is checked here and not only on a
 * witness path. A tree of more than `2^8` leaves is deeper than the cap, so its long paths cannot
 * be spent. A few of its leaves still can: the fold promotes an unpaired leaf to the next level,
 * and a leaf promoted often enough keeps a short path (at 300 leaves, 44 are within the cap). So an
 * oversized tree is part spendable and part not, and which part is which falls out of the fold
 * rather than out of anything the builder chose. Refuse the whole tree.
 *
 * The slot cap already makes such a tree unbuildable; this states the bound the spec names.
 */
export function nutrootMerkleRoot(leafHashes: Uint8Array[]): Uint8Array {
  if (leafHashes.length === 0) {
    throw new CTSError('Merkle root of zero leaves');
  }
  if (leafHashes.length > 2 ** NUTROOT_MAX_TREE_DEPTH) {
    throw new CTSError(`Tree exceeds depth ${NUTROOT_MAX_TREE_DEPTH}`);
  }
  let level = [...leafHashes].sort((a, b) => Bytes.compare(a, b));
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i + 1 < level.length; i += 2) {
      next.push(nutrootBranchHash(level[i], level[i + 1]));
    }
    if (level.length % 2 === 1) {
      next.push(level[level.length - 1]);
    }
    level = next;
  }
  return level[0];
}

/**
 * Merkle path for the leaf at `index` (an index into the transmitted list): sibling hashes on the
 * way up the sorted fold.
 */
export function nutrootMerklePath(leafHashes: Uint8Array[], index: number): Uint8Array[] {
  if (!Number.isInteger(index) || index < 0 || index >= leafHashes.length) {
    throw new CTSError(`Leaf index out of range: ${index}`);
  }
  const path: Uint8Array[] = [];
  let level = [...leafHashes].sort((a, b) => Bytes.compare(a, b));
  // Equal hashes are interchangeable under sorted-pair hashing, so first match is enough.
  let pos = level.findIndex((h) => Bytes.equals(h, leafHashes[index]));
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i + 1 < level.length; i += 2) {
      next.push(nutrootBranchHash(level[i], level[i + 1]));
    }
    const odd = level.length % 2 === 1;
    if (odd) {
      next.push(level[level.length - 1]);
    }
    if (odd && pos === level.length - 1) {
      // Promoted unpaired: no sibling at this level.
      pos = next.length - 1;
    } else {
      path.push(pos % 2 === 0 ? level[pos + 1] : level[pos - 1]);
      pos = Math.floor(pos / 2);
    }
    level = next;
  }
  return path;
}

/**
 * Recompute a root from a leaf hash and its merkle path.
 */
export function nutrootRootFromPath(leafHash: Uint8Array, path: Uint8Array[]): Uint8Array {
  if (path.length > NUTROOT_MAX_TREE_DEPTH) {
    throw new CTSError(`Merkle path exceeds depth ${NUTROOT_MAX_TREE_DEPTH}`);
  }
  if (leafHash.length !== 32 || path.some((sibling) => sibling.length !== 32)) {
    throw new CTSError('Merkle hashes must be 32 bytes');
  }
  return path.reduce((acc, sibling) => nutrootBranchHash(acc, sibling), leafHash);
}

/**
 * Nutroot tweak scalar: `tagged_hash("Cashu_NutrootTweak", K || root) mod n`.
 *
 * @remarks
 * Omit `root` for the empty tweak (aggregated keys, NUT-10): `tagged_hash(tag, K)`.
 */
export function nutrootTweak(internalKey: Uint8Array, merkleRoot?: Uint8Array): bigint {
  if (internalKey.length !== 33) {
    throw new CTSError('Internal key must be 33 bytes');
  }
  const digest = merkleRoot
    ? taggedHash(NUTROOT_TWEAK_TAG, internalKey, merkleRoot)
    : taggedHash(NUTROOT_TWEAK_TAG, internalKey);
  return Bytes.toBigInt(digest) % secp256k1.Point.Fn.ORDER;
}

/**
 * The v3 secret `P = K + t*G` as compressed SEC1 bytes.
 */
export function nutrootTweakPubkey(internalKey: Uint8Array, merkleRoot?: Uint8Array): Uint8Array {
  const t = nutrootTweak(internalKey, merkleRoot);
  const P = pointFromBytes(internalKey).add(secp256k1.Point.BASE.multiplyUnsafe(t));
  /* v8 ignore next 3 -- needs K = -t*G, cryptographically improbable */
  if (P.is0()) {
    throw new CTSError('Tweaked key at infinity');
  }
  return P.toBytes(true);
}

/**
 * Tweaked private key `p' = (k + t) mod n` for the key path.
 */
export function nutrootTweakSeckey(seckey: Uint8Array, merkleRoot?: Uint8Array): Uint8Array {
  if (seckey.length !== 32) {
    throw new CTSError('Secret key must be 32 bytes');
  }
  const k = Bytes.toBigInt(seckey);
  const order = secp256k1.Point.Fn.ORDER;
  if (k === 0n || k >= order) {
    throw new CTSError('Invalid secret key');
  }
  const K = secp256k1.Point.BASE.multiply(k).toBytes(true);
  const t = nutrootTweak(K, merkleRoot);
  const p = (k + t) % order;
  /* v8 ignore next 3 -- needs k = -t mod n, cryptographically improbable */
  if (p === 0n) {
    throw new CTSError('Tweaked secret key is zero');
  }
  return numberToBytesBE(p, 32);
}

/**
 * Verify a script-path commitment: leaf -> root (via path) -> tweak -> secret.
 *
 * @remarks
 * Commitment only; evaluating the revealed leaf's conditions is the caller's job.
 */
export function verifyNutrootCommitment(
  secret: Uint8Array,
  internalKey: Uint8Array,
  serializedLeaf: Uint8Array,
  merklePath: Uint8Array[],
): boolean {
  if (secret.length !== 33) {
    throw new CTSError('Secret must be 33 bytes');
  }
  const root = nutrootRootFromPath(nutrootLeafHash(serializedLeaf), merklePath);
  return Bytes.equals(nutrootTweakPubkey(internalKey, root), secret);
}

/**
 * NUMS base point `H` for script-only proofs: BIP-341's `H`, compressed.
 *
 * @remarks
 * Provably no known discrete log: `lift_x` of SHA-256 over G's **65-byte uncompressed** SEC1
 * encoding. Never used as an internal key verbatim, since that repeats across proofs; it is the
 * base of the per-proof offset `K = H + u*G` that `buildNutrootSecret` builds.
 */
export const NUTROOT_NUMS_KEY =
  '0250929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0';

/**
 * Offset the NUMS base by `u`: `K = H + u*G` (NUT-10).
 *
 * @remarks
 * `u` is not the blinding factor `r`: it travels in spend info and is public.
 * @throws If `u` is not a 32-byte scalar in `[1, n-1]`.
 */
export function numsOffsetKey(u: Uint8Array): Uint8Array {
  if (u.length !== 32) {
    throw new CTSError('NUMS offset must be 32 bytes');
  }
  const x = Bytes.toBigInt(u);
  if (x === 0n || x >= secp256k1.Point.Fn.ORDER) {
    throw new CTSError('NUMS offset is not a valid scalar');
  }
  return pointFromHex(NUTROOT_NUMS_KEY).add(secp256k1.Point.BASE.multiply(x)).toBytes(true);
}

/**
 * Build a locked v3 secret: `P = K + tagged_hash(K || root)*G` over the leaves' tree.
 *
 * @remarks
 * Passing {@link NUTROOT_NUMS_KEY} builds a script-only secret, offsetting it by a fresh `u` (spec
 * 2.3.5) so the internal key is unique per proof while nobody holds its scalar. `u` is returned for
 * disclosure in spend info; there is no way to ask for the base verbatim, because a repeated NUMS
 * key repeats the secret whenever the tree does.
 * @param opts.r - The NUMS offset to use rather than a random one, for a seed-derived proof (NUT-13
 *   type `0x02`). Only meaningful for a NUMS internal key.
 * @returns The 33-byte secret hex, the serialized tree (spend_info order), the internal key `K`,
 *   and `u` when `K` is a NUMS offset.
 */
export function buildNutrootSecret(
  internalKeyHex: string,
  leaves: NutrootLeaf[],
  opts?: { u?: Uint8Array },
): { secret: string; tree: string[]; K: string; u?: string } {
  if (leaves.length === 0) {
    throw new CTSError('A locked secret requires at least one leaf');
  }
  const isNums = internalKeyHex.toLowerCase() === NUTROOT_NUMS_KEY;
  if (opts?.u !== undefined && !isNums) {
    throw new CTSError('A NUMS offset applies only to the NUMS base key');
  }
  const u = isNums ? (opts?.u ?? secp256k1.utils.randomSecretKey()) : undefined;
  const internalKey = u ? numsOffsetKey(u) : Bytes.fromHex(internalKeyHex);
  enumerateLeafKeySlots(leaves);
  const tree = leaves.map((leaf) => serializeNutrootLeaf(leaf));
  const root = nutrootMerkleRoot(tree.map(nutrootLeafHash));
  const secret = nutrootTweakPubkey(internalKey, root);
  return {
    secret: Bytes.toHex(secret),
    tree: tree.map((leaf) => Bytes.toHex(leaf)),
    K: Bytes.toHex(internalKey),
    ...(u && { u: Bytes.toHex(u) }),
  };
}

/**
 * Build a script-path witness JSON for the leaf at `leafIndex` of the disclosed tree.
 *
 * @remarks
 * Shape (NUT-10): `{leaf, control: {K, path}, signatures, preimage?}`. Signatures are BIP-340 over
 * the transaction digest by the leaf's keys; `preimage` satisfies a hashlock leaf.
 */
export function buildScriptPathWitness(
  tree: string[],
  leafIndex: number,
  internalKeyHex: string,
  signatures: string[],
  preimage?: string,
): string {
  // NUT-10 witness bounds: no more signature entries than the leaf lists keys,
  // and a preimage of at most 32 bytes. A mint rejects either, so never emit them.
  const leaf = parseNutrootLeaf(Bytes.fromHex(tree[leafIndex] ?? ''));
  if (signatures.length > leaf.keys.length) {
    throw new CTSError('Witness holds more signatures than the leaf lists keys');
  }
  if (preimage !== undefined && Bytes.fromHex(preimage).length > 32) {
    throw new CTSError('Witness preimage exceeds 32 bytes');
  }
  const leafHashes = tree.map((leaf) => nutrootLeafHash(Bytes.fromHex(leaf)));
  const path = nutrootMerklePath(leafHashes, leafIndex);
  return JSON.stringify({
    leaf: tree[leafIndex],
    control: { K: internalKeyHex, path: path.map((h) => Bytes.toHex(h)) },
    signatures,
    ...(preimage !== undefined && { preimage }),
  });
}

/**
 * How many of a leaf's keys have a valid BIP-340 signature over `digest`.
 *
 * @remarks
 * Counts distinct keys, not signatures: one signer twice satisfies one threshold slot.
 */
export function countLeafSigners(
  leaf: NutrootLeaf,
  digest: Uint8Array,
  signatures: string[],
): number {
  return selectLeafSignatures(leaf, digest, signatures).length;
}

/**
 * Pick one valid signature per leaf key, dropping duplicates and non-verifying extras.
 *
 * @remarks
 * The result never exceeds the leaf's key count, the bound NUT-10 puts on script-path witnesses.
 */
export function selectLeafSignatures(
  leaf: NutrootLeaf,
  digest: Uint8Array,
  signatures: string[],
): string[] {
  const selected: string[] = [];
  for (const key of leaf.keys) {
    const match = signatures.find((signature) => {
      try {
        return schnorr.verify(Bytes.fromHex(signature), digest, Bytes.fromHex(key).subarray(1));
      } catch {
        return false;
      }
    });
    if (match !== undefined) selected.push(match);
  }
  return selected;
}

/**
 * {@link selectLeafSignatures}, requiring the leaf's threshold.
 *
 * @remarks
 * The mint bounds `signatures` at the leaf's key count, so duplicates and non-verifying cosigner
 * extras are trimmed rather than forwarded.
 * @throws If fewer than `leaf.n` distinct keys have a valid signature over `digest`.
 */
export function selectRequiredLeafSignatures(
  leaf: NutrootLeaf,
  digest: Uint8Array,
  signatures: string[],
): string[] {
  const selected = selectLeafSignatures(leaf, digest, signatures);
  if (selected.length < leaf.n) {
    throw new CTSError(
      `Script path leaf needs ${leaf.n} valid signatures, ${selected.length} produced`,
    );
  }
  return selected;
}

/**
 * Receive-time reconstruction check (NUT-10) for one proof's spend info. Spendability (check 2) is
 * the caller's: trial-match, seed recovery, or cosigning.
 *
 * @remarks
 * Returns 'bare' (`k` spends the secret directly), 'empty-tweaked' (the aggregated form, no tree),
 * 'tweaked' (the disclosed tree plus internal key reconstructs the secret, so the disclosure is
 * provably complete) or 'receiver-keyed' (reconstruction deferred to trial-match with the static
 * key). Throws on any mismatch, on tree-only spend info without a key source, and on leaves the
 * wallet cannot parse (unknown version/type or unknown constraint fields fail closed).
 */
export function verifyNutrootSpendInfo(
  secretHex: string,
  spendInfo: { k?: string; E?: string; K?: string; tree?: string[]; u?: string },
): 'bare' | 'empty-tweaked' | 'tweaked' | 'receiver-keyed' {
  const secret = Bytes.fromHex(secretHex);
  try {
    pointFromBytes(secret);
  } catch {
    throw new CTSError('Secret is not a 33-byte point');
  }
  // `k` and `E` are mutually exclusive (NUT-10): `k` says "here is the key", `E` says "derive
  // your key". Carrying both is malformed, and it is the shape a re-gifted receiver-keyed scalar
  // would take, which 2.5.2 warns hands the receiver's static key back to the original sender.
  if (spendInfo.k !== undefined && spendInfo.E !== undefined) {
    throw new CTSError('Spend info carries both k and E');
  }
  // `u` present means the internal key is a NUMS offset (NUT-10), so it must reduce to the
  // base: without this check `u` is decoration and a key path may still exist. Present iff the key
  // is an offset, so a claimed offset that does not reduce is a lie, not an omission.
  if (spendInfo.u !== undefined) {
    if (spendInfo.K === undefined) {
      throw new CTSError('Spend info carries a NUMS offset without its internal key');
    }
    let offsetKey: Uint8Array;
    try {
      offsetKey = numsOffsetKey(Bytes.fromHex(spendInfo.u));
    } catch {
      throw new CTSError('Spend info NUMS offset must be a 32-byte scalar');
    }
    if (!Bytes.equals(offsetKey, Bytes.fromHex(spendInfo.K))) {
      throw new CTSError('Spend info internal key is not the claimed NUMS offset');
    }
  }
  // Receiver-keyed (E without k): verification happens at trial-match with the static key;
  // the derivation pins the secret to the receiver, which a sender cannot have pre-tweaked (NUT-28).
  if (spendInfo.E !== undefined && spendInfo.k === undefined) {
    try {
      pointFromBytes(Bytes.fromHex(spendInfo.E));
    } catch {
      throw new CTSError('Spend info ephemeral must be a 33-byte point');
    }
    const leaves =
      spendInfo.tree && spendInfo.tree.length > 0
        ? spendInfo.tree.map((leaf) => parseNutrootLeaf(Bytes.fromHex(leaf)))
        : undefined;
    if (leaves) enumerateLeafKeySlots(leaves);
    // With K disclosed beside the tree (NUT-10), completeness is checkable here rather than only at
    // trial-match, and by any holder rather than only the receiver.
    if (spendInfo.K !== undefined && leaves) {
      const internalKey = Bytes.fromHex(spendInfo.K);
      if (internalKey.length !== 33) {
        throw new CTSError('Spend info internal key must be 33 bytes');
      }
      const treeBytes = spendInfo.tree!.map((leaf) => Bytes.fromHex(leaf));
      const root = nutrootMerkleRoot(treeBytes.map(nutrootLeafHash));
      if (!Bytes.equals(nutrootTweakPubkey(internalKey, root), secret)) {
        throw new CTSError('Disclosed tree does not reconstruct the proof secret');
      }
    }
    return 'receiver-keyed';
  }
  let internalKey: Uint8Array | undefined;
  if (spendInfo.k !== undefined) {
    let derived: Uint8Array;
    try {
      derived = getPubKeyFromPrivKey(Bytes.fromHex(spendInfo.k));
    } catch {
      throw new CTSError('Spend info key is not a valid private key');
    }
    if (spendInfo.K !== undefined) {
      let disclosed: Uint8Array;
      try {
        disclosed = pointFromBytes(Bytes.fromHex(spendInfo.K)).toBytes(true);
      } catch {
        throw new CTSError('Spend info internal key must be a 33-byte point');
      }
      if (!Bytes.equals(disclosed, derived)) {
        throw new CTSError('Spend info internal key does not match its private key');
      }
    }
    if (!spendInfo.tree || spendInfo.tree.length === 0) {
      if (Bytes.equals(derived, secret)) return 'bare';
      // The empty-tweak step (NUT-10): an aggregated key commits to having no script path by
      // tweaking with nothing but itself. Checked here rather than only for a disclosed `K`,
      // because a single-party key may use the same form.
      if (Bytes.equals(nutrootTweakPubkey(derived), secret)) return 'empty-tweaked';
      throw new CTSError('Spend info key does not match the proof secret');
    }
    internalKey = derived;
  } else if (spendInfo.K !== undefined) {
    internalKey = Bytes.fromHex(spendInfo.K);
    if (internalKey.length !== 33) {
      throw new CTSError('Spend info internal key must be 33 bytes');
    }
  }
  if (internalKey !== undefined && (!spendInfo.tree || spendInfo.tree.length === 0)) {
    // `K` alone is complete when the secret is its empty tweak: nothing else can be committed.
    // This is how an aggregated key arrives, since no single party holds its scalar to send.
    if (Bytes.equals(nutrootTweakPubkey(internalKey), secret)) return 'empty-tweaked';
    throw new CTSError('Spend info discloses a key that does not commit to the proof secret');
  }
  if (!spendInfo.tree || spendInfo.tree.length === 0 || internalKey === undefined) {
    throw new CTSError('Spend info is incomplete: tree and a key source are required');
  }
  const treeBytes = spendInfo.tree.map((leaf) => Bytes.fromHex(leaf));
  // Acceptance policy: every disclosed leaf must be one the wallet can reason about.
  const leaves = treeBytes.map(parseNutrootLeaf);
  enumerateLeafKeySlots(leaves);
  const root = nutrootMerkleRoot(treeBytes.map(nutrootLeafHash));
  if (!Bytes.equals(nutrootTweakPubkey(internalKey, root), secret)) {
    throw new CTSError('Disclosed tree does not reconstruct the proof secret');
  }
  return 'tweaked';
}

/**
 * Enumerate the positional blinding slots of a spend info tree (NUT-28).
 *
 * @remarks
 * Slot 0 is the internal key `K` and is not listed here. Slots 1.. are the `keys` entries: leaves
 * in transmitted order, keys within a leaf in order. Receivers derive all occupied slots and match
 * by key value, so the uncommitted leaf order cannot disable a path.
 * @throws If the tree needs more than {@link NUTROOT_MAX_SLOTS} slots.
 */
export function enumerateLeafKeySlots(
  leaves: NutrootLeaf[],
): Array<{ leafIndex: number; keyIndex: number; slot: number; key: string }> {
  const slots: Array<{ leafIndex: number; keyIndex: number; slot: number; key: string }> = [];
  leaves.forEach((leaf, leafIndex) => {
    leaf.keys.forEach((key, keyIndex) => {
      slots.push({ leafIndex, keyIndex, slot: slots.length + 1, key: key.toLowerCase() });
    });
  });
  if (slots.length + 1 > NUTROOT_MAX_SLOTS) {
    throw new CTSError(`Spend info exceeds ${NUTROOT_MAX_SLOTS} slots`);
  }
  return slots;
}

/**
 * Build a receiver-keyed v3 secret (NUT-28): `K = P_receiver + r_0*G`, optionally tweaked.
 *
 * @remarks
 * NUT-28 one layer down: fresh ephemeral per output, slot 0 is the internal key `K` and always
 * blinded, except a NUMS internal key, which is offset rather than ECDH-blinded (NUT-10): with no
 * scalar behind it there is no receiver half of the DH. Leaf keys are verbatim unless their owner
 * tagged them blind-me, which travels with the key's delivery channel (a payment request marking),
 * never in proof data; pass those keys as `blindKeys` and each occurrence is blinded at its own
 * slot.
 *
 * `E` travels iff it blinded something (NUT-18): a NUMS proof with no blind-me keys takes its
 * uniqueness from the offset and carries no ephemeral, since an `E` would tell the payee "derive
 * your key" when nobody can.
 */
export function deriveReceiverKeyedSecret(
  receiverPubHex: string,
  opts?: { leaves?: NutrootLeaf[]; eBytes?: Uint8Array; blindKeys?: string[] },
): { secret: string; E?: string; tree?: string[]; K?: string; u?: string } {
  if (receiverPubHex.toLowerCase() === NUTROOT_NUMS_KEY) {
    if (!opts?.leaves?.length) {
      throw new CTSError('A NUMS receiver key requires leaves: nothing else could spend the proof');
    }
    if (!opts.blindKeys?.length) {
      return buildNutrootSecret(NUTROOT_NUMS_KEY, opts.leaves);
    }
    const eBytes = opts.eBytes ?? secp256k1.utils.randomSecretKey();
    const leaves = blindTaggedLeafKeys(opts.leaves, eBytes, opts.blindKeys);
    const { secret, tree, K, u } = buildNutrootSecret(NUTROOT_NUMS_KEY, leaves);
    return { secret, E: Bytes.toHex(getPubKeyFromPrivKey(eBytes)), tree, K, u };
  }
  const eBytes = opts?.eBytes ?? secp256k1.utils.randomSecretKey();
  const { blinded, Ehex } = deriveP2BKBlindedPubkeys([receiverPubHex], eBytes, true);
  const internalKey = blinded[0];
  if (!opts?.leaves || opts.leaves.length === 0) {
    return { secret: internalKey, E: Ehex };
  }
  const leaves = blindTaggedLeafKeys(opts.leaves, eBytes, opts.blindKeys);
  const { secret, tree } = buildNutrootSecret(internalKey, leaves);
  // K travels with a disclosed tree (NUT-10): a script-path control block needs it, and it is
  // not recoverable from the secret and the tree, so without it every leaf key that is not the
  // receiver's own is a key its owner cannot spend with.
  return { secret, E: Ehex, tree, K: internalKey };
}

/**
 * Replace every occurrence of a blind-me tagged key with its slot-blinded form (NUT-28).
 *
 * @throws If a tagged key appears nowhere in the tree: the owner asked for a blinding the receiver
 *   will look for, so a silent no-op would produce a proof nobody recognizes.
 */
function blindTaggedLeafKeys(
  leaves: NutrootLeaf[],
  eBytes: Uint8Array,
  blindKeys?: string[],
): NutrootLeaf[] {
  const slots = enumerateLeafKeySlots(leaves); // also enforces the slot cap
  if (!blindKeys || blindKeys.length === 0) return leaves;
  const tagged = new Set(blindKeys.map((k) => k.toLowerCase()));
  const out = leaves.map((leaf) => ({ ...leaf, keys: [...leaf.keys] }));
  const hit = new Set<string>();
  for (const { leafIndex, keyIndex, slot, key } of slots) {
    if (!tagged.has(key)) continue;
    hit.add(key);
    out[leafIndex].keys[keyIndex] = deriveP2BKBlindedPubkeyAtSlot(key, eBytes, slot);
  }
  for (const key of tagged) {
    if (!hit.has(key)) throw new CTSError(`Blind-me key is not in the tree: ${key}`);
  }
  return out;
}

/**
 * Payee-side NUT-18 check: the disclosed spend info is exactly the requested tree.
 *
 * @remarks
 * One-to-one and order-insensitive: each disclosed leaf byte-identical to a distinct requested
 * leaf, except blind-me keys substituted in place. An extra or missing leaf rejects: an appended
 * leaf is spend power the payee never requested. Whether a substituted point is the tagged key's
 * actual blinding is its owner's trial-match, not checked here.
 * @throws If the spend info does not satisfy the request.
 */
export function verifyNutrootRequestTree(
  option: ParsedNutrootOption,
  spendInfo: { k?: string; E?: string; K?: string; tree?: string[]; u?: string } | undefined,
): void {
  if (!spendInfo) {
    throw new CTSError('Nutroot request: proof carries no spend info');
  }
  if (spendInfo.k !== undefined) {
    throw new CTSError('Nutroot request: a bearer key violates the receiver-keyed option');
  }
  // `E` is present iff it blinded something (NUT-18): always for a receiver-keyed request, and
  // for a NUMS request only when it tags blind-me keys. Both directions are checked, so presence
  // is part of the exact match rather than a free-floating field.
  const needsE =
    option.receiverKey.toLowerCase() !== NUTROOT_NUMS_KEY || (option.blindKeys ?? []).length > 0;
  if (needsE) {
    if (spendInfo.E === undefined) {
      throw new CTSError('Nutroot request: spend info is missing the ephemeral E');
    }
    try {
      pointFromBytes(Bytes.fromHex(spendInfo.E));
    } catch {
      throw new CTSError('Nutroot request: spend info ephemeral must be a 33-byte point');
    }
  } else if (spendInfo.E !== undefined) {
    throw new CTSError('Nutroot request: an ephemeral on a request that blinds nothing');
  }
  if (option.receiverKey.toLowerCase() === NUTROOT_NUMS_KEY) {
    // A NUMS request asks for proofs with no key path, which the offset is what proves: `K` alone
    // is just a point. Without both halves the payee has a key-path holder it cannot identify.
    if (spendInfo.u === undefined || spendInfo.K === undefined) {
      throw new CTSError(
        'Nutroot request: a NUMS request requires the internal key and its offset',
      );
    }
    let offsetKey: Uint8Array;
    try {
      offsetKey = numsOffsetKey(Bytes.fromHex(spendInfo.u));
    } catch {
      throw new CTSError('Nutroot request: NUMS offset must be a 32-byte scalar');
    }
    if (!Bytes.equals(offsetKey, Bytes.fromHex(spendInfo.K))) {
      throw new CTSError('Nutroot request: internal key is not the claimed NUMS offset');
    }
  } else if (spendInfo.u !== undefined) {
    throw new CTSError('Nutroot request: a NUMS offset on a receiver-keyed request');
  }
  const disclosed = spendInfo.tree ?? [];
  const requested = option.leaves ?? [];
  if (requested.length === 0) {
    if (disclosed.length > 0) {
      throw new CTSError('Nutroot request: a tree was disclosed but none was requested');
    }
    return;
  }
  if (disclosed.length !== requested.length) {
    throw new CTSError(
      `Nutroot request: expected ${requested.length} leaves, got ${disclosed.length}`,
    );
  }
  const blind = new Set((option.blindKeys ?? []).map((key) => key.toLowerCase()));
  const candidates = disclosed.map((hex) => {
    const bytes = Bytes.fromHex(hex);
    const leaf = parseNutrootLeaf(bytes);
    // Round-trip pins canonical bytes: an annotation or non-minimal field is not what the payee
    // asked for, even when inert.
    /* v8 ignore next 3 -- backstop: parseNutrootLeaf admits only canonical bytes today */
    if (!Bytes.equals(serializeNutrootLeaf(leaf), bytes)) {
      throw new CTSError('Nutroot request: disclosed leaf is not in requested canonical form');
    }
    const matches: number[] = [];
    requested.forEach((req, j) => {
      if (leafMatchesRequested(leaf, req, blind)) matches.push(j);
    });
    return matches;
  });
  if (!assignmentExists(candidates, new Array<boolean>(requested.length).fill(false), 0)) {
    throw new CTSError('Nutroot request: disclosed tree does not match the requested leaves');
  }
}

/**
 * One disclosed leaf against one requested leaf: byte-equal fields, keys equal in place, except a
 * blind-me key, which must have been substituted (a verbatim value there ignores the owner's tag).
 */
function leafMatchesRequested(leaf: NutrootLeaf, req: NutrootLeaf, blind: Set<string>): boolean {
  if (leaf.type !== req.type || leaf.n !== req.n) return false;
  if (leaf.time !== req.time || leaf.hash?.toLowerCase() !== req.hash?.toLowerCase()) return false;
  if (leaf.keys.length !== req.keys.length) return false;
  return req.keys.every((reqKey, i) => {
    const rk = reqKey.toLowerCase();
    return blind.has(rk) ? leaf.keys[i] !== rk : leaf.keys[i] === rk;
  });
}

/**
 * Backtracking one-to-one assignment of disclosed leaves to requested leaves. Trees are small (a
 * request names a handful of leaves), so exhaustive search is fine.
 */
function assignmentExists(candidates: number[][], used: boolean[], i: number): boolean {
  if (i === candidates.length) return true;
  for (const j of candidates[i]) {
    if (used[j]) continue;
    used[j] = true;
    if (assignmentExists(candidates, used, i + 1)) return true;
    used[j] = false;
  }
  return false;
}

/**
 * Every slot key a static key could hold, by the blinded pubkey it produces (NUT-28).
 *
 * @remarks
 * The receiver's half of the slot map. It is built over the slot space rather than over positions
 * on purpose: a sender assigns slots by walking the tree, but the root commits the leaf set, not
 * the transmitted order (the fold sorts), so a reordered list still reconstructs while every key
 * sits off the slot its owner expected. What reordering cannot change is which slots are in use,
 * since that is just the count of key occurrences. Matching by value against the whole slot space
 * is therefore order-independent, and costs the same as checking one slot per position: one
 * derivation per slot either way.
 */
export function slotKeysByBlindedPubkey(
  EHex: string,
  privHex: string,
  slotCount: number,
): Map<string, { slot: number; secretKey: string }> {
  const bySlot = new Map<string, { slot: number; secretKey: string }>();
  for (let slot = 1; slot <= slotCount; slot++) {
    let candidates: [string, string];
    try {
      candidates = deriveP2BKSlotSecretKeyCandidates(EHex, privHex, slot);
      /* v8 ignore start -- rejection sampling: an invalid derived scalar is improbable */
    } catch {
      continue; // not a usable slot key for this static key
    }
    /* v8 ignore stop */
    // Both parity candidates: an x-only import may hold n - p for the published point (NUT-28).
    for (const secretKey of candidates) {
      bySlot.set(Bytes.toHex(getPubKeyFromPrivKey(Bytes.fromHex(secretKey))), { slot, secretKey });
    }
  }
  return bySlot;
}

/**
 * Trial-match a spend info tree's leaf keys against the static keys held (NUT-28).
 *
 * @remarks
 * A verbatim key matches byte for byte; a blinded one matches when some slot's `(p + r_slot)*G`
 * reproduces it. Both are matched by value, not by position, so the transmitted leaf order carries
 * no meaning here and a reordered tree resolves exactly as the sender's did. Non-matches are
 * skipped, so a tree mixing both forms and several owners resolves in one pass. `EHex` may be
 * omitted for a tree with no receiver-keyed sender, leaving only verbatim matches.
 * @returns One entry per matching occurrence, with the key to sign that leaf with and the slot it
 *   was actually derived at, which need not be the occurrence's position.
 */
export function recoverLeafKeySecretKeys(
  tree: string[],
  EHex: string | undefined,
  privkeysHex: string[],
): Array<{
  leafIndex: number;
  keyIndex: number;
  slot: number;
  secretKey: string;
  blinded: boolean;
}> {
  const slots = enumerateLeafKeySlots(tree.map((leaf) => parseNutrootLeaf(Bytes.fromHex(leaf))));
  const hits = [];
  for (const privHex of privkeysHex) {
    const pub = Bytes.toHex(getPubKeyFromPrivKey(Bytes.fromHex(privHex)));
    const blindedKeys =
      EHex === undefined
        ? new Map<string, { slot: number; secretKey: string }>()
        : slotKeysByBlindedPubkey(EHex, privHex, slots.length);
    // The negated point is the same hex with the parity prefix flipped, so an x-only import that
    // holds n - p still byte-matches its published verbatim key (NUT-28).
    const pubNeg = (pub.startsWith('02') ? '03' : '02') + pub.slice(2);
    for (const { leafIndex, keyIndex, slot, key } of slots) {
      if (key === pub || key === pubNeg) {
        const secretKey = key === pub ? privHex.toLowerCase() : negateScalarHex(privHex);
        hits.push({ leafIndex, keyIndex, slot, secretKey, blinded: false });
        continue;
      }
      const blinded = blindedKeys.get(key);
      if (blinded) {
        hits.push({
          leafIndex,
          keyIndex,
          slot: blinded.slot,
          secretKey: blinded.secretKey,
          blinded: true,
        });
      }
    }
  }
  return hits;
}

/**
 * Trial-match a receiver-keyed proof against a static private key (NUT-28).
 *
 * @remarks
 * Both parity candidates are tried, so a scalar from an x-only import matches too.
 * @returns The key-path secret key (`k` bare, `k + t` tweaked) and the internal key, or undefined
 *   when the proof is not keyed to this static key.
 */
export function recoverReceiverKeyedSecretKey(
  secretHex: string,
  EHex: string,
  receiverPrivHex: string,
  tree?: string[],
): { secretKey: string; internalKey: string } | undefined {
  let candidates: [string, string];
  try {
    candidates = deriveP2BKSlotSecretKeyCandidates(EHex, receiverPrivHex, 0);
  } catch {
    return undefined;
  }
  const root =
    tree && tree.length > 0
      ? nutrootMerkleRoot(tree.map((leaf) => nutrootLeafHash(Bytes.fromHex(leaf))))
      : undefined;
  for (const internalSeckey of candidates) {
    const internalKey = Bytes.toHex(getPubKeyFromPrivKey(Bytes.fromHex(internalSeckey)));
    if (root === undefined) {
      if (internalKey === secretHex) return { secretKey: internalSeckey, internalKey };
      continue;
    }
    const tweaked = nutrootTweakSeckey(Bytes.fromHex(internalSeckey), root);
    if (Bytes.toHex(getPubKeyFromPrivKey(tweaked)) === secretHex) {
      return { secretKey: Bytes.toHex(tweaked), internalKey };
    }
  }
  return undefined;
}

/**
 * The other parity's scalar for the same x coordinate: `n - p` (NUT-28 x-only imports).
 */
function negateScalarHex(privHex: string): string {
  return Bytes.toHex(numberToBytesBE(secp256k1.Point.Fn.ORDER - BigInt('0x' + privHex), 32));
}
