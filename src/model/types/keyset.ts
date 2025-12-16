/**
 * Public keys are a dictionary of number and string. The number represents the amount that the key
 * signs for.
 */
export type Keys = { [amount: number]: string };

/**
 * Minimal key carrier shape for low level helpers.
 *
 * Any type with Keyset `id` can be used, including MintKeyset, MintKeys, HasKeysetKeys, Keyset,
 * KeysetCache.
 */
export type HasKeysetId = { id: string };

/**
 * Minimal key carrier shape for low level helpers.
 *
 * Any type with `id`, and `keys` can be used, including MintKeys, KeysetCache and Keyset.
 */
export type HasKeysetKeys = { id: string; keys: Keys };

/**
 * NUT-01 Keys API response (/v1/keys)
 */
export type GetKeysResponse = {
	/**
	 * Keysets.
	 */
	keysets: MintKeys[];
};

/**
 * NUT-02 Keysets API response (/v1/keysets)
 */
export type GetKeysetsResponse = {
	/**
	 * Keysets.
	 */
	keysets: MintKeyset[];
};

/**
 * A mint keyset.
 */
export type MintKeys = {
	/**
	 * Keyset ID.
	 */
	id: string;
	/**
	 * Unit of the keyset.
	 */
	unit: string;
	/**
	 * Expiry of the keyset.
	 */
	final_expiry?: number;
	/**
	 * Public keys are a dictionary of number and string. The number represents the amount that the
	 * key signs for.
	 */
	keys: Keys;
};

/**
 * A mint keyset entry.
 */
export type MintKeyset = {
	/**
	 * Keyset ID.
	 */
	id: string;
	/**
	 * Unit of the keyset.
	 */
	unit: string;
	/**
	 * Whether the keyset is active or not.
	 */
	active: boolean;
	/**
	 * Input fee for keyset (in ppk)
	 */
	input_fee_ppk?: number;

	/**
	 * Expiry of the keyset.
	 */
	final_expiry?: number;
};

/**
 * Cached view of a keyset.
 *
 * @remarks
 * This is basically MintKeyset, with optional "keys" field for active, verified keysets.
 */
export type KeysetCache = MintKeyset & {
	/**
	 * Optional. Keys for this keyset, if available.
	 *
	 * Present only when keyset is active and keys have been verified.
	 */
	keys?: Keys;
};

/**
 * Cached view of a KeyChain.
 *
 * @remarks
 * This is the preferred format for persisting and restoring keychain state.
 */
export type KeyChainCache = {
	/**
	 * Flattened keysets and, optionally, their keys.
	 */
	keysets: KeysetCache[];
	/**
	 * The unit this keychain is for, for example 'sat', 'usd'.
	 */
	unit: string;
	/**
	 * Mint URL that this cache belongs to.
	 */
	mintUrl: string;
};
