import { test, describe, expect } from 'vitest';

import { Wallet } from '../../src';
import { MINTCACHE } from '../consts';

const mintUrl = 'http://localhost:3338';
const wallet = new Wallet(mintUrl, MINTCACHE) as any;
await wallet.loadMint();
const expMsg = 'Amount must be a non-negative integer';

describe('assertInteger', () => {
	test('allows valid integers', () => {
		expect(() => wallet.assertAmount(2561)).not.toThrow();
		expect(() => wallet.assertAmount(0)).not.toThrow();
	});

	test('rejects non integer numbers', () => {
		expect(() => wallet.assertAmount(512.0019)).toThrow(expMsg);
		expect(() => wallet.assertAmount(NaN)).toThrow(expMsg);
		expect(() => wallet.assertAmount(Infinity)).toThrow(expMsg);
		expect(() => wallet.assertAmount(-Infinity)).toThrow(expMsg);
	});

	test('rejects non number types', () => {
		expect(() => wallet.assertAmount('2561' as unknown)).toThrow(expMsg);
		expect(() => wallet.assertAmount('0' as unknown)).toThrow(expMsg);
		expect(() => wallet.assertAmount(true as unknown)).toThrow(expMsg);
		expect(() => wallet.assertAmount(false as unknown)).toThrow(expMsg);
		expect(() => wallet.assertAmount({} as unknown)).toThrow(expMsg);
		expect(() => wallet.assertAmount(null as unknown)).toThrow(expMsg);
		expect(() => wallet.assertAmount(undefined as unknown)).toThrow(expMsg);
	});
});
