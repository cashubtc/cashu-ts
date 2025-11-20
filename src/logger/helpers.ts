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
 * Throw if a value is null or undefined. Value is narrowed thereafter.
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

/**
 * Invoke a user-supplied callback safely in a fire-and-forget manner.
 *
 * Used for per-operation hooks (e.g. `onCountersReserved`) where user code must never break the
 * wallet’s control flow. The callback is invoked synchronously, exceptions are caught and logged
 * (as a warning), and then swallowed.
 *
 * The wallet never `await`s the callback.
 *
 * @example
 *
 * ```ts
 * if (autoCounters.used) {
 * 	safeCallback(onCountersReserved, autoCounters.used, _logger, { keysetId });
 * }
 * ```
 *
 * @typeParam T Type of the payload passed to the callback.
 * @param cb The callback to invoke, or `undefined`.
 * @param payload The payload to pass to the callback.
 * @param logger Logger to use (defaults to NULL_LOGGER).
 * @param context Optional structured context for the log.
 */
export function safeCallback<T>(
	cb: ((p: T) => void | Promise<void>) | undefined,
	payload: T,
	logger: Logger = NULL_LOGGER,
	context?: Record<string, unknown>,
): void {
	if (!cb) return;

	try {
		const maybePromise = cb(payload);
		if (maybePromise && typeof maybePromise.then === 'function') {
			maybePromise.catch((error) => {
				try {
					logger.warn('callback failed', {
						...(context ?? {}),
						error,
						cb: cb.name ?? '',
					});
				} catch {
					/* ignore logger errors */
				}
			});
		}
	} catch (error) {
		try {
			logger.warn('callback failed', {
				...(context ?? {}),
				error,
				cb: cb.name ?? '',
			});
		} catch {
			/* ignore logger errors */
		}
	}
}
