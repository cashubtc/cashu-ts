import { bech32m } from '@scure/base';

type Bech32mString = `${string}1${string}`;

/**
 * Asserts that a string has valid bech32m format (contains separator '1' with content on both
 * sides). Per BIP-173/BIP-350, the last '1' in the string is the separator between HRP and data.
 *
 * @param str - The string to validate.
 * @throws Error if the string doesn't have a valid bech32m separator structure.
 */
function assertBech32mFormat(str: string): asserts str is Bech32mString {
	const separatorIndex = str.lastIndexOf('1');
	if (separatorIndex < 1 || separatorIndex === str.length - 1) {
		throw new Error('Invalid bech32m string: missing or misplaced separator');
	}
}

/**
 * Encodes a Uint8Array to a bech32m string with the given human-readable part (HRP).
 *
 * @param hrp - The human-readable prefix (e.g., 'cashu', 'bc')
 * @param data - The data to encode.
 * @returns The bech32m encoded string.
 */
function encodeBech32m(hrp: string, data: Uint8Array): string {
	const words = bech32m.toWords(data);
	return bech32m.encode(hrp, words);
}

/**
 * Decodes a bech32m string back to its components.
 *
 * @param encoded - The bech32m encoded string.
 * @returns An object containing the human-readable part (hrp) and the decoded data.
 */
function decodeBech32m(encoded: string): { hrp: string; data: Uint8Array } {
	assertBech32mFormat(encoded);
	const { prefix, words } = bech32m.decode(encoded);
	const data = bech32m.fromWords(words);
	return { hrp: prefix, data };
}

/**
 * Decodes a bech32m string and returns only the data portion.
 *
 * @param encoded - The bech32m encoded string.
 * @returns The decoded data as Uint8Array.
 */
function decodeBech32mToBytes(encoded: string): Uint8Array {
	return decodeBech32m(encoded).data;
}

/**
 * Checks if a string is a valid bech32m encoded string.
 *
 * @param str - The string to check.
 * @param expectedHrp - Optional: verify the HRP matches this value.
 * @returns True if the string is valid bech32m (and matches expectedHrp if provided)
 */
function isBech32m(str: string, expectedHrp?: string): boolean {
	try {
		const { hrp } = decodeBech32m(str);
		if (expectedHrp !== undefined && hrp !== expectedHrp) {
			return false;
		}
		return true;
	} catch {
		return false;
	}
}

export { encodeBech32m, decodeBech32m, decodeBech32mToBytes, isBech32m };
