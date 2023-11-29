import { hexToBytes } from '@noble/curves/abstract/utils';
import * as dhke from '../src/DHKE.js';
import { bytesToNumber } from '../src/utils.js';

const SECRET_MESSAGE = 'test_message';

describe('testing hash to curve', () => {
	test('testing string 0000....00', async () => {
		let secret = hexToBytes('0000000000000000000000000000000000000000000000000000000000000000');
		let Y = dhke.hashToCurve(secret);
		let hexY = Y.toHex(true);
		expect(hexY).toBe('0266687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925');
	});

	test('testing string 0000....01', async () => {
		let secret = hexToBytes('0000000000000000000000000000000000000000000000000000000000000001');
		let Y = dhke.hashToCurve(secret);
		let hexY = Y.toHex(true);
		expect(hexY).toBe('02ec4916dd28fc4c10d78e287ca5d9cc51ee1ae73cbfde08c6b37324cbfaac8bc5');
	});
});

describe('test blinding message', () => {
	test('testing string 0000....01', async () => {
		let secretUInt8 = new TextEncoder().encode(SECRET_MESSAGE);
		expect(secretUInt8).toStrictEqual(
			new Uint8Array([
				116,
				101,
				115,
				116,
				95,
				109,
				101,
				115,
				115,
				97,
				103,
				101
			])
		);
		const r = bytesToNumber(hexToBytes('0000000000000000000000000000000000000000000000000000000000000001'))
		let { B_ } = await dhke.blindMessage(
			secretUInt8,
			r
		);
		expect(B_.toHex(true)).toBe(
			'02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2'
		);
	});
});

describe('test unblinding signature', () => {
	test('testing string 0000....01', async () => {
		let C_ = dhke.pointFromHex(
			'02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2'
		);
		let r = bytesToNumber(
			hexToBytes('0000000000000000000000000000000000000000000000000000000000000001')
		);
		let A = dhke.pointFromHex('020000000000000000000000000000000000000000000000000000000000000001');
		let C = dhke.unblindSignature(C_, r, A);
		expect(C.toHex(true)).toBe(
			'03c724d7e6a5443b39ac8acf11f40420adc4f99a02e7cc1b57703d9391f6d129cd'
		);
	});
});
