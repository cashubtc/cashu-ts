import type { OutputDataLike } from './OutputData';
import type { MeltQuoteBaseResponse } from './types/NUT05';

/**
 * Base error for errors raised by cashu-ts itself.
 */
export class CTSError extends Error {
  readonly cause?: unknown;

  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'CTSError';
    if (options?.cause !== undefined) {
      Object.defineProperty(this, 'cause', {
        configurable: true,
        enumerable: false,
        value: options.cause,
        writable: true,
      });
    }
    Object.setPrototypeOf(this, CTSError.prototype);
  }
}

/**
 * This error is thrown when a HTTP response is not 2XX nor a protocol error.
 */
export class HttpResponseError extends CTSError {
  status: number;
  constructor(message: string, status: number, options?: { cause?: unknown }) {
    super(message, options);
    this.status = status;
    this.name = 'HttpResponseError';
    Object.setPrototypeOf(this, HttpResponseError.prototype);
  }
}

/**
 * This error is thrown when a network request fails.
 */
export class NetworkError extends CTSError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'NetworkError';
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

/**
 * Thrown when a keyset id cannot be resolved against the wallet's view of the mint.
 *
 * @remarks
 * `refreshed: false` means the wallet has no answer from the mint (rate limited, strict mode, or a
 * failed refresh), so a retry or a `loadMint(true)` may still resolve the id.
 */
export class UnknownKeysetError extends CTSError {
  /**
   * The keyset id that could not be resolved.
   */
  readonly keysetId: string;
  /**
   * True when a refresh ran and the id was still unknown, so the mint really does not have it.
   */
  readonly refreshed: boolean;
  constructor(keysetId: string, options?: { refreshed?: boolean; cause?: unknown }) {
    const refreshed = options?.refreshed ?? false;
    const message =
      options?.cause !== undefined
        ? `Could not resolve unknown keyset '${keysetId}': mint refresh failed`
        : refreshed
          ? `Keyset '${keysetId}' is not a keyset of this mint`
          : `Keyset '${keysetId}' is not in the wallet snapshot and no refresh was attempted; call loadMint(true), or retry once the repair cooldown clears`;
    super(message, options);
    this.keysetId = keysetId;
    this.refreshed = refreshed;
    this.name = 'UnknownKeysetError';
    Object.setPrototypeOf(this, UnknownKeysetError.prototype);
  }
}

/**
 * Thrown when a melt went through but its NUT-08 change could not be reconstructed.
 *
 * @remarks
 * The inputs are spent and the payment stands. `cause` says which recovery applies: a keyset that
 * can be loaded (see `keyChain.ensureKeysetKeys`) rebuilds from `outputData` and the quote's
 * `change` signatures via `wallet.createMeltChangeProofs()`. Anything else, eg invalid DLEQ or a
 * signature count mismatch, needs a NUT-09 restore on a seeded wallet.
 */
export class MeltChangeError extends CTSError {
  /**
   * The melt's blank outputs, the input to change recovery.
   */
  readonly outputData: OutputDataLike[];
  /**
   * The melt quote, merged from the preview and the mint's response.
   */
  readonly quote: MeltQuoteBaseResponse;
  constructor(
    outputData: OutputDataLike[],
    quote: MeltQuoteBaseResponse,
    options?: { cause?: unknown },
  ) {
    super(
      'Melt completed but its change could not be reconstructed; see cause: a keyset that will load rebuilds via createMeltChangeProofs(), anything else needs a NUT-09 restore',
      options,
    );
    this.outputData = outputData;
    this.quote = quote;
    this.name = 'MeltChangeError';
    Object.setPrototypeOf(this, MeltChangeError.prototype);
  }
}

/**
 * Thrown when the mint rejects a keyset the wallet's snapshot considers current.
 *
 * @remarks
 * `repaired: true` means the snapshot was refreshed before throwing: nothing retried for you, so
 * run the operation again and it should succeed. Retrying consumes fresh counters on seeded wallets
 * (recoverable via NUT-09 restore).
 */
export class StaleKeysetError extends CTSError {
  /**
   * True when the snapshot was refreshed before throwing, so the operation is worth running again.
   */
  readonly repaired: boolean;
  constructor(repaired: boolean, options?: { cause?: unknown }) {
    super(
      repaired
        ? 'Mint rejected a stale keyset; the snapshot has been refreshed, re-prepare the operation'
        : 'Mint rejected a stale keyset; refresh the snapshot (loadMint(true)) and re-prepare',
      options,
    );
    this.repaired = repaired;
    this.name = 'StaleKeysetError';
    Object.setPrototypeOf(this, StaleKeysetError.prototype);
  }
}

/**
 * This error is thrown when the server responds with 429 Too Many Requests. `retryAfterMs` is the
 * parsed `Retry-After` header in milliseconds, or `undefined` when the header is absent or
 * unparseable.
 */
export class RateLimitError extends HttpResponseError {
  constructor(
    message: string,
    public readonly retryAfterMs?: number,
  ) {
    super(message, 429);
    this.name = 'RateLimitError';
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
}

/**
 * This error is thrown when a [protocol
 * error](https://github.com/cashubtc/nuts/blob/main/00.md#errors) occurs. See error codes
 * [here](https://github.com/cashubtc/nuts/blob/main/error_codes.md).
 */
export class MintOperationError extends HttpResponseError {
  code: number;
  constructor(code: number, detail: string) {
    super(detail || 'Unknown mint operation error', 400);
    this.code = code;
    this.name = 'MintOperationError';
    Object.setPrototypeOf(this, MintOperationError.prototype);
  }
}

/**
 * True when `e` is a {@link MintOperationError}, including look-alikes by name + code.
 *
 * @remarks
 * Prefer this over `instanceof`, which misses errors thrown by another copy of this package (eg:
 * npm dedupe failure) or by a custom request layer declaring its own class.
 */
export function isMintOperationError(e: unknown): e is MintOperationError {
  return (
    e instanceof MintOperationError ||
    (e instanceof Error && e.name === 'MintOperationError' && 'code' in e)
  );
}

/**
 * A JSON-RPC error frame received over the NUT-17 WebSocket.
 *
 * @remarks
 * Carries the protocol error code, which the subscription callbacks cannot receive otherwise: they
 * are typed `(e: Error) => void`. Relevant codes are 30001 (clear auth required), 30002 (clear auth
 * failed), 31001 (blind auth required) and 31002 (blind auth failed). A 31001 on a subscribe means
 * the connection was never authenticated. See [error
 * codes](https://github.com/cashubtc/nuts/blob/main/error_codes.md).
 */
export class WsRpcError extends CTSError {
  readonly code: number;

  constructor(code: number, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
    this.name = 'WsRpcError';
    Object.setPrototypeOf(this, WsRpcError.prototype);
  }
}

/**
 * Thrown when authenticating a NUT-17 WebSocket connection fails.
 *
 * @remarks
 * `terminal` means this connection has failed to authenticate too many times in a row and will no
 * longer try: further `ensureAuthenticated()` calls reject immediately without spending another
 * token. That bound exists because a blind auth token is spent the moment it leaves the pool, so an
 * unbounded reconnect loop would drain the pool. Recovery requires a new connection.
 */
export class WsAuthError extends CTSError {
  readonly code?: number;
  readonly terminal: boolean;

  constructor(message: string, options?: { code?: number; terminal?: boolean; cause?: unknown }) {
    super(message, options);
    this.code = options?.code;
    this.terminal = options?.terminal ?? false;
    this.name = 'WsAuthError';
    Object.setPrototypeOf(this, WsAuthError.prototype);
  }
}
