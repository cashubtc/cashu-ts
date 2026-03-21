import { Bytes } from './Bytes';
import { JSONInt } from './JSONInt';

function encodeUint8toBase64(uint8array: Uint8Array): string {
	return Bytes.toBase64(uint8array);
}

function encodeUint8toBase64Url(bytes: Uint8Array): string {
	return Bytes.toBase64(bytes)
		.replace(/\+/g, '-') // Replace + with -
		.replace(/\//g, '_') // Replace / with _
		.replace(/=+$/, ''); // Remove padding characters
}

/**
 * Encode bytes as URL-safe base64 **with** padding (RFC 4648 §5, padded variant).
 *
 * Use this when the receiver requires padded URL-safe base64, e.g. CDK mint's
 * `general_purpose::URL_SAFE` decoder for the `Blind-auth` header (NUT-22). Use
 * `encodeUint8toBase64Url` instead when the spec explicitly forbids padding (e.g. PKCE code
 * verifier / challenge per RFC 7636).
 */
function encodeUint8toBase64UrlPadded(bytes: Uint8Array): string {
	return Bytes.toBase64(bytes)
		.replace(/\+/g, '-') // Replace + with -
		.replace(/\//g, '_'); // Replace / with _  (padding retained)
}

function encodeBase64toUint8(base64String: string): Uint8Array {
	return Bytes.fromBase64(base64String);
}

/**
 * Serializes an object to base64url-encoded JSON using {@link JSONInt.stringify}.
 *
 * `bigint` values are emitted as raw JSON number tokens (no quotes, no `n` suffix), which is
 * required for the v3 cashu token wire format. Callers must use {@link encodeBase64ToJson} to
 * decode, as standard `JSON.parse` will lose precision on integers above `MAX_SAFE_INTEGER`.
 */
function encodeJsonToBase64(jsonObj: unknown): string {
	const jsonString = JSONInt.stringify(jsonObj) ?? '';
	return base64urlFromBase64(Bytes.toBase64(Bytes.fromString(jsonString)));
}

/**
 * Deserializes a base64url-encoded JSON string using {@link JSONInt.parse}.
 *
 * Integers within `±MAX_SAFE_INTEGER` are returned as `number`; integers outside that range are
 * returned as `bigint`. This preserves precision for large amounts encoded by
 * {@link encodeJsonToBase64}.
 */
function encodeBase64ToJson<T extends object>(base64String: string): T {
	const jsonString = Bytes.toString(Bytes.fromBase64(base64urlToBase64(base64String)));
	return JSONInt.parse(jsonString) as T;
}

function base64urlToBase64(str: string) {
	return str.replace(/-/g, '+').replace(/_/g, '/').split('=')[0];
	// .replace(/./g, '=');
}

function base64urlFromBase64(str: string) {
	return str.replace(/\+/g, '-').replace(/\//g, '_').split('=')[0];
	// .replace(/=/g, '.');
}

function isBase64String(s: string): boolean {
	if (typeof s !== 'string' || s.length === 0) return false;

	// Accept both base64 and base64url char sets
	const base64url = /^[A-Za-z0-9\-_]+={0,2}$/;
	const base64 = /^[A-Za-z0-9+/]+={0,2}$/;

	// Quick character-set check
	if (!base64url.test(s) && !base64.test(s)) return false;

	// Normalize base64url to standard base64 for decoding
	const normalized = s.replace(/-/g, '+').replace(/_/g, '/');

	// Padding: length must be multiple of 4. Add '=' padding if needed (but no more than 2)
	const padLength = (4 - (normalized.length % 4)) % 4;
	if (padLength > 2) return false; // should never happen but keep safe
	const padded = normalized + '='.repeat(padLength);

	try {
		const decoded = Bytes.fromBase64(padded);

		// Re-encode and compare to the original (allowing either standard or url-safe representation)
		const reStandard = Bytes.toBase64(decoded);
		const reUrl = reStandard.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

		// Also compare against original normalized-without-padding variant
		const originalNoPad = normalized.replace(/=+$/, '');

		if (reStandard.replace(/=+$/, '') === originalNoPad) return true;
		if (reUrl === originalNoPad) return true;

		return false;
	} catch {
		return false;
	}
}

export {
	encodeUint8toBase64,
	encodeUint8toBase64Url,
	encodeUint8toBase64UrlPadded,
	encodeBase64toUint8,
	encodeJsonToBase64,
	encodeBase64ToJson,
	isBase64String,
};
