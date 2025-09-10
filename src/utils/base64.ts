import { Bytes } from './Bytes';

function encodeUint8toBase64(uint8array: Uint8Array): string {
	return Bytes.toBase64(uint8array);
}

function encodeUint8toBase64Url(bytes: Uint8Array): string {
	return Bytes.toBase64(bytes)
		.replace(/\+/g, '-') // Replace + with -
		.replace(/\//g, '_') // Replace / with _
		.replace(/=+$/, ''); // Remove padding characters
}

function encodeBase64toUint8(base64String: string): Uint8Array {
	return Bytes.fromBase64(base64String);
}

function encodeJsonToBase64(jsonObj: unknown): string {
	const jsonString = JSON.stringify(jsonObj);
	return base64urlFromBase64(Bytes.toBase64(Bytes.fromString(jsonString)));
}

function encodeBase64ToJson<T extends object>(base64String: string): T {
	const jsonString = Bytes.toString(Bytes.fromBase64(base64urlToBase64(base64String)));
	const jsonObj = JSON.parse(jsonString) as T;
	return jsonObj;
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
	encodeBase64toUint8,
	encodeJsonToBase64,
	encodeBase64ToJson,
	isBase64String,
};
