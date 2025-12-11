import { secp256k1 } from '@noble/curves/secp256k1.js';
import {
	hashToCurve,
	pointFromHex,
	blindMessage,
	unblindSignature,
	createBlindSignature,
	constructProofFromPromise,
	createRandomRawBlindedMessage,
	serializeProof,
	deserializeProof,
	getKeysetIdInt,
	hash_e,
	pointFromBytes,
} from '../../src/crypto';
import { bytesToNumber } from '../../src/utils';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, test } from 'vitest';
import { sha256 } from '@noble/hashes/sha2.js';
import { verifyProof } from '../../src/crypto/NUT01';

const SECRET_MESSAGE = 'test_message';

describe('test crypto scheme', () => {
	test('Test crypto scheme', async () => {
		const mintPrivKey = secp256k1.utils.randomSecretKey();
		const mintPubKey = secp256k1.getPublicKey(mintPrivKey, true);

		//Wallet(Bob)
		const blindMessage = createRandomRawBlindedMessage();

		//Mint
		const blindSignature = createBlindSignature(blindMessage.B_, mintPrivKey, 1, '');

		//Wallet
		const proof = constructProofFromPromise(
			blindSignature,
			blindMessage.r,
			blindMessage.secret,
			pointFromHex(bytesToHex(mintPubKey)),
		);

		//Mint
		const isValid = verifyProof(proof, mintPrivKey);
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
			bytesToNumber(hexToBytes('0000000000000000000000000000000000000000000000000000000000000001')),
		);
		expect(B_.toHex(true)).toBe(
			'025cc16fe33b953e2ace39653efb3e7a7049711ae1d8a2f7a9108753f1cdea742b',
		);
	});
});

describe('test unblinding signature', () => {
	test('testing string 0000....01', async () => {
		let C_ = pointFromHex('02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2');
		let r = bytesToNumber(
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

describe('serialize/deserialize proof', () => {
	test('round-trips without witness', () => {
		// Build a raw proof using the normal flow to get a valid C point.
		const mintSk = secp256k1.utils.randomSecretKey();
		const mintPk = bytesToHex(secp256k1.getPublicKey(mintSk, true));
		const secret = new TextEncoder().encode('roundtrip');
		const { r, B_ } = blindMessage(secret);
		const blindSig = createBlindSignature(B_, mintSk, 2, 'abc123');
		const raw = constructProofFromPromise(blindSig, r, secret, pointFromHex(mintPk));

		const ser = serializeProof(raw);
		const de = deserializeProof(ser);

		expect(de.amount).toBe(raw.amount);
		expect(de.id).toBe(raw.id);
		expect(de.C.toHex(true)).toBe(raw.C.toHex(true));
		expect(new TextDecoder().decode(de.secret)).toBe(new TextDecoder().decode(raw.secret));
		expect(de.witness).toBeUndefined();
	});

	test('round-trips with witness present', () => {
		const mintSk = secp256k1.utils.randomSecretKey();
		const mintPk = bytesToHex(secp256k1.getPublicKey(mintSk, true));
		const secret = new TextEncoder().encode('roundtrip-witness');
		const { r, B_ } = blindMessage(secret);
		const blindSig = createBlindSignature(B_, mintSk, 1, 'xyz');
		const raw = constructProofFromPromise(blindSig, r, secret, pointFromHex(mintPk));

		// attach a witness (matches SerializedProof.witness stringification)
		raw.witness = { signatures: ['aa'.repeat(32)] };

		const ser = serializeProof(raw);
		const de = deserializeProof(ser);

		expect(de.witness).toEqual(raw.witness);
	});
});
