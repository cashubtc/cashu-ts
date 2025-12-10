/**
 * Public keys are a dictionary of number and string. The number represents the amount that the key
 * signs for.
 */
export type Keys = { [amount: number]: string };

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
