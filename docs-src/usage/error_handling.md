# <a href="/">Documents</a> › [Usage Examples](../usage/usage_index.md) › **Error Handling Patterns**

# Error handling patterns

```ts
import {
  CTSError,
  isMintOperationError,
  isPendingError,
  isProofsAlreadySpentError,
  NetworkError,
} from '@cashu/cashu-ts';

try {
  const res = await wallet.ops.send(5, proofs).offlineExactOnly().run();
  console.log('Sent:', res.send.length, 'Kept:', res.keep.length);
} catch (e) {
  // Every library error sets a stable `name`, so logs and generic handlers can
  // tell them apart. Do not use `constructor.name`: the shipped build is
  // minified and it reads as a single letter.
  if (isProofsAlreadySpentError(e)) {
    // Reconcile the proof store with the mint's proof states.
  } else if (isPendingError(e)) {
    // Back off and check proof/quote state again; keep the proofs while pending.
  } else if (isMintOperationError(e)) {
    // Other mint rejection: the protocol code says why.
    console.error(e.code, e.message);
  } else if (e instanceof NetworkError) {
    // no usable response: retry or surface it
  } else if (e instanceof CTSError) {
    // any other library error; name says which, eg 'StaleKeysetError'
    console.error(e.name, e.message);
  }
  throw e;
}
```

`MintErrorCode` provides a named constant for every code in the canonical [NUT error registry](https://github.com/cashubtc/nuts/blob/main/error_codes.md). The predicates below check code sets through `isMintOperationError`, which also accepts errors from another copy of cashu-ts or a custom request layer by name and code. They never inspect the message.

| Predicate                   | Codes                                    |
| --------------------------- | ---------------------------------------- |
| `isProofsAlreadySpentError` | 11001                                    |
| `isPendingError`            | 11002, 11004, 20005                      |
| `isAlreadyIssuedError`      | 11003, 20002                             |
| `isQuoteNotPaidError`       | 20001                                    |
| `isQuoteExpiredError`       | 20007                                    |
| `isPaymentFailedError`      | 20004                                    |
| `isAuthError`               | 30001, 30002, 31001, 31002, 31003, 31004 |

`isAlreadyIssuedError` covers both already-signed outputs and an already-issued quote, because a repeated mint request can encounter either check first. It identifies the rejection; recovering issued proofs is a separate wallet action. `isPaymentFailedError` excludes pending payments.

For a custom code set, use `hasMintErrorCode`:

```ts
import { hasMintErrorCode, MintErrorCode } from '@cashu/cashu-ts';

try {
  await wallet.ops.send(5, proofs).run();
} catch (e) {
  if (hasMintErrorCode(e, [MintErrorCode.KEYSET_NOT_KNOWN, MintErrorCode.KEYSET_EXPIRED])) {
    console.error('The mint rejected the keyset');
  }
  throw e;
}
```

Unknown codes return `false` from the named predicates and remain readable on `MintOperationError.code`. Callers can include mint-specific codes in `hasMintErrorCode` without adding them to the constants table.

## Concurrent operations

cashu-ts does not lock proof sets. Each call only sees the proofs it is given, and your proof store is invisible to the library, so nothing stops two operations (in one `Wallet`, in two instances, or in two tabs or processes) from spending the same proofs at once. Serialising operations on the same proofs is the app's job. When two operations race on overlapping proofs, one succeeds and the other fails at the mint with `11001` (token already spent) or, while the winner's swap is still settling, `11002` (token pending). Treat `11002` as "check again": re-run `checkProofsStates` before deciding anything, and never delete proofs on it. Each losing attempt also consumes deterministic counters, which is harmless but visible in a restore.
