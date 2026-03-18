import { describe, it, expect } from 'vitest';
import { Amount } from '../../src/model/Amount';

describe('Amount.from validation', () => {
	it('rejects negative bigint amounts', () => {
		expect(() => Amount.from(-1n)).toThrow('Amount must be >= 0');
	});

	it('rejects negative number amounts', () => {
		expect(() => Amount.from(-1)).toThrow('Amount must be >= 0');
	});

	it('rejects invalid decimal strings', () => {
		expect(() => Amount.from('-1')).toThrow('Invalid amount string');
		expect(() => Amount.from('01')).toThrow('Invalid amount string');
	});

	it('rejects unsupported input types', () => {
		expect(() => Amount.from({} as unknown as Amount)).toThrow('Unsupported amount input type');
	});
});

describe('Amount conversions', () => {
	it('constructs one and serializes safely', () => {
		const one = Amount.one();
		expect(one.toBigInt()).toBe(1n);
		expect(one.toJSON()).toBe(1); // safe integer → number
	});

	it('converts to unsafe numbers when needed', () => {
		const large = Amount.from(BigInt(Number.MAX_SAFE_INTEGER) + 10n);
		expect(large.toNumberUnsafe()).toBe(Number(large.toBigInt()));
		expect(large.toJSON()).toBe(String(large.toBigInt())); // unsafe integer → string
	});
});

describe('Amount.isSafeNumber', () => {
	it('returns true up to MAX_SAFE_INTEGER', () => {
		const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
		expect(Amount.from(0).isSafeNumber()).toBe(true);
		expect(Amount.from(maxSafe).isSafeNumber()).toBe(true);
	});

	it('returns false above MAX_SAFE_INTEGER', () => {
		const tooLarge = BigInt(Number.MAX_SAFE_INTEGER) + 1n;
		expect(Amount.from(tooLarge).isSafeNumber()).toBe(false);
	});

	it('matches toNumber safety guard', () => {
		const safe = Amount.from(Number.MAX_SAFE_INTEGER);
		expect(safe.toNumber()).toBe(Number.MAX_SAFE_INTEGER);

		const tooLarge = Amount.from(BigInt(Number.MAX_SAFE_INTEGER) + 1n);
		expect(() => tooLarge.toNumber()).toThrow('exceeds Number.MAX_SAFE_INTEGER');
	});
});

describe('Amount arithmetic and comparisons', () => {
	it('throws on underflow', () => {
		expect(() => Amount.from(1).subtract(2)).toThrow('Amount underflow');
	});

	it('validates divisors for division and modulo', () => {
		expect(() => Amount.from(10).divideBy(0)).toThrow('Divisor must be > 0');
		expect(() => Amount.from(10).modulo(0)).toThrow('Divisor must be > 0');
	});

	it('handles comparison helpers', () => {
		const amount = Amount.from(5);
		expect(amount.lessThanOrEqual(5)).toBe(true);
		expect(amount.lessThanOrEqual(6)).toBe(true);
		expect(amount.greaterThanOrEqual(5)).toBe(true);
		expect(amount.greaterThanOrEqual(4)).toBe(true);
	});

	it('performs arithmetic operations', () => {
		expect(Amount.from(10).subtract(3).toBigInt()).toBe(7n);
		expect(Amount.from(9).divideBy(3).toBigInt()).toBe(3n);
		expect(Amount.from(10).modulo(3).toBigInt()).toBe(1n);
	});

	it('computes min and max', () => {
		expect(Amount.min(3, 5).toBigInt()).toBe(3n);
		expect(Amount.max(3, 5).toBigInt()).toBe(5n);
	});
});
