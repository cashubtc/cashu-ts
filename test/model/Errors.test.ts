import { describe, expect, test } from 'vitest';

import { isMintOperationError, MintOperationError, NetworkError } from '../../src/model/Errors';

describe('isMintOperationError', () => {
  test('accepts a real MintOperationError', () => {
    expect(isMintOperationError(new MintOperationError(20008, 'invalid signature'))).toBe(true);
  });

  test('accepts a look-alike by name + code', () => {
    const lookAlike = Object.assign(new Error('invalid signature'), {
      name: 'MintOperationError',
      code: 20008,
    });
    expect(isMintOperationError(lookAlike)).toBe(true);
  });

  test('rejects other errors and non-errors', () => {
    expect(isMintOperationError(new NetworkError('offline'))).toBe(false);
    expect(isMintOperationError(new Error('MintOperationError'))).toBe(false);
    expect(isMintOperationError({ name: 'MintOperationError', code: 20008 })).toBe(false);
    expect(isMintOperationError(undefined)).toBe(false);
  });
});
