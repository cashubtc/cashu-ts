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
		'181bab052815284ef0fcc445363d03f22261c10ca72b8281061bc6dd3c78c4a4',
		'fa2e2c3ed55ea97f367e813d0e800072eaf1d44679b1ac3cd604634865df72d6',
		'e0cdb36314b14254f85030aa030d80e5a0234f283ce6a1334e7c6365d7738792',
		'dffda37ebc2468c52ef1b9f65f84261b8a418c30ede62d05a939a3e1ed397d3e',
		'2aabff6d04fda81ad17e75daedfe122920a02c77e610e62f13d8d531b4ffb6e3',
	];
	test('derive Secret', async () => {
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
});

describe('testing deterministic blindedMessage', () => {
	const secrets = ['181bab052815284ef0fcc445363d03f22261c10ca72b8281061bc6dd3c78c4a4'];
	test('derive Secret', async () => {
		const secret1 = deriveSecret(seed, '009a1f293253e41e', 0);

		expect(bytesToHex(secret1)).toBe(secrets[0]);

		// blindMessage()
	});
});

describe('test deprecated private key derivation from derivation path', () => {
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
