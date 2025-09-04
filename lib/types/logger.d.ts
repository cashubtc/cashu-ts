/**
 * Defines the available log levels for the logger. Log levels are ordered from most severe (FATAL)
 * to least severe (TRACE).
 */
export declare const LogLevel: {
    readonly FATAL: "FATAL";
    readonly ERROR: "ERROR";
    readonly WARN: "WARN";
    readonly INFO: "INFO";
    readonly DEBUG: "DEBUG";
    readonly TRACE: "TRACE";
};
/**
 * Defines the available log levels for the logger. Log levels are ordered from most severe (FATAL)
 * to least severe (TRACE).
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
export declare const NULL_LOGGER: Logger;
/**
 * Outputs messages to the console based on the specified log level.
 *
 * Supports placeholder substitution in messages (e.g., `{key}`) using values from the optional
 * `context` object. Context keys not used in substitution are appended to the output as additional
 * data. Each log message is prefixed with the log level in square brackets (e.g., `[INFO]`).
 *
 * @example Const logger = new ConsoleLogger(LogLevel.DEBUG); logger.info('User {username} logged
 * in', { username: 'alice', ip: '127.0.0.1' }); // Output: [INFO] User alice logged in { ip:
 * "127.0.0.1" }
 */
export declare class ConsoleLogger implements Logger {
    private minLevel;
    static readonly SEVERITY: Record<LogLevel, number>;
    constructor(minLevel?: LogLevel);
    private logToConsole;
    private getConsoleMethod;
    fatal(message: string, context?: Record<string, unknown>): void;
    error(message: string, context?: Record<string, unknown>): void;
    warn(message: string, context?: Record<string, unknown>): void;
    info(message: string, context?: Record<string, unknown>): void;
    debug(message: string, context?: Record<string, unknown>): void;
    trace(message: string, context?: Record<string, unknown>): void;
    log(level: LogLevel, message: string, context?: Record<string, unknown>): void;
}
/**
 * Creates a timer to measure elapsed time in milliseconds.
 *
 * @example Const timer = measureTime(); // ... some code ... const duration = timer.elapsed();
 *
 * @returns An object with an `elapsed` method to retrieve the duration since the timer started.
 */
export declare function measureTime(): {
    elapsed: () => number;
};
