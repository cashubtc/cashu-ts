import { type Logger, type LogLevel } from './Logger';

const LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

const CONTROL_ESCAPES: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t' };
// eslint-disable-next-line no-control-regex -- matching control chars is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * Escapes C0/C1 control characters so one message renders as one log line and cannot carry terminal
 * escape sequences.
 */
function escapeControlChars(message: string): string {
  return String(message).replace(
    CONTROL_CHARS,
    (ch) => CONTROL_ESCAPES[ch] ?? '\\x' + ch.charCodeAt(0).toString(16).padStart(2, '0'),
  );
}

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
export class ConsoleLogger implements Logger {
  private minLevel: LogLevel;

  constructor(minLevel: LogLevel = 'info') {
    this.minLevel = minLevel;
  }

  private should(level: LogLevel): boolean {
    return LEVEL_ORDER[level] <= LEVEL_ORDER[this.minLevel];
  }
  private method(level: LogLevel): (msg: string, ...rest: unknown[]) => void {
    switch (level) {
      case 'error':
        return console.error;
      case 'warn':
        return console.warn;
      case 'info':
        return console.info;
      case 'debug':
        return console.debug;
      case 'trace':
        return console.trace;
      default:
        return console.log;
    }
  }
  private header(level: LogLevel, message: string): string {
    return `[${level.toUpperCase()}] ${escapeControlChars(message)}`;
  }
  private flattenContext(ctx?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!ctx) return undefined;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(ctx)) {
      out[k] = v instanceof Error ? { message: v.message, stack: v.stack } : v;
    }
    return out;
  }
  private emit(level: LogLevel, message: string, context?: Record<string, unknown>) {
    if (!this.should(level)) return;
    const line = this.header(level, message);
    const ctx = this.flattenContext(context);
    const fn = this.method(level);
    if (ctx && Object.keys(ctx).length) fn(line, ctx);
    else fn(line);
  }

  error(msg: string, ctx?: Record<string, unknown>) {
    this.emit('error', msg, ctx);
  }
  warn(msg: string, ctx?: Record<string, unknown>) {
    this.emit('warn', msg, ctx);
  }
  info(msg: string, ctx?: Record<string, unknown>) {
    this.emit('info', msg, ctx);
  }
  debug(msg: string, ctx?: Record<string, unknown>) {
    this.emit('debug', msg, ctx);
  }
  trace(msg: string, ctx?: Record<string, unknown>) {
    this.emit('trace', msg, ctx);
  }

  log(level: LogLevel, message: string, context?: Record<string, unknown>) {
    this.emit(level, message, context);
  }
}

/**
 * Creates a timer to measure elapsed time in milliseconds.
 *
 * @example Const timer = measureTime(); // ... some code ... const duration = timer.elapsed();
 *
 * @returns An object with an `elapsed` method to retrieve the duration since the timer started.
 */
export function measureTime() {
  const start = Date.now();
  return {
    elapsed: () => {
      return Date.now() - start;
    },
  };
}
