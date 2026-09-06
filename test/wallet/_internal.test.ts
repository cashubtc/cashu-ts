import { test, describe, expect } from 'vitest';

import { Amount, type Keys, type Proof, type OutputType } from '../../src';
import { OutputData, type OutputDataLike } from '../../src/model/OutputData';
import {
  ceilLog2,
  getKeepAmounts,
  orderOutputsForPayload,
  stringifyOutputTypeForLog,
} from '../../src/wallet/_internal';
import { PUBKEYS } from '../consts';

describe('ceilLog2', () => {
  test('matches Math.ceil(Math.log2(n)) for small values', () => {
    for (const [n, want] of [
      [1n, 0],
      [2n, 1],
      [3n, 2],
      [4n, 2],
      [5n, 3],
      [8n, 3],
      [9n, 4],
      [16n, 4],
    ] as const) {
      expect(ceilLog2(n)).toBe(want);
    }
  });

  test('is exact above Number.MAX_SAFE_INTEGER (float log2 would truncate)', () => {
    // 2^53 is a power of two; 2^53 + 1 needs one more bit. The old
    // toNumberUnsafe path truncated 2^53+1 back to 2^53 and returned 53.
    expect(ceilLog2(2n ** 53n)).toBe(53);
    expect(ceilLog2(2n ** 53n + 1n)).toBe(54);
    expect(ceilLog2(2n ** 64n)).toBe(64);
  });
});

describe('getKeepAmounts', () => {
  const amountsWeHave = [1, 2, 4, 4, 4, 8];
  const proofsWeHave = amountsWeHave.map((amount) => {
    return {
      amount: Amount.from(amount),
      id: 'id',
      C: 'C',
    } as Proof;
  });
  const keys = PUBKEYS as Keys;

  test('keep amounts', () => {
    // info: getKeepAmounts returns the amounts we need to fill up
    // the wallet to a target number of denominations plus an optimal
    // split of the remaining amount (to reach the total amount)

    let amountsToKeep = getKeepAmounts(proofsWeHave, 22, keys, 3);
    // keeping 22 with a target count of 3, we expect two 1s, two 2s, no 4s, and two 8s, and no extra to reach 22
    expect(amountsToKeep.map((a) => a.toNumber())).toEqual([1, 1, 2, 2, 8, 8]);

    // keeping 22 with a target count of 4, we expect three 1s, three 2s, one 4, and one 8 and another 1 to reach 22
    amountsToKeep = getKeepAmounts(proofsWeHave, 22, keys, 4);
    expect(amountsToKeep.map((a) => a.toNumber())).toEqual([1, 1, 1, 1, 2, 2, 2, 4, 8]);

    // keeping 22 with a target of 2, we expect one 1, one 2, no 4s, one 8, and another 1, 2, 8 to reach 22
    amountsToKeep = getKeepAmounts(proofsWeHave, 22, keys, 2);
    expect(amountsToKeep.map((a) => a.toNumber())).toEqual([1, 1, 2, 2, 8, 8]);

    amountsToKeep = getKeepAmounts(proofsWeHave, '22', keys, 2);
    expect(amountsToKeep.map((a) => a.toNumber())).toEqual([1, 1, 2, 2, 8, 8]);
  });
});

describe('stringifyOutputTypeForLog', () => {
  const keyset = { id: '00bd033559de27d0', keys: PUBKEYS as Keys };

  test('formats random denominations as strings', () => {
    const result = stringifyOutputTypeForLog({
      type: 'random',
      denominations: [Amount.from(1), 2n, '4'],
    });
    expect(result).toBe(JSON.stringify({ type: 'random', denominations: ['1', '2', '4'] }));
  });

  test('formats deterministic denominations and counter', () => {
    const result = stringifyOutputTypeForLog({
      type: 'deterministic',
      counter: 7,
      denominations: [1, Amount.from(2)],
    });
    expect(result).toBe(
      JSON.stringify({ type: 'deterministic', counter: 7, denominations: ['1', '2'] }),
    );
  });

  test('formats factory denominations as strings', () => {
    const result = stringifyOutputTypeForLog({
      type: 'factory',
      factory: (amount, keys) => OutputData.createRandomData(amount, keys)[0],
      denominations: [1, Amount.from(2)],
    });
    expect(result).toBe(JSON.stringify({ type: 'factory', denominations: ['1', '2'] }));
  });

  test('formats lock denominations as strings', () => {
    const result = stringifyOutputTypeForLog({
      type: 'lock',
      options: { mainKeys: ['02'.padEnd(66, '1')] },
      denominations: [1, Amount.from(2)],
    });
    expect(JSON.parse(result)).toEqual({
      type: 'lock',
      mainKeys: 1,
      refundKeys: 0,
      denominations: ['1', '2'],
    });
  });

  test('logs the key counts, never the key material', () => {
    const lockKey = '02'.padEnd(66, 'a');
    const additionalKey = '02'.padEnd(66, 'b');
    const refundKey = '02'.padEnd(66, 'c');
    const result = stringifyOutputTypeForLog({
      type: 'lock',
      options: {
        mainKeys: [lockKey, additionalKey],
        locktime: 123,
        refundKeys: [refundKey],
        blindKeys: true,
      },
    });
    expect(JSON.parse(result)).toEqual({
      type: 'lock',
      mainKeys: 2,
      refundKeys: 1,
      locktime: 123,
      blindKeys: true,
      denominations: [],
    });
    for (const key of [lockKey, additionalKey, refundKey]) {
      expect(result).not.toContain(key);
    }
    expect(result).toContain('blindKeys');
  });

  test('formats custom outputs as amount strings without serializing bigint internals', () => {
    const data = OutputData.createRandomData(3, keyset, [1, 2]);
    const result = stringifyOutputTypeForLog({
      type: 'custom',
      data,
    });
    expect(result).toBe(JSON.stringify({ type: 'custom', outputs: 2, amounts: ['1', '2'] }));
  });

  test('formats empty denominations for all non-custom output types', () => {
    expect(
      stringifyOutputTypeForLog({
        type: 'random',
      }),
    ).toBe(JSON.stringify({ type: 'random', denominations: [] }));

    expect(
      stringifyOutputTypeForLog({
        type: 'deterministic',
        counter: 0,
      }),
    ).toBe(JSON.stringify({ type: 'deterministic', counter: 0, denominations: [] }));

    expect(
      stringifyOutputTypeForLog({
        type: 'factory',
        factory: (amount, keys) => OutputData.createRandomData(amount, keys)[0],
      }),
    ).toBe(JSON.stringify({ type: 'factory', denominations: [] }));

    expect(
      JSON.parse(
        stringifyOutputTypeForLog({
          type: 'lock',
          options: { mainKeys: ['02'.padEnd(66, '1')] },
        }),
      ),
    ).toEqual({ type: 'lock', mainKeys: 1, refundKeys: 0, denominations: [] });
  });

  test('returns unknown for unknown type', () => {
    const data = OutputData.createRandomData(3, keyset, [1, 2]);
    const result = stringifyOutputTypeForLog({
      type: 'badtype',
      data,
    } as unknown as OutputType);
    expect(result).toBe('Unknown');
  });
});

describe('orderOutputsForPayload', () => {
  const out = (amount: number) =>
    ({ blindedMessage: { amount: Amount.from(amount), B_: '', id: '' } }) as OutputDataLike;

  test('interleaves keeps and sends by amount, and says which is which', () => {
    // The case that matters: keeps are larger than sends, so construction order and payload
    // order differ. Reading the split off position is exactly what the sort prevents.
    const { outputData, keepVector, indices } = orderOutputsForPayload([out(16), out(8)], [out(4)]);
    expect(outputData.map((d) => Number(d.blindedMessage.amount.toBigInt()))).toEqual([4, 8, 16]);
    expect(keepVector).toEqual([false, true, true]);
    expect(indices).toEqual([2, 1, 0]);
  });

  test('leaves construction order alone when asked', () => {
    const { outputData, keepVector } = orderOutputsForPayload([out(16), out(8)], [out(4)], false);
    expect(outputData.map((d) => Number(d.blindedMessage.amount.toBigInt()))).toEqual([16, 8, 4]);
    expect(keepVector).toEqual([true, true, false]);
  });

  test('ties keep construction order, which still leaks their split', () => {
    // Documented rather than fixed: randomizing within a tie makes the order unreproducible
    // from a preview unless the choice travels with it.
    const { keepVector } = orderOutputsForPayload([out(8)], [out(8)]);
    expect(keepVector).toEqual([true, false]);
  });
});

describe('stringifyOutputTypeForLog: lock with leaves', () => {
  test('logs the tree shape, never the key material', () => {
    const mainKey = `02${'ab'.repeat(32)}`;
    const leafKey = `02${'cd'.repeat(32)}`;
    const ot: OutputType = {
      type: 'lock',
      options: {
        mainKeys: [mainKey],
        leaves: [
          { type: 'threshold', n: 1, keys: [leafKey] },
          { type: 'threshold', n: 1, keys: [leafKey] },
        ],
        blindKeys: [leafKey],
      },
      denominations: [1, 2],
    };
    const s = stringifyOutputTypeForLog(ot);
    expect(JSON.parse(s)).toEqual({
      type: 'lock',
      mainKeys: 1,
      refundKeys: 0,
      leaves: 2,
      blindKeys: true,
      denominations: ['1', '2'],
    });
    expect(s).not.toContain(mainKey);
    expect(s).not.toContain(leafKey);
  });
});
