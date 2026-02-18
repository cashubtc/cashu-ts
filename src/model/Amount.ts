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
		const maxSafe = BigInt(Number.MAX_SAFE_INTEGER);
		if (this.value > maxSafe) {
			throw new AmountError(
				`Amount ${this.value} exceeds Number.MAX_SAFE_INTEGER; use bigint/string.`,
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

	toJSON(): string {
		return this.toString(); // safer than number for u64
	}

	isZero(): boolean {
		return this.value === 0n;
	}

	// -----------------------------------------------------------------
	// Section: Arithmetic
	// -----------------------------------------------------------------

	add(other: AmountLike): Amount {
		const o = Amount.from(other);
		return new Amount(this.value + o.value);
	}

	sub(other: AmountLike): Amount {
		const o = Amount.from(other);
		const next = this.value - o.value;
		if (next < 0n) {
			throw new AmountError(`Amount underflow: ${this.value} - ${o.value} would be negative`);
		}
		return new Amount(next);
	}

	mul(factor: number | bigint): Amount {
		let f: bigint;
		if (typeof factor === 'number') {
			if (!Number.isFinite(factor) || !Number.isInteger(factor)) {
				throw new AmountError(`Invalid multiplier: ${factor}`);
			}
			f = BigInt(factor);
		} else {
			f = factor;
		}

		if (f < 0n) {
			throw new AmountError(`Multiplier must be >= 0, got ${f}`);
		}

		return new Amount(this.value * f);
	}

	div(divisor: number | bigint): Amount {
		let d: bigint;
		if (typeof divisor === 'number') {
			if (!Number.isFinite(divisor) || !Number.isInteger(divisor)) {
				throw new AmountError(`Invalid divisor: ${divisor}`);
			}
			d = BigInt(divisor);
		} else {
			d = divisor;
		}

		if (d <= 0n) {
			throw new AmountError(`Divisor must be > 0, got ${d}`);
		}

		return new Amount(this.value / d); // integer division
	}

	mod(divisor: number | bigint): Amount {
		let d: bigint;
		if (typeof divisor === 'number') {
			if (!Number.isFinite(divisor) || !Number.isInteger(divisor)) {
				throw new AmountError(`Invalid divisor: ${divisor}`);
			}
			d = BigInt(divisor);
		} else {
			d = divisor;
		}

		if (d <= 0n) {
			throw new AmountError(`Divisor must be > 0, got ${d}`);
		}

		return new Amount(this.value % d);
	}

	// -----------------------------------------------------------------
	// Section: Comparison
	// -----------------------------------------------------------------

	eq(other: AmountLike): boolean {
		return this.value === Amount.from(other).value;
	}

	lt(other: AmountLike): boolean {
		return this.value < Amount.from(other).value;
	}

	lte(other: AmountLike): boolean {
		return this.value <= Amount.from(other).value;
	}

	gt(other: AmountLike): boolean {
		return this.value > Amount.from(other).value;
	}

	gte(other: AmountLike): boolean {
		return this.value >= Amount.from(other).value;
	}

	// -----------------------------------------------------------------
	// Section: Helpers
	// -----------------------------------------------------------------

	static min(a: AmountLike, b: AmountLike): Amount {
		const aa = Amount.from(a);
		const bb = Amount.from(b);
		return aa.lte(bb) ? aa : bb;
	}

	static max(a: AmountLike, b: AmountLike): Amount {
		const aa = Amount.from(a);
		const bb = Amount.from(b);
		return aa.gte(bb) ? aa : bb;
	}

	static sum(values: Iterable<AmountLike>): Amount {
		let total = 0n;
		for (const v of values) {
			total += Amount.from(v).value;
		}
		return new Amount(total);
	}
}
