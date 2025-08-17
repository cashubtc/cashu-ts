import * as mmh from 'murmurhash';
import { Buffer } from 'buffer';

class BitArray {
	private buffer: Uint8Array;
	private bitLength: number;
	private maxSetIndex: number;

	constructor(sizeOrBuffer: number | Buffer) {
		if (typeof sizeOrBuffer === 'number') {
			this.bitLength = sizeOrBuffer;
			this.buffer = new Uint8Array(Math.ceil(sizeOrBuffer / 8));
		} else {
			this.buffer = sizeOrBuffer;
			this.bitLength = sizeOrBuffer.length * 8;
		}
		this.maxSetIndex = 0;
	}

	public get(index: number): boolean {
		if (index < 0 || index >= this.bitLength) {
			throw new Error(`Index out of bounds: index = ${index}`);
		}
		const byteIndex = Math.floor(index / 8);
		const bitPosition = 7 - (index % 8); // Bits are stored from MSB to LSB within each byte
		return ((this.buffer[byteIndex] >> bitPosition) & 1) === 1;
	}

	public set(index: number, value: boolean): void {
		if (index < 0 || index >= this.bitLength) {
			throw new Error('Index out of bounds');
		}
		this.maxSetIndex = Math.max(this.maxSetIndex, index);
		const byteIndex = Math.floor(index / 8);
		const bitPosition = 7 - (index % 8); // Bits are stored from MSB to LSB within each byte
		if (value) {
			this.buffer[byteIndex] |= 1 << bitPosition;
		} else {
			this.buffer[byteIndex] &= ~(1 << bitPosition);
		}
	}

	public toBuffer(): Buffer {
		// Return a Buffer that only contains the bits up to bitLength, padded with zeros to the next full byte.
		const byteLength = Math.ceil((this.maxSetIndex + 1) / 8);
		return Buffer.from(this.buffer.slice(0, byteLength));
	}
}

export function hashToRange(item: Buffer, f: bigint): bigint {
	const h1 = mmh.v3(item, 0);
	const h2 = mmh.v3(item, h1);
	const h = (BigInt(h1) << 32n) | BigInt(h2);
	return (f * h) >> 64n;
}

function createHashedSet(items: Buffer[], m: number): bigint[] {
	const n = items.length;
	const f = n * m;

	return items.map((e) => hashToRange(e, BigInt(f)));
}

function golombEncode(stream: BitArray, offset: number, x: bigint, P: bigint): number {
	if (x < 0) throw new Error('x must be non-negative');

	let q = x >> P;
	const r = x & (2n ** P - 1n);

	// Append the quotient in unary coding
	while (q > 0) {
		stream.set(offset, true);
		q -= 1n;
		offset += 1;
	}

	stream.set(offset, false);
	offset += 1;

	// Append the remainder in binary coding
	for (let i = BigInt(0); i < P; i++) {
		stream.set(offset, ((r >> (P - 1n - i)) & 1n) == 1n);
		offset += 1;
	}

	return offset;
}

function golombDecode(stream: BitArray, offset: number, P: bigint): [bigint, number] {
	let q = BigInt(0);
	while (stream.get(offset)) {
		q += 1n;
		offset += 1;
	}

	offset += 1;

	// Calculate the remainder directly from the bitarray slice
	let r = BigInt(0);
	for (let i = 0; i < Number(P); i++) {
		r = (r << 1n) | (stream.get(offset + i) ? 1n : 0n);
	}

	const x = (q << P) | r;
	return [x, offset + Number(P)];
}

export class GCSFilter {
	numItems: number;
	invFpr: number;
	remBitlength: number;
	content: Buffer;

	constructor(content: Buffer, numItems: number, invFpr = 784931, remBitlength = 19) {
		this.numItems = numItems;
		this.invFpr = invFpr;
		this.remBitlength = remBitlength;
		this.content = content;
	}

	static create(items: Buffer[], p = 19, m = 784931): GCSFilter {
		if (m > 2 ** 32) {
			throw new Error('GCS Error: m parameter must be smaller than 2^32');
		}
		if (items.length === 0) {
			return new GCSFilter(Buffer.from([]), 0, m, p);
		}
		if (items.length > 2 ** 32) {
			throw new Error('GCS Error: number of elements must be smaller than 2^32');
		}

		const setItems = createHashedSet(items, m);
		const sortedSetItems = setItems.sort((a, b) => (a > b ? 1 : a < b ? -1 : 0));

		const outputStream = new BitArray(sortedSetItems.length * (p + 3));

		let lastValue = BigInt(0);
		let offset = 0;
		for (const item of sortedSetItems) {
			const delta = item - lastValue;
			offset = golombEncode(outputStream, offset, delta, BigInt(p));
			lastValue = item;
		}

		return new GCSFilter(
			outputStream.toBuffer(), // Pads to the right with zero up to the byte boundary
			sortedSetItems.length,
			m,
			p,
		);
	}

	matchMany(targets: Buffer[]): boolean[] {
		const f = BigInt(this.numItems) * BigInt(this.invFpr);
		const result = new Array(targets.length);
		result.fill(false);

		if (f === 0n) {
			return result as boolean[];
		}

		if (new Set(targets).size !== targets.length) {
			throw new Error('GCS Error: match targets are not unique entries');
		}

		// Sorted ascending
		const targetHashes = targets
			.map((target, index) => [hashToRange(target, f), index])
			.sort((a, b) => (a[0] > b[0] ? 1 : a[0] < b[0] ? -1 : 0));

		const inputStream = new BitArray(this.content);
		let value = BigInt(0);
		let offset = 0;
		let matchIndex = 0;

		for (let i = 0; i < this.numItems; i++) {
			const [delta, newOffset] = golombDecode(inputStream, offset, BigInt(this.remBitlength));
			offset = newOffset;
			value += delta;

			while (matchIndex < targetHashes.length && value >= targetHashes[matchIndex][0]) {
				if (value == targetHashes[matchIndex][0]) {
					const targetIndex = targetHashes[matchIndex][1] as number;
					result[targetIndex] = true;
				}
				matchIndex++;
			}
		}

		return result as boolean[];
	}
}
