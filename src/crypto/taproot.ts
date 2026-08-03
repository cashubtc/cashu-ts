import { secp256k1 } from '@noble/curves/secp256k1.js';
import { numberToBytesBE } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';

import { CTSError } from '../model/Errors';
import { Bytes } from '../utils';

import { pointFromBytes } from './curve_secp';

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
 * Suggested caps from spec 2.6, pending confirmation.
 */
export const TAPROOT_MAX_LEAF_BYTES = 1024;
export const TAPROOT_MAX_TREE_DEPTH = 8;

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
  if (value < 0n) {
    throw new CTSError('Cannot encode negative integer');
  }
  if (value === 0n) return new Uint8Array(0);
  let hexStr = value.toString(16);
  if (hexStr.length % 2) hexStr = '0' + hexStr;
  return Bytes.fromHex(hexStr);
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
    return b;
  });
  const fields: Uint8Array[] = [
    tlvRecord(FIELD_N, new Uint8Array([leaf.n])),
    tlvRecord(FIELD_KEYS, Bytes.concat(...keyBytes)),
  ];
  if (leaf.type === 'after') {
    if (!Number.isInteger(leaf.time) || (leaf.time as number) < 0) {
      throw new CTSError('after leaf requires a unix time');
    }
    fields.push(tlvRecord(FIELD_TIME, minimalBE(BigInt(leaf.time as number))));
  }
  if (leaf.type === 'hashlock') {
    const h = Bytes.fromHex(leaf.hash ?? '');
    if (h.length !== 32) {
      throw new CTSError('hashlock leaf requires a 32-byte hash');
    }
    fields.push(tlvRecord(FIELD_HASH, h));
  }
  const out = Bytes.concat(new Uint8Array([TAPROOT_LEAF_VERSION, typeByte]), ...fields);
  if (out.length > TAPROOT_MAX_LEAF_BYTES) {
    throw new CTSError(`Leaf exceeds ${TAPROOT_MAX_LEAF_BYTES} bytes`);
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
  if (bytes.length > TAPROOT_MAX_LEAF_BYTES) {
    throw new CTSError(`Leaf exceeds ${TAPROOT_MAX_LEAF_BYTES} bytes`);
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
          keys.push(Bytes.toHex(rec.value.subarray(i, i + 33)));
        }
        break;
      }
      case FIELD_TIME: {
        const t = readMinimalBE(rec.value);
        if (t > BigInt(Number.MAX_SAFE_INTEGER)) {
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
  if (typeName === 'after' && time === undefined) {
    throw new CTSError('after leaf missing time field');
  }
  if (typeName === 'hashlock' && hash === undefined) {
    throw new CTSError('hashlock leaf missing hash field');
  }
  const leaf: TaprootLeaf = { type: typeName, n, keys };
  if (time !== undefined) leaf.time = time;
  if (hash !== undefined) leaf.hash = hash;
  return leaf;
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
 */
export function taprootMerkleRoot(leafHashes: Uint8Array[]): Uint8Array {
  if (leafHashes.length === 0) {
    throw new CTSError('Merkle root of zero leaves');
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
  const P = pointFromBytes(internalKey).add(secp256k1.Point.BASE.multiply(t));
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
