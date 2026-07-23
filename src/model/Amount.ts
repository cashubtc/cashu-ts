import { U64_MAX } from '../utils/limits';

import { CTSError } from './Errors';

export class AmountError extends CTSError {
  constructor(message: string) {
    super(message);
    this.name = 'AmountError';
    Object.setPrototypeOf(this, AmountError.prototype);
  }
}

/**
 * All types that can be converted to an {@link Amount} value object.
 */
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
    // Single choke point for the u64 ceiling: every Amount, including arithmetic results, is
    // <= u64 max. Muldiv helpers keep their wide intermediate in bigint and only construct the
    // divided-down result, so a valid `a*n/d` still works while an out-of-range result throws.
    if (value > U64_MAX) {
      throw new AmountError(`Amount exceeds u64 max, got ${value}`);
    }
    this.value = value;
    Object.freeze(this);
  }

  // -----------------------------------------------------------------
  // Section: Static Factories
  // -----------------------------------------------------------------

  /**
   * Parse/normalize supported inputs into an Amount.
   *
   * @throws If input is negative, exceeds the u64 range, is a non-finite/non-integer `number`, or
   *   is above the safe integer limit for a `number`.
   */
  static from(input: AmountLike): Amount {
    if (input instanceof Amount) return input;

    if (typeof input === 'bigint') {
      if (input < 0n) {
        throw new AmountError(`Amount must be >= 0, got ${input}`);
      }
      return new Amount(input); // constructor enforces the u64 ceiling
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
      // Length-gate before regex/BigInt: u64 max is 20 digits, so a longer amount string is
      // out of range by definition. Refuse it up front rather than run O(n) parsing on unbounded
      // input.
      if (input.length > 20) {
        throw new AmountError(`Amount exceeds u64 max: "${input.slice(0, 20)}..."`);
      }
      // Decimal-only canonical form
      if (!/^(0|[1-9]\d*)$/.test(input)) {
        throw new AmountError(
          `Invalid amount string "${input}". Expected non-negative decimal integer.`,
        );
      }
      return new Amount(BigInt(input)); // constructor enforces the u64 ceiling
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
   * Used by JSON.stringify() to convert Amount to string.
   */
  toJSON(): string {
    return this.toString();
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
   * @example
   *
   *     amount.ceilPercent(2); // ceil(2% of amount)
   *     amount.ceilPercent(1, 200); // ceil(0.5% of amount)
   *     amount.ceilPercent(15, 10); // ceil(1.5% of amount)
   *
   * @throws If numerator is a negative or non-integer, or denominator is not a positive integer.
   */
  ceilPercent(numerator: number, denominator: number = 100): Amount {
    if (!Number.isInteger(numerator) || numerator < 0) {
      throw new AmountError(
        `ceilPercent: numerator must be a non-negative integer, got ${numerator}`,
      );
    }
    if (!Number.isInteger(denominator) || denominator <= 0) {
      throw new AmountError(
        `ceilPercent: denominator must be a positive integer, got ${denominator}`,
      );
    }
    // ceil(a * n / d) = floor((a * n + d - 1) / d); the a*n intermediate stays in bigint
    const num = BigInt(numerator);
    const den = BigInt(denominator);
    return new Amount((this.value * num + (den - 1n)) / den);
  }

  /**
   * Returns `floor(this × numerator / denominator)` using integer arithmetic only.
   *
   * The natural complement to {@link Amount.ceilPercent} — use when you need the conservative lower
   * bound, e.g. "maximum spendable after reserving fees".
   *
   * @example
   *
   *     amount.floorPercent(98); // floor(98% of amount)
   *     amount.floorPercent(1, 200); // floor(0.5% of amount)
   *
   * @throws If numerator is a negative or non-integer, or denominator is not a positive integer.
   */
  floorPercent(numerator: number, denominator: number = 100): Amount {
    if (!Number.isInteger(numerator) || numerator < 0) {
      throw new AmountError(
        `floorPercent: numerator must be a non-negative integer, got ${numerator}`,
      );
    }
    if (!Number.isInteger(denominator) || denominator <= 0) {
      throw new AmountError(
        `floorPercent: denominator must be a positive integer, got ${denominator}`,
      );
    }
    // floor(a * n / d); the a*n intermediate stays in bigint
    const num = BigInt(numerator);
    const den = BigInt(denominator);
    return new Amount((this.value * num) / den);
  }

  /**
   * Returns true if this amount is within the inclusive range [min, max].
   *
   * @example
   *
   *     msats.inRange(data.minSendable, data.maxSendable);
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
   * @example
   *
   *     fee.clamp(MIN_FEE, tokenAmount);
   *     invoiceAmount.clamp(Amount.from(minSendable), Amount.from(maxSendable));
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
   * @example
   *
   *     // Scale a 1000-sat amount down by a 3/4 ratio → 750
   *     Amount.from(1000).scaledBy(3, 4);
   *
   *     // Proportional rescale: if neededAmount is too high, shrink estInvAmount to fit
   *     estInvAmount.scaledBy(tokenAmount, neededAmount).subtract(1);
   *
   * @throws If numerator or denominator are zero or negative.
   */
  scaledBy(numerator: AmountLike, denominator: AmountLike): Amount {
    const n = Amount.from(numerator).value;
    const d = Amount.from(denominator).value;
    if (n === 0n) return Amount.zero();
    if (d === 0n) {
      throw new AmountError('scaledBy: denominator must be > 0');
    }
    // round(a × n / d) = floor((2 × a × n + d) / (2 × d)); the 2*a*n intermediate stays in bigint
    return new Amount((2n * this.value * n + d) / (2n * d));
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

  // -----------------------------------------------------------------
  // Section: Unit lifting
  // -----------------------------------------------------------------

  /**
   * Tag this {@link Amount} with a currency unit, returning an {@link AmountWithUnit}.
   */
  withUnit(unit: string): AmountWithUnit {
    return new AmountWithUnit(this, unit);
  }
}

export class AmountWithUnitError extends CTSError {
  constructor(message: string) {
    super(message);
    this.name = 'AmountWithUnitError';
    Object.setPrototypeOf(this, AmountWithUnitError.prototype);
  }
}

/**
 * Immutable {@link Amount} paired with a currency unit.
 *
 * Binary ops require matching units (throw {@link AmountWithUnitError} otherwise); scalar ops
 * preserve the unit.
 *
 * Lift via {@link Amount.withUnit} / {@link AmountWithUnit.from}, drop via
 * {@link AmountWithUnit.toAmount}.
 *
 * @example
 *
 *     AmountWithUnit.from(100, 'sat');
 *     Amount.from(21).withUnit('sat');
 */
export class AmountWithUnit {
  private readonly _amount: Amount;
  readonly unit: string;

  constructor(amount: Amount, unit: string) {
    if (typeof unit !== 'string' || unit.length === 0) {
      throw new AmountWithUnitError('unit required');
    }
    this._amount = amount;
    this.unit = unit;
    Object.freeze(this);
  }

  // -----------------------------------------------------------------
  // Section: Static Factories
  // -----------------------------------------------------------------

  static from(value: AmountLike, unit: string): AmountWithUnit {
    return new AmountWithUnit(Amount.from(value), unit);
  }

  static zero(unit: string): AmountWithUnit {
    return new AmountWithUnit(Amount.zero(), unit);
  }

  static one(unit: string): AmountWithUnit {
    return new AmountWithUnit(Amount.one(), unit);
  }

  // -----------------------------------------------------------------
  // Section: Escape hatch
  // -----------------------------------------------------------------

  /**
   * Return the underlying unitless {@link Amount}, dropping the unit guard.
   */
  toAmount(): Amount {
    return this._amount;
  }

  // -----------------------------------------------------------------
  // Section: Pass-through converters (no unit dimension)
  // -----------------------------------------------------------------

  toBigInt(): bigint {
    return this._amount.toBigInt();
  }

  toNumber(): number {
    return this._amount.toNumber();
  }

  /**
   * Unit-bearing canonical form, e.g. `"[sat]: 100"`. Used by `String(x)`, template literals,
   * `console.log`, and any other string-coercion context.
   *
   * Leads with `[` (never a digit, sign, or decimal point) so that `parseInt(String(x))` /
   * `parseFloat(String(x))` return `NaN` even if the unit itself starts with digits — otherwise a
   * unit like `"9999sat"` would let `parseInt` silently extract `9999` from the unit and drop the
   * real amount.
   */
  toString(): string {
    return `[${this.unit}]: ${this._amount.toString()}`;
  }

  toJSON(): { amount: string; unit: string } {
    return { amount: this._amount.toString(), unit: this.unit };
  }

  /**
   * Coercion hook: returns the unit-bearing string for `"string"` hints (`String(x)`, template
   * literals), throws otherwise. Prevents `+`, `-`, `*`, `==`, `Number(x)`, etc. from silently
   * stripping the unit — use {@link AmountWithUnit.toAmount} for explicit numeric access.
   *
   * @internal
   */
  [Symbol.toPrimitive](hint: 'number' | 'string' | 'default'): string {
    if (hint === 'string') return this.toString();
    throw new AmountWithUnitError(
      `Implicit ${hint === 'number' ? 'numeric' : 'default'} coercion of AmountWithUnit is unsafe; use .toAmount() then explicit arithmetic, or .toString() for display.`,
    );
  }

  isZero(): boolean {
    return this._amount.isZero();
  }

  isSafeNumber(): boolean {
    return this._amount.isSafeNumber();
  }

  // -----------------------------------------------------------------
  // Section: Binary ops — strict unit match
  // -----------------------------------------------------------------

  private requireSameUnit(other: AmountWithUnit): void {
    if (this.unit !== other.unit) {
      throw new AmountWithUnitError(`unit mismatch: ${this.unit} vs ${other.unit}`);
    }
  }

  add(other: AmountWithUnit): AmountWithUnit {
    this.requireSameUnit(other);
    return new AmountWithUnit(this._amount.add(other._amount), this.unit);
  }

  subtract(other: AmountWithUnit): AmountWithUnit {
    this.requireSameUnit(other);
    return new AmountWithUnit(this._amount.subtract(other._amount), this.unit);
  }

  equals(other: AmountWithUnit): boolean {
    this.requireSameUnit(other);
    return this._amount.equals(other._amount);
  }

  compareTo(other: AmountWithUnit): -1 | 0 | 1 {
    this.requireSameUnit(other);
    return this._amount.compareTo(other._amount);
  }

  lessThan(other: AmountWithUnit): boolean {
    return this.compareTo(other) < 0;
  }

  lessThanOrEqual(other: AmountWithUnit): boolean {
    return this.compareTo(other) <= 0;
  }

  greaterThan(other: AmountWithUnit): boolean {
    return this.compareTo(other) > 0;
  }

  greaterThanOrEqual(other: AmountWithUnit): boolean {
    return this.compareTo(other) >= 0;
  }

  inRange(min: AmountWithUnit, max: AmountWithUnit): boolean {
    this.requireSameUnit(min);
    this.requireSameUnit(max);
    return this._amount.inRange(min._amount, max._amount);
  }

  clamp(min: AmountWithUnit, max: AmountWithUnit): AmountWithUnit {
    this.requireSameUnit(min);
    this.requireSameUnit(max);
    return new AmountWithUnit(this._amount.clamp(min._amount, max._amount), this.unit);
  }

  // -----------------------------------------------------------------
  // Section: Scalar ops — second arg dimensionless, unit preserved
  // -----------------------------------------------------------------

  multiplyBy(factor: AmountLike): AmountWithUnit {
    return new AmountWithUnit(this._amount.multiplyBy(factor), this.unit);
  }

  divideBy(divisor: AmountLike): AmountWithUnit {
    return new AmountWithUnit(this._amount.divideBy(divisor), this.unit);
  }

  modulo(divisor: AmountLike): AmountWithUnit {
    return new AmountWithUnit(this._amount.modulo(divisor), this.unit);
  }

  ceilPercent(numerator: number, denominator?: number): AmountWithUnit {
    return new AmountWithUnit(this._amount.ceilPercent(numerator, denominator), this.unit);
  }

  floorPercent(numerator: number, denominator?: number): AmountWithUnit {
    return new AmountWithUnit(this._amount.floorPercent(numerator, denominator), this.unit);
  }

  scaledBy(numerator: AmountLike, denominator: AmountLike): AmountWithUnit {
    return new AmountWithUnit(this._amount.scaledBy(numerator, denominator), this.unit);
  }

  // -----------------------------------------------------------------
  // Section: Statics
  // -----------------------------------------------------------------

  static min(a: AmountWithUnit, b: AmountWithUnit): AmountWithUnit {
    a.requireSameUnit(b);
    return a.compareTo(b) <= 0 ? a : b;
  }

  static max(a: AmountWithUnit, b: AmountWithUnit): AmountWithUnit {
    a.requireSameUnit(b);
    return a.compareTo(b) >= 0 ? a : b;
  }

  /**
   * Sum a unit-tagged iterable.
   *
   * - If `unit` is provided, every element must match it; the result has that unit. An empty iterable
   *   returns `AmountWithUnit.zero(unit)`.
   * - If `unit` is omitted, the iterable must be non-empty; the unit is inferred from the first
   *   element and every subsequent element must match. An empty iterable throws.
   *
   * @throws {AmountWithUnitError} On unit mismatch, or on empty iterable when `unit` is omitted.
   */
  static sum(values: Iterable<AmountWithUnit>, unit?: string): AmountWithUnit {
    let expected = unit;
    let total = 0n;
    let seen = false;
    for (const v of values) {
      if (expected === undefined) {
        expected = v.unit;
      } else if (v.unit !== expected) {
        throw new AmountWithUnitError(`unit mismatch: ${expected} vs ${v.unit}`);
      }
      total += v._amount.toBigInt();
      seen = true;
    }
    if (expected === undefined) {
      throw new AmountWithUnitError('cannot infer unit from empty sum');
    }
    return new AmountWithUnit(seen ? Amount.from(total) : Amount.zero(), expected);
  }
}
