import type { P2PKOptions, P2PKTag } from '../crypto/NUT11';
import { NUTROOT_NUMS_KEY, parseNutrootLeaf, type NutrootLeaf } from '../crypto/nutroot';
import { CTSError } from '../model/Errors';
import { Bytes } from '../utils';

/**
 * Semantic spending conditions for locked outputs, independent of keyset version.
 *
 * @remarks
 * The wallet encodes these per keyset: NUT-11/14 tags on pre-v3, a nutroot tree on v3. `leaves` and
 * a `blindKeys` list are v3-only; `additionalTags` and `sigAll` are pre-v3 encoding features (v3
 * refuses tags and absorbs sigAll: every v3 input signs the whole transaction).
 */
export type LockOptions = {
  /**
   * Main-path keys; `requiredMainSignatures` of them must sign (default 1).
   */
  mainKeys?: string[];
  requiredMainSignatures?: number;
  /**
   * SHA-256 hashlock (NUT-14 HTLC semantics): a preimage is required alongside signatures.
   */
  hashlock?: string;
  /**
   * Unix seconds after which the refund path activates; the main path never expires.
   */
  locktime?: number;
  /**
   * Refund-path keys; `requiredRefundSignatures` of them must sign (default 1).
   */
  refundKeys?: string[];
  requiredRefundSignatures?: number;
  /**
   * Explicit tree leaves beyond what the fields above express (eg staged reclaim). v3 only.
   */
  leaves?: NutrootLeaf[];
  /**
   * `true` blinds every key; a list blinds exactly those keys (v3 only).
   */
  blindKeys?: boolean | string[];
  /**
   * Extra NUT-11 secret tags. Pre-v3 only: v3 secrets carry no tags.
   */
  additionalTags?: P2PKTag[];
  /**
   * NUT-11 SIG_ALL. On v3 this is the default and only behavior.
   */
  sigAll?: boolean;
};

const lc = (k: string) => k.toLowerCase();

/**
 * Encodes a lock for a v3 keyset: receiver key plus tree, in `createNutrootData` form.
 *
 * @remarks
 * The key path exists iff exactly one main key with no threshold and no hashlock: anything weaker
 * in a leaf would bypass the lock, and a hashlock key path would bypass the preimage.
 * @throws On a shape v3 cannot express: extra tags, anyone-after-locktime, a keyless hashlock, an
 *   unattainable threshold, or an empty lock.
 */
export function lockToNutrootOptions(lock: LockOptions): {
  receiverPub: string;
  leaves?: NutrootLeaf[];
  blindKeys?: string[];
} {
  if (lock.additionalTags?.length) {
    throw new CTSError('Extra tags do not fit a v3 lock: v3 secrets carry no tags');
  }
  const mainKeys = (lock.mainKeys ?? []).map(lc);
  const explicit = (lock.leaves ?? []).map((leaf) => ({ ...leaf, keys: leaf.keys.map(lc) }));
  if (mainKeys.length === 0 && lock.hashlock === undefined && explicit.length === 0) {
    throw new CTSError('A lock needs at least one main key, hashlock, or leaf');
  }
  if (lock.hashlock !== undefined && mainKeys.length === 0) {
    throw new CTSError(
      'A keyless hashlock does not fit a v3 lock: leaves require at least one key',
    );
  }
  const n = lock.requiredMainSignatures ?? 1;
  if (n > mainKeys.length && (mainKeys.length > 0 || lock.requiredMainSignatures !== undefined)) {
    throw new CTSError(`Threshold ${n} exceeds the ${mainKeys.length} main keys`);
  }
  const leaves: NutrootLeaf[] = [];
  const keyPath = lock.hashlock === undefined && mainKeys.length === 1 && n === 1;
  if (lock.hashlock !== undefined) {
    leaves.push({ type: 'hashlock', n, hash: lc(lock.hashlock), keys: mainKeys });
  } else if (!keyPath && mainKeys.length > 0) {
    leaves.push({ type: 'threshold', n, keys: mainKeys });
  }
  // Refund keys without a locktime are inert under NUT-11 too (the refund path never activates),
  // so dropping them preserves the semantics exactly.
  if (lock.locktime !== undefined) {
    const refundKeys = (lock.refundKeys ?? []).map(lc);
    if (refundKeys.length === 0) {
      throw new CTSError(
        'Anyone-after-locktime does not fit a v3 lock: leaves require at least one key. Lock the timeout to your own refund key instead',
      );
    }
    const nRefund = lock.requiredRefundSignatures ?? 1;
    if (nRefund > refundKeys.length) {
      throw new CTSError(
        `Refund threshold ${nRefund} exceeds the ${refundKeys.length} refund keys`,
      );
    }
    leaves.push({ type: 'after', n: nRefund, time: lock.locktime, keys: refundKeys });
  }
  leaves.push(...explicit);
  // sigAll is absorbed: every v3 input signs the whole transaction (NUT-10).
  const blindKeys =
    lock.blindKeys === true
      ? [...new Set(leaves.flatMap((leaf) => leaf.keys))]
      : (Array.isArray(lock.blindKeys) ? lock.blindKeys : []).map(lc);
  return {
    receiverPub: keyPath ? mainKeys[0] : NUTROOT_NUMS_KEY,
    ...(leaves.length > 0 && { leaves }),
    ...(blindKeys.length > 0 && { blindKeys }),
  };
}

/**
 * Encodes a lock for a pre-v3 keyset: NUT-11/14 well-known secret options.
 *
 * @throws On a shape NUT-11 cannot express: explicit leaves, or a partial blind-me list.
 */
export function lockToP2PKOptions(lock: LockOptions): P2PKOptions {
  if (lock.leaves?.length) {
    throw new CTSError('Leaf locks need a v3 keyset: NUT-11 tags cannot express a tree');
  }
  if (Array.isArray(lock.blindKeys)) {
    throw new CTSError('NUT-11 blinds all keys or none: a partial blind-me list needs a v3 keyset');
  }
  const mainKeys = (lock.mainKeys ?? []).map(lc);
  if (mainKeys.length === 0 && lock.hashlock === undefined) {
    throw new CTSError('At least one lock pubkey is required');
  }
  const rs = lock.requiredMainSignatures;
  const rrs = lock.requiredRefundSignatures;
  const refundKeys = lock.locktime !== undefined ? (lock.refundKeys ?? []).map(lc) : [];
  const conditions = {
    ...(lock.locktime !== undefined && { locktime: lock.locktime }),
    ...(refundKeys.length > 0 && { refundKeys }),
    // Drop a redundant threshold of 1, but keep an explicit one when its key set is empty
    // (keyless HTLC / no refund keys) so downstream validation rejects the impossible lock.
    ...(rs !== undefined && (rs > 1 || mainKeys.length === 0) && { requiredSignatures: rs }),
    ...(rrs !== undefined &&
      (rrs > 1 || refundKeys.length === 0) && {
        requiredRefundSignatures: rrs,
      }),
    ...(lock.additionalTags?.length && { additionalTags: lock.additionalTags.slice() }),
    ...(lock.blindKeys === true && { blindKeys: true }),
    ...(lock.sigAll && { sigFlag: 'SIG_ALL' as const }),
  };
  // The first main key takes the NUT-10 data slot; for an HTLC the hashlock does, so every main
  // key rides the pubkeys tag.
  return lock.hashlock !== undefined
    ? {
        kind: 'HTLC',
        data: lc(lock.hashlock),
        ...(mainKeys.length > 0 && { pubkeys: mainKeys }),
        ...conditions,
      }
    : {
        kind: 'P2PK',
        data: mainKeys[0],
        ...(mainKeys.length > 1 && { pubkeys: mainKeys.slice(1) }),
        ...conditions,
      };
}

/**
 * Decodes NUT-11/14 options back to semantic lock options.
 */
export function p2pkToLockOptions(p2pk: P2PKOptions): LockOptions {
  const mainKeys =
    p2pk.kind === 'HTLC' ? (p2pk.pubkeys ?? []) : [p2pk.data, ...(p2pk.pubkeys ?? [])];
  return {
    ...(p2pk.kind === 'HTLC' && { hashlock: p2pk.data }),
    ...(mainKeys.length > 0 && { mainKeys }),
    ...(p2pk.requiredSignatures !== undefined && {
      requiredMainSignatures: p2pk.requiredSignatures,
    }),
    ...(p2pk.locktime !== undefined && { locktime: p2pk.locktime }),
    ...(p2pk.refundKeys?.length && { refundKeys: p2pk.refundKeys }),
    ...(p2pk.requiredRefundSignatures !== undefined && {
      requiredRefundSignatures: p2pk.requiredRefundSignatures,
    }),
    ...(p2pk.additionalTags?.length && { additionalTags: p2pk.additionalTags }),
    ...(p2pk.blindKeys && { blindKeys: true }),
    ...(p2pk.sigFlag === 'SIG_ALL' && { sigAll: true }),
  };
}

/**
 * Decodes a nutroot lock to readable lock options, faithfully.
 *
 * @remarks
 * Leaves may be parsed or serialized (the wire form a proof's spend info discloses). Leaves are
 * never collapsed back into the sugar fields: what was authored as a tree reads as a tree.
 */
export function nutrootToLockOptions(options: {
  receiverPub: string;
  leaves?: Array<NutrootLeaf | string>;
  blindKeys?: string[];
}): LockOptions {
  const leaves = (options.leaves ?? []).map((leaf) =>
    typeof leaf === 'string' ? parseNutrootLeaf(Bytes.fromHex(leaf)) : leaf,
  );
  const isNums = lc(options.receiverPub) === NUTROOT_NUMS_KEY;
  return {
    ...(!isNums && { mainKeys: [lc(options.receiverPub)] }),
    ...(leaves.length > 0 && { leaves }),
    ...(options.blindKeys?.length && { blindKeys: options.blindKeys.map(lc) }),
  };
}
