import { describe, expect, test } from 'vitest';

import {
  CTSError,
  HttpResponseError,
  isMintOperationError,
  MintOperationError,
  NetworkError,
  RateLimitError,
  StaleKeysetError,
  UnknownKeysetError,
} from '../../src/model/Errors';

describe('CTSError', () => {
  test('sets name and message', () => {
    const err = new CTSError('boom');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CTSError);
    expect(err.name).toBe('CTSError');
    expect(err.message).toBe('boom');
  });

  test('omits cause property when no cause given', () => {
    const err = new CTSError('boom');
    expect(err.cause).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(err, 'cause')).toBe(false);
  });

  test('attaches cause as a non-enumerable, configurable, writable property', () => {
    const root = new Error('root');
    const err = new CTSError('boom', { cause: root });
    expect(err.cause).toBe(root);

    const descriptor = Object.getOwnPropertyDescriptor(err, 'cause');
    expect(descriptor).toBeDefined();
    // Non-enumerable: cause must not leak into JSON.stringify / Object.keys output.
    expect(descriptor?.enumerable).toBe(false);
    expect(Object.keys(err)).not.toContain('cause');
    // Writable: the chain can be reassigned after construction.
    expect(descriptor?.writable).toBe(true);
    // Configurable: the descriptor can be redefined/deleted.
    expect(descriptor?.configurable).toBe(true);
  });

  test('cause is writable and reassignable', () => {
    const err = new CTSError('boom', { cause: new Error('first') });
    const replacement = new Error('second');
    // `cause` is declared readonly but defined as writable at runtime.
    (err as { cause?: unknown }).cause = replacement;
    expect(err.cause).toBe(replacement);
  });

  test('cause is redefinable because it is configurable', () => {
    const err = new CTSError('boom', { cause: new Error('first') });
    expect(() => Object.defineProperty(err, 'cause', { value: 'redefined' })).not.toThrow();
    expect(err.cause).toBe('redefined');
  });
});

describe('HttpResponseError', () => {
  test('carries status and chains cause through CTSError', () => {
    const root = new Error('root');
    const err = new HttpResponseError('bad response', 503, { cause: root });
    expect(err).toBeInstanceOf(CTSError);
    expect(err).toBeInstanceOf(HttpResponseError);
    expect(err.name).toBe('HttpResponseError');
    expect(err.message).toBe('bad response');
    expect(err.status).toBe(503);
    expect(err.cause).toBe(root);
  });
});

describe('NetworkError', () => {
  test('sets name and chains cause', () => {
    const root = new Error('offline');
    const err = new NetworkError('request failed', { cause: root });
    expect(err).toBeInstanceOf(CTSError);
    expect(err).toBeInstanceOf(NetworkError);
    expect(err.name).toBe('NetworkError');
    expect(err.message).toBe('request failed');
    expect(err.cause).toBe(root);
  });
});

describe('RateLimitError', () => {
  test('fixes status at 429 and records retryAfterMs', () => {
    const err = new RateLimitError('slow down', 1500);
    expect(err).toBeInstanceOf(HttpResponseError);
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.name).toBe('RateLimitError');
    expect(err.message).toBe('slow down');
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(1500);
  });

  test('leaves retryAfterMs undefined when absent', () => {
    const err = new RateLimitError('slow down');
    expect(err.retryAfterMs).toBeUndefined();
    expect(err.status).toBe(429);
  });
});

describe('MintOperationError', () => {
  test('sets code, name and status 400', () => {
    const err = new MintOperationError(11000, 'Token already spent');
    expect(err).toBeInstanceOf(HttpResponseError);
    expect(err).toBeInstanceOf(MintOperationError);
    expect(err.name).toBe('MintOperationError');
    expect(err.code).toBe(11000);
    expect(err.status).toBe(400);
    expect(err.message).toBe('Token already spent');
  });

  test('falls back to a default message when detail is empty', () => {
    const err = new MintOperationError(20000, '');
    expect(err.message).toBe('Unknown mint operation error');
  });
});

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

describe('UnknownKeysetError', () => {
  test('carries the keyset id and extends CTSError', () => {
    const e = new UnknownKeysetError('00deadbeefdeadbe');
    expect(e).toBeInstanceOf(CTSError);
    expect(e.name).toBe('UnknownKeysetError');
    expect(e.keysetId).toBe('00deadbeefdeadbe');
    expect(e.message).toBe("Keyset '00deadbeefdeadbe' is not a keyset of this mint");
    expect(e.cause).toBeUndefined();
  });

  test('names the refresh failure when a cause is given', () => {
    const cause = new Error('offline');
    const e = new UnknownKeysetError('00deadbeefdeadbe', { cause });
    expect(e.message).toBe(
      "Could not resolve unknown keyset '00deadbeefdeadbe': mint refresh failed",
    );
    expect(e.cause).toBe(cause);
  });
});

describe('StaleKeysetError', () => {
  test('reports a repaired snapshot and extends CTSError', () => {
    const e = new StaleKeysetError(true);
    expect(e).toBeInstanceOf(CTSError);
    expect(e.name).toBe('StaleKeysetError');
    expect(e.repaired).toBe(true);
    expect(e.message).toBe(
      'Mint rejected a stale keyset; the snapshot has been refreshed, re-prepare the operation',
    );
    expect(e.cause).toBeUndefined();
  });

  test('tells the caller to refresh when nothing was repaired', () => {
    const cause = new MintOperationError(12002, 'Keyset is inactive, cannot sign messages');
    const e = new StaleKeysetError(false, { cause });
    expect(e.repaired).toBe(false);
    expect(e.message).toBe(
      'Mint rejected a stale keyset; refresh the snapshot (loadMint(true)) and re-prepare',
    );
    expect(e.cause).toBe(cause);
  });
});
