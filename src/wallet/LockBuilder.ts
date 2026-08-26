import { assertValidTagKey, dedupeP2PKPubkeys, normalizeHashlock, type P2PKTag } from '../crypto';
import { serializeNutrootLeaf, type NutrootLeaf } from '../crypto/nutroot';
import { CTSError } from '../model/Errors';
import { OutputData } from '../model/OutputData';

import { lockToNutrootOptions, lockToP2PKOptions, type LockOptions } from './lock';

function assertUnixSeconds(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new CTSError(`locktime must be a non-negative finite Unix time, got ${seconds}`);
  }
  return Math.floor(seconds);
}

/**
 * Builder for lock spending conditions, independent of keyset version.
 *
 * @remarks
 * Emits {@link LockOptions}; the wallet encodes them for whichever keyset is active, so consumers
 * state the conditions and never the keyset version. `addLeaf` shapes are v3-only.
 */
export class LockBuilder {
  // Keys are deduplicated by x-only identity and first-seen order preserved.
  private mainKeys: string[] = [];
  private refundKeys: string[] = [];
  private locktime?: number;
  private nSigs?: number;
  private nSigsRefund?: number;
  private extraTags: P2PKTag[] = [];
  private _blindKeys?: boolean | string[];
  private _sigAll?: boolean;
  private hashlock?: string;
  private leaves: NutrootLeaf[] = [];

  /**
   * Adds main-path key(s), 33-byte compressed hex; for an x-only (Nostr) key prepend '02'.
   */
  addMainPubkey(pk: string | string[]) {
    const arr = Array.isArray(pk) ? pk : [pk];
    this.mainKeys = dedupeP2PKPubkeys([...this.mainKeys, ...arr]);
    return this;
  }

  /**
   * Adds refund-path key(s), active after the locktime; requires
   * {@link LockBuilder.lockUntil | lockUntil}.
   */
  addRefundPubkey(pk: string | string[]) {
    const arr = Array.isArray(pk) ? pk : [pk];
    this.refundKeys = dedupeP2PKPubkeys([...this.refundKeys, ...arr]);
    return this;
  }

  /**
   * Sets the locktime: Unix seconds, epoch milliseconds, or a Date.
   */
  lockUntil(when: Date | number) {
    let seconds: number;
    if (when instanceof Date) {
      seconds = when.getTime() / 1000;
    } else {
      // A value that looks like epoch milliseconds (>= 1e12) is read as ms so
      // lockUntil(Date.now()) works; smaller values are treated as Unix seconds.
      seconds = when < 1e12 ? when : when / 1000;
    }
    this.locktime = assertUnixSeconds(seconds);
    return this;
  }

  /**
   * Requires n-of-m signatures from the main keys (default 1).
   */
  requireMainSignatures(n: number) {
    if (!Number.isInteger(n) || n < 1)
      throw new CTSError(`requiredMainSignatures must be a positive integer, got ${n}`);
    this.nSigs = n;
    return this;
  }

  /**
   * Requires n-of-m signatures from the refund keys (default 1).
   */
  requireRefundSignatures(n: number) {
    if (!Number.isInteger(n) || n < 1)
      throw new CTSError(`requiredRefundSignatures must be a positive integer, got ${n}`);
    this.nSigsRefund = n;
    return this;
  }

  /**
   * Adds an extra NUT-11 secret tag. Pre-v3 keysets only: v3 secrets carry no tags.
   */
  addTag(key: string, values?: string[] | string) {
    assertValidTagKey(key); //  Validate key
    const vals = values === undefined ? [] : Array.isArray(values) ? values : [values];
    const stringVals = vals.map(String); // all to strings
    // NUT-10 tag values must be non-empty strings; reject at the setter so an empty
    // value fails here rather than producing a secret parseSecret later rejects.
    if (stringVals.some((v) => v.length === 0)) {
      throw new CTSError(`tag "${key}" values must be non-empty strings`);
    }
    this.extraTags.push([key, ...stringVals]);
    return this;
  }

  /**
   * Adds multiple NUT-11 tags at once; see {@link LockBuilder.addTag | addTag}.
   */
  addTags(tags: P2PKTag[]) {
    for (const [k, ...vals] of tags) this.addTag(k, vals);
    return this;
  }

  /**
   * Blinds every key, or exactly the listed keys (a list is v3-only: NUT-11 blinds all or none).
   */
  blindKeys(keys?: string | string[]) {
    this._blindKeys = keys === undefined ? true : dedupeP2PKPubkeys([keys].flat());
    return this;
  }

  /**
   * Sets NUT-11 SIG_ALL; on v3 keysets this is the default and only behavior.
   */
  sigAll() {
    this._sigAll = true;
    return this;
  }

  /**
   * Adds a SHA-256 hashlock (NUT-14 HTLC semantics): a preimage is required alongside signatures.
   *
   * @throws If the hashlock is not a 64-character hex string (SHA-256).
   */
  addHashlock(hashlock: string) {
    // Validate at the setter (like addMainPubkey) so a bad hashlock fails here, not
    // silently: an empty/invalid value must never be mistaken for "no hashlock" and
    // degrade the intended HTLC into a plain signature lock.
    this.hashlock = normalizeHashlock(hashlock);
    return this;
  }

  /**
   * Adds an explicit tree leaf beyond what the other methods express (eg staged reclaim windows).
   * v3 keysets only.
   *
   * @throws If the leaf does not serialize (unknown type, unattainable threshold, no keys).
   */
  addLeaf(leaf: NutrootLeaf) {
    serializeNutrootLeaf(leaf); // validate at the setter, like the other inputs
    this.leaves.push({ ...leaf, keys: [...leaf.keys] });
    return this;
  }

  /**
   * Builds the {@link LockOptions}, validating through a real encoder so a bad lock fails here.
   */
  toOptions(): LockOptions {
    if (this.mainKeys.length === 0 && this.hashlock === undefined && this.leaves.length === 0) {
      throw new CTSError('At least one main pubkey, hashlock, or leaf is required');
    }
    // Encoders drop inert refund keys quietly; the builder catches them as the user error they
    // almost certainly are (a forgotten lockUntil).
    if (this.refundKeys.length > 0 && this.locktime === undefined) {
      throw new CTSError('refund keys require a locktime');
    }
    const lock: LockOptions = {
      ...(this.mainKeys.length > 0 && { mainKeys: this.mainKeys.slice() }),
      // Drop a redundant threshold of 1, but keep an explicit one when its key set is empty so
      // encoding rejects the impossible lock rather than silently relaxing it.
      ...(this.nSigs !== undefined && (this.nSigs > 1 || this.mainKeys.length === 0)
        ? { requiredMainSignatures: this.nSigs }
        : {}),
      ...(this.hashlock !== undefined && { hashlock: this.hashlock }),
      ...(this.locktime !== undefined && { locktime: this.locktime }),
      ...(this.refundKeys.length > 0 && { refundKeys: this.refundKeys.slice() }),
      ...(this.nSigsRefund !== undefined && (this.nSigsRefund > 1 || this.refundKeys.length === 0)
        ? { requiredRefundSignatures: this.nSigsRefund }
        : {}),
      ...(this.leaves.length > 0 && { leaves: this.leaves.map((l) => ({ ...l })) }),
      ...(this._blindKeys !== undefined && { blindKeys: this._blindKeys }),
      ...(this.extraTags.length > 0 && { additionalTags: this.extraTags.slice() }),
      ...(this._sigAll && { sigAll: true }),
    };
    // Smoke-test through an encoder so a bad lock fails here, not at send time. v3-only shapes
    // validate structurally; everything else builds a real NUT-11 secret.
    if (lock.leaves || Array.isArray(lock.blindKeys)) {
      lockToNutrootOptions(lock);
    } else {
      const smokeTest = OutputData.createSingleP2PKData(lockToP2PKOptions(lock), 1, 'deedbeef');
      void smokeTest; // intentionally unused
    }
    return lock;
  }

  /**
   * Seeds a builder from existing {@link LockOptions}, eg to amend a stored lock.
   */
  static fromOptions(lock: LockOptions): LockBuilder {
    const b = new LockBuilder();
    if (lock.hashlock !== undefined) b.addHashlock(lock.hashlock);
    if (lock.mainKeys?.length) b.addMainPubkey(lock.mainKeys);
    // lock.locktime is already canonical Unix seconds; assign directly so lockUntil's
    // ms heuristic can't re-interpret a >= 1e12 second value and expire the lock.
    if (lock.locktime !== undefined) b.locktime = assertUnixSeconds(lock.locktime);
    if (lock.refundKeys?.length) b.addRefundPubkey(lock.refundKeys);
    if (lock.requiredMainSignatures !== undefined)
      b.requireMainSignatures(lock.requiredMainSignatures);
    if (lock.requiredRefundSignatures !== undefined)
      b.requireRefundSignatures(lock.requiredRefundSignatures);
    for (const leaf of lock.leaves ?? []) b.addLeaf(leaf);
    if (lock.blindKeys !== undefined && lock.blindKeys !== false) {
      b.blindKeys(lock.blindKeys === true ? undefined : lock.blindKeys);
    }
    if (lock.additionalTags?.length) b.addTags(lock.additionalTags);
    if (lock.sigAll) b.sigAll();
    return b;
  }
}
