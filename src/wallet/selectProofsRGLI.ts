// Minimal types to avoid importing the whole wallet, keeps this module independent
import type { Proof } from '../model/types/proof';
import { fail, failIf, failIfNullish, type Logger, NULL_LOGGER, measureTime } from '../logger';
import { type SendResponse } from './types';
import { type KeyChain } from './KeyChain';

export type SelectProofs = (
	proofs: Proof[],
	amountToSend: number,
	keyChain: KeyChain,
	includeFees?: boolean,
	exactMatch?: boolean,
	logger?: Logger,
) => SendResponse;

export const selectProofsRGLI: SelectProofs = (
	proofs: Proof[],
	amountToSend: number,
	keyChain: KeyChain,
	includeFees: boolean = false,
	exactMatch: boolean = false,
	_logger: Logger = NULL_LOGGER,
): SendResponse => {
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
	interface ProofWithFee {
		proof: Proof;
		exFee: number;
		ppkfee: number;
	}
	const feeForProof = (proof: Proof): number => {
		try {
			return keyChain.getKeyset(proof.id).fee;
		} catch (e) {
			fail(`Could not get fee. No keyset found for keyset id: ${proof.id}`, _logger, {
				error: e,
				keychain: keyChain.getKeysets(),
			});
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
		if (netSum < amountToSend) return Infinity; // no good
		return amount + feePPK / 1000 - amountToSend;
	};

	/**
	 * Pre-processing.
	 */
	let totalAmount = 0;
	let totalFeePPK = 0;
	const proofWithFees = proofs.map((p) => {
		const ppkfee = feeForProof(p);
		const exFee = includeFees ? p.amount - ppkfee / 1000 : p.amount;
		const obj = { proof: p, exFee, ppkfee };
		// Sum all economical proofs (filtered below)
		if (!includeFees || exFee > 0) {
			totalAmount += p.amount;
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
			const rightIndex = binarySearchIndex(spendableProofs, amountToSend, true);
			endIndex = rightIndex !== null ? rightIndex + 1 : 0;
		} else {
			const biggerIndex = binarySearchIndex(spendableProofs, amountToSend, false);
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
			totalAmount -= spendableProofs[i].proof.amount;
			totalFeePPK -= spendableProofs[i].ppkfee;
		}
		spendableProofs = spendableProofs.slice(0, endIndex);
	}

	// Validate using precomputed totals
	const totalNetSum = sumExFees(totalAmount, totalFeePPK);
	if (amountToSend <= 0 || amountToSend > totalNetSum) {
		return { keep: proofs, send: [] };
	}

	// Max acceptable amount for non-exact matches
	const maxOverAmount = Math.min(
		Math.ceil(amountToSend * (1 + MAX_OVRPCT / 100)),
		amountToSend + MAX_OVRAMT,
		totalNetSum,
	);

	/**
	 * RGLI algorithm: Runs multiple trials (up to MAX_TRIALS) Each trial starts with randomized
	 * greedy subset (S) and then tries to improve that subset to get a valid solution. NOTE: Fees are
	 * dynamic, based on number of proofs (PPK), so we perform all calculations based on net amounts.
	 */
	for (let trial = 0; trial < MAX_TRIALS; trial++) {
		// PHASE 1: Randomized Greedy Selection
		// Add proofs up to amountToSend (after adjusting for fees)
		// for exact match or the first amount over target otherwise
		const S: ProofWithFee[] = [];
		let amount = 0;
		let feePPK = 0;
		for (const obj of shuffleArray(spendableProofs)) {
			const newAmount = amount + obj.proof.amount;
			const newFeePPK = feePPK + obj.ppkfee;
			const netSum = sumExFees(newAmount, newFeePPK);
			if (exactMatch && netSum > amountToSend) break;
			S.push(obj);
			amount = newAmount;
			feePPK = newFeePPK;
			if (netSum >= amountToSend) break;
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
				netSum === amountToSend ||
				(!exactMatch && netSum >= amountToSend && netSum <= maxOverAmount)
			) {
				break;
			}

			// Get details for proof being replaced (objP), and temporarily
			// calculate the subset amount/fee with that proof removed.
			const objP = S[i];
			const tempAmount = amount - objP.proof.amount;
			const tempFeePPK = feePPK - objP.ppkfee;
			const tempNetSum = sumExFees(tempAmount, tempFeePPK);
			const target = amountToSend - tempNetSum;

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
						amount = tempAmount + objQ.proof.amount;
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
				const tempAmount = amount - objP.proof.amount;
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
				bestSum === amountToSend ||
				(!exactMatch && bestSum >= amountToSend && bestSum <= maxOverAmount)
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
		const keep = proofs.filter((p) => !bestSubsetSet.has(p));
		_logger.info(`Proof selection took ${timer.elapsed()}ms`);
		return { keep, send: bestProofs };
	}
	return { keep: proofs, send: [] };
};
