import { dedupeP2PKPubkeys, type P2PKOptions, type P2PKTag, type SigFlag } from '../crypto';
import { CTSError } from '../model/Errors';
import { assertValidTagKey, OutputData } from '../model/OutputData';

function assertUnixSeconds(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) {
    throw new CTSError(`locktime must be a non-negative finite Unix time, got ${seconds}`);
  }
  return Math.floor(seconds);
}

export class P2PKBuilder {
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

  addLockPubkey(pk: string | string[]) {
    const arr = Array.isArray(pk) ? pk : [pk];
    this.lockKeys = dedupeP2PKPubkeys([...this.lockKeys, ...arr]);
    return this;
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

  requireLockSignatures(n: number) {
    if (!Number.isInteger(n) || n < 1)
      throw new CTSError(`requiredSignatures (n_sigs) must be a positive integer, got ${n}`);
    this.nSigs = n;
    return this;
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
   */
  addHashlock(hashlock: string) {
    this.hashlock = hashlock;
    return this;
  }

  toOptions(): P2PKOptions {
    const locks = this.lockKeys;
    const refunds = this.refundKeys;

    // HTLC (NUT-14) locks to a hashlock, so lock pubkeys are optional there; a
    // plain P2PK always needs at least one.
    if (locks.length === 0 && !this.hashlock) {
      throw new CTSError('At least one lock pubkey is required');
    }

    const pubkey: string | string[] = locks.length === 1 ? locks[0] : locks;

    const p2pk: P2PKOptions = {
      pubkey,
      ...(this.locktime !== undefined ? { locktime: this.locktime } : {}),
      ...(refunds.length ? { refundKeys: refunds } : {}),
      // Drop a redundant default threshold of 1 (1-of-N is implied), but pass an
      // explicit threshold through when its key set is empty — a keyless HTLC with
      // n_sigs, or n_sigs_refund with no refund keys, is contradictory and must be
      // rejected by the smoke test below, not silently weakened to preimage-only.
      ...(this.nSigs !== undefined && (this.nSigs > 1 || locks.length === 0)
        ? { requiredSignatures: this.nSigs }
        : {}),
      ...(this.nSigsRefund !== undefined && (this.nSigsRefund > 1 || refunds.length === 0)
        ? { requiredRefundSignatures: this.nSigsRefund }
        : {}),
      ...(this.extraTags.length ? { additionalTags: this.extraTags.slice() } : {}),
      ...(this._blindKeys ? { blindKeys: true } : {}),
      ...(this.sigFlag == 'SIG_ALL' ? { sigFlag: 'SIG_ALL' } : {}),
      ...(this.hashlock ? { hashlock: this.hashlock } : {}),
    };

    // Ensure the secret is valid (not too long etc); also validates options
    const smokeTest = OutputData.createSingleP2PKData(p2pk, 1, 'deedbeef');
    void smokeTest; // intentionally unused

    return p2pk;
  }

  static fromOptions(opts: P2PKOptions): P2PKBuilder {
    const b = new P2PKBuilder();
<<<<<<< HEAD
    const locks = Array.isArray(opts.pubkey) ? opts.pubkey : [opts.pubkey];
    b.addLockPubkey(locks);
    if (opts.locktime !== undefined) b.lockUntil(opts.locktime);
    if (opts.refundKeys?.length) b.addRefundPubkey(opts.refundKeys);
    if (opts.requiredSignatures !== undefined) b.requireLockSignatures(opts.requiredSignatures);
    if (opts.requiredRefundSignatures !== undefined)
      b.requireRefundSignatures(opts.requiredRefundSignatures);
    if (opts.additionalTags?.length) b.addTags(opts.additionalTags);
    if (opts.blindKeys) b.blindKeys();
    if (opts.sigFlag == 'SIG_ALL') b.sigAll();
    if (opts.hashlock) b.addHashlock(opts.hashlock);
=======
    if (p2pk.kind === 'HTLC') {
      b.addHashlock(p2pk.data);
      if (p2pk.pubkeys?.length) b.addLockPubkey(p2pk.pubkeys);
    } else {
      b.addLockPubkey([p2pk.data, ...(p2pk.pubkeys ?? [])]);
    }
    // p2pk.locktime is already canonical Unix seconds; assign directly so lockUntil's
    // ms heuristic can't re-interpret a >= 1e12 second value and expire the lock.
    if (p2pk.locktime !== undefined) b.locktime = assertUnixSeconds(p2pk.locktime);
    if (p2pk.refundKeys?.length) b.addRefundPubkey(p2pk.refundKeys);
    if (p2pk.requiredSignatures !== undefined) b.requireLockSignatures(p2pk.requiredSignatures);
    if (p2pk.requiredRefundSignatures !== undefined)
      b.requireRefundSignatures(p2pk.requiredRefundSignatures);
    if (p2pk.additionalTags?.length) b.addTags(p2pk.additionalTags);
    if (p2pk.blindKeys) b.blindKeys();
    if (p2pk.sigFlag == 'SIG_ALL') b.sigAll();
>>>>>>> 6985fa1 (fix(wallet): harden P2PK spending-condition locktime and tag validation (#894))
    return b;
  }
}
