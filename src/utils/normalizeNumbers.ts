import { Amount, type AmountLike } from '../model/Amount';
import type { MintKeys, MintKeyset } from '../model/types';

/**
 * Temporary v3 shim for public amount fields that still return `number`.
 *
 * In v4 these callers should return `Amount` directly instead of collapsing back to `number`. This
 * function will likely disappear.
 *
 * @internal
 */
export function normalizeAmountToLegacyNumber(value: AmountLike, context: string): number;
export function normalizeAmountToLegacyNumber<TFallback extends number | null | undefined>(
	value: AmountLike | null | undefined,
	context: string,
	fallback: TFallback,
): number | TFallback;
export function normalizeAmountToLegacyNumber<TFallback extends number | null | undefined>(
	value: AmountLike | null | undefined,
	context: string,
	fallback?: TFallback,
): number | TFallback {
	if (value === null || value === undefined) {
		if (arguments.length >= 3) {
			return fallback as TFallback;
		}
		throw new Error(`Invalid ${context}: missing value`);
	}
	try {
		return Amount.from(value).toNumberUnsafe();
	} catch (e) {
		throw new Error(`Invalid ${context}: ${(e as Error).message}`);
	}
}

/**
 * Normalize metadata-like numeric fields that must remain safe JS numbers. NB; This will STAY in
 * v4, as it is used for timestamps, TTLs, fee metadata, limits/counters that should remain plain
 * number.
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
		throw new Error(`Invalid ${context}: missing value`);
	}
	try {
		return Amount.from(value).toNumber();
	} catch (e) {
		throw new Error(`Invalid ${context}: ${(e as Error).message}`);
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
