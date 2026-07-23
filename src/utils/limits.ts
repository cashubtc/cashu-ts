/**
 * NUT-22: Hard ceiling for `bat_max_mint`, the maximum number of blind authentication tokens a
 * wallet may request in a single mint call. Values advertised by a mint above this cap are
 * clamped.
 */
export const ABSOLUTE_MAX_PER_MINT = 100;

/**
 * Cap on outputs from the `splitAmount` denomination fill. A normal split over a power-of-two
 * keyset is at most a few dozen; a coarse keyset (few, small denominations) over a large value
 * could otherwise fill millions. 8x cdk's default max_outputs (1000): clears any real mint, and a
 * request carrying that many outputs would be rejected for size anyway. Exceeding it throws.
 */
export const MAX_SPLIT_OUTPUTS = 8_192;

/**
 * NUT-29: Hard ceiling for batch-mint size, the maximum number of quote entries a wallet may
 * include in a single `prepareBatchMint` call. Values advertised by a mint above this cap are
 * clamped.
 */
export const ABSOLUTE_MAX_BATCH_SIZE = 100;

/**
 * NUT-02: Hard ceiling on the number of denominations a mint-supplied keyset may carry, checked
 * before any per-key work (id derivation hashes every pubkey). Real keysets carry ~64 keys (powers
 * of two to 2^63), so 256 is ample headroom. Oversized keysets fail id verification.
 */
export const MAX_KEYSET_DENOMINATIONS = 256;

/**
 * NUT-04/05: Upper bound on the length of a mint-advertised payment `method` string we will derive
 * a default `method_name` from. Real methods are short identifiers (`bolt11`, `onchain`); a value
 * beyond this is malformed/hostile, so we skip derivation rather than run unbounded string work
 * (split/map/join) on a multi-megabyte string, which a malicious mint could use to exhaust memory.
 */
export const MAX_METHOD_LENGTH = 255;

/**
 * Max u64 (2^64 - 1): the ceiling every Amount is held to. Enforced in the Amount constructor, so
 * arithmetic results are bounded too; muldiv helpers keep their wide intermediate in bigint and
 * only construct the divided-down result.
 */
export const U64_MAX = 2n ** 64n - 1n;
