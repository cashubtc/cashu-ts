import { secp256k1 } from '@noble/curves/secp256k1';
import {
	hashToCurve,
	pointFromHex,
	SerializedMintKeys,
	createBlindSignature,
} from '../../../src/crypto';
import { bytesToHex } from '@noble/curves/abstract/utils';
import { hexToBytes } from '@noble/hashes/utils';
import { PUBKEYS } from '../consts';
import { describe, expect, test } from 'vitest';
import { constructProofFromPromise, createRandomBlindedMessage } from '../../../src/crypto/client';
import { verifyProof } from '../../../src/crypto/mint';
describe('test crypto scheme', () => {
	test('Test crypto scheme', async () => {
		const mintPrivKey = secp256k1.utils.randomPrivateKey();
		const mintPubKey = secp256k1.getPublicKey(mintPrivKey, true);

		//Wallet(Bob)
		const blindedMessage = createRandomBlindedMessage();

		//Mint
		const blindSignature = createBlindSignature(blindedMessage.B_, mintPrivKey, 1, '');

		//Wallet
		const proof = constructProofFromPromise(
			blindSignature,
			blindedMessage.r,
			blindedMessage.secret,
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
