import { Buffer } from 'buffer';
import { bytesToHex } from '@noble/curves/abstract/utils';
import { HDKey } from '@scure/bip32';
import { describe, expect, test } from 'vitest';
import { deriveSecret } from '../../../src/crypto/client/NUT09';

const seed = Uint8Array.from(
	Buffer.from(
		'dd44ee516b0647e80b488e8dcc56d736a148f15276bef588b37057476d4b2b25780d3688a32b37353d6995997842c0fd8b412475c891c16310471fbc86dcbda8',
		'hex',
	),
);

describe('testing hdkey from seed', () => {
	test('hdkey from seed', async () => {
		const hdkey = HDKey.fromMasterSeed(seed);
		expect(hdkey).not.toBeNull();
	});

	test('hdkey to uint8array', async () => {
		const hdkey = HDKey.fromMasterSeed(seed);
		const privateKey = hdkey.privateKey;
		expect(privateKey).not.toBeNull();

		const seed_expected =
			'dd44ee516b0647e80b488e8dcc56d736a148f15276bef588b37057476d4b2b25780d3688a32b37353d6995997842c0fd8b412475c891c16310471fbc86dcbda8';
		const seed_uint8_array_expected = Uint8Array.from(Buffer.from(seed_expected, 'hex'));
		expect(seed).toEqual(seed_uint8_array_expected);
	});
});

describe('testing deterministic secrets', () => {
	const secrets = [
		'485875df74771877439ac06339e284c3acfcd9be7abf3bc20b516faeadfe77ae',
		'8f2b39e8e594a4056eb1e6dbb4b0c38ef13b1b2c751f64f810ec04ee35b77270',
		'bc628c79accd2364fd31511216a0fab62afd4a18ff77a20deded7b858c9860c8',
		'59284fd1650ea9fa17db2b3acf59ecd0f2d52ec3261dd4152785813ff27a33bf',
		'576c23393a8b31cc8da6688d9c9a96394ec74b40fdaf1f693a6bb84284334ea0',
	];
	const secrets1 = [
		'7614f34ff4ab0e9faa2e8c0a9ef4d50be8516c38349f33f9ee6ddb0305cb5296',
		'6da184e4f071826922a89f9212f685109484275d385576338225229f0358e538',
		'8ffe423197f49c3392605918267a31d1a604346b0c306ac18d90b7e6fdc098a5',
		'5adc787c2d58b5d3d66f96476b8fda2c692a34304d68f83702cd2a4a91d69896',
		'c6b5809f737da4a751a9cb0c72ab7e8227079078a11289661cfc30dbcb9e0aaa',
	];
	test('derive Secret -- deprecated', async () => {
		const secret1 = deriveSecret(seed, '009a1f293253e41e', 0);
		const secret2 = deriveSecret(seed, '009a1f293253e41e', 1);
		const secret3 = deriveSecret(seed, '009a1f293253e41e', 2);
		const secret4 = deriveSecret(seed, '009a1f293253e41e', 3);
		const secret5 = deriveSecret(seed, '009a1f293253e41e', 4);

		expect(bytesToHex(secret1)).toBe(secrets[0]);
		expect(bytesToHex(secret2)).toBe(secrets[1]);
		expect(bytesToHex(secret3)).toBe(secrets[2]);
		expect(bytesToHex(secret4)).toBe(secrets[3]);
		expect(bytesToHex(secret5)).toBe(secrets[4]);
	});
	test('derive Secret', () => {
		const secret1 = deriveSecret(
			seed,
			'012e23479a0029432eaad0d2040c09be53bab592d5cbf1d55e0dd26c9495951b30',
			0,
		);
		const secret2 = deriveSecret(
			seed,
			'012e23479a0029432eaad0d2040c09be53bab592d5cbf1d55e0dd26c9495951b30',
			1,
		);
		const secret3 = deriveSecret(
			seed,
			'012e23479a0029432eaad0d2040c09be53bab592d5cbf1d55e0dd26c9495951b30',
			2,
		);
		const secret4 = deriveSecret(
			seed,
			'012e23479a0029432eaad0d2040c09be53bab592d5cbf1d55e0dd26c9495951b30',
			3,
		);
		const secret5 = deriveSecret(
			seed,
			'012e23479a0029432eaad0d2040c09be53bab592d5cbf1d55e0dd26c9495951b30',
			4,
		);

		expect(bytesToHex(secret1)).toBe(secrets1[0]);
		expect(bytesToHex(secret2)).toBe(secrets1[1]);
		expect(bytesToHex(secret3)).toBe(secrets1[2]);
		expect(bytesToHex(secret4)).toBe(secrets1[3]);
		expect(bytesToHex(secret5)).toBe(secrets1[4]);
	});
});

describe('testing deterministic blindedMessage', () => {
	const secrets = ['485875df74771877439ac06339e284c3acfcd9be7abf3bc20b516faeadfe77ae'];
	const secrets1 = ['7614f34ff4ab0e9faa2e8c0a9ef4d50be8516c38349f33f9ee6ddb0305cb5296'];
	test('derive blindedMessage -- deprecated', async () => {
		const secret1 = deriveSecret(seed, '009a1f293253e41e', 0);

		expect(bytesToHex(secret1)).toBe(secrets[0]);
	});
	test('derive blindedMessage', () => {
		const secret1 = deriveSecret(
			seed,
			'012e23479a0029432eaad0d2040c09be53bab592d5cbf1d55e0dd26c9495951b30',
			0,
		);

		expect(bytesToHex(secret1)).toBe(secrets1[0]);
	});
});

describe('test private key derivation from derivation path -- deprecated', () => {
	const seed =
		'dd44ee516b0647e80b488e8dcc56d736a148f15276bef588b37057476d4b2b25780d3688a32b37353d6995997842c0fd8b412475c891c16310471fbc86dcbda8';
	const seed_uint8_array = Uint8Array.from(Buffer.from(seed, 'hex'));
	const hdkey = HDKey.fromMasterSeed(seed_uint8_array);
	const expected_privatekey = '9d32fc57e6fa2942d05ee475d28ba6a56839b8cb8a3f174b05ed0ed9d3a420f6';
	const derivation_path = "m/129372'/0'/2004500376'/0'/0";
	const derived = hdkey.derive(derivation_path);
	test('derive Secret', async () => {
		expect(derived.privateKey).not.toBeNull();
		const privateKey = derived.privateKey || new Uint8Array();
		expect(bytesToHex(privateKey)).toBe(expected_privatekey);
	});
});
