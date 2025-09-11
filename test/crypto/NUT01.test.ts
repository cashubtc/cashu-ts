import { hexToBytes } from '@noble/hashes/utils';
import {
	blindMessage,
	hexToNumber,
	createBlindSignature,
	createNewMintKeys,
	serializeMintKeys,
	deserializeMintKeys,
} from '../../src/crypto';
import { PUBKEYS, TEST_PRIV_KEY_PUBS } from './consts';
import { describe, expect, test } from 'vitest';

describe('test blind sig', () => {
	test('blind sig', async () => {
		const privKey = hexToBytes('0000000000000000000000000000000000000000000000000000000000000001');
		const { B_ } = blindMessage(
			new TextEncoder().encode('test_message'),
			hexToNumber('0000000000000000000000000000000000000000000000000000000000000001'),
		);
		const { C_ } = createBlindSignature(B_, privKey, 0, '0000000');
		expect(C_.toHex(true)).toBe(
			'025cc16fe33b953e2ace39653efb3e7a7049711ae1d8a2f7a9108753f1cdea742b',
		);
	});
});
describe('new mint keys', () => {
	test('mint keys from seed', async () => {
		const keys = createNewMintKeys(64, new TextEncoder().encode('TEST_PRIVATE_KEY'));
		const serialized = serializeMintKeys(keys.pubKeys);
		console.log(serialized);
		expect(serialized).toEqual(TEST_PRIV_KEY_PUBS);

		const randomkeys = createNewMintKeys(64);
		const serializedRandom = serializeMintKeys(randomkeys.pubKeys);

		expect(serializedRandom).not.toEqual(PUBKEYS);
		expect(serializedRandom).toHaveProperty('288230376151711744');
	});
});
describe('serialize mint keys', () => {
	test('derive', () => {
		const keys: SerializedMintKeys = PUBKEYS;
		const deserializedKeys = deserializeMintKeys(keys);
		const serializedKeys = serializeMintKeys(deserializedKeys);
		expect(serializedKeys).toEqual(keys);
	});
});
