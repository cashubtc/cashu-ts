[Documents](../index.html) › [Usage Examples](../usage/usage_index.md) › **Logging**

# Logging

By default, cashu-ts does not log to the console. If you want to enable logging for debugging purposes, you can set the `logger` option when creating a wallet or mint. A `ConsoleLogger` is provided, or you can wrap your existing logger to conform to the `Logger` interface:

```typescript
import { Mint, Wallet, ConsoleLogger, LogLevel } from '@cashu/cashu-ts';
const mintUrl = 'http://localhost:3338';
const mintLogger = new ConsoleLogger('error');
const mint = new Mint(mintUrl, undefined, { logger: mintLogger }); // Enable logging for the mint
const walletLogger = new ConsoleLogger('debug');
const wallet = new Wallet(mint, { logger: walletLogger }); // Enable logging for the wallet
await wallet.loadMint(); // wallet with logging is now ready to use
```
