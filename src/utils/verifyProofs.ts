import { hexToBytes } from '@noble/hashes/utils.js';

import {
  type G1Point,
  type G2Point,
  assertV3PointSecret,
  batchVerifyUnblindedSignatureBls,
  isBlsKeyset,
  pointFromHex,
  pointFromHexG1,
  pointFromHexG2,
  verifyDLEQProof_reblind,
  verifyUnblindedSignatureBls,
} from '../crypto';
import { verifyNutrootSpendInfo } from '../crypto/nutroot';
import { Amount } from '../model/Amount';
import { CallerAbortError, CTSError } from '../model/Errors';
import type { HasKeysetKeys, Proof, ProofLike } from '../model/types';

import { budgetOrThrow, chunkSizeOrThrow, mapInChunks, yieldToEventLoop } from './chunked';
import { hexToNumber } from './core';
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
   * When true, a v0/v1/v2 proof without a DLEQ is invalid. The NUT-12 default accepts it ("verify
   * if present"). Ignored for v3, which always pairing-verifies.
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

function keyFor(p: Proof, getKeyset: Lookup): { key: string } | { error: CTSError } {
  let ks: HasKeysetKeys;
  try {
    ks = getKeyset(p.id);
  } catch (e) {
    return { error: new CTSError(e instanceof Error ? e.message : String(e), { cause: e }) };
  }
  // An empty keyset means keys were never loaded (eg rotated-out keyset per NUT-01), not that
  // the denomination is missing. Say so: the two failures have different fixes.
  if (Object.keys(ks.keys).length === 0) {
    return { error: new CTSError(`No keys loaded for keyset ${ks.id}`) };
  }
  const key = ks.keys[p.amount.toString()];
  if (!key) {
    return {
      error: new CTSError(`Undefined key for amount ${p.amount.toString()} in keyset ${ks.id}`),
    };
  }
  return { key };
}

function dleqHolds(p: Proof, key: string, require: boolean): boolean {
  if (p.dleq == undefined) return !require;
  // A DLEQ the wallet never completed with its own `r` is malformed, not absent: it cannot be
  // re-blinded, and a zero blinding factor would assert the message was never blinded at all.
  if (p.dleq.r == undefined) return false;
  try {
    return verifyDLEQProof_reblind(
      new TextEncoder().encode(p.secret),
      { e: hexToBytes(p.dleq.e), s: hexToBytes(p.dleq.s), r: hexToNumber(p.dleq.r) },
      pointFromHex(p.C),
      pointFromHex(key),
    );
  } catch {
    return false;
  }
}

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
      error: new CTSError(`Invalid amount ${String(raw.amount)} in keyset ${raw.id}`, { cause }),
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
        const message = e instanceof Error ? e.message : 'Invalid spend info';
        errors[index] = new CTSError(`${message} (keyset ${p.id}, amount ${p.amount.toString()})`);
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

async function verify<T extends ProofLike>(
  proofs: T[],
  getKeyset: Lookup,
  opts: VerifyProofsOptions | undefined,
  cascade: boolean,
): Promise<ProofVerification<T>> {
  // Every proof costs curve work, so bound the batch before any of it: a token is untrusted
  // input and the cap is far above any real one.
  if (proofs.length > ABSOLUTE_MAX_ARRAY_LENGTH) {
    throw new CTSError(
      `Token contains too many proofs: ${proofs.length}, maximum is ${ABSOLUTE_MAX_ARRAY_LENGTH}`,
    );
  }
  const require = opts?.require ?? false;
  const cap = chunkSizeOrThrow(opts?.chunkSize);
  const budget = budgetOrThrow(opts?.budgetMs);
  const total = proofs.length;
  const errors: Failure[] = new Array<Failure>(total).fill(undefined);
  let done = 0;
  const report = () => opts?.onProgress?.(done, total);

  // v0/v1/v2: one DLEQ each, the helper yields on the time budget.
  const secp: number[] = [];
  const bls: number[] = [];
  proofs.forEach((p, i) => (isBlsKeyset(p.id) ? bls : secp).push(i));
  await mapInChunks(secp, (i) => (errors[i] = verifySecp(proofs[i], getKeyset, require)), {
    chunkSize: cap,
    budgetMs: budget,
    signal: opts?.signal,
    onProgress: (n) => {
      done = n;
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
    done = secp.length + at;
    sliceSize = Math.max(1, Math.min(cap, Math.floor(budget / Math.max(perItem, 0.01))));
  }
  if (bls.length > 0) report();

  const result: ProofVerification<T> = { valid: [], invalid: [] };
  errors.forEach((error, i) => {
    if (error) result.invalid.push({ proof: proofs[i], error });
    else result.valid.push(proofs[i]);
  });
  return result;
}

/**
 * Checks that the mint signed each proof: DLEQ on v0/v1/v2 (NUT-12), pairing on v3.
 *
 * @remarks
 * For signatures the mint just returned, or a store audit. Runs in chunks that yield to the event
 * loop. Spend info and witnesses are not looked at: use {@link verifyReceivedProofs} for proofs that
 * arrived from outside. An unknown keyset or denomination is reported as invalid.
 * @param getKeyset Lookup callback (e.g. `(id) => keyChain.getKeyset(id)`).
 * @throws {@link CTSError} If more proofs than the batch cap are passed.
 */
export function verifyMintSignatures<T extends ProofLike>(
  proofs: T[],
  getKeyset: (id: string) => HasKeysetKeys,
  opts?: VerifyProofsOptions,
): Promise<ProofVerification<T>> {
  return verify(proofs, getKeyset, opts, false);
}

/**
 * Verifies proofs that arrived from outside: the mint signature on every proof, and the nutroot
 * spend-info cascade on v3 proofs.
 *
 * @remarks
 * Same engine and options as {@link verifyMintSignatures}. A receive is all or nothing, so a caller
 * typically throws `invalid[0].error`, which names the offending keyset and amount.
 * @throws {@link CTSError} If more proofs than the batch cap are passed.
 */
export function verifyReceivedProofs<T extends ProofLike>(
  proofs: T[],
  getKeyset: (id: string) => HasKeysetKeys,
  opts?: VerifyProofsOptions,
): Promise<ProofVerification<T>> {
  return verify(proofs, getKeyset, opts, true);
}
