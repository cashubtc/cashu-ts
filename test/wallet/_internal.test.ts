import { test, describe, expect } from 'vitest';
import { Amount, type Keys, type Proof, OutputType } from '../../src';
import { PUBKEYS } from '../consts';
import { getKeepAmounts, stringifyOutputTypeForLog } from '../../src/wallet/_internal';
import { OutputData } from '../../src/model/OutputData';

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

  test('formats p2pk denominations as strings', () => {
    const result = stringifyOutputTypeForLog({
      type: 'p2pk',
      options: { pubkey: '02'.padEnd(66, '1') },
      denominations: [1, Amount.from(2)],
    });
    expect(result).toBe(
      JSON.stringify({
        type: 'p2pk',
        options: { pubkey: '02'.padEnd(66, '1') },
        denominations: ['1', '2'],
      }),
    );
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
      stringifyOutputTypeForLog({
        type: 'p2pk',
        options: { pubkey: '02'.padEnd(66, '1') },
      }),
    ).toBe(
      JSON.stringify({
        type: 'p2pk',
        options: { pubkey: '02'.padEnd(66, '1') },
        denominations: [],
      }),
    );
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
