// Minimal types to avoid importing the whole wallet, keeps this module independent
import { fail, failIf, failIfNullish, type Logger, NULL_LOGGER, measureTime } from '../logger';
import { Amount, type AmountLike } from '../model/Amount';
import { CTSError } from '../model/Errors';
import type { Proof, ProofLike } from '../model/types/proof';
import { normalizeProofAmounts } from '../utils';

import { type KeyChain } from './KeyChain';
import { type SendResponse } from './types';

export type SelectProofs = (
  proofs: ProofLike[],
  amountToSelect: AmountLike,
  keyChain: KeyChain,
  includeFees?: boolean,
  exactMatch?: boolean,
  logger?: Logger,
) => SendResponse;

export function selectProofsRGLI(
  proofs: ProofLike[],
  amountToSelect: AmountLike,
  keyChain: KeyChain,
  includeFees: boolean = false,
  exactMatch: boolean = false,
  _logger: Logger = NULL_LOGGER,
): SendResponse {
  const normalizedProofs = normalizeProofAmounts(proofs);
  const targetAmount = Amount.from(amountToSelect);
  const targetAmountNumber = targetAmount.toNumber();

  // Init vars
  const MAX_TRIALS = 60; // 40-80 is optimal (per RGLI paper)
  const MAX_OVRPCT = 0; // Acceptable close match overage (percent)
  const MAX_OVRAMT = 0; // Acceptable close match overage (absolute)
  const MAX_TIMEMS = 1000; // Halt new trials if over time (in ms)
  const MAX_P2SWAP = 5000; // Max number of Phase 2 improvement swaps
  const timer = measureTime(); // start the clock
  let bestSubset: ProofWithFee[] | null = null;
  let bestDelta = Infinity;
  let bestAmount = 0;
  let bestFeePPK = 0;

  /**
   * Helper Functions.
   */
  // Caches proof amount (number) and fee
  interface ProofWithFee {
    proof: Proof;
    amountNum: number; // proof.amount.toNumber()
    exFee: number;
    ppkfee: number;
  }
  // Looks up fee for a proof
  const feeForProof = (proof: Proof): number => {
    try {
      return keyChain.getKeyset(proof.id).fee;
    } catch (e) {
      const message = `Could not get fee. No keyset found for keyset id: ${proof.id}`;
      _logger.error(message, {
        error: e,
        keychain: keyChain.getKeysets(),
      });
      throw new CTSError(message, { cause: e });
    }
  };
  // Calculate net amount after fees
  const sumExFees = (amount: number, feePPK: number): number => {
    return amount - (includeFees ? Math.ceil(feePPK / 1000) : 0);
  };
  // Shuffle array for randomization
  const shuffleArray = <T>(array: T[]): T[] => {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      // Stryker disable next-line ArithmeticOperator: any in-range index yields a valid permutation; the shuffle need not be uniform
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  };
  // Performs a binary search on a sorted (ascending) array of ProofWithFee objects by exFee.
  // If lessOrEqual=true, returns the rightmost index where exFee <= value
  // If lessOrEqual=false, returns the leftmost index where exFee >= value
  const binarySearchIndex = (
    arr: ProofWithFee[],
    value: number,
    lessOrEqual: boolean,
  ): number | null => {
    let left = 0,
      right = arr.length - 1,
      result: number | null = null;
    while (left <= right) {
      const mid = Math.floor((left + right) / 2);
      const midValue = arr[mid].exFee;
      if (lessOrEqual ? midValue <= value : midValue >= value) {
        result = mid;
        if (lessOrEqual) left = mid + 1;
        else right = mid - 1;
      } else {
        if (lessOrEqual) right = mid - 1;
        else left = mid + 1;
      }
    }
    return lessOrEqual ? result : left < arr.length ? left : null;
  };
  // Insert into array of ProofWithFee objects sorted by exFee
  const insertSorted = (arr: ProofWithFee[], obj: ProofWithFee): void => {
    const value = obj.exFee;
    let left = 0,
      right = arr.length;
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (arr[mid].exFee < value) left = mid + 1;
      else right = mid;
    }
    arr.splice(left, 0, obj);
  };
  // "Delta" is the excess over amountToSend including fees
  // plus a tiebreaker to favour lower PPK keysets
  // NB: Solutions under amountToSend are invalid (delta: Infinity)
  const calculateDelta = (amount: number, feePPK: number): number => {
    const netSum = sumExFees(amount, feePPK);
    if (netSum < targetAmountNumber) return Infinity; // no good
    return amount + feePPK / 1000 - targetAmountNumber;
  };

  /**
   * Pre-processing.
   */
  let totalAmount = 0;
  let totalFeePPK = 0;
  const proofWithFees = normalizedProofs.map((p) => {
    // Guard: this algorithm uses number arithmetic throughout. Amounts above MAX_SAFE_INTEGER
    // (e.g. high-value proofs in msat-denomination mints) require a custom SelectProofs impl.
    if (p.amount.greaterThan(Number.MAX_SAFE_INTEGER)) {
      fail(
        'selectProofsRGLI does not support proof amounts > Number.MAX_SAFE_INTEGER. ' +
          'Provide a custom SelectProofs implementation for msat-scale wallets.',
        _logger,
      );
    }
    const ppkfee = feeForProof(p);
    const amountNum = p.amount.toNumber(); // safe: guarded above
    const exFee = includeFees ? amountNum - ppkfee / 1000 : amountNum;
    const obj = { proof: p, amountNum, exFee, ppkfee };
    // Sum all economical proofs (filtered below)
    if (!includeFees || exFee > 0) {
      totalAmount += amountNum;
      totalFeePPK += ppkfee;
    }
    return obj;
  });

  // Filter uneconomical proofs (totals computed above)
  let spendableProofs = includeFees ? proofWithFees.filter((obj) => obj.exFee > 0) : proofWithFees;

  // Sort by exFee ascending
  spendableProofs.sort((a, b) => a.exFee - b.exFee);

  // Remove proofs too large to be useful and adjust totals
  // Exact Match: Keep proofs where exFee <= amountToSend
  // Close Match: Keep proofs where exFee <= nextBiggerExFee
  if (spendableProofs.length > 0) {
    let endIndex;
    if (exactMatch) {
      const rightIndex = binarySearchIndex(spendableProofs, targetAmountNumber, true);
      endIndex = rightIndex !== null ? rightIndex + 1 : 0;
    } else {
      const biggerIndex = binarySearchIndex(spendableProofs, targetAmountNumber, false);
      if (biggerIndex !== null) {
        const nextBiggerExFee = spendableProofs[biggerIndex].exFee;
        const rightIndex = binarySearchIndex(spendableProofs, nextBiggerExFee, true);
        failIfNullish(rightIndex, 'Unexpected null rightIndex in binary search', _logger);
        endIndex = rightIndex + 1;
      } else {
        // Keep all proofs if all exFee < amountToSend
        endIndex = spendableProofs.length;
      }
    }
    // Adjust totals for removed proofs
    for (let i = endIndex; i < spendableProofs.length; i++) {
      totalAmount -= spendableProofs[i].amountNum;
      totalFeePPK -= spendableProofs[i].ppkfee;
    }
    spendableProofs = spendableProofs.slice(0, endIndex);
  }

  // Validate using precomputed totals
  const totalNetSum = sumExFees(totalAmount, totalFeePPK);
  if (targetAmount.isZero() || targetAmountNumber > totalNetSum) {
    return { keep: normalizedProofs, send: [] };
  }

  // Max acceptable amount for non-exact matches
  const maxOverAmount = Math.min(
    // Stryker disable next-line ArithmeticOperator: MAX_OVRPCT is 0, so the percentage arithmetic is identity
    Math.ceil(targetAmountNumber * (1 + MAX_OVRPCT / 100)),
    // Stryker disable next-line ArithmeticOperator: MAX_OVRAMT is 0, so + and - are identical
    targetAmountNumber + MAX_OVRAMT,
    totalNetSum,
  );

  /**
   * RGLI algorithm: Runs multiple trials (up to MAX_TRIALS) Each trial starts with randomized
   * greedy subset (S) and then tries to improve that subset to get a valid solution. NOTE: Fees are
   * dynamic, based on number of proofs (PPK), so we perform all calculations based on net amounts.
   */
  for (let trial = 0; trial < MAX_TRIALS; trial++) {
    // PHASE 1: Randomized Greedy Selection
    // Add proofs up to target amount (after adjusting for fees)
    // for exact match or the first amount over target otherwise
    const S: ProofWithFee[] = [];
    let amount = 0;
    let feePPK = 0;
    for (const obj of shuffleArray(spendableProofs)) {
      const newAmount = amount + obj.amountNum;
      const newFeePPK = feePPK + obj.ppkfee;
      const netSum = sumExFees(newAmount, newFeePPK);
      if (exactMatch && netSum > targetAmountNumber) break;
      S.push(obj);
      amount = newAmount;
      feePPK = newFeePPK;
      if (netSum >= targetAmountNumber) break;
    }

    // PHASE 2: Local Improvement
    // Examine all the amounts found in the first phase, and find the
    // amount not in the current solution (others), which would get us
    // closest to the amountToSend.

    // Calculate the "others" array (note: spendableProofs is sorted ASC)
    // Using set.has() for filtering gives faster lookups: O(n+m)
    // Using array.includes() would be way slower: O(n*m)
    const SSet = new Set(S);
    const others = spendableProofs.filter((obj) => !SSet.has(obj));
    // Generate a random order for accessing the trial subset ('S')
    const indices = shuffleArray(Array.from({ length: S.length }, (_, i) => i)).slice(
      0,
      MAX_P2SWAP,
    );
    for (const i of indices) {
      // Exact or acceptable close match solution found?
      const netSum = sumExFees(amount, feePPK);
      if (
        netSum === targetAmountNumber ||
        (!exactMatch && netSum >= targetAmountNumber && netSum <= maxOverAmount)
      ) {
        break;
      }

      // Get details for proof being replaced (objP), and temporarily
      // calculate the subset amount/fee with that proof removed.
      const objP = S[i];
      const tempAmount = amount - objP.amountNum;
      const tempFeePPK = feePPK - objP.ppkfee;
      const tempNetSum = sumExFees(tempAmount, tempFeePPK);
      const target = targetAmountNumber - tempNetSum;

      // Find a better replacement proof (objQ) and swap it in
      // Exact match can only replace larger to close on the target
      // Close match can replace larger or smaller as needed, but will
      // not replace larger unless it closes on the target
      const qIndex = binarySearchIndex(others, target, exactMatch);
      if (qIndex !== null) {
        const objQ = others[qIndex];
        if (!exactMatch || objQ.exFee > objP.exFee) {
          if (target >= 0 || objQ.exFee <= objP.exFee) {
            S[i] = objQ;
            amount = tempAmount + objQ.amountNum;
            feePPK = tempFeePPK + objQ.ppkfee;
            others.splice(qIndex, 1);
            insertSorted(others, objP);
          }
        }
      }
    }
    // Update best solution
    const delta = calculateDelta(amount, feePPK);
    if (delta < bestDelta) {
      _logger.debug(
        `selectProofsToSend: best solution found in trial #${trial} - amount: ${amount}, delta: ${delta}`,
      );
      bestSubset = [...S].sort((a, b) => b.exFee - a.exFee); // copy & sort
      bestDelta = delta;
      bestAmount = amount;
      bestFeePPK = feePPK;

      // "PHASE 3": Final check to make sure we haven't overpaid fees
      // and see if we can improve the solution. This is an adaptation
      // to the original RGLI, which helps us identify close match and
      // optimal fee solutions more consistently
      const tempS = [...bestSubset]; // copy
      while (tempS.length > 1 && bestDelta > 0) {
        const objP = tempS.pop() as ProofWithFee;
        const tempAmount = amount - objP.amountNum;
        const tempFeePPK = feePPK - objP.ppkfee;
        const tempDelta = calculateDelta(tempAmount, tempFeePPK);
        if (tempDelta == Infinity) break;
        if (tempDelta < bestDelta) {
          bestSubset = [...tempS];
          bestDelta = tempDelta;
          bestAmount = tempAmount;
          bestFeePPK = tempFeePPK;
          amount = tempAmount;
          feePPK = tempFeePPK;
        }
      }
    }
    // Check if solution is acceptable
    if (bestSubset && bestDelta < Infinity) {
      const bestSum = sumExFees(bestAmount, bestFeePPK);
      if (
        bestSum === targetAmountNumber ||
        (!exactMatch && bestSum >= targetAmountNumber && bestSum <= maxOverAmount)
      ) {
        break;
      }
    }
    // Time limit reached?
    if (timer.elapsed() > MAX_TIMEMS) {
      failIf(
        exactMatch,
        'Proof selection took too long. Try again with a smaller proof set.',
        _logger,
      );
      _logger.warn('Proof selection took too long. Returning best selection so far.');
      break;
    }
  }
  // Return Result
  if (bestSubset && bestDelta < Infinity) {
    const bestProofs = bestSubset.map((obj) => obj.proof);
    const bestSubsetSet = new Set(bestProofs);
    const keep = normalizedProofs.filter((p) => !bestSubsetSet.has(p));
    _logger.info(`Proof selection took ${timer.elapsed()}ms`);
    return { keep, send: bestProofs };
  }
  return { keep: normalizedProofs, send: [] };
}

/**
 * Keyset-rotation-aware proof selection. Wraps {@link selectProofsRGLI}.
 *
 * @remarks
 * Prefers stale keysets (base64 first, then older versions, inactive before active),
 * force-including whole stale buckets, dust and all, so balances rotate onto the current keyset.
 * Falls back to plain RGLI when the biased attempt has no solution.
 */
export function selectProofsRotating(
  proofs: ProofLike[],
  amountToSelect: AmountLike,
  keyChain: KeyChain,
  includeFees: boolean = false,
  exactMatch: boolean = false,
  _logger: Logger = NULL_LOGGER,
): SendResponse {
  const normalizedProofs = normalizeProofAmounts(proofs);
  const targetAmount = Amount.from(amountToSelect);
  const target = targetAmount.toBigInt();

  // Net sum under unified fee arithmetic (single ceil over the whole set).
  // Bigint keeps the wrapper exact at u64 scale; only pools delegated to RGLI
  // carry its number-arithmetic guard. Bigint not Amount because dust proofs
  // can netOf() negative (eg: 1 sat proof at 2000ppk).
  const netOf = (gross: bigint, ppk: bigint): bigint =>
    gross - (includeFees ? (ppk + 999n) / 1000n : 0n);
  // Partition the full set around a chosen send subset (proof secrets are unique)
  const toSendResponse = (send: Proof[]): SendResponse => {
    const sendSet = new Set(send.map((p) => p.secret));
    return { keep: normalizedProofs.filter((p) => !sendSet.has(p.secret)), send };
  };

  // Bucket by staleness: version rank (base64 = 0, else first id byte + 1), with
  // inactive before active within a version. Lower keys are staler.
  const buckets = new Map<number, { proofs: Proof[]; gross: bigint; ppk: bigint }>();
  for (const p of normalizedProofs) {
    const ks = keyChain.getKeyset(p.id); // throws for unknown keyset ids
    const rank = ks.hasHexId ? parseInt(p.id.slice(0, 2), 16) + 1 : 0;
    const key = rank * 2 + (ks.isActive ? 1 : 0);
    const bucket = buckets.get(key) ?? { proofs: [], gross: 0n, ppk: 0n };
    bucket.proofs.push(p);
    bucket.gross += p.amount.toBigInt();
    bucket.ppk += BigInt(ks.fee);
    buckets.set(key, bucket);
  }
  const order = [...buckets.keys()].sort((a, b) => a - b);

  // Fast path: nothing to rotate
  if (targetAmount.isZero() || order.length <= 1) {
    return selectProofsRGLI(
      normalizedProofs,
      targetAmount,
      keyChain,
      includeFees,
      exactMatch,
      _logger,
    );
  }

  // Walk stalest first, forcing whole buckets while the running net stays below target
  const forced: Proof[] = [];
  let fGross = 0n;
  let fPpk = 0n;
  let i = 0;
  for (; i < order.length; i++) {
    const b = buckets.get(order[i])!;
    const candidateNet = netOf(fGross + b.gross, fPpk + b.ppk);
    if (candidateNet > target) break; // boundary bucket (we will RGLI this one)
    // the whole bucket is needed: add all its proofs and continue to next bucket
    // push singly: spreading a huge bucket into push() can overflow the call stack
    for (const q of b.proofs) forced.push(q);
    fGross += b.gross;
    fPpk += b.ppk;
    if (candidateNet === target) return toSendResponse(forced); // forced buckets cover it exactly
  }

  // Delegate the residual to RGLI: boundary bucket first, then boundary plus fresher
  // The walk forced buckets only while strictly below target (equality returned
  // early), so the residual handed to RGLI is always at least 1
  if (i < order.length) {
    const residual = target - netOf(fGross, fPpk);
    const boundary = buckets.get(order[i])!.proofs;
    const fresher = order.slice(i + 1).flatMap((k) => buckets.get(k)!.proofs);
    const pools = fresher.length ? [boundary, boundary.concat(fresher)] : [boundary];
    for (const pool of pools) {
      let attempt: SendResponse;
      try {
        attempt = selectProofsRGLI(pool, residual, keyChain, includeFees, exactMatch, _logger);
      } catch (error) {
        _logger.debug('selectProofsRotating: biased attempt failed', { error });
        continue; // RGLI could not handle this pool (timeout or scale); widen or fall back
      }
      if (attempt.send.length === 0) continue;
      // Splitting forced/residual can overstate fees by one, so verify the merged
      // solution with a single ceil before accepting it
      let mergedGross = fGross;
      let mergedPpk = fPpk;
      for (const p of attempt.send) {
        mergedGross += p.amount.toBigInt();
        mergedPpk += BigInt(keyChain.getKeyset(p.id).fee);
      }
      const mergedNet = netOf(mergedGross, mergedPpk);
      if (exactMatch ? mergedNet === target : mergedNet >= target) {
        return toSendResponse(forced.concat(attempt.send));
      }
    }
  }

  // No biased solution, or every bucket forced without covering the target: plain RGLI
  return selectProofsRGLI(
    normalizedProofs,
    targetAmount,
    keyChain,
    includeFees,
    exactMatch,
    _logger,
  );
}
