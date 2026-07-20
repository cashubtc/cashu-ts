/**
 * NUT-22: Hard ceiling for `bat_max_mint`, the maximum number of blind authentication tokens a
 * wallet may request in a single mint call. Values advertised by a mint above this cap are
 * clamped.
 */
export const ABSOLUTE_MAX_PER_MINT = 100;

/**
 * NUT-29: Hard ceiling for batch-mint size, the maximum number of quote entries a wallet may
 * include in a single `prepareBatchMint` call. Values advertised by a mint above this cap are
 * clamped.
 */
export const ABSOLUTE_MAX_BATCH_SIZE = 100;

/**
 * Max u64 (2^64 - 1): upper bound for amount and other u64 integer fields as they arrive from the
 * wire or an API caller. Enforced on ingest (`Amount.from`), not on arithmetic: Amount math
 * (percent, scale) intentionally uses intermediates above u64.
 */
export const U64_MAX = 2n ** 64n - 1n;
