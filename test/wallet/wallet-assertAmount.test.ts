import { test, describe, expect } from 'vitest';

import { Wallet } from '../../src';
import { MINTCACHE } from '../consts';

const mintUrl = 'http://localhost:3338';
const wallet = new Wallet(mintUrl) as any;
wallet.loadMintFromCache(MINTCACHE.mintInfo, MINTCACHE.keychainCache);

describe('parseAmount tests', () => {
	test('allows valid integers', () => {
		expect(() => wallet.parseAmount(2561, 'test')).not.toThrow();
		expect(() => wallet.parseAmount(2561n, 'test')).not.toThrow();
		expect(() => wallet.parseAmount('2561', 'test')).not.toThrow();
		expect(() => wallet.parseAmount(Number.MAX_SAFE_INTEGER, 'test')).not.toThrow(); // exact boundary (2^53 - 1)
	});

	test('rejects non-integer numbers', () => {
		expect(() => wallet.parseAmount(512.0019, 'test')).toThrow('Invalid number amount: 512.0019');
		expect(() => wallet.parseAmount(NaN, 'test')).toThrow('Invalid number amount: NaN');
		expect(() => wallet.parseAmount(Infinity, 'test')).toThrow('Invalid number amount: Infinity');
		expect(() => wallet.parseAmount(-Infinity, 'test')).toThrow('Invalid number amount: -Infinity');
	});

	test('rejects zero', () => {
		expect(() => wallet.parseAmount(0, 'test')).toThrow('Amount must be positive: 0');
		expect(() => wallet.parseAmount(0n, 'test')).toThrow('Amount must be positive: 0');
		expect(() => wallet.parseAmount('0', 'test')).toThrow('Amount must be positive: 0');
	});

	test('rejects unsupported types', () => {
		expect(() => wallet.parseAmount(true as unknown, 'test')).toThrow(
			'Unsupported amount input type',
		);
		expect(() => wallet.parseAmount(false as unknown, 'test')).toThrow(
			'Unsupported amount input type',
		);
		expect(() => wallet.parseAmount({} as unknown, 'test')).toThrow(
			'Unsupported amount input type',
		);
		expect(() => wallet.parseAmount(null as unknown, 'test')).toThrow(
			'Unsupported amount input type',
		);
		expect(() => wallet.parseAmount(undefined as unknown, 'test')).toThrow(
			'Unsupported amount input type',
		);
	});

	test('rejects unsafe integer', () => {
		expect(() => wallet.parseAmount(9007199254740992, 'test')).toThrow('Unsafe integer amount'); // 2^53
		expect(() => wallet.parseAmount(Math.pow(2, 53), 'test')).toThrow('Unsafe integer amount');
	});
});
