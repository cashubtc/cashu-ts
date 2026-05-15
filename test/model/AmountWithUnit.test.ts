import { describe, it, expect } from 'vitest';
import { Amount, AmountWithUnit, AmountWithUnitError } from '../../src/model/Amount';

describe('AmountWithUnit construction', () => {
  it('rejects empty unit string', () => {
    expect(() => new AmountWithUnit(Amount.from(1), '')).toThrow(AmountWithUnitError);
    expect(() => new AmountWithUnit(Amount.from(1), '')).toThrow('unit required');
  });

  it('rejects non-string unit', () => {
    expect(() => new AmountWithUnit(Amount.from(1), undefined as unknown as string)).toThrow(
      AmountWithUnitError,
    );
    expect(() => new AmountWithUnit(Amount.from(1), null as unknown as string)).toThrow(
      AmountWithUnitError,
    );
  });

  it('stores amount and unit', () => {
    const a = AmountWithUnit.from(100, 'sat');
    expect(a.toAmount().toBigInt()).toBe(100n);
    expect(a.unit).toBe('sat');
  });

  it('is frozen — assignment to unit throws in strict mode', () => {
    const a = AmountWithUnit.from(1, 'sat');
    expect(() => {
      (a as unknown as { unit: string }).unit = 'usd';
    }).toThrow();
  });
});

describe('AmountWithUnit factories', () => {
  it('AmountWithUnit.from accepts AmountLike + unit', () => {
    expect(AmountWithUnit.from(100, 'sat').toAmount().toBigInt()).toBe(100n);
    expect(AmountWithUnit.from(100n, 'sat').toAmount().toBigInt()).toBe(100n);
    expect(AmountWithUnit.from('100', 'sat').toAmount().toBigInt()).toBe(100n);
    expect(AmountWithUnit.from(Amount.from(100), 'sat').toAmount().toBigInt()).toBe(100n);
  });

  it('AmountWithUnit.zero / one', () => {
    expect(AmountWithUnit.zero('sat').toAmount().toBigInt()).toBe(0n);
    expect(AmountWithUnit.one('usd').toAmount().toBigInt()).toBe(1n);
    expect(AmountWithUnit.zero('sat').unit).toBe('sat');
    expect(AmountWithUnit.one('usd').unit).toBe('usd');
  });
});

describe('AmountWithUnit pass-through converters', () => {
  it('toBigInt / toNumber match underlying Amount', () => {
    const a = AmountWithUnit.from(123, 'sat');
    expect(a.toBigInt()).toBe(a.toAmount().toBigInt());
    expect(a.toNumber()).toBe(a.toAmount().toNumber());
  });

  it('toString returns "<unit>: <amount>" (does not silently drop unit)', () => {
    expect(AmountWithUnit.from(123, 'sat').toString()).toBe('sat: 123');
    expect(AmountWithUnit.from(5, 'usd').toString()).toBe('usd: 5');
    expect(AmountWithUnit.zero('msat').toString()).toBe('msat: 0');
  });

  it('isZero / isSafeNumber match underlying Amount', () => {
    expect(AmountWithUnit.zero('sat').isZero()).toBe(true);
    expect(AmountWithUnit.one('sat').isZero()).toBe(false);
    expect(AmountWithUnit.from(1, 'sat').isSafeNumber()).toBe(true);
    expect(AmountWithUnit.from(BigInt(Number.MAX_SAFE_INTEGER) + 1n, 'sat').isSafeNumber()).toBe(
      false,
    );
  });
});

describe('AmountWithUnit.toJSON', () => {
  it('returns { amount: string, unit: string }', () => {
    const a = AmountWithUnit.from(100, 'sat');
    expect(a.toJSON()).toEqual({ amount: '100', unit: 'sat' });
  });

  it('round-trips through JSON.stringify', () => {
    const a = AmountWithUnit.from(100, 'sat');
    expect(JSON.parse(JSON.stringify(a))).toEqual({ amount: '100', unit: 'sat' });
  });
});

describe('AmountWithUnit binary ops', () => {
  const a = AmountWithUnit.from(100, 'sat');
  const b = AmountWithUnit.from(40, 'sat');
  const c = AmountWithUnit.from(5, 'usd');

  it('add matches Amount.add when units agree', () => {
    expect(a.add(b).toAmount().toBigInt()).toBe(140n);
    expect(a.add(b).unit).toBe('sat');
  });

  it('add throws AmountWithUnitError on unit mismatch', () => {
    expect(() => a.add(c)).toThrow(AmountWithUnitError);
    expect(() => a.add(c)).toThrow('unit mismatch: sat vs usd');
  });

  it('subtract matches Amount.subtract when units agree', () => {
    expect(a.subtract(b).toAmount().toBigInt()).toBe(60n);
  });

  it('subtract throws on unit mismatch', () => {
    expect(() => a.subtract(c)).toThrow(AmountWithUnitError);
  });

  it('equals throws on unit mismatch (not silently false)', () => {
    expect(a.equals(AmountWithUnit.from(100, 'sat'))).toBe(true);
    expect(a.equals(b)).toBe(false);
    expect(() => a.equals(c)).toThrow(AmountWithUnitError);
  });

  it('compareTo throws on unit mismatch', () => {
    expect(a.compareTo(b)).toBe(1);
    expect(b.compareTo(a)).toBe(-1);
    expect(a.compareTo(AmountWithUnit.from(100, 'sat'))).toBe(0);
    expect(() => a.compareTo(c)).toThrow(AmountWithUnitError);
  });

  it('comparators throw on unit mismatch', () => {
    expect(() => a.lessThan(c)).toThrow(AmountWithUnitError);
    expect(() => a.lessThanOrEqual(c)).toThrow(AmountWithUnitError);
    expect(() => a.greaterThan(c)).toThrow(AmountWithUnitError);
    expect(() => a.greaterThanOrEqual(c)).toThrow(AmountWithUnitError);
  });

  it('comparators agree with raw Amount semantics for same-unit pairs', () => {
    expect(a.greaterThan(b)).toBe(true);
    expect(b.lessThan(a)).toBe(true);
    expect(a.greaterThanOrEqual(AmountWithUnit.from(100, 'sat'))).toBe(true);
    expect(a.lessThanOrEqual(AmountWithUnit.from(100, 'sat'))).toBe(true);
  });

  it('inRange / clamp respect unit', () => {
    const lo = AmountWithUnit.from(10, 'sat');
    const hi = AmountWithUnit.from(200, 'sat');
    expect(a.inRange(lo, hi)).toBe(true);
    expect(a.clamp(lo, hi).toAmount().toBigInt()).toBe(100n);
    expect(() => a.inRange(c, hi)).toThrow(AmountWithUnitError);
    expect(() => a.clamp(c, hi)).toThrow(AmountWithUnitError);
    expect(() => a.inRange(lo, c)).toThrow(AmountWithUnitError);
    expect(() => a.clamp(lo, c)).toThrow(AmountWithUnitError);
  });
});

describe('AmountWithUnit scalar ops preserve unit', () => {
  const a = AmountWithUnit.from(1000, 'sat');

  it('multiplyBy', () => {
    const r = a.multiplyBy(3);
    expect(r.toAmount().toBigInt()).toBe(3000n);
    expect(r.unit).toBe('sat');
  });

  it('divideBy', () => {
    const r = a.divideBy(4);
    expect(r.toAmount().toBigInt()).toBe(250n);
    expect(r.unit).toBe('sat');
  });

  it('modulo', () => {
    const r = a.modulo(7);
    expect(r.toAmount().toBigInt()).toBe(1000n % 7n);
    expect(r.unit).toBe('sat');
  });

  it('ceilPercent', () => {
    const r = a.ceilPercent(2);
    expect(r.toAmount().toBigInt()).toBe(20n);
    expect(r.unit).toBe('sat');
  });

  it('floorPercent', () => {
    const r = a.floorPercent(2);
    expect(r.toAmount().toBigInt()).toBe(20n);
    expect(r.unit).toBe('sat');
  });

  it('scaledBy', () => {
    const r = a.scaledBy(3, 4);
    expect(r.toAmount().toBigInt()).toBe(750n);
    expect(r.unit).toBe('sat');
  });
});

describe('AmountWithUnit.min / max', () => {
  it('returns the lesser/greater when units agree', () => {
    const a = AmountWithUnit.from(3, 'sat');
    const b = AmountWithUnit.from(5, 'sat');
    expect(AmountWithUnit.min(a, b).toAmount().toBigInt()).toBe(3n);
    expect(AmountWithUnit.min(b, a).toAmount().toBigInt()).toBe(3n);
    expect(AmountWithUnit.max(a, b).toAmount().toBigInt()).toBe(5n);
    expect(AmountWithUnit.max(b, a).toAmount().toBigInt()).toBe(5n);
    expect(AmountWithUnit.min(a, b).unit).toBe('sat');
  });

  it('throws on unit mismatch', () => {
    const a = AmountWithUnit.from(3, 'sat');
    const c = AmountWithUnit.from(3, 'usd');
    expect(() => AmountWithUnit.min(a, c)).toThrow(AmountWithUnitError);
    expect(() => AmountWithUnit.max(a, c)).toThrow(AmountWithUnitError);
  });
});

describe('AmountWithUnit.sum', () => {
  it('infers unit from first element when hint omitted', () => {
    const r = AmountWithUnit.sum([
      AmountWithUnit.from(1, 'sat'),
      AmountWithUnit.from(2, 'sat'),
      AmountWithUnit.from(3, 'sat'),
    ]);
    expect(r.toAmount().toBigInt()).toBe(6n);
    expect(r.unit).toBe('sat');
  });

  it('throws on empty iterable when hint omitted', () => {
    expect(() => AmountWithUnit.sum([])).toThrow('cannot infer unit from empty sum');
  });

  it('returns zero(unit) on empty iterable when hint provided', () => {
    const r = AmountWithUnit.sum([], 'sat');
    expect(r.toAmount().toBigInt()).toBe(0n);
    expect(r.unit).toBe('sat');
  });

  it('validates every element against unit hint', () => {
    expect(() =>
      AmountWithUnit.sum([AmountWithUnit.from(1, 'sat'), AmountWithUnit.from(2, 'usd')], 'sat'),
    ).toThrow(AmountWithUnitError);
  });

  it('throws on mixed-unit iterable without hint', () => {
    expect(() =>
      AmountWithUnit.sum([AmountWithUnit.from(1, 'sat'), AmountWithUnit.from(2, 'usd')]),
    ).toThrow(AmountWithUnitError);
  });
});

describe('Amount.withUnit', () => {
  it('lifts a unitless Amount and round-trips', () => {
    const a = Amount.from(100).withUnit('sat');
    expect(a.toAmount().equals(Amount.from(100))).toBe(true);
    expect(a.unit).toBe('sat');
  });

  it('rejects empty unit', () => {
    expect(() => Amount.from(1).withUnit('')).toThrow(AmountWithUnitError);
  });
});

describe('AmountWithUnit implicit coercion is safe', () => {
  const a = AmountWithUnit.from(100, 'sat');

  it('template literals produce unit-bearing string', () => {
    expect(`${a}`).toBe('sat: 100');
    expect(`balance: ${a}`).toBe('balance: sat: 100');
  });

  it('String(x) produces unit-bearing string', () => {
    expect(String(a)).toBe('sat: 100');
  });

  it('parseInt / parseFloat of the string form return NaN (unit cannot be stripped via parse)', () => {
    expect(parseInt(String(a), 10)).toBeNaN();
    expect(parseFloat(String(a))).toBeNaN();
    // and via implicit string coercion on the object directly
    expect(parseInt(a as unknown as string, 10)).toBeNaN();
    expect(parseFloat(a as unknown as string)).toBeNaN();
  });

  it('Number(x) throws (does not silently strip unit)', () => {
    expect(() => Number(a)).toThrow(AmountWithUnitError);
    expect(() => Number(a)).toThrow(/numeric coercion .* unsafe/i);
  });

  it('unary + throws', () => {
    expect(() => +(a as unknown as number)).toThrow(AmountWithUnitError);
  });

  it('arithmetic operators throw (a - n, n * a, etc.)', () => {
    expect(() => (a as unknown as number) - 10).toThrow(AmountWithUnitError);
    expect(() => 2 * (a as unknown as number)).toThrow(AmountWithUnitError);
    expect(() => (a as unknown as number) / 5).toThrow(AmountWithUnitError);
  });

  it('loose equality with a number throws (no silent comparison on bare value)', () => {
    expect(() => (a as unknown) == 100).toThrow(AmountWithUnitError);
  });

  it('`a + b` with two AmountWithUnit throws (no silent numeric add)', () => {
    const b = AmountWithUnit.from(50, 'sat');
    expect(() => (a as unknown as number) + (b as unknown as number)).toThrow(AmountWithUnitError);
  });

  it('JSON.stringify is unaffected (uses toJSON, not toString)', () => {
    expect(JSON.stringify(a)).toBe('{"amount":"100","unit":"sat"}');
  });
});

describe('Amount and AmountWithUnit do not silently bridge', () => {
  it('Amount.from does not accept AmountWithUnit (compile-time, runtime rejects too)', () => {
    const tagged = AmountWithUnit.from(100, 'sat');
    expect(() => {
      // @ts-expect-error AmountWithUnit is not assignable to AmountLike
      Amount.from(tagged);
    }).toThrow('Unsupported amount input type');
    // .toAmount() is the explicit, safe escape hatch
    expect(Amount.from(tagged.toAmount()).toBigInt()).toBe(100n);
  });
});
