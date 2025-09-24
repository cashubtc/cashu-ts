import { type Logger } from './Logger';
import { NULL_LOGGER } from './NullLogger';

/**
 * Log at ERROR and throw. Always throws.
 *
 * @param message - Error message to log and throw.
 * @param logger - Logger to use, defaults to NULL_LOGGER.
 * @param context - Optional structured context for the log.
 * @throws {Error} Always throws with the given message.
 */
export function fail(
	message: string,
	logger: Logger = NULL_LOGGER,
	context?: Record<string, unknown>,
): never {
	logger.error(message, context);
	throw new Error(message);
}

/**
 * Log at FATAL and throw. Always throws.
 *
 * @param message - Error message to log and throw.
 * @param logger - Logger to use, defaults to NULL_LOGGER.
 * @param context - Optional structured context for the log.
 * @throws {Error} Always throws with the given message.
 */
export function panic(
	message: string,
	logger: Logger = NULL_LOGGER,
	context?: Record<string, unknown>,
): never {
	logger.fatal(message, context);
	throw new Error(message);
}

/**
 * Throw if a Boolean condition is true. On return, the compiler knows the condition is false.
 *
 * @param condition - Condition that must be false to continue.
 * @param message - Error message if condition is true.
 * @param logger - Logger to use, defaults to NULL_LOGGER.
 * @param context - Optional structured context for the log.
 * @throws {Error} If condition is true, throws with the given message.
 */
export function failIf(
	condition: boolean,
	message: string,
	logger: Logger = NULL_LOGGER,
	context?: Record<string, unknown>,
): asserts condition is false {
	if (condition) fail(message, logger, context);
}

/**
 * Throw if a value is null or undefined. On return, narrows away null and undefined from the value
 * type.
 *
 * @typeParam T - The value type to check.
 * @param value - The value to validate.
 * @param message - Error message if value is nullish.
 * @param logger - Logger to use, defaults to NULL_LOGGER.
 * @param context - Optional structured context for the log.
 * @throws {Error} If value is null or undefined.
 */
export function failIfNullish<T>(
	value: T,
	message: string,
	logger: Logger = NULL_LOGGER,
	context?: Record<string, unknown>,
): asserts value is Exclude<T, null | undefined> {
	if (value == null) fail(message, logger, context);
}
