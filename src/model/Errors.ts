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
 * Thrown when a keyset id cannot be resolved against the mint, even after a refresh.
 */
export class UnknownKeysetError extends CTSError {
  readonly keysetId: string;
  constructor(keysetId: string, options?: { cause?: unknown }) {
    const message =
      options?.cause !== undefined
        ? `Could not resolve unknown keyset '${keysetId}': mint refresh failed`
        : `Keyset '${keysetId}' is not a keyset of this mint`;
    super(message, options);
    this.keysetId = keysetId;
    this.name = 'UnknownKeysetError';
    Object.setPrototypeOf(this, UnknownKeysetError.prototype);
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
