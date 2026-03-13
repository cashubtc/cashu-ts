# Migrating to cashu-ts v4.0.0

## ESM-only package

cashu-ts v4 ships **only ES modules**. The CommonJS build (`lib/cashu-ts.cjs`) has been removed.

### Why

Our core dependencies (`@noble/curves`, `@noble/hashes`, `@scure/bip32`) are ESM-only.
Maintaining a dual CJS build required bundling those deps into the CJS output, increasing
complexity and risk of module-duplication bugs. Node.js v20.19+ supports `require(esm)`
natively, removing the primary CJS use case.

### What changed

- `package.json` no longer has a `"require"` condition in `exports` or a `"main"` field pointing to a `.cjs` file.
- `npm run compile` produces only the ESM bundle (`lib/cashu-ts.es.js`).
- The IIFE standalone browser build is unchanged.

## Migration path for consumers

| Current setup                     | Migration                                         |
| --------------------------------- | ------------------------------------------------- |
| `require('@cashu/cashu-ts')`      | Convert to ESM `import` or use dynamic `import()` |
| Node.js < 20.19                   | Upgrade Node.js to 20.19+ or 22.x                 |
| Bundler configured for CJS output | Update bundler config to output ESM               |

### Example

```js
// Before (CJS)
const { Wallet } = require('@cashu/cashu-ts');

// After (ESM)
import { Wallet } from '@cashu/cashu-ts';
```

If you must keep a CJS entry point, use a dynamic import wrapper:

```js
// CJS compatibility shim (Node.js >= 20.19)
const { Wallet } = await import('@cashu/cashu-ts');
```
