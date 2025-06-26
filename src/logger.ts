export enum LogLevel {
	FATAL = 0, // Most severe
	ERROR = 1,
	WARN = 2,
	INFO = 3,
	DEBUG = 4,
	TRACE = 5 // Least severe
}

export interface Logger {
	fatal(message: string, context?: Record<string, any>): void;
	error(message: string, context?: Record<string, any>): void;
	warn(message: string, context?: Record<string, any>): void;
	info(message: string, context?: Record<string, any>): void;
	debug(message: string, context?: Record<string, any>): void;
	trace(message: string, context?: Record<string, any>): void;
	log(level: LogLevel, message: string, context?: Record<string, any>): void;
}

/**
 * The default logger implementation - does nothing
 */
class NullLogger implements Logger {
	fatal(message: string, context?: Record<string, any>): void {}
	error(message: string, context?: Record<string, any>): void {}
	warn(message: string, context?: Record<string, any>): void {}
	info(message: string, context?: Record<string, any>): void {}
	debug(message: string, context?: Record<string, any>): void {}
	trace(message: string, context?: Record<string, any>): void {}
	log(level: LogLevel, message: string, context?: Record<string, any>): void {}
}

export const NULL_LOGGER = new NullLogger();

// Mapping of log levels to console methods
const CONSOLE_METHODS: Record<LogLevel, (message: string, ...args: any[]) => void> = {
	[LogLevel.FATAL]: console.error,
	[LogLevel.ERROR]: console.error,
	[LogLevel.WARN]: console.warn,
	[LogLevel.INFO]: console.info,
	[LogLevel.DEBUG]: console.debug,
	[LogLevel.TRACE]: console.trace
};

// Mapping of LogLevel numeric values to their string names
const LOG_LEVEL_NAMES: Record<LogLevel, string> = {
	[LogLevel.FATAL]: 'FATAL',
	[LogLevel.ERROR]: 'ERROR',
	[LogLevel.WARN]: 'WARN',
	[LogLevel.INFO]: 'INFO',
	[LogLevel.DEBUG]: 'DEBUG',
	[LogLevel.TRACE]: 'TRACE'
};

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

	constructor(minLevel: LogLevel = LogLevel.INFO) {
		this.minLevel = minLevel; // Store the LogLevel value directly
	}

	private logToConsole(level: LogLevel, message: string, context?: Record<string, any>): void {
		if (level > this.minLevel) return;
		const levelPrefix = `[${LOG_LEVEL_NAMES[level]}] `;
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
			const consoleMethod = CONSOLE_METHODS[level];
			if (Object.keys(filteredContext).length > 0) {
				consoleMethod(levelPrefix + interpolatedMessage, filteredContext);
			} else {
				consoleMethod(levelPrefix + interpolatedMessage);
			}
		} else {
			CONSOLE_METHODS[level](levelPrefix + interpolatedMessage);
		}
	}
	fatal(message: string, context?: Record<string, any>): void {
		this.logToConsole(LogLevel.FATAL, message, context);
	}
	error(message: string, context?: Record<string, any>): void {
		this.logToConsole(LogLevel.ERROR, message, context);
	}
	warn(message: string, context?: Record<string, any>): void {
		this.logToConsole(LogLevel.WARN, message, context);
	}
	info(message: string, context?: Record<string, any>): void {
		this.logToConsole(LogLevel.INFO, message, context);
	}
	debug(message: string, context?: Record<string, any>): void {
		this.logToConsole(LogLevel.DEBUG, message, context);
	}
	trace(message: string, context?: Record<string, any>): void {
		this.logToConsole(LogLevel.TRACE, message, context);
	}
	log(level: LogLevel, message: string, context?: Record<string, any>): void {
		this.logToConsole(level, message, context);
	}
}
