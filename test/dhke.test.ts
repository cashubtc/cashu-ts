import { hexToBytes } from '@noble/curves/abstract/utils';
import * as dhke from '../src/DHKE.js';
import { bytesToNumber } from '../src/utils.js';

const SECRET_MESSAGE = 'test_message';

describe('testing hash to curve', () => {
	test('testing string 0000....00', async () => {
		let secret = hexToBytes('0000000000000000000000000000000000000000000000000000000000000000');
		let Y = dhke.hashToCurve(secret);
		let hexY = Y.toHex(true);
		expect(hexY).toBe('024cce997d3b518f739663b757deaec95bcd9473c30a14ac2fd04023a739d1a725');
	});

	test('testing string 0000....01', async () => {
		let secret = hexToBytes('0000000000000000000000000000000000000000000000000000000000000001');
		let Y = dhke.hashToCurve(secret);
		let hexY = Y.toHex(true);
		expect(hexY).toBe('022e7158e11c9506f1aa4248bf531298daa7febd6194f003edcd9b93ade6253acf');
	});
});

describe('test blinding message', () => {
	test('testing string 0000....01', async () => {
		var enc = new TextEncoder();
		let secretUInt8 = enc.encode('test_message');
		let { B_ } = await dhke.blindMessage(
			secretUInt8,
			bytesToNumber(hexToBytes('0000000000000000000000000000000000000000000000000000000000000001'))
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
