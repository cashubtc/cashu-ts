import { bytesToHex } from '@noble/curves/abstract/utils';
import { HDKey } from '@scure/bip32';
import { describe, expect, test } from 'vitest';
import { deriveSecret } from '../../../src/crypto/client/NUT09';
import { Bytes } from '../../../src/utils/Bytes';
import { getKeysetIdInt } from '../../../src/crypto/common';

const seed = Uint8Array.from(
	Bytes.fromHex(
		'dd44ee516b0647e80b488e8dcc56d736a148f15276bef588b37057476d4b2b25780d3688a32b37353d6995997842c0fd8b412475c891c16310471fbc86dcbda8',
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
		const seed_uint8_array_expected = Bytes.fromHex(seed_expected);
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
		'ba250bf927b1df5dd0a07c543be783a4349a7f99904acd3406548402d3484118',
		'3a6423fe56abd5e74ec9d22a91ee110cd2ce45a7039901439d62e5534d3438c1',
		'843484a75b78850096fac5b513e62854f11d57491cf775a6fd2edf4e583ae8c0',
		'3600608d5cf8197374f060cfbcff134d2cd1fb57eea68cbcf2fa6917c58911b6',
		'717fce9cc6f9ea060d20dd4e0230af4d63f3894cc49dd062fd99d033ea1ac1dd',
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
	const secrets1 = ['ba250bf927b1df5dd0a07c543be783a4349a7f99904acd3406548402d3484118'];
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
	const seed_uint8_array = Bytes.fromHex(seed);
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

describe('base64 keyset id uses deprecated derivation path', () => {
	test('deriveSecret matches manual HD derivation for base64 keyset id', () => {
		const base64KeysetId = '0NI3TUAs1Sfy'; // legacy-style base64 keyset id from fixtures
		const counter = 2;

		// Compute expected via deprecated path definition
		const hdkey = HDKey.fromMasterSeed(seed);
		const keysetIdInt = getKeysetIdInt(base64KeysetId);
		const derivationPath = `m/129372'/0'/${keysetIdInt}'/${counter}'/0`;
		const derived = hdkey.derive(derivationPath);
		expect(derived.privateKey).not.toBeNull();
		const expected = derived.privateKey || new Uint8Array();

		const actual = deriveSecret(seed, base64KeysetId, counter);
		expect(bytesToHex(actual)).toBe(bytesToHex(expected));
	});
});
