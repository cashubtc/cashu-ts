import { afterEach, describe, test, expect, vi } from 'vitest';

import { ConsoleLogger, NULL_LOGGER } from '../../src/logger';
import { MAX_LOG_CONTEXT_DEPTH } from '../../src/utils/limits';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ConsoleLogger', () => {
  test('logs messages at or above minLevel', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const logger = new ConsoleLogger('warn');

    logger.error('Error message');
    logger.warn('Warn message');
    logger.info('Info message');

    expect(errorSpy).toHaveBeenCalledWith('[ERROR] Error message');
    expect(warnSpy).toHaveBeenCalledWith('[WARN] Warn message');
    expect(infoSpy).not.toHaveBeenCalled();
  });

  test('uses correct console method for each log level', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const traceSpy = vi.spyOn(console, 'trace').mockImplementation(() => undefined);

    const logger = new ConsoleLogger('trace');

    logger.error('Error');
    logger.warn('Warn');
    logger.info('Info');
    logger.debug('Debug');
    logger.trace('Trace');

    expect(errorSpy).toHaveBeenCalledWith('[ERROR] Error');
    expect(warnSpy).toHaveBeenCalledWith('[WARN] Warn');
    expect(infoSpy).toHaveBeenCalledWith('[INFO] Info');
    expect(debugSpy).toHaveBeenCalledWith('[DEBUG] Debug');
    expect(traceSpy).toHaveBeenCalledWith('[TRACE] Trace');
  });

  test('Message with context', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const logger = new ConsoleLogger('info');

    // Context in object
    logger.info('User logged in', { username: 'alice', ip: '127.0.0.1' });

    expect(infoSpy).toHaveBeenCalledWith('[INFO] User logged in', {
      username: 'alice',
      ip: '127.0.0.1',
    });

    // Context as variable
    const ip = '127.0.0.1';
    logger.info('User logged in', { username: 'alice', ip });

    expect(infoSpy).toHaveBeenCalledWith('[INFO] User logged in', {
      username: 'alice',
      ip: '127.0.0.1',
    });
  });

  test('handles Error objects in context', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logger = new ConsoleLogger('error');
    const err = new Error('Test error');

    logger.error('Error occurred', { error: err });

    expect(errorSpy).toHaveBeenCalledWith('[ERROR] Error occurred', {
      error: { message: 'Test error', stack: expect.any(String) },
    });
  });

  test('escapes Unicode separators carried in a context Error stack', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logger = new ConsoleLogger('error');
    const err = new Error('rejected [ERROR] forged event');
    err.stack = 'Error: rejected [ERROR] forged event\n    at somewhere';

    logger.error('Invalid response from mint', { error: err });

    const emitted = errorSpy.mock.calls[0]?.[1] as { error: { message: string; stack: string } };
    expect(emitted.error.message).toBe('rejected\\u2028[ERROR] forged event');
    expect(emitted.error.stack).not.toMatch(/[\u2028\u2029]/u);
  });

  test('leaves a missing Error stack as undefined rather than throwing', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logger = new ConsoleLogger('error');
    const err = new Error('Test error');
    err.stack = undefined;

    logger.error('Error occurred', { error: err });

    expect(errorSpy).toHaveBeenCalledWith('[ERROR] Error occurred', {
      error: { message: 'Test error', stack: undefined },
    });
  });

  test('escapes an Error nested below the top level of context', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logger = new ConsoleLogger('error');
    const err = new Error('rejected [ERROR] forged event');

    logger.error('Invalid response from mint', { data: { cause: err } });

    const emitted = errorSpy.mock.calls[0]?.[1] as {
      data: { cause: { message: string } };
    };
    expect(emitted.data.cause.message).toBe('rejected\\u2028[ERROR] forged event');
  });

  test('truncates recursion into deeply nested context', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logger = new ConsoleLogger('error');
    const buriedLeaf = 'buried leaf';

    // `MAX_LOG_CONTEXT_DEPTH` hops of `.next` reach the object at the depth cap.
    let atCap: Record<string, unknown> = { value: buriedLeaf };
    for (let i = 0; i < MAX_LOG_CONTEXT_DEPTH; i++) {
      atCap = { next: atCap };
    }

    logger.error('deep', { ...atCap, shallow: 'top level' });

    const emitted = errorSpy.mock.calls[0]?.[1] as Record<string, unknown>;
    // A field beside the chain, well within the cap, is still escaped.
    expect(emitted.shallow).toBe('top\\u2028level');

    let cursor = emitted;
    for (let i = 0; i < MAX_LOG_CONTEXT_DEPTH; i++) {
      cursor = cursor.next as Record<string, unknown>;
    }
    // The object at the cap is returned unprocessed, so its leaf survives unescaped.
    expect(cursor.value).toBe(buriedLeaf);
  });

  test('escapes strings inside array context values', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logger = new ConsoleLogger('error');

    logger.error('items', { items: ['a b', 'plain'] });

    expect(errorSpy).toHaveBeenCalledWith('[ERROR] items', {
      items: ['a\\u2028b', 'plain'],
    });
  });

  test('leaves non-plain context objects and null/number leaves untouched', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const logger = new ConsoleLogger('info');
    const at = new Date(0);

    logger.info('x', { at, n: 1, z: null });

    expect(infoSpy).toHaveBeenCalledWith('[INFO] x', { at, n: 1, z: null });
  });

  test('escapes control characters in the message', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const logger = new ConsoleLogger('info');

    logger.info('alice logged out\n[INFO] admin role granted\r\x1b[31malert\x00');

    expect(infoSpy).toHaveBeenCalledWith(
      '[INFO] alice logged out\\n[INFO] admin role granted\\r\\x1b[31malert\\x00',
    );
  });

  test('escapes Unicode line and paragraph separators in the message', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const logger = new ConsoleLogger('info');

    logger.info('alice logged out [ERROR] admin role granted [WARN] forged event');

    expect(infoSpy).toHaveBeenCalledWith(
      '[INFO] alice logged out\\u2028[ERROR] admin role granted\\u2029[WARN] forged event',
    );
  });

  test('escapes Unicode separators in nested context string values', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logger = new ConsoleLogger('error');

    logger.error('Invalid response from mint', {
      data: { detail: 'rejected [ERROR] forged event [INFO] accepted' },
    });

    expect(errorSpy).toHaveBeenCalledWith('[ERROR] Invalid response from mint', {
      data: { detail: 'rejected\\u2028[ERROR] forged event\\u2029[INFO] accepted' },
    });
  });

  test('preserves an own __proto__ field in structured context', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const logger = new ConsoleLogger('info');
    const context = JSON.parse('{"__proto__":{"action":"grant-admin"}}') as Record<string, unknown>;

    logger.info('Event', context);

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const emittedContext = infoSpy.mock.calls[0]?.[1] as Record<string, unknown> | undefined;
    expect(emittedContext).toBeDefined();
    expect(Object.prototype.hasOwnProperty.call(emittedContext, '__proto__')).toBe(true);
    expect(emittedContext?.['__proto__']).toEqual({ action: 'grant-admin' });
  });

  test('generic log method works correctly', () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
    const logger = new ConsoleLogger('info');

    logger.log('info', 'Info message');
    logger.log('debug', 'Debug message');

    expect(infoSpy).toHaveBeenCalledWith('[INFO] Info message');
    expect(debugSpy).not.toHaveBeenCalled();
  });
});

describe('NullLogger', () => {
  test('does not log anything', () => {
    const nullLogger = NULL_LOGGER;
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    nullLogger.error('Should not log');

    expect(errorSpy).not.toHaveBeenCalled();
  });
});
