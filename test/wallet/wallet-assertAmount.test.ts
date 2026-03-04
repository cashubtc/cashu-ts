import { test, describe, expect } from 'vitest';

import { Wallet } from '../../src';
import { MINTCACHE } from '../consts';

const mintUrl = 'http://localhost:3338';
const wallet = new Wallet(mintUrl) as any;
wallet.loadMintFromCache(MINTCACHE.mintInfo, MINTCACHE.keychainCache);

describe('normalizeAmount tests', () => {
	test('allows valid integers', () => {
		expect(() => wallet.normalizeAmount(2561, 'test')).not.toThrow();
		expect(() => wallet.normalizeAmount(2561n, 'test')).not.toThrow();
		expect(() => wallet.normalizeAmount('2561', 'test')).not.toThrow();
		expect(() => wallet.normalizeAmount(Number.MAX_SAFE_INTEGER, 'test')).not.toThrow(); // exact boundary (2^53 - 1)
	});

	test('rejects non-integer numbers', () => {
		expect(() => wallet.normalizeAmount(512.0019, 'test')).toThrow(
			'Invalid number amount: 512.0019',
		);
		expect(() => wallet.normalizeAmount(NaN, 'test')).toThrow('Invalid number amount: NaN');
		expect(() => wallet.normalizeAmount(Infinity, 'test')).toThrow(
			'Invalid number amount: Infinity',
		);
		expect(() => wallet.normalizeAmount(-Infinity, 'test')).toThrow(
			'Invalid number amount: -Infinity',
		);
	});

	test('rejects zero', () => {
		expect(() => wallet.normalizeAmount(0, 'test')).toThrow('Amount must be positive: 0');
		expect(() => wallet.normalizeAmount(0n, 'test')).toThrow('Amount must be positive: 0');
		expect(() => wallet.normalizeAmount('0', 'test')).toThrow('Amount must be positive: 0');
	});

	test('rejects unsupported types', () => {
		expect(() => wallet.normalizeAmount(true as unknown, 'test')).toThrow(
			'Unsupported amount input type',
		);
		expect(() => wallet.normalizeAmount(false as unknown, 'test')).toThrow(
			'Unsupported amount input type',
		);
		expect(() => wallet.normalizeAmount({} as unknown, 'test')).toThrow(
			'Unsupported amount input type',
		);
		expect(() => wallet.normalizeAmount(null as unknown, 'test')).toThrow(
			'Unsupported amount input type',
		);
		expect(() => wallet.normalizeAmount(undefined as unknown, 'test')).toThrow(
			'Unsupported amount input type',
		);
	});

	test('rejects unsafe integer', () => {
		expect(() => wallet.normalizeAmount(9007199254740992, 'test')).toThrow('Unsafe integer amount'); // 2^53
		expect(() => wallet.normalizeAmount(Math.pow(2, 53), 'test')).toThrow('Unsafe integer amount');
	});
});
