import { describe, expect, test } from 'vitest';

import { deriveConditionalKeysetId } from '../../src';
import { DUMMY_TEST_KEYS, NUT02_V1_VECTOR1_KEYS } from '../consts';

describe('NUT-CTF conditional keyset id derivation', () => {
  test('matches CDK v2_from_data_conditional vectors', () => {
    const conditionId = '11'.repeat(32);
    expect(
      deriveConditionalKeysetId({
        keys: NUT02_V1_VECTOR1_KEYS.keys,
        input_fee_ppk: 250,
        final_expiry: 1754296607,
        unit: 'sat',
        conditionId,
        outcomeCollectionId: '22'.repeat(32),
      }),
    ).toBe('01ef86b29fae7779271737d657c127f51ecf2b5672251d4e9bacc590607927dfaa');

    expect(
      deriveConditionalKeysetId({
        keys: NUT02_V1_VECTOR1_KEYS.keys,
        unit: 'sat',
        conditionId,
        outcomeCollectionId: 'bb'.repeat(32),
      }),
    ).toBe('01109feab5f222e4f16a3b5805fa95fdf73c22224482feb4e6e0185cce5c28fdb6');

    expect(
      deriveConditionalKeysetId({
        keys: DUMMY_TEST_KEYS.keys,
        final_expiry: 1754296607,
        unit: 'sat',
        conditionId: 'aa'.repeat(32),
        outcomeCollectionId: 'cc'.repeat(32),
      }),
    ).toBe('0170110f06b9bb85565a6746ca5715f877b99db14d87219f6e9030cb529f61e6ea');
  });

  test('rejects malformed condition identifiers', () => {
    expect(() =>
      deriveConditionalKeysetId({
        keys: DUMMY_TEST_KEYS.keys,
        unit: 'sat',
        conditionId: 'not-hex',
        outcomeCollectionId: 'cc'.repeat(32),
      }),
    ).toThrow(/conditionId/);
  });
});
