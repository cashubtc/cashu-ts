export class AmountError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'AmountError';
	}
}

export type AmountLike = number | bigint | string | Amount;

/**
 * Immutable, non-negative integer amount value object.
 *
 * Internal representation is bigint. Use factory methods to instantiate.
 *
 * @example
 *
 *     Amount.from('21'); // string
 *     Amount.from(21); // number
 *     Amount.from(21n); // bigint
 *     Amount.zero();
 *     Amount.one();
 */
export class Amount {
	private readonly value: bigint;

	private constructor(value: bigint) {
		this.value = value;
		Object.freeze(this);
	}

	// -----------------------------------------------------------------
	// Section: Static Factories
	// -----------------------------------------------------------------

	/**
	 * Parse/normalize supported inputs into an Amount.
	 *
	 * @throws If input is negative, or `number` type input is above safe limit, or input is not a
	 *   finite integer.
	 */
	static from(input: AmountLike): Amount {
		if (input instanceof Amount) return input;

		if (typeof input === 'bigint') {
			if (input < 0n) {
				throw new AmountError(`Amount must be >= 0, got ${input}`);
			}
			return new Amount(input);
		}

		if (typeof input === 'number') {
			// number path is legacy-friendly but safety-checked
			if (!Number.isFinite(input) || !Number.isInteger(input)) {
				throw new AmountError(`Invalid number amount: ${input}`);
			}
			if (input < 0) {
				throw new AmountError(`Amount must be >= 0, got ${input}`);
			}
			if (!Number.isSafeInteger(input)) {
				throw new AmountError(`Unsafe integer amount: ${input}. Use bigint or decimal string.`);
			}
			return new Amount(BigInt(input));
		}

		if (typeof input === 'string') {
			// Decimal-only canonical form
			if (!/^(0|[1-9]\d*)$/.test(input)) {
				throw new AmountError(
					`Invalid amount string "${input}". Expected non-negative decimal integer.`,
				);
			}
			return new Amount(BigInt(input));
		}

		// Unknown type
		throw new AmountError('Unsupported amount input type');
	}

	static zero(): Amount {
		return new Amount(0n);
	}

	static one(): Amount {
		return new Amount(1n);
	}

	// -----------------------------------------------------------------
	// Section: Converters
	// -----------------------------------------------------------------

	/**
	 * Internal canonical value.
	 */
	toBigInt(): bigint {
		return this.value;
	}

	/**
	 * Safe conversion to number.
	 *
	 * @throws If value exceeds Number.MAX_SAFE_INTEGER.
	 */
	toNumber(): number {
		if (!this.isSafeNumber()) {
			throw new AmountError(
				`Amount ${this.value} exceeds Number.MAX_SAFE_INTEGER; use toBigInt/toString/toJSON.`,
			);
		}
		return Number(this.value);
	}

	/**
	 * Unsafe conversion to number. Precision can be lost above MAX_SAFE_INTEGER.
	 */
	toNumberUnsafe(): number {
		return Number(this.value);
	}

	/**
	 * Canonical decimal representation for logs/JSON string mode.
	 */
	toString(): string {
		return this.value.toString(10);
	}

	/**
	 * Returns number if a safe integer, string if not.
	 */
	toJSON(): number | string {
		return this.isSafeNumber() ? Number(this.value) : this.toString();
	}

	// -----------------------------------------------------------------
	// Section: Arithmetic
	// -----------------------------------------------------------------

	add(other: AmountLike): Amount {
		const o = Amount.from(other);
		return new Amount(this.value + o.value);
	}

	subtract(other: AmountLike): Amount {
		const o = Amount.from(other);
		const next = this.value - o.value;
		if (next < 0n) {
			throw new AmountError(`Amount underflow: ${this.value} - ${o.value} would be negative`);
		}
		return new Amount(next);
	}

	multiplyBy(factor: AmountLike): Amount {
		const f = Amount.from(factor).value;
		return new Amount(this.value * f);
	}

	divideBy(divisor: AmountLike): Amount {
		const d = Amount.from(divisor).value;
		if (d <= 0n) {
			throw new AmountError(`Divisor must be > 0, got ${d}`);
		}

		return new Amount(this.value / d); // integer division
	}

	modulo(divisor: AmountLike): Amount {
		const d = Amount.from(divisor).value;
		if (d <= 0n) {
			throw new AmountError(`Divisor must be > 0, got ${d}`);
		}

		return new Amount(this.value % d);
	}

	// -----------------------------------------------------------------
	// Section: Finance Helpers
	// -----------------------------------------------------------------

	/**
	 * Returns `ceil(this × numerator / denominator)` using integer arithmetic only.
	 *
	 * The default denominator of 100 makes common percentage calculations natural. Use a larger
	 * denominator to express fractional percentages without floats.
	 *
	 * @example Amount.ceilPercent(2) // ceil(2% of amount) amount.ceilPercent(1, 200) // ceil(0.5% of
	 * amount) amount.ceilPercent(15, 10) // ceil(1.5% of amount)
	 *
	 * @throws If numerator or denominator are not positive integers.
	 */
	ceilPercent(numerator: number, denominator: number = 100): Amount {
		if (!Number.isInteger(numerator) || numerator <= 0) {
			throw new AmountError(`ceilPercent: numerator must be a positive integer, got ${numerator}`);
		}
		if (!Number.isInteger(denominator) || denominator <= 0) {
			throw new AmountError(
				`ceilPercent: denominator must be a positive integer, got ${denominator}`,
			);
		}
		// ceil(a * n / d) = floor((a * n + d - 1) / d)
		return this.multiplyBy(numerator)
			.add(denominator - 1)
			.divideBy(denominator);
	}

	/**
	 * Returns `floor(this × numerator / denominator)` using integer arithmetic only.
	 *
	 * The natural complement to {@link ceilPercent} — use when you need the conservative lower bound,
	 * e.g. "maximum spendable after reserving fees".
	 *
	 * @example Amount.floorPercent(98) // floor(98% of amount) amount.floorPercent(1, 200) //
	 * floor(0.5% of amount)
	 *
	 * @throws If numerator or denominator are not positive integers.
	 */
	floorPercent(numerator: number, denominator: number = 100): Amount {
		if (!Number.isInteger(numerator) || numerator <= 0) {
			throw new AmountError(`floorPercent: numerator must be a positive integer, got ${numerator}`);
		}
		if (!Number.isInteger(denominator) || denominator <= 0) {
			throw new AmountError(
				`floorPercent: denominator must be a positive integer, got ${denominator}`,
			);
		}
		return this.multiplyBy(numerator).divideBy(denominator);
	}

	/**
	 * Returns true if this amount is within the inclusive range [min, max].
	 *
	 * @example Msats.inRange(data.minSendable, data.maxSendable)
	 *
	 * @throws If min > max.
	 */
	inRange(min: AmountLike, max: AmountLike): boolean {
		const lo = Amount.from(min);
		const hi = Amount.from(max);
		if (lo.greaterThan(hi)) {
			throw new AmountError(`inRange: min (${lo.toString()}) must be <= max (${hi.toString()})`);
		}
		return this.greaterThanOrEqual(lo) && this.lessThanOrEqual(hi);
	}

	/**
	 * Clamps this amount to the inclusive range [min, max].
	 *
	 * @example Fee.clamp(MIN_FEE, tokenAmount) invoiceAmount.clamp(Amount.from(minSendable),
	 * Amount.from(maxSendable))
	 *
	 * @throws If min > max.
	 */
	clamp(min: AmountLike, max: AmountLike): Amount {
		const lo = Amount.from(min);
		const hi = Amount.from(max);
		if (lo.greaterThan(hi)) {
			throw new AmountError(`clamp: min (${lo.toString()}) must be <= max (${hi.toString()})`);
		}
		return Amount.max(lo, Amount.min(hi, this));
	}

	/**
	 * Returns `round(this × numerator / denominator)` using integer arithmetic only.
	 *
	 * Useful for proportional rescaling — currency conversion, capacity checks, partial fills —
	 * without floating-point imprecision or overflow risk.
	 *
	 * Uses the identity: `round(a × b / c) = floor((2 × a × b + c) / (2 × c))`
	 *
	 * @example // Scale a 1000-sat amount down by a 3/4 ratio → 750 Amount.from(1000).scaledBy(3, 4)
	 *
	 *     // Proportional rescale: if neededAmount is too high, shrink estInvAmount to fit
	 *     estInvAmount.scaledBy(tokenAmount, neededAmount).subtract(1);
	 *
	 * @throws If numerator or denominator are zero or negative.
	 */
	scaledBy(numerator: AmountLike, denominator: AmountLike): Amount {
		const n = Amount.from(numerator);
		const d = Amount.from(denominator);
		if (n.isZero()) return Amount.zero();
		if (d.isZero()) {
			throw new AmountError('scaledBy: denominator must be > 0');
		}
		// round(a × n / d) = floor((2 × a × n + d) / (2 × d))
		return this.multiplyBy(n).multiplyBy(2).add(d).divideBy(d.multiplyBy(2));
	}

	// -----------------------------------------------------------------
	// Section: Comparison
	// -----------------------------------------------------------------

	/**
	 * Whether this Amount can be safely converted to a number.
	 */
	isSafeNumber(): boolean {
		const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
		return this.value <= maxSafe;
	}

	isZero(): boolean {
		return this.value === 0n;
	}

	equals(other: AmountLike): boolean {
		return this.value === Amount.from(other).value;
	}

	/**
	 * Compares this Amount with another Amount.
	 *
	 * Defines the natural ordering of Amount values. Useful for sorting and ordering logic.
	 *
	 * @returns -1 if this < other, 0 if equal, 1 if this > other.
	 */
	compareTo(other: AmountLike): -1 | 0 | 1 {
		const o = Amount.from(other).value;
		if (this.value < o) return -1;
		if (this.value > o) return 1;
		return 0;
	}

	lessThan(other: AmountLike): boolean {
		return this.compareTo(other) < 0;
	}

	lessThanOrEqual(other: AmountLike): boolean {
		return this.compareTo(other) <= 0;
	}

	greaterThan(other: AmountLike): boolean {
		return this.compareTo(other) > 0;
	}

	greaterThanOrEqual(other: AmountLike): boolean {
		return this.compareTo(other) >= 0;
	}

	// -----------------------------------------------------------------
	// Section: Helpers
	// -----------------------------------------------------------------

	static min(a: AmountLike, b: AmountLike): Amount {
		const aa = Amount.from(a);
		const bb = Amount.from(b);
		return aa.compareTo(bb) <= 0 ? aa : bb;
	}

	static max(a: AmountLike, b: AmountLike): Amount {
		const aa = Amount.from(a);
		const bb = Amount.from(b);
		return aa.compareTo(bb) >= 0 ? aa : bb;
	}

	static sum(values: Iterable<AmountLike>): Amount {
		let total = 0n;
		for (const v of values) {
			total += Amount.from(v).value;
		}
		return new Amount(total);
	}
}
