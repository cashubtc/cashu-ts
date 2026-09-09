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
 * NUT-06: Fallback for `max_array_length` when a mint advertises none. Both reference mints cap
 * request arrays at 1000 by default; half that leaves headroom for stricter operator configs.
 */
export const DEFAULT_MAX_ARRAY_LENGTH = 500;

/**
 * NUT-06: Hard ceiling for an advertised `max_array_length`. Bounds the work a mint can talk the
 * wallet into doing per request (a restore batch is one derivation and one blinded message per
 * entry). Values outside `[1, cap]` are clamped, the floor so batching loops still make progress.
 */
export const ABSOLUTE_MAX_ARRAY_LENGTH = 10_000;

/**
 * NUT-02: Hard ceiling on the number of denominations a mint-supplied keyset may carry, checked
 * before any per-key work (id derivation hashes every pubkey). Real keysets carry ~64 keys (powers
 * of two to 2^63), so 256 is ample headroom. Oversized keysets fail id verification.
 */
export const MAX_KEYSET_DENOMINATIONS = 256;

/**
 * Minimum gap between two internal snapshot repairs (`loadMint(true)` fired from inside an
 * operation). Rotations are rare, so a wallet that keeps meeting keyset ids the mint rejects is
 * being fed garbage: without this, each bad token would cost three outbound mint requests,
 * repeatably. Explicit consumer refreshes are not rate limited.
 */
export const REPAIR_COOLDOWN_MS = 60_000;

/**
 * Upper bound on entries we process from a mint-advertised list (NUT-04/05 `methods`, NUT-21/22
 * `protected_endpoints`). Real mints advertise tens; the transport 8 MiB cap still admits ~100k
 * small records, so an unbounded map/clone/sort over them is a memory-amplification vector. Lists
 * longer than this are truncated with a warning rather than processed in full.
 */
export const MAX_MINT_INFO_LIST = 1_024;

/**
 * NUT-10: Cap on a serialized secret, applied when creating outputs and before parsing a received
 * proof's secret. Matches the Nutshell default `mint_max_secret_length`. Creation counts code
 * points (as the mint does); the parse-side check counts UTF-16 units, which is never fewer.
 */
export const MAX_SECRET_LENGTH = 1024;

/**
 * NUT-11/14: Cap on a serialized witness, checked before parsing. The 64-signature cap on the
 * verify path keeps a full witness under 9 KiB, so 16 KiB leaves ample headroom.
 */
export const MAX_WITNESS_LENGTH = 16_384;

/**
 * Max u64 (2^64 - 1): the ceiling every Amount is held to. Enforced in the Amount constructor, so
 * arithmetic results are bounded too; muldiv helpers keep their wide intermediate in bigint and
 * only construct the divided-down result.
 */
export const U64_MAX = 2n ** 64n - 1n;

/**
 * Total array items + map entries `decodeCBOR` accepts from one payload.
 *
 * @remarks
 * A v4 proof with both a DLEQ and a witness costs about 9 nodes (1 array slot, the 5-entry proof
 * map, the 3-entry nested DLEQ map), so `ABSOLUTE_MAX_ARRAY_LENGTH` proofs of that shape need about
 * 90,000; this leaves headroom above that on top of the usual one-allocation-per-input-byte bound.
 */
export const MAX_CBOR_NODES = 262_144;

/**
 * NUT-11: Upper bound on the keys in one `pubkeys` or `refund` tag, applied before any per-key
 * curve work. NUT-28 caps a lock at 11 slots (data + pubkeys + refund), enforced at build; this is
 * a work bound with headroom, not the exact slot rule. A string secret past
 * {@link MAX_SECRET_LENGTH} is rejected before it is parsed, so this only gates a pre-parsed
 * secret.
 */
export const MAX_P2PK_PUBKEYS = 16;

/**
 * NUT-11: Upper bound on untrusted witness size, applied on the verify path so per-signature work
 * stays bounded rather than scaling with input. SIG_ALL adds a signature per message variant per
 * signer, so signatures need more headroom than keys ({@link MAX_P2PK_PUBKEYS}).
 */
export const MAX_P2PK_SIGNATURES = 64;
