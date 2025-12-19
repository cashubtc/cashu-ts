import { test, describe, expect } from 'vitest';

import { Wallet } from '../../src';
import { MINTCACHE } from '../consts';

const mintUrl = 'http://localhost:3338';
const wallet = new Wallet(mintUrl) as any;
wallet.loadMintFromCache(MINTCACHE.mintInfo, MINTCACHE.keychainCache);

describe('assertAmount tests', () => {
	test('allows valid integers', () => {
		expect(() => wallet.assertAmount(2561, 'test')).not.toThrow();
		expect(() => wallet.assertAmount(Number.MAX_SAFE_INTEGER, 'test')).not.toThrow(); // exact boundary (2^53 - 1)
	});

	test('rejects non-integer numbers', () => {
		expect(() => wallet.assertAmount(512.0019, 'test')).toThrow('Invalid amount: 512.0019');
		expect(() => wallet.assertAmount(NaN, 'test')).toThrow('Invalid amount: NaN');
		expect(() => wallet.assertAmount(Infinity, 'test')).toThrow('Invalid amount: Infinity');
		expect(() => wallet.assertAmount(-Infinity, 'test')).toThrow('Invalid amount: -Infinity');
	});

	test('rejects zero', () => {
		expect(() => wallet.assertAmount(0, 'test')).toThrow('Amount must be positive: 0');
	});

	test('rejects non number types', () => {
		expect(() => wallet.assertAmount('2561' as unknown, 'test')).toThrow('Invalid amount: 2561');
		expect(() => wallet.assertAmount('0' as unknown, 'test')).toThrow('Invalid amount: 0');
		expect(() => wallet.assertAmount(true as unknown, 'test')).toThrow('Invalid amount: true');
		expect(() => wallet.assertAmount(false as unknown, 'test')).toThrow('Invalid amount: false');
		expect(() => wallet.assertAmount({} as unknown, 'test')).toThrow('Invalid amount:');
		expect(() => wallet.assertAmount(null as unknown, 'test')).toThrow('Invalid amount: null');
		expect(() => wallet.assertAmount(undefined as unknown, 'test')).toThrow(
			'Invalid amount: undefined',
		);
	});

	test('rejects unsafe integer', () => {
		expect(() => wallet.assertAmount(9007199254740992, 'test')).toThrow(
			'Amount must be a safe integer',
		); // 2^53
		expect(() => wallet.assertAmount(Math.pow(2, 53), 'test')).toThrow(
			'Amount must be a safe integer',
		);
	});
});
