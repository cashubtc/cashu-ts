/**
 * Internal wallet utilities — not part of the public API.
 */
import { Amount, type AmountLike } from '../model/Amount';
import type { Keys, Proof } from '../model/types';
import { splitAmount } from '../utils/core';

function getKeysetAmountsAsc(keys: Keys): Amount[] {
	const amounts = Object.keys(keys).map((k) => Amount.from(k));
	amounts.sort((a, b) => a.compareTo(b));
	return amounts;
}

/**
 * Creates a list of amounts to keep based on the proofs we have and the proofs we want to reach.
 *
 * @param proofsWeHave Proofs stored (from current mint) — only `.amount` is read.
 * @param amountToKeep Amount to keep.
 * @param keys Keys of current keyset.
 * @param targetCount The target number of proofs to reach.
 * @returns An array of amounts to keep.
 */
export function getKeepAmounts(
	proofsWeHave: Array<Pick<Proof, 'amount'>>,
	amountToKeep: AmountLike,
	keys: Keys,
	targetCount: number,
): Amount[] {
	const normalizedAmountToKeep = Amount.from(amountToKeep);
	const amountsWeWant: Amount[] = [];
	let runningTotal = Amount.zero();
	const amountsWeHave = proofsWeHave.map((p) => p.amount);
	for (const amt of getKeysetAmountsAsc(keys)) {
		const countWeHave = amountsWeHave.filter((a) => amt.equals(a)).length;
		const countWeWant = Math.max(targetCount - countWeHave, 0);
		for (let i = 0; i < countWeWant; ++i) {
			const nextTotal = runningTotal.add(amt);
			if (nextTotal.greaterThan(normalizedAmountToKeep)) {
				break;
			}
			amountsWeWant.push(amt);
			runningTotal = nextTotal;
		}
	}
	const amountDiff = normalizedAmountToKeep.subtract(runningTotal);
	if (!amountDiff.isZero()) {
		for (const amt of splitAmount(amountDiff, keys)) {
			amountsWeWant.push(amt);
			runningTotal = runningTotal.add(amt);
		}
	}
	return amountsWeWant.sort((a, b) => a.compareTo(b));
}
