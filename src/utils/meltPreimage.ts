import type { Logger } from '../logger';

import { bolt11PreimageMatches } from './core';

/**
 * Returns the preimage when it hashes to the invoice's payment hash, null (with a warning) when it
 * does not, and the preimage unchanged when the invoice cannot be parsed.
 */
export function verifiedPreimage(
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
