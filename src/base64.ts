import { Bytes } from './utils/Bytes';

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

export {
	encodeUint8toBase64,
	encodeUint8toBase64Url,
	encodeBase64toUint8,
	encodeJsonToBase64,
	encodeBase64ToJson,
};
