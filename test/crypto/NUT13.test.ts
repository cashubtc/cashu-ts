import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, test } from 'vitest';
import { deriveBlindingFactor } from '../../src/crypto';

describe('deriveBlindingFactor', () => {
	test('preserves 32-byte encoding when reduced scalar has leading zeros', () => {
		const seed = new TextEncoder().encode('test seed for regression');
		const keysetId = '01abcdef0123456789abcdef0123456789abcdef0123456789abcdef01234567';

		const r = deriveBlindingFactor(seed, keysetId, 197);

		expect(r).toHaveLength(32);
		expect(bytesToHex(r)).toBe('008464578dd0553eda2793249681ca2996587a6118b0974bf295fc946b4e5911');
	});
});
