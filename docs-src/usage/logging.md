# <a href="/">Documents</a> › [Usage Examples](../usage/usage_index.md) › **Logging**

# Logging

By default, cashu-ts does not log to the console. If you want to enable logging for debugging purposes, you can set the `logger` option when creating a wallet or mint. A `ConsoleLogger` is provided, or you can wrap your existing logger to conform to the `Logger` interface:

```typescript
import { Mint, Wallet, ConsoleLogger, type LogLevel } from '@cashu/cashu-ts';
const mintUrl = 'http://localhost:3338';
const mintLevel: LogLevel = 'error'; // 'error' | 'warn' | 'info' | 'debug' | 'trace'
const mintLogger = new ConsoleLogger(mintLevel);
const mint = new Mint(mintUrl, { logger: mintLogger }); // Enable logging for the mint
const walletLogger = new ConsoleLogger('debug');
const wallet = new Wallet(mint, { logger: walletLogger }); // Enable logging for the wallet
await wallet.loadMint(); // wallet with logging is now ready to use
```

## The `Logger` interface

To send cashu-ts output to your own logger, implement these six methods. `log()` takes the level
as its first argument; the other five are the per-level shorthands. `ConsoleLogger` is simply the
bundled implementation of this interface.

```typescript
import { Wallet, type Logger } from '@cashu/cashu-ts';

// appLogger is your existing logger
const logger: Logger = {
  log: (level, message, context) => appLogger.write(level, message, context),
  error: (message, context) => appLogger.write('error', message, context),
  warn: (message, context) => appLogger.write('warn', message, context),
  info: (message, context) => appLogger.write('info', message, context),
  debug: (message, context) => appLogger.write('debug', message, context),
  trace: (message, context) => appLogger.write('trace', message, context),
};

const wallet = new Wallet('http://localhost:3338', { logger });
```

Every method receives an optional `context` object of structured fields. `debug` is verbose: it
dumps the whole keychain cache once per load, along with lock and spending-condition evaluation,
so budget for a large entry if you ship it to a log service. `trace` is part of the interface but
the library does not currently emit at that level.
