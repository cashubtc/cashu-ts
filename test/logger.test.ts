import { describe, test, expect, vi } from 'vitest';
import { ConsoleLogger, NULL_LOGGER, LogLevel } from '../src/logger';

describe('ConsoleLogger', () => {
	test('logs messages at or above minLevel', () => {
		const errorSpy = vi.spyOn(console, 'error');
		const warnSpy = vi.spyOn(console, 'warn');
		const infoSpy = vi.spyOn(console, 'info');

		const logger = new ConsoleLogger(LogLevel.WARN);

		logger.fatal('Fatal message');
		logger.error('Error message');
		logger.warn('Warn message');
		logger.info('Info message');

		expect(errorSpy).toHaveBeenCalledWith('[FATAL] Fatal message');
		expect(errorSpy).toHaveBeenCalledWith('[ERROR] Error message');
		expect(warnSpy).toHaveBeenCalledWith('[WARN] Warn message');
		expect(infoSpy).not.toHaveBeenCalled();
	});

	test('uses correct console method for each log level', () => {
		const errorSpy = vi.spyOn(console, 'error');
		const warnSpy = vi.spyOn(console, 'warn');
		const infoSpy = vi.spyOn(console, 'info');
		const debugSpy = vi.spyOn(console, 'debug');
		const traceSpy = vi.spyOn(console, 'trace');

		const logger = new ConsoleLogger(LogLevel.TRACE);

		logger.fatal('Fatal');
		logger.error('Error');
		logger.warn('Warn');
		logger.info('Info');
		logger.debug('Debug');
		logger.trace('Trace');

		expect(errorSpy).toHaveBeenCalledWith('[FATAL] Fatal');
		expect(errorSpy).toHaveBeenCalledWith('[ERROR] Error');
		expect(warnSpy).toHaveBeenCalledWith('[WARN] Warn');
		expect(infoSpy).toHaveBeenCalledWith('[INFO] Info');
		expect(debugSpy).toHaveBeenCalledWith('[DEBUG] Debug');
		expect(traceSpy).toHaveBeenCalledWith('[TRACE] Trace');
	});

	test('interpolates message with context', () => {
		const infoSpy = vi.spyOn(console, 'info');

		const logger = new ConsoleLogger(LogLevel.INFO);

		logger.info('User {username} logged in', { username: 'alice' });

		expect(infoSpy).toHaveBeenCalledWith('[INFO] User alice logged in');
	});

	test('appends unused context to the log', () => {
		const infoSpy = vi.spyOn(console, 'info');

		const logger = new ConsoleLogger(LogLevel.INFO);

		logger.info('User {username} logged in', { username: 'alice', ip: '127.0.0.1' });

		expect(infoSpy).toHaveBeenCalledWith('[INFO] User alice logged in', { ip: '127.0.0.1' });
	});

	test('handles Error objects in context', () => {
		const errorSpy = vi.spyOn(console, 'error');

		const logger = new ConsoleLogger(LogLevel.ERROR);
		const err = new Error('Test error');

		logger.error('Error occurred', { error: err });

		expect(errorSpy).toHaveBeenCalledWith('[ERROR] Error occurred', {
			error: { message: 'Test error', stack: expect.any(String) }
		});
	});

	test('leaves placeholders unchanged if context key is missing', () => {
		const infoSpy = vi.spyOn(console, 'info');

		const logger = new ConsoleLogger(LogLevel.INFO);

		logger.info('User {username} logged in', { other: 'data' });

		expect(infoSpy).toHaveBeenCalledWith('[INFO] User {username} logged in', { other: 'data' });
	});

	test('generic log method works correctly', () => {
		const infoSpy = vi.spyOn(console, 'info');
		const debugSpy = vi.spyOn(console, 'debug');

		const logger = new ConsoleLogger(LogLevel.INFO);

		logger.log(LogLevel.INFO, 'Info message');
		logger.log(LogLevel.DEBUG, 'Debug message');

		expect(infoSpy).toHaveBeenCalledWith('[INFO] Info message');
		expect(debugSpy).not.toHaveBeenCalled();
	});
});

describe('NullLogger', () => {
	test('does not log anything', () => {
		const nullLogger = NULL_LOGGER;
		const errorSpy = vi.spyOn(console, 'error');

		nullLogger.fatal('Should not log');

		expect(errorSpy).not.toHaveBeenCalled();
	});
});
