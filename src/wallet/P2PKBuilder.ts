import {
  assertValidTagKey,
  dedupeP2PKPubkeys,
  normalizeHashlock,
  type LockConditions,
  type P2PKTag,
  type SigFlag,
  type P2PKOptions,
} from '../crypto';
import { CTSError } from '../model/Errors';
import { OutputData } from '../model/OutputData';

function assertUnixSeconds(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new CTSError(`locktime must be a non-negative finite Unix time, got ${seconds}`);
  }
  return Math.floor(seconds);
}

/**
 * Builder for lock spending conditions.
 *
 * @remarks
 * The v5 name for `P2PKBuilder`: adopt it (with `addMainPubkey` and `requireMainSignatures`) and
 * the v5 upgrade keeps these call sites compiling.
 */
export class LockBuilder {
  // Keys are deduplicated by x-only identity and first-seen order preserved.
  private lockKeys: string[] = [];
  private refundKeys: string[] = [];
  private locktime?: number;
  private nSigs?: number;
  private nSigsRefund?: number;
  private extraTags: P2PKTag[] = [];
  private _blindKeys?: boolean;
  private sigFlag?: SigFlag;
  private hashlock?: string;

  addMainPubkey(pk: string | string[]) {
    const arr = Array.isArray(pk) ? pk : [pk];
    this.lockKeys = dedupeP2PKPubkeys([...this.lockKeys, ...arr]);
    return this;
  }

  /**
   * @deprecated Use `addMainPubkey`. Removed in v5.
   */
  addLockPubkey(pk: string | string[]) {
    return this.addMainPubkey(pk);
  }

  addRefundPubkey(pk: string | string[]) {
    const arr = Array.isArray(pk) ? pk : [pk];
    this.refundKeys = dedupeP2PKPubkeys([...this.refundKeys, ...arr]);
    return this;
  }

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

  requireMainSignatures(n: number) {
    if (!Number.isInteger(n) || n < 1)
      throw new CTSError(`requiredSignatures (n_sigs) must be a positive integer, got ${n}`);
    this.nSigs = n;
    return this;
  }

  /**
   * @deprecated Use `requireMainSignatures`. Removed in v5.
   */
  requireLockSignatures(n: number) {
    return this.requireMainSignatures(n);
  }

  requireRefundSignatures(n: number) {
    if (!Number.isInteger(n) || n < 1)
      throw new CTSError(
        `requiredRefundSignatures (n_sigs_refund) must be a positive integer, got ${n}`,
      );
    this.nSigsRefund = n;
    return this;
  }

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

  addTags(tags: P2PKTag[]) {
    for (const [k, ...vals] of tags) this.addTag(k, vals);
    return this;
  }

  blindKeys() {
    this._blindKeys = true;
    return this;
  }

  sigAll() {
    this.sigFlag = 'SIG_ALL';
    return this;
  }

  /**
   * Converts a `P2PK` output into a NUT-14 `HTLC` kind output.
   *
   * @throws If the hashlock is not a 64-character hex string (SHA-256).
   */
  addHashlock(hashlock: string) {
    // Validate at the setter (like addLockPubkey) so a bad hashlock fails here, not
    // silently: an empty/invalid value must never be mistaken for "no hashlock" and
    // degrade the intended HTLC into a plain P2PK lock.
    this.hashlock = normalizeHashlock(hashlock);
    return this;
  }

  toOptions(): P2PKOptions {
    const locks = this.lockKeys;
    const refunds = this.refundKeys;

    // HTLC (NUT-14) locks to a hashlock, so lock pubkeys are optional there; a
    // plain P2PK always needs at least one.
    if (locks.length === 0 && this.hashlock === undefined) {
      throw new CTSError('At least one lock pubkey is required');
    }

    // The first lock key is the P2PK `data` slot; the rest ride the `pubkeys` tag.
    // For an HTLC the hashlock is the `data` slot, so every lock key is a `pubkeys`
    // (receiver) key. Branch on set-ness, not truthiness: addHashlock already rejects
    // empty/invalid values, so this only distinguishes "hashlock set" from "unset".
    const tagPubkeys = this.hashlock !== undefined ? locks : locks.slice(1);

    const conditions: LockConditions = {
      ...(tagPubkeys.length ? { pubkeys: tagPubkeys } : {}),
      ...(this.locktime !== undefined ? { locktime: this.locktime } : {}),
      ...(refunds.length ? { refundKeys: refunds } : {}),
      // Drop a redundant default of 1, but keep an explicit threshold when its key set is
      // empty (keyless HTLC / no refund keys) so the smoke test rejects the impossible lock.
      ...(this.nSigs !== undefined && (this.nSigs > 1 || locks.length === 0)
        ? { requiredSignatures: this.nSigs }
        : {}),
      ...(this.nSigsRefund !== undefined && (this.nSigsRefund > 1 || refunds.length === 0)
        ? { requiredRefundSignatures: this.nSigsRefund }
        : {}),
      ...(this.extraTags.length ? { additionalTags: this.extraTags.slice() } : {}),
      ...(this._blindKeys ? { blindKeys: true } : {}),
      ...(this.sigFlag == 'SIG_ALL' ? { sigFlag: 'SIG_ALL' } : {}),
    };

    const p2pk: P2PKOptions =
      this.hashlock !== undefined
        ? { kind: 'HTLC', data: this.hashlock, ...conditions }
        : { kind: 'P2PK', data: locks[0], ...conditions };

    // Ensure the secret is valid (not too long etc); also validates options
    const smokeTest = OutputData.createSingleP2PKData(p2pk, 1, 'deedbeef');
    void smokeTest; // intentionally unused

    return p2pk;
  }

  static fromOptions(p2pk: P2PKOptions): LockBuilder {
    const b = new LockBuilder();
    if (p2pk.kind === 'HTLC') {
      b.addHashlock(p2pk.data);
      if (p2pk.pubkeys?.length) b.addMainPubkey(p2pk.pubkeys);
    } else {
      b.addMainPubkey([p2pk.data, ...(p2pk.pubkeys ?? [])]);
    }
    // p2pk.locktime is already canonical Unix seconds; assign directly so lockUntil's
    // ms heuristic can't re-interpret a >= 1e12 second value and expire the lock.
    if (p2pk.locktime !== undefined) b.locktime = assertUnixSeconds(p2pk.locktime);
    if (p2pk.refundKeys?.length) b.addRefundPubkey(p2pk.refundKeys);
    if (p2pk.requiredSignatures !== undefined) b.requireMainSignatures(p2pk.requiredSignatures);
    if (p2pk.requiredRefundSignatures !== undefined)
      b.requireRefundSignatures(p2pk.requiredRefundSignatures);
    if (p2pk.additionalTags?.length) b.addTags(p2pk.additionalTags);
    if (p2pk.blindKeys) b.blindKeys();
    if (p2pk.sigFlag == 'SIG_ALL') b.sigAll();
    return b;
  }
}

/**
 * @deprecated Renamed {@link LockBuilder}. This alias is removed in v5.
 */
export const P2PKBuilder = LockBuilder;
/**
 * @deprecated Renamed {@link LockBuilder}. This alias is removed in v5.
 */
export type P2PKBuilder = LockBuilder;
