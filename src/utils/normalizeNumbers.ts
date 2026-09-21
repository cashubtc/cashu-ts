import { Amount, type AmountLike } from '../model/Amount';
import { CTSError } from '../model/Errors';
import { MintQuoteState, type MintKeys, type MintKeyset } from '../model/types';

/**
 * Normalize metadata-like numeric fields that must remain safe JS numbers, such as timestamps,
 * TTLs, fee metadata, limits/counters.
 *
 * @throws On Out-or-range numbers unless a fallback is explicitly provided.
 * @internal
 */
export function normalizeSafeIntegerMetadata(value: AmountLike, context: string): number;
export function normalizeSafeIntegerMetadata<TFallback extends number | null | undefined>(
  value: AmountLike | null | undefined,
  context: string,
  fallback: TFallback,
): number | TFallback;
export function normalizeSafeIntegerMetadata<TFallback extends number | null | undefined>(
  value: AmountLike | null | undefined,
  context: string,
  fallback?: TFallback,
): number | TFallback {
  if (value === null || value === undefined) {
    if (arguments.length >= 3) {
      return fallback as TFallback;
    }
    throw new CTSError(`Invalid ${context}: missing value`);
  }
  try {
    return Amount.from(value).toNumber();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    throw new CTSError(`Invalid ${context}: ${message}`, { cause: e });
  }
}

export function normalizeMintKeyset(keyset: MintKeyset): MintKeyset {
  return {
    ...keyset,
    input_fee_ppk: normalizeSafeIntegerMetadata(
      keyset.input_fee_ppk,
      'keyset.input_fee_ppk',
      undefined,
    ),
    final_expiry: normalizeSafeIntegerMetadata(
      keyset.final_expiry,
      'keyset.final_expiry',
      undefined,
    ),
  };
}

export function normalizeMintKeys(keys: MintKeys): MintKeys {
  return {
    ...keys,
    input_fee_ppk: normalizeSafeIntegerMetadata(
      keys.input_fee_ppk,
      'keys.input_fee_ppk',
      undefined,
    ),
    final_expiry: normalizeSafeIntegerMetadata(keys.final_expiry, 'keys.final_expiry', undefined),
  };
}

/**
 * Derives `[amount_paid, amount_issued]` from the legacy single-use `state` and quote `amount`, or
 * returns null when underivable. Shared by the HTTP and NUT-17 mint quote paths.
 */
export function deriveMintQuoteAccounting(data: Record<string, unknown>): [Amount, Amount] | null {
  if (
    typeof data.state !== 'string' ||
    !Object.values(MintQuoteState).includes(data.state as MintQuoteState)
  ) {
    return null;
  }
  if (data.state === MintQuoteState.UNPAID) {
    return [Amount.from(0), Amount.from(0)];
  }
  let amount: Amount;
  try {
    amount = Amount.from(data.amount as AmountLike);
  } catch {
    return null;
  }
  return data.state === MintQuoteState.PAID ? [amount, Amount.from(0)] : [amount, amount];
}
