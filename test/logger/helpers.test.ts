import { describe, test, expect, vi } from 'vitest';
import { fail, panic, failIf } from '../../src/logger';
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
		expect(logger.error as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('boom', {
			a: 1,
		});
		// fatal must not be called here
		expect(logger.fatal as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
	});

	test('panic() logs fatal and throws Error', () => {
		const logger = stubLogger();

		expect(() => panic('kaput', logger, { x: 2 })).toThrow(Error);
		expect(logger.fatal as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('kaput', {
			x: 2,
		});
		// error must not be called here
		expect(logger.error as unknown as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
	});

	test('failIf() throws on truthy and passes on falsy', () => {
		const logger = stubLogger();

		// falsy: no throw
		expect(() => failIf(false, 'should not throw', logger)).not.toThrow();

		// truthy: throws + logs error
		expect(() => failIf(true, 'nope', logger, { why: 'truthy' })).toThrow(Error);
		expect(logger.error as unknown as ReturnType<typeof vi.fn>).toHaveBeenCalledWith('nope', {
			why: 'truthy',
		});
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
		expect(() => panic('kaput', logger)).toThrow(Error);
	});
});
