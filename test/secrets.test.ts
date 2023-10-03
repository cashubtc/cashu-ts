import { bytesToHex } from '@noble/curves/abstract/utils';
import { deriveSeedFromMnemonic } from '../src/secrets';
import { deriveBlindingFactor, deriveSecret } from '../src/secrets';
import { HDKey } from '@scure/bip32';

const mnemonic = 'half depart obvious quality work element tank gorilla view sugar picture humble';
const seed = deriveSeedFromMnemonic(mnemonic);


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
		'9d32fc57e6fa2942d05ee475d28ba6a56839b8cb8a3f174b05ed0ed9d3a420f6',
		'1c0f2c32e7438e7cc992612049e9dfcdbffd454ea460901f24cc429921437802',
		'327c606b761af03cbe26fa13c4b34a6183b868c52cda059fe57fdddcb4e1e1e7',
		'53476919560398b56c0fdc5dd92cf8628b1e06de6f2652b0f7d6e8ac319de3b7',
		'b2f5d632229378a716be6752fc79ac8c2b43323b820859a7956f2dfe5432b7b4'
	];
	test('derive Secret', async () => {
		const secret1 = deriveSecret(seed, '1cCNIAZ2X/w1', 0);
		const secret2 = deriveSecret(seed, '1cCNIAZ2X/w1', 1);
		const secret3 = deriveSecret(seed, '1cCNIAZ2X/w1', 2);
		const secret4 = deriveSecret(seed, '1cCNIAZ2X/w1', 3);
		const secret5 = deriveSecret(seed, '1cCNIAZ2X/w1', 4);

		expect(bytesToHex(secret1)).toBe(secrets[0]);
		expect(bytesToHex(secret2)).toBe(secrets[1]);
		expect(bytesToHex(secret3)).toBe(secrets[2]);
		expect(bytesToHex(secret4)).toBe(secrets[3]);
		expect(bytesToHex(secret5)).toBe(secrets[4]);
	});
});

describe('test private key derivation from derivation path', () => {
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
