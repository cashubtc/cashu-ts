import {
  dedupeP2PKPubkeys,
  type LockConditions,
  type P2PKTag,
  type SigFlag,
  type P2PKOptions,
} from '../crypto';
import { CTSError } from '../model/Errors';
import { assertValidTagKey, OutputData } from '../model/OutputData';

function toUnixSeconds(input: Date | number): number {
  if (input instanceof Date) return Math.floor(input.getTime() / 1000);
  return input < 1e12 ? Math.floor(input) : Math.floor(input / 1000); // > 1e12 = ms
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
    this.locktime = toUnixSeconds(when);
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
    this.extraTags.push([key, ...vals.map(String)]); // all to strings
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

    // The first lock key is the P2PK `data` slot; the rest ride the `pubkeys` tag.
    // For an HTLC the hashlock is the `data` slot, so every lock key is a `pubkeys`
    // (receiver) key.
    const tagPubkeys = this.hashlock ? locks : locks.slice(1);

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

    const p2pk: P2PKOptions = this.hashlock
      ? { kind: 'HTLC', data: this.hashlock, ...conditions }
      : { kind: 'P2PK', data: locks[0], ...conditions };

    // Ensure the secret is valid (not too long etc); also validates options
    const smokeTest = OutputData.createSingleP2PKData(p2pk, 1, 'deedbeef');
    void smokeTest; // intentionally unused

    return p2pk;
  }

  static fromOptions(p2pk: P2PKOptions): P2PKBuilder {
    const b = new P2PKBuilder();
    if (p2pk.kind === 'HTLC') {
      b.addHashlock(p2pk.data);
      if (p2pk.pubkeys?.length) b.addLockPubkey(p2pk.pubkeys);
    } else {
      b.addLockPubkey([p2pk.data, ...(p2pk.pubkeys ?? [])]);
    }
    if (p2pk.locktime !== undefined) b.lockUntil(p2pk.locktime);
    if (p2pk.refundKeys?.length) b.addRefundPubkey(p2pk.refundKeys);
    if (p2pk.requiredSignatures !== undefined) b.requireLockSignatures(p2pk.requiredSignatures);
    if (p2pk.requiredRefundSignatures !== undefined)
      b.requireRefundSignatures(p2pk.requiredRefundSignatures);
    if (p2pk.additionalTags?.length) b.addTags(p2pk.additionalTags);
    if (p2pk.blindKeys) b.blindKeys();
    if (p2pk.sigFlag == 'SIG_ALL') b.sigAll();
    return b;
  }
}
