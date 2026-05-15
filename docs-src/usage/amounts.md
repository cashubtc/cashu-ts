# <a href="/">Documents</a> › [Usage Examples](../usage/usage_index.md) › **Amounts**

# Amounts

cashu-ts represents monetary values with two related value objects:

- **`Amount`** — immutable, bigint-backed, non-negative. Unit-agnostic. Use this for protocol-level math, fee calculations, and any operation scoped to a single keyset/wallet (which already implies a unit).
- **`AmountWithUnit`** — wraps an `Amount` and a `unit: string`. Use this when your app aggregates or compares across units (e.g. multi-currency balances).

`Amount` is what every cashu-ts API returns and accepts. `AmountWithUnit` is an opt-in for downstream consumers.

## Working with `Amount`

```ts
import { Amount } from '@cashu/cashu-ts';

const a = Amount.from(100); // accepts number | bigint | string | Amount
const b = Amount.from('21');

a.add(b).toBigInt(); // 121n
a.subtract(b).toString(); // '79'
a.equals(Amount.from(100)); // true
a.greaterThan(50); // true

// Finance helpers — integer arithmetic, no floats
Amount.from(1000).ceilPercent(2); // 20 (2% of 1000)
Amount.from(1001).ceilPercent(1, 200); // 6 (= ceil(0.5% of 1001), fractional via larger denom)
Amount.from(1000).floorPercent(98); // 980 (98% of 1000)
Amount.from(1001).floorPercent(1, 200); // 5 (= floor(0.5% of 1001), fractional via larger denom)
Amount.from(1000).scaledBy(3, 4); // 750
Amount.from(500).clamp(100, 1000); // 500 (already in range, unchanged)
Amount.from(500).clamp(100, 400); // 400 (clamped down to max)
Amount.from(500).inRange(100, 1000); // true
```

## Working with `AmountWithUnit`

```ts
import { Amount, AmountWithUnit, AmountWithUnitError } from '@cashu/cashu-ts';

const a = AmountWithUnit.from(100, 'sat');
const b = AmountWithUnit.from(50, 'sat');
const c = AmountWithUnit.from(5, 'usd');

a.add(b); // AmountWithUnit { amount: 150, unit: 'sat' }
a.add(c); // throws AmountWithUnitError

// Drop back to a unitless Amount when handing off to single-unit APIs
const raw: Amount = a.toAmount();

// Lift a unitless Amount into the unit-checked tier
Amount.from(21).withUnit('sat'); // AmountWithUnit

// Aggregate a unit-tagged iterable
AmountWithUnit.sum([a, b]); // 150 sat (unit inferred)
AmountWithUnit.sum([], 'sat'); // 0 sat (empty + explicit hint)
```

## Choosing between them

- One wallet, one unit per mint → `Amount` is enough. The wallet already enforces unit at the object level.
- Aggregating across units (totals, transfers, displays) → wrap into `AmountWithUnit` at the boundary; do unit-checked math; unwrap with `.toAmount()` when handing back to single-unit APIs.
