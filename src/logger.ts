/**
 * Defines the available log levels for the logger.
 * Log levels are ordered from most severe (FATAL) to least severe (TRACE).
 */
export const LogLevel = {
	FATAL: 'FATAL',
	ERROR: 'ERROR',
	WARN: 'WARN',
	INFO: 'INFO',
	DEBUG: 'DEBUG',
	TRACE: 'TRACE'
} as const;

/**
 * Defines the available log levels for the logger.
 * Log levels are ordered from most severe (FATAL) to least severe (TRACE).
 */
export type LogLevel = (typeof LogLevel)[keyof typeof LogLevel];

export interface Logger {
	fatal(message: string, context?: Record<string, unknown>): void;
	error(message: string, context?: Record<string, unknown>): void;
	warn(message: string, context?: Record<string, unknown>): void;
	info(message: string, context?: Record<string, unknown>): void;
	debug(message: string, context?: Record<string, unknown>): void;
	trace(message: string, context?: Record<string, unknown>): void;
	log(level: LogLevel, message: string, context?: Record<string, unknown>): void;
}

// The default logger implementation - does nothing
/* eslint-disable @typescript-eslint/no-empty-function */
export const NULL_LOGGER: Logger = {
	fatal() {},
	error() {},
	warn() {},
	info() {},
	debug() {},
	trace() {},
	log() {}
};
/* eslint-enable @typescript-eslint/no-empty-function */

/**
 * Outputs messages to the console based on the specified log level.
 *
 * Supports placeholder substitution in messages (e.g., `{key}`) using values
 * from the optional `context` object. Context keys not used in substitution are
 * appended to the output as additional data. Each log message is prefixed with
 * the log level in square brackets (e.g., `[INFO]`).
 *
 * @example
 * const logger = new ConsoleLogger(LogLevel.DEBUG);
 * logger.info('User {username} logged in', { username: 'alice', ip: '127.0.0.1' });
 * // Output: [INFO] User alice logged in { ip: "127.0.0.1" }
 */
export class ConsoleLogger implements Logger {
	private minLevel: LogLevel;
	public static readonly SEVERITY: Record<LogLevel, number> = {
		[LogLevel.FATAL]: 0,
		[LogLevel.ERROR]: 1,
		[LogLevel.WARN]: 2,
		[LogLevel.INFO]: 3,
		[LogLevel.DEBUG]: 4,
		[LogLevel.TRACE]: 5
	};
	constructor(minLevel: LogLevel = LogLevel.INFO) {
		this.minLevel = minLevel;
	}

	private logToConsole(level: LogLevel, message: string, context?: Record<string, unknown>): void {
		if (ConsoleLogger.SEVERITY[level] > ConsoleLogger.SEVERITY[this.minLevel]) return;
		const levelPrefix = `[${level}] `;
		let interpolatedMessage = message;
		const usedKeys = new Set<string>();
		if (context) {
			const processedContext = Object.fromEntries(
				Object.entries(context).map(([key, value]) => [
					key,
					value instanceof Error ? { message: value.message, stack: value.stack } : value
				])
			);
			interpolatedMessage = message.replace(/\{(\w+)\}/g, (match, key) => {
				if (processedContext[key] !== undefined) {
					usedKeys.add(key);
					return String(processedContext[key]);
				}
				return match;
			});
			const filteredContext = Object.fromEntries(
				Object.entries(processedContext).filter(([key]) => !usedKeys.has(key))
			);
			const consoleMethod = this.getConsoleMethod(level);
			if (Object.keys(filteredContext).length > 0) {
				consoleMethod(levelPrefix + interpolatedMessage, filteredContext);
			} else {
				consoleMethod(levelPrefix + interpolatedMessage);
			}
		} else {
			this.getConsoleMethod(level)(levelPrefix + interpolatedMessage);
		}
	}
	// Note: NOT static as test suite needs to spy on the output
	private getConsoleMethod(level: LogLevel): (message: string, ...args: Array<unknown>) => void {
		switch (level) {
			case LogLevel.FATAL:
			case LogLevel.ERROR:
				return console.error;
			case LogLevel.WARN:
				return console.warn;
			case LogLevel.INFO:
				return console.info;
			case LogLevel.DEBUG:
				return console.debug;
			case LogLevel.TRACE:
				return console.trace;
			default:
				// We could throw, but that's a bit aggressive for a logging class
				// so just use a regular console.log()
				return console.log;
		}
	}
	// Interface methods
	fatal(message: string, context?: Record<string, unknown>): void {
		this.logToConsole(LogLevel.FATAL, message, context);
	}
	error(message: string, context?: Record<string, unknown>): void {
		this.logToConsole(LogLevel.ERROR, message, context);
	}
	warn(message: string, context?: Record<string, unknown>): void {
		this.logToConsole(LogLevel.WARN, message, context);
	}
	info(message: string, context?: Record<string, unknown>): void {
		this.logToConsole(LogLevel.INFO, message, context);
	}
	debug(message: string, context?: Record<string, unknown>): void {
		this.logToConsole(LogLevel.DEBUG, message, context);
	}
	trace(message: string, context?: Record<string, unknown>): void {
		this.logToConsole(LogLevel.TRACE, message, context);
	}
	log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
		this.logToConsole(level, message, context);
	}
}

/**
 * Creates a timer to measure elapsed time in milliseconds.
 * @returns an object with an `elapsed` method to retrieve the duration since the timer started.
 * @example
 * const timer = measureTime();
 * // ... some code ...
 * const duration = timer.elapsed();
 */
export function measureTime() {
	const start = Date.now();
	return {
		elapsed: () => {
			return Date.now() - start;
		}
	};
}
