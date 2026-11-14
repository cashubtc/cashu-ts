import { hexToBytes } from '@noble/hashes/utils.js';

import { pointFromHex, verifyDLEQProof_reblind } from '../crypto';
import { safeCallback } from '../logger';
import { Amount } from '../model/Amount';
import { CTSError } from '../model/Errors';
import type { HasKeysetKeys, Proof, ProofLike } from '../model/types';

<<<<<<< HEAD
import { budgetOrThrow, chunkSizeOrThrow, mapInChunks } from './chunked';
import { hexToNumber } from './core';
=======
import { budgetOrThrow, chunkSizeOrThrow, mapInChunks, yieldToEventLoop } from './chunked';
import { hexToNumber, isRecord } from './core';
>>>>>>> 3012efc (fix(utils): check proof field types in verifyReceivedProofs (#1434))
import { ABSOLUTE_MAX_ARRAY_LENGTH } from './limits';

/**
 * Result of a proof verification: the caller's own objects, split, order preserved.
 */
export type ProofVerification<T> = {
  valid: T[];
  invalid: Array<{ proof: T; error: CTSError }>;
};

export type VerifyProofsOptions = {
  /**
   * When true, a proof without a DLEQ is invalid. The NUT-12 default accepts it ("verify if
   * present").
   */
  require?: boolean;
  /**
   * Most proofs checked between yields to the event loop. Default 32; the time budget usually
   * yields earlier.
   */
  chunkSize?: number;
  /**
   * Milliseconds of work between yields. Default 50, a few frames.
   */
  budgetMs?: number;
  /**
   * Checked between chunks; the call rejects with `CallerAbortError`.
   */
  signal?: AbortSignal;
  /**
   * Called after each chunk with proofs checked so far and the total.
   */
  onProgress?: (done: number, total: number) => void;
};

type Lookup = (id: string) => HasKeysetKeys;

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

<<<<<<< HEAD
/**
 * One proof: amount, keyset, denomination, then the DLEQ. Never throws.
 */
function verifyOne(raw: ProofLike, getKeyset: Lookup, require: boolean): CTSError | undefined {
  let p: Proof;
  try {
    p = { ...raw, amount: Amount.from(raw.amount) };
  } catch (cause) {
    return new CTSError(`Invalid amount ${String(raw.amount)} in keyset ${raw.id}`, { cause });
  }
=======
function show(v: unknown): string {
  try {
    return String(v);
  } catch {
    return typeof v;
  }
}

/**
 * Proofs from outside are untyped, so the fields every later step reads are checked first.
 */
function shapeError(p: unknown): Failure {
  if (
    isRecord(p) &&
    typeof p.id === 'string' &&
    typeof p.secret === 'string' &&
    typeof p.C === 'string'
  ) {
    return undefined;
  }
  return new CTSError('Proof must have a string id, secret and C');
}

function keyFor(p: Proof, getKeyset: Lookup): { key: string } | { error: CTSError } {
>>>>>>> 3012efc (fix(utils): check proof field types in verifyReceivedProofs (#1434))
  let ks: HasKeysetKeys;
  try {
    ks = getKeyset(p.id);
  } catch (e) {
    return new CTSError(messageOf(e), { cause: e });
  }
  // An empty keyset means keys were never loaded, not that the denomination is missing.
  if (Object.keys(ks.keys).length === 0) return new CTSError(`No keys loaded for keyset ${ks.id}`);
  const key = ks.keys[p.amount.toString()];
  if (!key) {
    return new CTSError(`Undefined key for amount ${p.amount.toString()} in keyset ${ks.id}`);
  }
  const fail = () =>
    new CTSError(
      `${require ? 'Token contains proofs with invalid or missing DLEQ' : 'Token contains a proof with an invalid DLEQ'} (keyset ${p.id}, amount ${p.amount.toString()})`,
    );
  if (p.dleq == undefined) return require ? fail() : undefined;
  // A DLEQ the wallet never completed with its own `r` is malformed, not absent.
  if (p.dleq.r == undefined) return fail();
  try {
    const ok = verifyDLEQProof_reblind(
      new TextEncoder().encode(p.secret),
      { e: hexToBytes(p.dleq.e), s: hexToBytes(p.dleq.s), r: hexToNumber(p.dleq.r) },
      pointFromHex(p.C),
      pointFromHex(key),
    );
    return ok ? undefined : fail();
  } catch {
    return fail();
  }
}

<<<<<<< HEAD
=======
type Failure = CTSError | undefined;

function failFor(require: boolean) {
  const failMsg = require
    ? 'Token contains proofs with invalid or missing DLEQ'
    : 'Token contains a proof with an invalid DLEQ';
  return (p: ProofLike) =>
    new CTSError(`${failMsg} (keyset ${p.id}, amount ${p.amount.toString()})`);
}

function normalize(raw: ProofLike): { p: Proof } | { error: CTSError } {
  try {
    return { p: { ...raw, amount: Amount.from(raw.amount) } };
  } catch (cause) {
    return {
      error: new CTSError(`Invalid amount ${show(raw.amount)} in keyset ${raw.id}`, { cause }),
    };
  }
}

/**
 * One v0/v1/v2 proof: keyset, denomination, then the DLEQ.
 */
function verifySecp(raw: ProofLike, getKeyset: Lookup, require: boolean): Failure {
  const n = normalize(raw);
  if ('error' in n) return n.error;
  const found = keyFor(n.p, getKeyset);
  if ('error' in found) return found.error;
  return dleqHolds(n.p, found.key, require) ? undefined : failFor(require)(n.p);
}

/**
 * One slice of v3 proofs: optional spend-info cascade, keyset, then one batched pairing.
 *
 * @remarks
 * The batch falls back to per-proof only when it fails, so a bad proof is named without paying a
 * pairing each on the happy path. With `cascade`, spend info must reconstruct the secret before
 * anything else is looked at (nutroot secrets 2.5.1).
 */
function verifyBlsSlice(
  slice: ProofLike[],
  getKeyset: Lookup,
  opts: { require: boolean; cascade: boolean },
): Failure[] {
  const fail = failFor(opts.require);
  const errors: Failure[] = new Array<Failure>(slice.length).fill(undefined);
  const items: Array<{ K2: G2Point; C: G1Point; secret: Uint8Array; index: number }> = [];
  slice.forEach((raw, index) => {
    const n = normalize(raw);
    if ('error' in n) {
      errors[index] = n.error;
      return;
    }
    const p = n.p;
    if (opts.cascade && p.spend_info) {
      try {
        verifyNutrootSpendInfo(p.secret, p.spend_info);
      } catch (e) {
        errors[index] = new CTSError(
          `${messageOf(e)} (keyset ${p.id}, amount ${p.amount.toString()})`,
        );
        return;
      }
    }
    const found = keyFor(p, getKeyset);
    if ('error' in found) {
      errors[index] = found.error;
      return;
    }
    try {
      assertV3PointSecret(p.secret);
      items.push({
        K2: pointFromHexG2(found.key),
        C: pointFromHexG1(p.C),
        secret: new TextEncoder().encode(p.secret),
        index,
      });
    } catch {
      // Malformed keyset hex, secret or C: invalid, never an unhandled throw.
      errors[index] = fail(p);
    }
  });
  if (items.length > 0) {
    // A single proof pairs directly; the batch wrapper would cost an extra multiplication.
    const batchOk = items.length > 1 && batchVerifyUnblindedSignatureBls(items);
    for (const it of items) {
      if (!batchOk && !verifyUnblindedSignatureBls(it.K2, it.C, it.secret)) {
        errors[it.index] = fail(slice[it.index]);
      }
    }
  }
  return errors;
}

>>>>>>> 3012efc (fix(utils): check proof field types in verifyReceivedProofs (#1434))
async function verify<T extends ProofLike>(
  proofs: T[],
  getKeyset: Lookup,
  opts: VerifyProofsOptions | undefined,
): Promise<ProofVerification<T>> {
  // Every proof costs curve work, so bound the batch before any of it.
  if (proofs.length > ABSOLUTE_MAX_ARRAY_LENGTH) {
    throw new CTSError(
      `Token contains too many proofs: ${proofs.length}, maximum is ${ABSOLUTE_MAX_ARRAY_LENGTH}`,
    );
  }
  const require = opts?.require ?? false;
<<<<<<< HEAD
  const errors = await mapInChunks(proofs, (p) => verifyOne(p, getKeyset, require), {
    chunkSize: chunkSizeOrThrow(opts?.chunkSize),
    budgetMs: budgetOrThrow(opts?.budgetMs),
    signal: opts?.signal,
    onProgress: (done, total) => safeCallback(() => opts?.onProgress?.(done, total), undefined),
  });
=======
  const cap = chunkSizeOrThrow(opts?.chunkSize);
  const budget = budgetOrThrow(opts?.budgetMs);
  const total = proofs.length;
  const errors: Failure[] = new Array<Failure>(total).fill(undefined);
  let done = 0;
  const report = () => safeCallback(() => opts?.onProgress?.(done, total), undefined);

  // v0/v1/v2: one DLEQ each, the helper yields on the time budget.
  const secp: number[] = [];
  const bls: number[] = [];
  proofs.forEach((p, i) => {
    errors[i] = shapeError(p);
    if (!errors[i]) (isBlsKeyset(p.id) ? bls : secp).push(i);
  });
  const malformed = total - secp.length - bls.length;
  await mapInChunks(secp, (i) => (errors[i] = verifySecp(proofs[i], getKeyset, require)), {
    chunkSize: cap,
    budgetMs: budget,
    signal: opts?.signal,
    onProgress: (n) => {
      done = malformed + n;
      report();
    },
  });

  // v3: a batched pairing per slice. A slice is one synchronous call, so its size is set from
  // the measured cost of the previous slice to fit the budget, within the cap.
  let sliceSize = Math.min(4, cap);
  for (let at = 0; at < bls.length;) {
    if (at > 0) {
      report();
      await yieldToEventLoop();
    }
    if (opts?.signal?.aborted) throw new CallerAbortError('Operation aborted by caller');
    const idx = bls.slice(at, at + sliceSize);
    const t0 = performance.now();
    const found = verifyBlsSlice(
      idx.map((i) => proofs[i]),
      getKeyset,
      { require, cascade },
    );
    const perItem = (performance.now() - t0) / idx.length;
    idx.forEach((i, k) => (errors[i] = found[k]));
    at += idx.length;
    done = malformed + secp.length + at;
    sliceSize = Math.max(1, Math.min(cap, Math.floor(budget / Math.max(perItem, 0.01))));
  }
  if (bls.length > 0) report();

>>>>>>> 3012efc (fix(utils): check proof field types in verifyReceivedProofs (#1434))
  const result: ProofVerification<T> = { valid: [], invalid: [] };
  errors.forEach((error, i) => {
    if (error) result.invalid.push({ proof: proofs[i], error });
    else result.valid.push(proofs[i]);
  });
  return result;
}

/**
 * Checks that the mint signed each proof (NUT-12 DLEQ), in chunks that yield to the event loop.
 *
 * @remarks
 * Replaces `hasValidDleq`, which v5 removes. The default here is NUT-12 verify-if-present; pass
 * `require: true` for `hasValidDleq`'s v4 default. Nothing throws per proof.
 * @throws {@link CTSError} If more proofs than the batch cap are passed, or an option is invalid.
 */
export function verifyMintSignatures<T extends ProofLike>(
  proofs: T[],
  getKeyset: (id: string) => HasKeysetKeys,
  opts?: VerifyProofsOptions,
): Promise<ProofVerification<T>> {
  return verify(proofs, getKeyset, opts);
}

/**
 * Verifies proofs that arrived from outside. Same as {@link verifyMintSignatures} on v4.
 *
 * @remarks
 * In v5 this also runs the nutroot spend-info cascade on v3 proofs, which v4 does not have. Use it
 * for received tokens now and the call carries over unchanged.
 * @throws {@link CTSError} If more proofs than the batch cap are passed, or an option is invalid.
 */
export function verifyReceivedProofs<T extends ProofLike>(
  proofs: T[],
  getKeyset: (id: string) => HasKeysetKeys,
  opts?: VerifyProofsOptions,
): Promise<ProofVerification<T>> {
  return verify(proofs, getKeyset, opts);
}
