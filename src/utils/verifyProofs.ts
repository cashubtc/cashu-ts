import { hexToBytes } from '@noble/hashes/utils.js';

import { pointFromHex, verifyDLEQProof_reblind } from '../crypto';
import { Amount } from '../model/Amount';
import { CTSError } from '../model/Errors';
import type { HasKeysetKeys, Proof, ProofLike } from '../model/types';

import { budgetOrThrow, chunkSizeOrThrow, mapInChunks } from './chunked';
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
  const errors = await mapInChunks(proofs, (p) => verifyOne(p, getKeyset, require), {
    chunkSize: chunkSizeOrThrow(opts?.chunkSize),
    budgetMs: budgetOrThrow(opts?.budgetMs),
    signal: opts?.signal,
    onProgress: opts?.onProgress,
  });
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
