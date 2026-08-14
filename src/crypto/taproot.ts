import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { numberToBytesBE } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

import { CTSError } from '../model/Errors';
import { Bytes } from '../utils';

import { getPubKeyFromPrivKey, pointFromBytes } from './curve_secp';
import {
  deriveP2BKBlindedPubkeyAtSlot,
  deriveP2BKBlindedPubkeys,
  deriveP2BKSlotSecretKey,
} from './NUT28';

/**
 * Taproot secrets (v3 keysets) crypto core: tagged hashes, canonical TLV, leaf serialization,
 * merkle tree, and tweak math.
 *
 * @remarks
 * BIP341's commitment machinery with Cashu tags and compressed (not x-only) keys. Spec:
 * taproot-secrets.md sections 2.1, 2.3, 2.6.
 */

export const TAPROOT_LEAF_TAG = 'Cashu_TapLeaf';
export const TAPROOT_BRANCH_TAG = 'Cashu_TapBranch';
export const TAPROOT_TWEAK_TAG = 'Cashu_TapTweak';

/**
 * Current leaf version for the declarative leaf family.
 */
export const TAPROOT_LEAF_VERSION = 0x00;

/**
 * Leaf type registry (version 0x00). A number means one thing forever.
 */
export const TAPROOT_LEAF_TYPE = {
  threshold: 0x01,
  after: 0x02,
  hashlock: 0x03,
} as const;

/**
 * Leaf body field types. Even = constraint (unknown fails closed), odd = annotation (ignorable).
 */
const FIELD_N = 0x02;
const FIELD_KEYS = 0x04;
const FIELD_TIME = 0x06;
const FIELD_HASH = 0x08;

/**
 * Normative caps from spec 2.6. The leaf body excludes the leading version byte.
 */
export const TAPROOT_MAX_LEAF_BYTES = 1024;
export const TAPROOT_MAX_TREE_DEPTH = 8;

/**
 * Largest unix time an `after` leaf may name (2^53 - 1).
 *
 * @remarks
 * The point where implementations built on IEEE-754 integers stop counting exactly. Bounded so
 * every implementation reads the same leaf: without it a leaf is valid at a mint and unparsable in
 * a wallet, which strands the proof with its holder.
 */
export const TAPROOT_MAX_LEAF_TIME = Number.MAX_SAFE_INTEGER;

/**
 * Enumerated blinding slots per secret (spec 2.7): exactly one index byte.
 */
export const TAPROOT_MAX_SLOTS = 256;

/**
 * A parsed declarative leaf (version 0x00).
 *
 * @remarks
 * `keys` are 33-byte compressed SEC1 hex. `time` is unix seconds. `hash` is 32 bytes hex.
 */
export type TaprootLeaf = {
  type: keyof typeof TAPROOT_LEAF_TYPE;
  n: number;
  keys: string[];
  time?: number;
  hash?: string;
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
export function serializeTaprootLeaf(leaf: TaprootLeaf): Uint8Array {
  const typeByte = TAPROOT_LEAF_TYPE[leaf.type];
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
    if ((leaf.time as number) > TAPROOT_MAX_LEAF_TIME) {
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
  const out = Bytes.concat(new Uint8Array([TAPROOT_LEAF_VERSION, typeByte]), ...fields);
  if (out.length - 1 > TAPROOT_MAX_LEAF_BYTES) {
    throw new CTSError(`Leaf body exceeds ${TAPROOT_MAX_LEAF_BYTES} bytes`);
  }
  return out;
}

/**
 * Parse a serialized leaf.
 *
 * @remarks
 * Fails closed: unknown leaf version or type, unknown even (constraint) fields, missing required
 * fields, and non-canonical streams all throw. Unknown odd (annotation) fields are ignored.
 */
export function parseTaprootLeaf(bytes: Uint8Array): TaprootLeaf {
  if (bytes.length < 2) {
    throw new CTSError('Leaf too short');
  }
  if (bytes.length - 1 > TAPROOT_MAX_LEAF_BYTES) {
    throw new CTSError(`Leaf body exceeds ${TAPROOT_MAX_LEAF_BYTES} bytes`);
  }
  if (bytes[0] !== TAPROOT_LEAF_VERSION) {
    throw new CTSError(`Unknown leaf version: ${bytes[0]}`);
  }
  const typeByte = bytes[1];
  const typeName = (Object.keys(TAPROOT_LEAF_TYPE) as Array<keyof typeof TAPROOT_LEAF_TYPE>).find(
    (k) => TAPROOT_LEAF_TYPE[k] === typeByte,
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
        if (t > BigInt(TAPROOT_MAX_LEAF_TIME)) {
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
        if (rec.type % 2 === 0) {
          throw new CTSError(`Unknown constraint field: ${rec.type}`);
        }
        // Odd = annotation, safe to ignore.
        break;
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
  const leaf: TaprootLeaf = { type: typeName, n, keys };
  if (time !== undefined) leaf.time = time;
  if (hash !== undefined) leaf.hash = hash;
  return leaf;
}

/**
 * Parse a hex-serialized leaf to its declarative form.
 */
export function parseTaprootLeafHex(leafHex: string): TaprootLeaf {
  return parseTaprootLeaf(Bytes.fromHex(leafHex));
}

/**
 * Serialize a leaf to its hex wire form, the shape spend info and payment requests carry.
 */
export function serializeTaprootLeafHex(leaf: TaprootLeaf): string {
  return Bytes.toHex(serializeTaprootLeaf(leaf));
}

/**
 * Hash a serialized leaf: `tagged_hash("Cashu_TapLeaf", leaf)`.
 */
export function taprootLeafHash(serializedLeaf: Uint8Array): Uint8Array {
  return taggedHash(TAPROOT_LEAF_TAG, serializedLeaf);
}

/**
 * Hash a branch of two child hashes, sorted pair, no left/right flags.
 */
export function taprootBranchHash(a: Uint8Array, b: Uint8Array): Uint8Array {
  const sorted = Bytes.compare(a, b) <= 0 ? [a, b] : [b, a];
  return taggedHash(TAPROOT_BRANCH_TAG, sorted[0], sorted[1]);
}

/**
 * Fold leaf hashes to a merkle root: pairwise per level, odd hash promoted.
 *
 * @remarks
 * Depth is a property of the tree, not of one leaf, so the cap is checked here and not only on a
 * witness path. A tree of more than `2^8` leaves is deeper than the cap, so its long paths cannot
 * be spent. A few of its leaves still can: the fold promotes an unpaired leaf to the next level,
 * and a leaf promoted often enough keeps a short path (at 300 leaves, 44 are within the cap). So an
 * oversized tree is part spendable and part not, and which part is which falls out of the fold
 * rather than out of anything the builder chose. Refuse the whole tree.
 *
 * The slot cap already makes such a tree unbuildable; this states the bound the spec names.
 */
export function taprootMerkleRoot(leafHashes: Uint8Array[]): Uint8Array {
  if (leafHashes.length === 0) {
    throw new CTSError('Merkle root of zero leaves');
  }
  if (leafHashes.length > 2 ** TAPROOT_MAX_TREE_DEPTH) {
    throw new CTSError(`Tree exceeds depth ${TAPROOT_MAX_TREE_DEPTH}`);
  }
  let level = leafHashes;
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i + 1 < level.length; i += 2) {
      next.push(taprootBranchHash(level[i], level[i + 1]));
    }
    if (level.length % 2 === 1) {
      next.push(level[level.length - 1]);
    }
    level = next;
  }
  return level[0];
}

/**
 * Merkle path for the leaf at `index`: sibling hashes on the way up.
 */
export function taprootMerklePath(leafHashes: Uint8Array[], index: number): Uint8Array[] {
  if (!Number.isInteger(index) || index < 0 || index >= leafHashes.length) {
    throw new CTSError(`Leaf index out of range: ${index}`);
  }
  const path: Uint8Array[] = [];
  let level = leafHashes;
  let pos = index;
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i + 1 < level.length; i += 2) {
      next.push(taprootBranchHash(level[i], level[i + 1]));
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
export function taprootRootFromPath(leafHash: Uint8Array, path: Uint8Array[]): Uint8Array {
  if (path.length > TAPROOT_MAX_TREE_DEPTH) {
    throw new CTSError(`Merkle path exceeds depth ${TAPROOT_MAX_TREE_DEPTH}`);
  }
  if (leafHash.length !== 32 || path.some((sibling) => sibling.length !== 32)) {
    throw new CTSError('Merkle hashes must be 32 bytes');
  }
  return path.reduce((acc, sibling) => taprootBranchHash(acc, sibling), leafHash);
}

/**
 * Taproot tweak scalar: `tagged_hash("Cashu_TapTweak", K || root) mod n`.
 *
 * @remarks
 * Omit `root` for the empty tweak (aggregated keys, spec 3.8): `tagged_hash(tag, K)`.
 */
export function taprootTweak(internalKey: Uint8Array, merkleRoot?: Uint8Array): bigint {
  if (internalKey.length !== 33) {
    throw new CTSError('Internal key must be 33 bytes');
  }
  const digest = merkleRoot
    ? taggedHash(TAPROOT_TWEAK_TAG, internalKey, merkleRoot)
    : taggedHash(TAPROOT_TWEAK_TAG, internalKey);
  return Bytes.toBigInt(digest) % secp256k1.Point.Fn.ORDER;
}

/**
 * Tweaked output key `P = K + t*G` as compressed SEC1 bytes.
 */
export function taprootTweakPubkey(internalKey: Uint8Array, merkleRoot?: Uint8Array): Uint8Array {
  const t = taprootTweak(internalKey, merkleRoot);
  const P = pointFromBytes(internalKey).add(secp256k1.Point.BASE.multiplyUnsafe(t));
  if (P.is0()) {
    throw new CTSError('Tweaked key at infinity');
  }
  return P.toBytes(true);
}

/**
 * Tweaked private key `p' = (k + t) mod n` for the key path.
 */
export function taprootTweakSeckey(seckey: Uint8Array, merkleRoot?: Uint8Array): Uint8Array {
  if (seckey.length !== 32) {
    throw new CTSError('Secret key must be 32 bytes');
  }
  const k = Bytes.toBigInt(seckey);
  const order = secp256k1.Point.Fn.ORDER;
  if (k === 0n || k >= order) {
    throw new CTSError('Invalid secret key');
  }
  const K = secp256k1.Point.BASE.multiply(k).toBytes(true);
  const t = taprootTweak(K, merkleRoot);
  const p = (k + t) % order;
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
export function verifyTaprootCommitment(
  secret: Uint8Array,
  internalKey: Uint8Array,
  serializedLeaf: Uint8Array,
  merklePath: Uint8Array[],
): boolean {
  if (secret.length !== 33) {
    throw new CTSError('Secret must be 33 bytes');
  }
  const root = taprootRootFromPath(taprootLeafHash(serializedLeaf), merklePath);
  return Bytes.equals(taprootTweakPubkey(internalKey, root), secret);
}

/**
 * NUMS internal key for script-only proofs: BIP-341's `H` point, compressed.
 *
 * @remarks
 * Provably no known discrete log (lift_x of SHA256(G)); with it as `K`, all spending must go
 * through the revealed leaves.
 */
export const TAPROOT_NUMS_KEY =
  '0250929b74c1a04954b78b4b6035e97a5e078a5a0f28ec96d547bfee9ace803ac0';

/**
 * Build a locked v3 secret: `P = K + tagged_hash(K || root)*G` over the leaves' tree.
 *
 * @returns The 33-byte secret hex and the serialized tree (spend_info order).
 */
export function buildTaprootSecret(
  internalKeyHex: string,
  leaves: TaprootLeaf[],
): { secret: string; tree: string[] } {
  if (leaves.length === 0) {
    throw new CTSError('A locked secret requires at least one leaf');
  }
  enumerateLeafKeySlots(leaves);
  const tree = leaves.map((leaf) => serializeTaprootLeaf(leaf));
  const root = taprootMerkleRoot(tree.map(taprootLeafHash));
  const secret = taprootTweakPubkey(Bytes.fromHex(internalKeyHex), root);
  return { secret: Bytes.toHex(secret), tree: tree.map((leaf) => Bytes.toHex(leaf)) };
}

/**
 * Build a script-path witness JSON for the leaf at `leafIndex` of the disclosed tree.
 *
 * @remarks
 * Shape (spec 2.3.2): `{leaf, control: {K, path}, signatures, preimage?}`. Signatures are BIP-340
 * over the transaction digest by the leaf's keys; `preimage` satisfies a hashlock leaf.
 */
export function buildScriptPathWitness(
  tree: string[],
  leafIndex: number,
  internalKeyHex: string,
  signatures: string[],
  preimage?: string,
): string {
  const leafHashes = tree.map((leaf) => taprootLeafHash(Bytes.fromHex(leaf)));
  const path = taprootMerklePath(leafHashes, leafIndex);
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
  leaf: TaprootLeaf,
  digest: Uint8Array,
  signatures: string[],
): number {
  return leaf.keys.filter((key) =>
    signatures.some((signature) => {
      try {
        return schnorr.verify(Bytes.fromHex(signature), digest, Bytes.fromHex(key).subarray(1));
      } catch {
        return false;
      }
    }),
  ).length;
}

/**
 * Receive-time reconstruction check (spec 2.5.1 check 1) for one proof's spend info. Spendability
 * (check 2) is the caller's: trial-match, seed recovery, or cosigning.
 *
 * @remarks
 * Returns 'bare' (k key-path spends the secret directly) or 'tweaked' (the disclosed tree plus
 * internal key reconstructs the secret, so the disclosure is provably complete). Throws on any
 * mismatch, on tree-only spend info without a key source, and on leaves the wallet cannot parse
 * (unknown version/type or unknown constraint fields fail closed).
 */
export function verifyTaprootSpendInfo(
  secretHex: string,
  spendInfo: { k?: string; E?: string; K?: string; tree?: string[] },
): 'bare' | 'tweaked' | 'receiver-keyed' | 'aggregated' {
  const secret = Bytes.fromHex(secretHex);
  try {
    pointFromBytes(secret);
  } catch {
    throw new CTSError('Secret is not a 33-byte point');
  }
  // `k` and `E` are mutually exclusive (spec 2.5.2): `k` says "here is the key", `E` says "derive
  // your key". Carrying both is malformed, and it is the shape a re-gifted receiver-keyed scalar
  // would take, which 2.5.2 warns hands the receiver's static key back to the original sender.
  if (spendInfo.k !== undefined && spendInfo.E !== undefined) {
    throw new CTSError('Spend info carries both k and E');
  }
  // Receiver-keyed (E without k): verification happens at trial-match with the static key;
  // the derivation pins the secret to the receiver, which a sender cannot have pre-tweaked (2.7).
  if (spendInfo.E !== undefined && spendInfo.k === undefined) {
    try {
      pointFromBytes(Bytes.fromHex(spendInfo.E));
    } catch {
      throw new CTSError('Spend info ephemeral must be a 33-byte point');
    }
    const leaves =
      spendInfo.tree && spendInfo.tree.length > 0
        ? spendInfo.tree.map((leaf) => parseTaprootLeaf(Bytes.fromHex(leaf)))
        : undefined;
    if (leaves) enumerateLeafKeySlots(leaves);
    // With K disclosed beside the tree (2.5), completeness is checkable here rather than only at
    // trial-match, and by any holder rather than only the receiver.
    if (spendInfo.K !== undefined && leaves) {
      const internalKey = Bytes.fromHex(spendInfo.K);
      if (internalKey.length !== 33) {
        throw new CTSError('Spend info internal key must be 33 bytes');
      }
      const treeBytes = spendInfo.tree!.map((leaf) => Bytes.fromHex(leaf));
      const root = taprootMerkleRoot(treeBytes.map(taprootLeafHash));
      if (!Bytes.equals(taprootTweakPubkey(internalKey, root), secret)) {
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
      // The empty-tweak step (2.5.1, 3.8): an aggregated key commits to having no script path by
      // tweaking with nothing but itself. Checked here rather than only for a disclosed `K`,
      // because a single-party key may use the same form.
      if (Bytes.equals(taprootTweakPubkey(derived), secret)) return 'aggregated';
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
    if (Bytes.equals(taprootTweakPubkey(internalKey), secret)) return 'aggregated';
    throw new CTSError('Spend info discloses a key that does not commit to the proof secret');
  }
  if (!spendInfo.tree || spendInfo.tree.length === 0 || internalKey === undefined) {
    throw new CTSError('Spend info is incomplete: tree and a key source are required');
  }
  const treeBytes = spendInfo.tree.map((leaf) => Bytes.fromHex(leaf));
  // Acceptance policy: every disclosed leaf must be one the wallet can reason about.
  const leaves = treeBytes.map(parseTaprootLeaf);
  enumerateLeafKeySlots(leaves);
  const root = taprootMerkleRoot(treeBytes.map(taprootLeafHash));
  if (!Bytes.equals(taprootTweakPubkey(internalKey, root), secret)) {
    throw new CTSError('Disclosed tree does not reconstruct the proof secret');
  }
  return 'tweaked';
}

/**
 * Enumerate the positional blinding slots of a spend info tree (spec 2.7).
 *
 * @remarks
 * Slot 0 is the base key and is not listed here. Slots 1.. are the `keys` entries: leaves in
 * transmitted order, keys within a leaf in order. Receivers derive all occupied slots and match by
 * key value, so the uncommitted leaf order cannot disable a path.
 * @throws If the tree needs more than {@link TAPROOT_MAX_SLOTS} slots.
 */
export function enumerateLeafKeySlots(
  leaves: TaprootLeaf[],
): Array<{ leafIndex: number; keyIndex: number; slot: number; key: string }> {
  const slots: Array<{ leafIndex: number; keyIndex: number; slot: number; key: string }> = [];
  leaves.forEach((leaf, leafIndex) => {
    leaf.keys.forEach((key, keyIndex) => {
      slots.push({ leafIndex, keyIndex, slot: slots.length + 1, key: key.toLowerCase() });
    });
  });
  if (slots.length + 1 > TAPROOT_MAX_SLOTS) {
    throw new CTSError(`Spend info exceeds ${TAPROOT_MAX_SLOTS} slots`);
  }
  return slots;
}

/**
 * Build a receiver-keyed v3 secret (spec 2.7): `K = P_receiver + r_0*G`, optionally tweaked.
 *
 * @remarks
 * NUT-28 one layer down: fresh ephemeral per output, slot 0 is the base key and always blinded,
 * except a NUMS base, which travels verbatim with uniqueness from a blinded leaf key (spec 2.3.5).
 * Leaf keys are verbatim unless their owner tagged them blind-me, which travels with the key's
 * delivery channel (a payment request marking), never in proof data; pass those keys as `blindKeys`
 * and each occurrence is blinded at its own slot.
 */
export function deriveReceiverKeyedSecret(
  receiverPubHex: string,
  opts?: { leaves?: TaprootLeaf[]; eBytes?: Uint8Array; blindKeys?: string[] },
): { secret: string; E: string; tree?: string[]; K?: string } {
  const eBytes = opts?.eBytes ?? secp256k1.utils.randomSecretKey();
  if (receiverPubHex.toLowerCase() === TAPROOT_NUMS_KEY) {
    // Never blind a NUMS base (spec 2.3.5): nobody holds its scalar for the receiver's half of
    // the ECDH, so a blinded NUMS is indistinguishable from a sender-owned key hiding a key
    // path. Verbatim keeps it recognizable; per-proof uniqueness must then come from the tree,
    // so a blinded leaf key is mandatory.
    if (!opts?.leaves?.length || !opts.blindKeys?.length) {
      throw new CTSError('A NUMS receiver key requires leaves with at least one blind-me key');
    }
    const leaves = blindTaggedLeafKeys(opts.leaves, eBytes, opts.blindKeys);
    const { secret, tree } = buildTaprootSecret(TAPROOT_NUMS_KEY, leaves);
    return { secret, E: Bytes.toHex(getPubKeyFromPrivKey(eBytes)), tree, K: TAPROOT_NUMS_KEY };
  }
  const { blinded, Ehex } = deriveP2BKBlindedPubkeys([receiverPubHex], eBytes, true);
  const internalKey = blinded[0];
  if (!opts?.leaves || opts.leaves.length === 0) {
    return { secret: internalKey, E: Ehex };
  }
  const leaves = blindTaggedLeafKeys(opts.leaves, eBytes, opts.blindKeys);
  const { secret, tree } = buildTaprootSecret(internalKey, leaves);
  // K travels with a disclosed tree (spec 2.5): a script-path control block needs it, and it is
  // not recoverable from the secret and the tree, so without it every leaf key that is not the
  // receiver's own is a key its owner cannot spend with.
  return { secret, E: Ehex, tree, K: internalKey };
}

/**
 * Replace every occurrence of a blind-me tagged key with its slot-blinded form (spec 2.7).
 *
 * @throws If a tagged key appears nowhere in the tree: the owner asked for a blinding the receiver
 *   will look for, so a silent no-op would produce a proof nobody recognizes.
 */
function blindTaggedLeafKeys(
  leaves: TaprootLeaf[],
  eBytes: Uint8Array,
  blindKeys?: string[],
): TaprootLeaf[] {
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
 * Every slot key a static key could hold, by the blinded pubkey it produces (spec 2.7).
 *
 * @remarks
 * The receiver's half of the slot map. It is built over the slot space rather than over positions
 * on purpose: a sender assigns slots by walking the tree, but the transmitted order is not
 * committed by the root (sorted-pair hashing fixes the leaf set, not an arrangement), so a
 * reordered list would move every key off the slot its owner expected. What reordering cannot
 * change is which slots are in use, since that is just the count of key occurrences. Matching by
 * value against the whole slot space is therefore order-independent, and costs the same as checking
 * one slot per position: one derivation per slot either way.
 */
export function slotKeysByBlindedPubkey(
  EHex: string,
  privHex: string,
  slotCount: number,
): Map<string, { slot: number; secretKey: string }> {
  const bySlot = new Map<string, { slot: number; secretKey: string }>();
  for (let slot = 1; slot <= slotCount; slot++) {
    let candidate: string;
    try {
      candidate = deriveP2BKSlotSecretKey(EHex, privHex, slot);
    } catch {
      continue; // not a usable slot key for this static key
    }
    bySlot.set(Bytes.toHex(getPubKeyFromPrivKey(Bytes.fromHex(candidate))), {
      slot,
      secretKey: candidate,
    });
  }
  return bySlot;
}

/**
 * Trial-match a spend info tree's leaf keys against the static keys held (spec 2.7).
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
  const slots = enumerateLeafKeySlots(tree.map((leaf) => parseTaprootLeaf(Bytes.fromHex(leaf))));
  const hits = [];
  for (const privHex of privkeysHex) {
    const pub = Bytes.toHex(getPubKeyFromPrivKey(Bytes.fromHex(privHex)));
    const blindedKeys =
      EHex === undefined
        ? new Map<string, { slot: number; secretKey: string }>()
        : slotKeysByBlindedPubkey(EHex, privHex, slots.length);
    for (const { leafIndex, keyIndex, slot, key } of slots) {
      if (key === pub) {
        hits.push({ leafIndex, keyIndex, slot, secretKey: privHex.toLowerCase(), blinded: false });
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
 * Trial-match a receiver-keyed proof against a static private key (spec 2.7).
 *
 * @returns The key-path secret key (`k` bare, `k + t` tweaked) and the internal key, or undefined
 *   when the proof is not keyed to this static key.
 */
export function recoverReceiverKeyedSecretKey(
  secretHex: string,
  EHex: string,
  receiverPrivHex: string,
  tree?: string[],
): { secretKey: string; internalKey: string } | undefined {
  let baseKey: string;
  try {
    baseKey = deriveP2BKSlotSecretKey(EHex, receiverPrivHex, 0);
  } catch {
    return undefined;
  }
  const internalKey = Bytes.toHex(getPubKeyFromPrivKey(Bytes.fromHex(baseKey)));
  if (!tree || tree.length === 0) {
    return internalKey === secretHex ? { secretKey: baseKey, internalKey } : undefined;
  }
  const root = taprootMerkleRoot(tree.map((leaf) => taprootLeafHash(Bytes.fromHex(leaf))));
  const tweaked = taprootTweakSeckey(Bytes.fromHex(baseKey), root);
  if (Bytes.toHex(getPubKeyFromPrivKey(tweaked)) !== secretHex) return undefined;
  return { secretKey: Bytes.toHex(tweaked), internalKey };
}
