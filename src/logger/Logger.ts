/**
 * Defines the available log levels for the logger. Log levels are ordered from most severe (FATAL)
 * to least severe (TRACE).
 */
export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

export interface Logger {
	fatal(message: string, context?: Record<string, unknown>): void;
	error(message: string, context?: Record<string, unknown>): void;
	warn(message: string, context?: Record<string, unknown>): void;
	info(message: string, context?: Record<string, unknown>): void;
	debug(message: string, context?: Record<string, unknown>): void;
	trace(message: string, context?: Record<string, unknown>): void;
	log(level: LogLevel, message: string, context?: Record<string, unknown>): void;
}
