export class Bytes {
	static fromHex(hex: string): Uint8Array {
		hex = hex.trim();
		if (hex.length === 0) {
			return new Uint8Array(0);
		}
		if (hex.length < 2 || hex.length & 1) {
			throw new Error('Invalid hex string: odd length.');
		}
		if (hex.startsWith('0x') || hex.startsWith('0X')) {
			hex = hex.slice(2);
		}
		const match = hex.match(/^[0-9a-fA-F]*$/);
		if (!match) {
			throw new Error('Invalid hex string: contains non-hex characters');
		}
		const matches = hex.match(/.{1,2}/g);
		if (!matches) {
			throw new Error('Invalid hex string');
		}
		return new Uint8Array(matches.map((byte) => parseInt(byte, 16)));
	}

	static toHex(bytes: Uint8Array): string {
		return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
	}

	static fromString(str: string): Uint8Array {
		str = str.trim();
		return new TextEncoder().encode(str);
	}

	static toString(bytes: Uint8Array): string {
		return new TextDecoder('utf-8').decode(bytes);
	}

	static concat(...arrays: Uint8Array[]): Uint8Array {
		const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
		const result = new Uint8Array(totalLength);
		let offset = 0;
		for (const arr of arrays) {
			result.set(arr, offset);
			offset += arr.length;
		}
		return result;
	}

	static alloc(size: number): Uint8Array {
		return new Uint8Array(size);
	}

	static writeBigUint64BE(value: bigint): Uint8Array {
		const buffer = new ArrayBuffer(8);
		new DataView(buffer).setBigUint64(0, value, false);
		return new Uint8Array(buffer);
	}

	static toBase64(bytes: Uint8Array): string {
		if (typeof Buffer !== 'undefined') {
			return Buffer.from(bytes).toString('base64');
		}
		// preventing stack overflow by chunking
		if (bytes.length > 32768) {
			let result = '';
			for (let i = 0; i < bytes.length; i += 32768) {
				const chunk = bytes.slice(i, i + 32768);
				result += btoa(String.fromCharCode(...chunk));
			}
			return result;
		}
		return btoa(String.fromCharCode(...bytes));
	}

	static fromBase64(base64: string): Uint8Array {
		base64 = base64.trim();
		// normalise base64url to base64 and pad
		let normalizedBase64 = base64.replace(/-/g, '+').replace(/_/g, '/');
		while (normalizedBase64.length % 4) {
			normalizedBase64 += '=';
		}
		if (typeof Buffer !== 'undefined') {
			return new Uint8Array(Buffer.from(normalizedBase64, 'base64'));
		}
		return new Uint8Array([...atob(normalizedBase64)].map((c) => c.charCodeAt(0)));
	}

	static equals(a: Uint8Array, b: Uint8Array): boolean {
		if (a.length !== b.length) return false;
		let result = 0;
		for (let i = 0; i < a.length; i++) {
			result |= a[i] ^ b[i];
		}
		return result === 0;
	}

	static compare(a: Uint8Array, b: Uint8Array): number {
		const minLength = Math.min(a.length, b.length);
		for (let i = 0; i < minLength; i++) {
			if (a[i] < b[i]) return -1;
			if (a[i] > b[i]) return 1;
		}
		return a.length - b.length;
	}
}
