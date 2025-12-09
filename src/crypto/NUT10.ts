import { bytesToHex, randomBytes } from '@noble/curves/utils';

export type SecretKind = 'P2PK' | 'HTLC' | (string & {}); // union with any string

export interface SecretData {
	nonce: string;
	data: string;
	tags?: string[][];
}

export type Secret = [SecretKind, SecretData];

// ------------------------------
// NUT-10 Secrets
// ------------------------------

/**
 * Create a NUT-10 well known secret.
 *
 * @param kind - The secret kind (P2PK, HTLC, etc)
 * @param pubkey - The pubkey to add to Secret.data.
 * @param tags - Optional. Additional P2PK tags.
 */
export function createSecret(kind: SecretKind, data: string, tags?: string[][]): string {
	const newSecret: Secret = [
		kind,
		{
			nonce: bytesToHex(randomBytes(32)),
			data,
			tags,
		},
	];
	return JSON.stringify(newSecret);
}

/**
 * Parse a secret string and validate NUT-10 shape.
 *
 * @param secret - The Proof secret.
 * @returns Secret object.
 * @throws If the JSON is invalid or NUT-10 secret is malformed.
 */
export function parseSecret(secret: string | Secret): Secret {
	let parsed: unknown;
	try {
		if (typeof secret === 'string') {
			parsed = JSON.parse(secret) as Secret;
		} else {
			parsed = secret; // Pass through
		}
	} catch {
		throw new Error("Can't parse secret");
	}

	// Validate NUT-10 shape
	if (
		!Array.isArray(parsed) ||
		parsed.length !== 2 ||
		typeof parsed[0] !== 'string' || // kind
		typeof parsed[1] !== 'object' || // data
		parsed[0].trim().length === 0 ||
		parsed[1] === null
	) {
		throw new Error('Invalid NUT-10 secret');
	}
	const [kind, data] = parsed as [SecretKind, Record<string, unknown>];
	if (typeof data.nonce !== 'string' || typeof data.data !== 'string') {
		throw new Error('Invalid NUT-10 secret nonce / data');
	}
	if (data.tags) {
		// Check data.tags is an array
		if (!Array.isArray(data.tags)) {
			throw new Error('Invalid NUT-10 secret tags');
		}
		// Check individual tags are non-empty arrays of strings
		const invalid = data.tags.some(
			(t) =>
				!Array.isArray(t) || t.length === 0 || t.some((tt) => typeof tt !== 'string' || !tt.length),
		);
		if (invalid) {
			throw new Error('Invalid NUT-10 tag(s)');
		}
	}

	return [
		kind,
		{
			nonce: data.nonce,
			data: data.data,
			tags: data.tags,
		} as SecretData,
	];
}

// ------------------------------
// Secret Kind / Data
// ------------------------------

/**
 * Assert that a Secret is of the expected kind.
 *
 * @param allowed - NUT-10 Kind(s) allowed.
 * @param secret - The Proof secret.
 * @returns Parsed Secret if the kind matches.
 * @throws If secret kind is not as expected.
 */
export function assertSecretKind(
	allowed: SecretKind | SecretKind[],
	secret: Secret | string,
): Secret {
	const kinds = Array.isArray(allowed) ? allowed : [allowed];
	const parsed = parseSecret(secret);
	const actual = parsed[0];
	if (!kinds.includes(actual)) {
		throw new Error(`Invalid secret kind: ${actual} Allowed: ${kinds.join(', ')}`);
	}
	return parsed;
}

/**
 * Get the kind (first element) of a Secret.
 *
 * @param secret - The Proof secret.
 */
export function getSecretKind(secret: Secret | string): SecretKind {
	return parseSecret(secret)[0];
}

/**
 * Get the SecretData payload (second element) of a Secret.
 *
 * @param secret - The Proof secret.
 */
export function getSecretData(secret: Secret | string): SecretData {
	return parseSecret(secret)[1];
}

/**
 * Get data field value from a secret.
 *
 * @param secret - The Proof secret.
 * @returns - SecretData.data.
 */
export function getDataField(secret: Secret | string): string {
	const { data } = getSecretData(secret);
	return data;
}

// ------------------------------
// Secret Tags
// ------------------------------

/**
 * Get all tags from a secret.
 *
 * @param secret - The Proof secret.
 * @returns - Array of tag arrays.
 */
export function getTags(secret: Secret | string): string[][] {
	const { tags } = getSecretData(secret);
	return tags ?? [];
}

/**
 * Check if a secret has a tag with the given key.
 *
 * @param secret - The Proof secret.
 * @param key - Tag key to lookup.
 * @returns - True if tag exists, False otherwise.
 */
export function hasTag(secret: Secret | string, key: string): boolean {
	return getTags(secret).some((t) => t[0] === key);
}

/**
 * Get the values of a tag by key, excluding the key itself.
 *
 * @param secret - The Proof secret.
 * @param key - Tag key to lookup.
 * @returns - Array of Tag values or undefined if not present.
 */
export function getTag(secret: Secret | string, key: string): string[] | undefined {
	const tag = getTags(secret).find((t) => t[0] === key);
	if (!tag || tag.length <= 1) return undefined;
	return tag.slice(1);
}

/**
 * Get the first scalar value of a tag as a string, or undefined if missing.
 *
 * @param secret - The Proof secret.
 * @param key - Tag key to lookup.
 * @returns - Tag value or undefined if not present.
 */
export function getTagScalar(secret: Secret | string, key: string): string | undefined {
	const vals = getTag(secret, key);
	return vals && vals.length > 0 ? vals[0] : undefined;
}

/**
 * Get the first scalar value of a tag parsed as base-10 integer, or undefined.
 *
 * @param secret - The Proof secret.
 * @param key - Tag key to lookup.
 * @returns - Tag value as an integer, undefined if not present or invalid.
 */
export function getTagInt(secret: Secret | string, key: string): number | undefined {
	const v = getTagScalar(secret, key);
	if (v === undefined) return undefined;
	const n = Number.parseInt(v, 10);
	return Number.isFinite(n) ? n : undefined;
}
