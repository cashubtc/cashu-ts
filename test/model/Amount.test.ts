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

describe('Amount.floorPercent', () => {
	it('floors 2% of 1000 to 20', () => {
		expect(Amount.from(1000).floorPercent(2).toBigInt()).toBe(20n);
	});
	it('floors 1% of 101 to 1 (not 1.01)', () => {
		expect(Amount.from(101).floorPercent(1).toBigInt()).toBe(1n);
	});
	it('supports fractional percentages via larger denominator', () => {
		// floor(0.5% of 1000) = floor(5) = 5
		expect(Amount.from(1000).floorPercent(1, 200).toBigInt()).toBe(5n);
		// floor(0.5% of 1001) = floor(5.005) = 5
		expect(Amount.from(1001).floorPercent(1, 200).toBigInt()).toBe(5n);
	});
	it('returns zero for amounts smaller than the percentage unit', () => {
		expect(Amount.from(1).floorPercent(2).toBigInt()).toBe(0n);
	});
	it('throws for non-positive numerator or denominator', () => {
		expect(() => Amount.from(100).floorPercent(0)).toThrow('floorPercent');
		expect(() => Amount.from(100).floorPercent(2, 0)).toThrow('floorPercent');
		expect(() => Amount.from(100).floorPercent(-1)).toThrow('floorPercent');
	});
	it('works with large (unsafe integer) amounts', () => {
		const large = Amount.from(BigInt(Number.MAX_SAFE_INTEGER) + 1000n);
		const result = large.floorPercent(2);
		expect(result.toBigInt()).toBe((large.toBigInt() * 2n) / 100n);
	});
});

describe('Amount.ceilPercent', () => {
	it('ceils 2% of 1000 to 20', () => {
		expect(Amount.from(1000).ceilPercent(2).toBigInt()).toBe(20n);
	});
	it('ceils 2% of 101 to 3 (not 2.02)', () => {
		expect(Amount.from(101).ceilPercent(2).toBigInt()).toBe(3n);
	});
	it('ceils 2% of 100 to 2 exactly', () => {
		expect(Amount.from(100).ceilPercent(2).toBigInt()).toBe(2n);
	});
	it('supports fractional percentages via larger denominator', () => {
		// ceil(0.5% of 1000) = ceil(5) = 5
		expect(Amount.from(1000).ceilPercent(1, 200).toBigInt()).toBe(5n);
		// ceil(0.5% of 1001) = ceil(5.005) = 6
		expect(Amount.from(1001).ceilPercent(1, 200).toBigInt()).toBe(6n);
	});
	it('returns at least 1 for any positive amount', () => {
		expect(Amount.from(1).ceilPercent(2).toBigInt()).toBe(1n);
	});
	it('throws for non-positive numerator or denominator', () => {
		expect(() => Amount.from(100).ceilPercent(0)).toThrow('ceilPercent');
		expect(() => Amount.from(100).ceilPercent(2, 0)).toThrow('ceilPercent');
		expect(() => Amount.from(100).ceilPercent(-1)).toThrow('ceilPercent');
	});
});

describe('Amount.scaledBy', () => {
	it('rounds 1000 scaled by 3/4 to 750', () => {
		expect(Amount.from(1000).scaledBy(3, 4).toBigInt()).toBe(750n);
	});
	it('rounds 10 scaled by 1/3 to 3 (round half up)', () => {
		// 10 * 1/3 = 3.333... → rounds to 3
		expect(Amount.from(10).scaledBy(1, 3).toBigInt()).toBe(3n);
	});
	it('rounds 10 scaled by 2/3 to 7 (round half up)', () => {
		// 10 * 2/3 = 6.666... → rounds to 7
		expect(Amount.from(10).scaledBy(2, 3).toBigInt()).toBe(7n);
	});
	it('rounds 0.5 up (i.e. 1 scaled by 1/2 = 1)', () => {
		// 1 * 1/2 = 0.5 → rounds to 1
		expect(Amount.from(1).scaledBy(1, 2).toBigInt()).toBe(1n);
	});
	it('returns zero when numerator is zero', () => {
		expect(Amount.from(1000).scaledBy(0, 100).toBigInt()).toBe(0n);
	});
	it('accepts Amount arguments', () => {
		const token = Amount.from(900);
		const needed = Amount.from(1000);
		// round(500 * 900 / 1000) = round(450) = 450
		expect(Amount.from(500).scaledBy(token, needed).toBigInt()).toBe(450n);
	});
	it('throws for zero denominator', () => {
		expect(() => Amount.from(100).scaledBy(1, 0)).toThrow('scaledBy');
	});
	it('works with large (unsafe integer) amounts', () => {
		const large = Amount.from(BigInt(Number.MAX_SAFE_INTEGER) + 1000n);
		const scaled = large.scaledBy(3, 4);
		// Should equal floor((large * 3 * 2 + 4) / (4 * 2))
		const expected = (large.toBigInt() * 3n * 2n + 4n) / (4n * 2n);
		expect(scaled.toBigInt()).toBe(expected);
	});
});

describe('Amount.clamp', () => {
	it('returns value unchanged when within range', () => {
		expect(Amount.from(500).clamp(100, 1000).toBigInt()).toBe(500n);
	});
	it('clamps up to min when below range', () => {
		expect(Amount.from(50).clamp(100, 1000).toBigInt()).toBe(100n);
	});
	it('clamps down to max when above range', () => {
		expect(Amount.from(2000).clamp(100, 1000).toBigInt()).toBe(1000n);
	});
	it('returns min when value equals min', () => {
		expect(Amount.from(100).clamp(100, 1000).toBigInt()).toBe(100n);
	});
	it('returns max when value equals max', () => {
		expect(Amount.from(1000).clamp(100, 1000).toBigInt()).toBe(1000n);
	});
	it('handles min === max (point range)', () => {
		expect(Amount.from(500).clamp(200, 200).toBigInt()).toBe(200n);
	});
	it('accepts AmountLike arguments', () => {
		expect(Amount.from(500).clamp(100n, 1000n).toBigInt()).toBe(500n);
	});
	it('throws when min > max', () => {
		expect(() => Amount.from(500).clamp(1000, 100)).toThrow('clamp');
	});
});

describe('Amount.inRange', () => {
	it('returns true when within range', () => {
		expect(Amount.from(500).inRange(100, 1000)).toBe(true);
	});
	it('returns true at min boundary', () => {
		expect(Amount.from(100).inRange(100, 1000)).toBe(true);
	});
	it('returns true at max boundary', () => {
		expect(Amount.from(1000).inRange(100, 1000)).toBe(true);
	});
	it('returns false below min', () => {
		expect(Amount.from(99).inRange(100, 1000)).toBe(false);
	});
	it('returns false above max', () => {
		expect(Amount.from(1001).inRange(100, 1000)).toBe(false);
	});
	it('accepts AmountLike arguments', () => {
		expect(Amount.from(500).inRange(100n, 1000n)).toBe(true);
	});
	it('throws when min > max', () => {
		expect(() => Amount.from(500).inRange(1000, 100)).toThrow('inRange');
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
