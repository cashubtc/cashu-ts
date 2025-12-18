import { test, describe, expect } from 'vitest';

import { Wallet } from '../../src';
import { MINTCACHE } from '../consts';

const mintUrl = 'http://localhost:3338';
const wallet = new Wallet(mintUrl) as any;
wallet.loadMintFromCache(MINTCACHE.mintInfo, MINTCACHE.keychainCache);
const expMsg = 'Amount must be a positive integer';

describe('assertAmount tests', () => {
	test('allows valid integers', () => {
		expect(() => wallet.assertAmount(2561, 'test')).not.toThrow();
		expect(() => wallet.assertAmount(Number.MAX_SAFE_INTEGER, 'test')).not.toThrow(); // exact boundary (2^53 - 1)
	});

	test('rejects non positive integer numbers', () => {
		expect(() => wallet.assertAmount(512.0019, 'test')).toThrow(expMsg);
		expect(() => wallet.assertAmount(NaN, 'test')).toThrow(expMsg);
		expect(() => wallet.assertAmount(Infinity, 'test')).toThrow(expMsg);
		expect(() => wallet.assertAmount(-Infinity, 'test')).toThrow(expMsg);
		expect(() => wallet.assertAmount(0, 'test')).toThrow(expMsg);
	});

	test('rejects non number types', () => {
		expect(() => wallet.assertAmount('2561' as unknown, 'test')).toThrow(expMsg);
		expect(() => wallet.assertAmount('0' as unknown, 'test')).toThrow(expMsg);
		expect(() => wallet.assertAmount(true as unknown, 'test')).toThrow(expMsg);
		expect(() => wallet.assertAmount(false as unknown, 'test')).toThrow(expMsg);
		expect(() => wallet.assertAmount({} as unknown, 'test')).toThrow(expMsg);
		expect(() => wallet.assertAmount(null as unknown, 'test')).toThrow(expMsg);
		expect(() => wallet.assertAmount(undefined as unknown, 'test')).toThrow(expMsg);
	});
	test('rejects unsafe integer', () => {
		const expMsg = 'Amount must be a safe integer';
		expect(() => wallet.assertAmount(9007199254740992, 'test')).toThrow(expMsg); // 2^53
		expect(() => wallet.assertAmount(Math.pow(2, 53), 'test')).toThrow(expMsg);
	});
});
