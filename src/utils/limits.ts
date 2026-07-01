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
 * NUT-04/05: Upper bound on the length of a mint-advertised payment `method` string we will derive
 * a default `method_name` from. Real methods are short identifiers (`bolt11`, `onchain`); a value
 * beyond this is malformed/hostile, so we skip derivation rather than run unbounded string work
 * (split/map/join) on a multi-megabyte string, which a malicious mint could use to exhaust memory.
 */
export const MAX_METHOD_LENGTH = 255;
