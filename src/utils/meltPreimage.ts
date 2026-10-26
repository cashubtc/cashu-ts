import type { Logger } from '../logger';

import { bolt11PreimageMatches } from './core';

/**
 * Normalizes a bolt melt response's `payment_preimage` in place to a string or null.
 *
 * @remarks
 * Per NUT-23 it is `<str | null>`: undefined reads as null, any other type warns and reads as null.
 * A bolt11 preimage is also checked against its invoice.
 */
export function normalizeMeltPreimage(
  data: Record<string, unknown>,
  method: string,
  logger: Logger,
  op: string,
): void {
  const supplied = data.payment_preimage ?? null;
  if (typeof supplied !== 'string') {
    if (supplied !== null) {
      logger.warn('Mint returned a payment_preimage that is not a string', { op });
    }
    data.payment_preimage = null;
    return;
  }
  data.payment_preimage =
    method === 'bolt11' && typeof data.request === 'string'
      ? verifiedPreimage(data.request, supplied, logger, op)
      : supplied;
}

/**
 * Returns the preimage when it hashes to the invoice's payment hash, null (with a warning) when it
 * does not, and the preimage unchanged when the invoice cannot be parsed.
 */
function verifiedPreimage(
  request: string,
  preimage: string,
  logger: Logger,
  op: string,
): string | null {
  let valid: boolean;
  try {
    valid = bolt11PreimageMatches(request, preimage);
  } catch (err) {
    logger.debug('Melt quote request is not a parseable BOLT11 invoice', { op, err });
    return preimage;
  }
  if (valid) return preimage;
  logger.warn('Mint returned a payment_preimage that does not match the invoice', { op });
  return null;
}
