import { bytesToHex } from '@noble/curves/utils.js';
import { Bytes } from '../../utils/Bytes';

export function bytesToNumber(bytes: Uint8Array): bigint {
	return hexToNumber(bytesToHex(bytes));
}

export function hexToNumber(hex: string): bigint {
	return BigInt(`0x${hex}`);
}

export function encodeBase64toUint8(base64String: string): Uint8Array {
	return Bytes.fromBase64(base64String);
}
