import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, test } from 'vitest';
import {
	createBlindSignature,
	hash_e,
	pointFromBytes,
	pointFromHex,
	createDLEQProof,
	verifyDLEQProof,
	verifyDLEQProof_reblind,
	constructUnblindedSignature,
	createRandomRawBlindedMessage,
} from '../../src/crypto';
import { OutputData } from '../../src/model/OutputData';
import { Amount } from '../../src/model/Amount';

describe('test hash_e', () => {
	test('test hash_e function', async () => {
		const C_ = pointFromHex('02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2');
		const K = pointFromHex('020000000000000000000000000000000000000000000000000000000000000001');
		const R1 = pointFromHex('020000000000000000000000000000000000000000000000000000000000000001');
		const R2 = pointFromHex('020000000000000000000000000000000000000000000000000000000000000001');
		const e = hash_e([R1, R2, K, C_]);
		console.log('e = ' + bytesToHex(e));
		expect(bytesToHex(e)).toEqual(
			'a4dc034b74338c28c6bc3ea49731f2a24440fc7c4affc08b31a93fc9fbe6401e',
		);
	});
});

describe('test DLEQ scheme', () => {
	test('test DLEQ scheme: Alice verifies', async () => {
		const mintPrivKey = secp256k1.utils.randomSecretKey();
		const mintPubKey = pointFromBytes(secp256k1.getPublicKey(mintPrivKey, true));

		// Wallet(Alice)
		const blindMessage = createRandomRawBlindedMessage();

		// Mint
		const blindSignature = createBlindSignature(blindMessage.B_, mintPrivKey, '');
		const dleqProof = createDLEQProof(blindMessage.B_, mintPrivKey);

		// Wallet(Alice)
		const isValid = verifyDLEQProof(dleqProof, blindMessage.B_, blindSignature.C_, mintPubKey);
		expect(isValid).toBe(true);
	});
	test('test DLEQ scheme: Carol verifies', async () => {
		const mintPrivKey = secp256k1.utils.randomSecretKey();
		const mintPubKey = pointFromBytes(secp256k1.getPublicKey(mintPrivKey, true));

		// Wallet(Alice)
		const blindMessage = createRandomRawBlindedMessage();

		// Mint
		const blindSignature = createBlindSignature(blindMessage.B_, mintPrivKey, '');
		let dleqProof = createDLEQProof(blindMessage.B_, mintPrivKey);

		// Wallet(Alice)
		const proof = constructUnblindedSignature(
			blindSignature,
			blindMessage.r,
			blindMessage.secret,
			mintPubKey,
		);
		dleqProof.r = blindMessage.r;

		// Wallet(Carol)
		const isValid = verifyDLEQProof_reblind(blindMessage.secret, dleqProof, proof.C, mintPubKey);
		expect(isValid).toBe(true);
	});
});

describe('OutputData.toProof DLEQ verification', () => {
	function mintSetup() {
		const mintPrivKey = secp256k1.utils.randomSecretKey();
		const mintPubKey = pointFromBytes(secp256k1.getPublicKey(mintPrivKey, true));
		const blindMsg = createRandomRawBlindedMessage();
		const blindSig = createBlindSignature(blindMsg.B_, mintPrivKey, 'test-keyset');
		const dleq = createDLEQProof(blindMsg.B_, mintPrivKey);
		const keyset = {
			id: 'test-keyset',
			keys: { '1': mintPubKey.toHex(true) },
		};
		const od = new OutputData(
			{ amount: 1n, B_: blindMsg.B_.toHex(true), id: 'test-keyset' },
			blindMsg.r,
			blindMsg.secret,
		);
		return { mintPrivKey, mintPubKey, blindMsg, blindSig, dleq, keyset, od };
	}

	test('toProof succeeds with valid DLEQ', () => {
		const { blindSig, dleq, keyset, od } = mintSetup();
		const sig = {
			id: 'test-keyset',
			amount: Amount.from(1),
			C_: blindSig.C_.toHex(true),
			dleq: { s: bytesToHex(dleq.s), e: bytesToHex(dleq.e) },
		};
		const proof = od.toProof(sig, keyset);
		expect(proof.amount).toBe(1n);
		expect(proof.dleq).toBeDefined();
	});

	test('toProof throws on invalid DLEQ', () => {
		const { blindSig, dleq, keyset, od } = mintSetup();
		// Corrupt the DLEQ 'e' value
		const badE = new Uint8Array(dleq.e);
		badE[0] ^= 0xff;
		const sig = {
			id: 'test-keyset',
			amount: Amount.from(1),
			C_: blindSig.C_.toHex(true),
			dleq: { s: bytesToHex(dleq.s), e: bytesToHex(badE) },
		};
		expect(() => od.toProof(sig, keyset)).toThrow('DLEQ verification failed');
	});
});
