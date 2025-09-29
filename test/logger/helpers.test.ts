import { describe, test, expect, vi } from 'vitest';
import { fail, failIf, safeCallback } from '../../src/logger';
import type { Logger } from '../../src/logger';

function stubLogger(): Logger {
	return {
		fatal: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
		trace: vi.fn(),
		log: vi.fn(),
	};
}

describe('logger helpers', () => {
	test('fail() logs error and throws Error', () => {
		const logger = stubLogger();

		expect(() => fail('boom', logger, { a: 1 })).toThrow(Error);
		expect(logger.error as any).toHaveBeenCalledWith('boom', { a: 1 });
	});

	test('failIf() throws on truthy and passes on falsy', () => {
		const logger = stubLogger();

		// falsy: no throw
		expect(() => failIf(false, 'should not throw', logger)).not.toThrow();

		// truthy: throws + logs error
		expect(() => failIf(true, 'nope', logger, { why: 'truthy' })).toThrow(Error);
		expect(logger.error as any).toHaveBeenCalledWith('nope', { why: 'truthy' });
	});

	test('helpers do not crash if logger logging throws', () => {
		const logger: Logger = {
			fatal: () => {
				throw new Error('console broken');
			},
			error: () => {
				throw new Error('console broken');
			},
			warn: () => {},
			info: () => {},
			debug: () => {},
			trace: () => {},
			log: () => {},
		};

		// Still throws our Error (logging failure is swallowed)
		expect(() => fail('boom', logger)).toThrow(Error);
	});
});

describe('safeCallback', () => {
	test('invokes callback with the provided payload', () => {
		const cb = vi.fn();
		const payload = { x: 42 };
		const logger = stubLogger();

		safeCallback(cb, payload, logger);
		expect(cb).toHaveBeenCalledWith(payload);
		expect(logger.warn as any).not.toHaveBeenCalled();
	});

	test('does nothing if callback is undefined', () => {
		const logger = stubLogger();
		expect(() => safeCallback(undefined, { y: 1 }, logger)).not.toThrow();
		expect(logger.warn as any).not.toHaveBeenCalled();
	});

	test('logs a warning and swallows errors thrown by the callback (anonymous cb)', () => {
		const logger = stubLogger();
		const cb = vi.fn(() => {
			throw new Error('boom');
		});
		const payload = { z: 9 };

		expect(() => safeCallback(cb, payload, logger, { op: 'test' })).not.toThrow();
		expect(cb).toHaveBeenCalled();

		// verify warn was called with expected shape
		expect(logger.warn as any).toHaveBeenCalledTimes(1);
		const [msg, meta] = (logger.warn as any).mock.calls[0];
		expect(msg).toBe('callback failed');

		// meta should contain our context and error
		expect(meta).toMatchObject({ op: 'test' });
		expect(meta.error).toBeInstanceOf(Error);
		expect((meta.error as Error).message).toBe('boom');

		// The cb identity depends on the test runner (vi.fn() => "spy").
		// Just assert it's a string (and optionally allow a small set).
		expect(typeof meta.cb).toBe('string');
		expect(['anonymous', 'spy', ''].includes(meta.cb)).toBe(true);
	});

	test('logs a warning including the callback name when available', () => {
		const logger = stubLogger();
		function namedCb() {
			throw new Error('kaput');
		}
		expect(() => safeCallback(namedCb, { n: 1 }, logger)).not.toThrow();

		expect(logger.warn as any).toHaveBeenCalledTimes(1);
		const [msg, meta] = (logger.warn as any).mock.calls[0];
		expect(msg).toBe('callback failed');
		expect(meta.cb).toBe('namedCb'); // uses function name when present
		expect(meta.error).toBeInstanceOf(Error);
		expect((meta.error as Error).message).toBe('kaput');
	});

	test('continues execution after a throwing callback', () => {
		const logger = stubLogger();
		const cb = vi.fn(() => {
			throw new Error('oops');
		});
		const after = vi.fn();

		safeCallback(cb, { n: 1 }, logger);
		safeCallback(after, { n: 2 }, logger);

		expect(cb).toHaveBeenCalled();
		expect(after).toHaveBeenCalledWith({ n: 2 });
	});

	test('swallows errors thrown by the logger itself', () => {
		const logger: Logger = {
			fatal: vi.fn(),
			error: vi.fn(),
			warn: vi.fn(() => {
				throw new Error('logger broken');
			}),
			info: vi.fn(),
			debug: vi.fn(),
			trace: vi.fn(),
			log: vi.fn(),
		};

		const cb = vi.fn(() => {
			throw new Error('boom');
		});

		// Neither callback error nor logger error should bubble
		expect(() => safeCallback(cb, { k: 1 }, logger, { ctx: true })).not.toThrow();
		expect(cb).toHaveBeenCalled();
		expect(logger.warn as any).toHaveBeenCalledTimes(1);
	});
});
