import { secp256k1 } from '@noble/curves/secp256k1.js';
import {
	hashToCurve,
	pointFromHex,
	blindMessage,
	unblindSignature,
	createBlindSignature,
	constructUnblindedSignature,
	createRandomRawBlindedMessage,
	getKeysetIdInt,
	hash_e,
	pointFromBytes,
} from '../../src/crypto';
import { Bytes } from '../../src/utils';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, test } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { verifyUnblindedSignature } from '../../src/crypto/NUT01';

const SECRET_MESSAGE = 'test_message';

describe('test crypto scheme', () => {
	test('Test crypto scheme', async () => {
		const mintPrivKey = secp256k1.utils.randomSecretKey();
		const mintPubKey = secp256k1.getPublicKey(mintPrivKey, true);

		//Wallet(Bob)
		const blindMessage = createRandomRawBlindedMessage();

		//Mint
		const blindSignature = createBlindSignature(blindMessage.B_, mintPrivKey, '');

		//Wallet
		const proof = constructUnblindedSignature(
			blindSignature,
			blindMessage.r,
			blindMessage.secret,
			pointFromHex(bytesToHex(mintPubKey)),
		);

		//Mint
		const isValid = verifyUnblindedSignature(proof, mintPrivKey);
		expect(isValid).toBeTruthy();
	});
});

describe('testing hash to curve', () => {
	test('testing string 0000....00', async () => {
		let secret = hexToBytes('0000000000000000000000000000000000000000000000000000000000000000');
		let Y = hashToCurve(secret);
		let hexY = Y.toHex(true);
		expect(hexY).toBe('024cce997d3b518f739663b757deaec95bcd9473c30a14ac2fd04023a739d1a725');
	});

	test('testing string 0000....01', async () => {
		let secret = hexToBytes('0000000000000000000000000000000000000000000000000000000000000001');
		let Y = hashToCurve(secret);
		let hexY = Y.toHex(true);
		expect(hexY).toBe('022e7158e11c9506f1aa4248bf531298daa7febd6194f003edcd9b93ade6253acf');
	});
});

describe('test blinding message', () => {
	test('testing string 0000....01', async () => {
		var enc = new TextEncoder();
		let secretUInt8 = enc.encode(SECRET_MESSAGE);
		let { B_ } = blindMessage(
			secretUInt8,
			Bytes.toBigInt(
				hexToBytes('0000000000000000000000000000000000000000000000000000000000000001'),
			),
		);
		expect(B_.toHex(true)).toBe(
			'025cc16fe33b953e2ace39653efb3e7a7049711ae1d8a2f7a9108753f1cdea742b',
		);
	});

	test('throws when r is zero', () => {
		const secretUInt8 = new TextEncoder().encode(SECRET_MESSAGE);
		expect(() => blindMessage(secretUInt8, 0n)).toThrow('Blinding factor r must be non-zero');
	});

	test('generates random r when none provided', () => {
		const secretUInt8 = new TextEncoder().encode(SECRET_MESSAGE);
		const { r } = blindMessage(secretUInt8);
		expect(r).toBeTypeOf('bigint');
		expect(r).not.toBe(0n);
	});
});

describe('test unblinding signature', () => {
	test('testing string 0000....01', async () => {
		let C_ = pointFromHex('02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2');
		let r = Bytes.toBigInt(
			hexToBytes('0000000000000000000000000000000000000000000000000000000000000001'),
		);
		let A = pointFromHex('020000000000000000000000000000000000000000000000000000000000000001');
		let C = unblindSignature(C_, r, A);
		expect(C.toHex(true)).toBe(
			'03c724d7e6a5443b39ac8acf11f40420adc4f99a02e7cc1b57703d9391f6d129cd',
		);
	});
});

describe('point helpers and hash_e', () => {
	test('pointFromBytes round-trips a compressed pubkey', () => {
		const sk = secp256k1.utils.randomSecretKey();
		const hex = bytesToHex(secp256k1.getPublicKey(sk, true)); // compressed
		const bytes = hexToBytes(hex);
		const pt = pointFromBytes(bytes);
		expect(pt.toHex(true)).toBe(hex);
	});

	test('hash_e == sha256(concat(uncompressed points))', () => {
		const sk1 = secp256k1.utils.randomSecretKey();
		const sk2 = secp256k1.utils.randomSecretKey();
		const P1 = pointFromHex(bytesToHex(secp256k1.getPublicKey(sk1, true)));
		const P2 = pointFromHex(bytesToHex(secp256k1.getPublicKey(sk2, true)));

		const e = hash_e([P1, P2]);

		const concatUncompressed = P1.toHex(false) + P2.toHex(false);
		const expected = sha256(new TextEncoder().encode(concatUncompressed));
		expect(bytesToHex(e)).toBe(bytesToHex(expected));
	});
});

describe('getKeysetIdInt', () => {
	test('hex keyset id is reduced mod (2^31-1)', () => {
		const MOD = BigInt(2 ** 31 - 1);
		const hexId = '01abcdef';
		const expected = BigInt('0x' + hexId) % MOD;
		expect(getKeysetIdInt(hexId)).toBe(expected);
	});

	test('legacy base64 keyset id path', () => {
		// 'AQID' base64 => bytes [0x01, 0x02, 0x03] => 0x010203
		const MOD = BigInt(2 ** 31 - 1);
		const b64Id = 'AQID';
		const expected = BigInt(0x010203) % MOD;
		expect(getKeysetIdInt(b64Id)).toBe(expected);
	});
});
