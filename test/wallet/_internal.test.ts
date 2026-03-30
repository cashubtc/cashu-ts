import { test, describe, expect } from 'vitest';
import { type Keys, type Proof } from '../../src';
import { PUBKEYS } from '../consts';
import { getKeepAmounts } from '../../src/wallet/_internal';

describe('getKeepAmounts', () => {
	const amountsWeHave = [1, 2, 4, 4, 4, 8];
	const proofsWeHave = amountsWeHave.map((amount) => {
		return {
			amount: BigInt(amount),
			id: 'id',
			C: 'C',
		} as Proof;
	});
	const keys = PUBKEYS as Keys;

	test('keep amounts', () => {
		// info: getKeepAmounts returns the amounts we need to fill up
		// the wallet to a target number of denominations plus an optimal
		// split of the remaining amount (to reach the total amount)

		let amountsToKeep = getKeepAmounts(proofsWeHave, 22, keys, 3);
		// keeping 22 with a target count of 3, we expect two 1s, two 2s, no 4s, and two 8s, and no extra to reach 22
		expect(amountsToKeep.map((a) => a.toNumber())).toEqual([1, 1, 2, 2, 8, 8]);

		// keeping 22 with a target count of 4, we expect three 1s, three 2s, one 4, and one 8 and another 1 to reach 22
		amountsToKeep = getKeepAmounts(proofsWeHave, 22, keys, 4);
		expect(amountsToKeep.map((a) => a.toNumber())).toEqual([1, 1, 1, 1, 2, 2, 2, 4, 8]);

		// keeping 22 with a target of 2, we expect one 1, one 2, no 4s, one 8, and another 1, 2, 8 to reach 22
		amountsToKeep = getKeepAmounts(proofsWeHave, 22, keys, 2);
		expect(amountsToKeep.map((a) => a.toNumber())).toEqual([1, 1, 2, 2, 8, 8]);

		amountsToKeep = getKeepAmounts(proofsWeHave, '22', keys, 2);
		expect(amountsToKeep.map((a) => a.toNumber())).toEqual([1, 1, 2, 2, 8, 8]);
	});
});
