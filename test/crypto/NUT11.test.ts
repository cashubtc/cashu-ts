import { schnorr, secp256k1 } from '@noble/curves/secp256k1';
import { hexToBytes, bytesToHex, randomBytes } from '@noble/hashes/utils';
import { describe, expect, test, vi } from 'vitest';
import {
	createP2PKsecret,
	signP2PKProof,
	signP2PKProofs,
	parseP2PKSecret,
	getP2PKWitnessPubkeys,
	getP2PKWitnessRefundkeys,
	getP2PKExpectedKWitnessPubkeys,
	getP2PKLocktime,
	getP2PKNSigs,
	getP2PKSigFlag,
	getP2PKWitnessSignatures,
	Secret,
	verifyP2PKSig,
	verifyP2PKSigOutput,
	getPubKeyFromPrivKey,
	createRandomBlindedMessage,
	createRandomSecretKey,
	getSignedOutput,
	getSignedOutputs,
	hasP2PKSignedProof,
	signP2PKSecret,
	verifyP2PKSecretSignature,
	createP2BKBlindedPubkeys,
	P2BK_DST,
} from '../../src/crypto';
import { Proof, P2PKWitness } from '../../src/model/types';
import { sha256 } from '@noble/hashes/sha2';

const PRIVKEY = schnorr.utils.randomSecretKey();
const PUBKEY = bytesToHex(getPubKeyFromPrivKey(PRIVKEY));
describe('test create p2pk secret', () => {
	test('create from key', async () => {
		const secret = createP2PKsecret(PUBKEY);
		const decodedSecret = parseP2PKSecret(secret);

		expect(decodedSecret[0]).toBe('P2PK');
		// console.log(JSON.stringify(decodedSecret))
		expect(Object.keys(decodedSecret[1]).includes('nonce')).toBe(true);
		expect(Object.keys(decodedSecret[1]).includes('data')).toBe(true);
	});
	test('sign and verify proof', async () => {
		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}"}]`;
		const proof: Proof = {
			amount: 1,
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			id: '00000000000',
			secret: secretStr,
		};
		const signedProof = signP2PKProof(proof, bytesToHex(PRIVKEY));
		const verify = verifyP2PKSig(signedProof);
		expect(verify).toBe(true);
	});

	test('sign and verify proofs', async () => {
		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}"}]`;
		const proof1: Proof = {
			amount: 1,
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			id: '00000000000',
			secret: secretStr,
		};

		const proof2: Proof = {
			amount: 1,
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			id: '00000000000',
			secret: secretStr,
		};

		const proofs = [proof1, proof2];

		const signedProofs = signP2PKProofs(proofs, bytesToHex(PRIVKEY));
		const verify0 = verifyP2PKSig(signedProofs[0]);
		const verify1 = verifyP2PKSig(signedProofs[1]);
		expect(verify0).toBe(true);
		expect(verify1).toBe(true);
	});

	test('sign and verify proofs, different keys', async () => {
		const PRIVKEY2 = schnorr.utils.randomSecretKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}"}]`;
		const secretStr2 = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY2}"}]`;
		const proof1: Proof = {
			amount: 1,
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			id: '00000000000',
			secret: secretStr,
		};

		const proof2: Proof = {
			amount: 1,
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			id: '00000000000',
			secret: secretStr2,
		};

		const proofs = [proof1, proof2];

		const signedProofs = signP2PKProofs(proofs, [bytesToHex(PRIVKEY), bytesToHex(PRIVKEY2)]);
		const verify0 = verifyP2PKSig(signedProofs[0]);
		const verify1 = verifyP2PKSig(signedProofs[1]);
		expect(verify0).toBe(true);
		expect(verify1).toBe(true);
	});

	test('sign and verify proofs, multiple keys', async () => {
		const PRIVKEY2 = schnorr.utils.randomSecretKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["n_sigs","2"],["pubkeys","${PUBKEY2}"]]}]`;
		const secretStr2 = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["n_sigs","1"],["pubkeys","${PUBKEY2}"]]}]`;
		const proof1: Proof = {
			amount: 1,
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			id: '00000000000',
			secret: secretStr,
		};

		const proof2: Proof = {
			amount: 1,
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			id: '00000000000',
			secret: secretStr2,
		};

		const proofs = [proof1, proof2];

		const signedProofs = signP2PKProofs(proofs, [bytesToHex(PRIVKEY), bytesToHex(PRIVKEY2)]);
		const verify0 = verifyP2PKSig(signedProofs[0]);
		const verify1 = verifyP2PKSig(signedProofs[1]);
		expect(verify0).toBe(true);
		expect(verify1).toBe(true);
	});

	test('sign and verify blindedMessage', async () => {
		const blindedMessage = createRandomBlindedMessage(PRIVKEY);
		const verify = verifyP2PKSigOutput(blindedMessage, PUBKEY);
		expect(verify).toBe(true);
	});
});

describe('test getP2PKNSigs', () => {
	test('non-p2pk secret', async () => {
		const secretStr = `["BAD",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}"}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		expect(() => getP2PKNSigs(parsed)).toThrow('Invalid P2PK secret: must start with "P2PK"');
		expect(() => getP2PKNSigs(secretStr)).toThrow('Invalid P2PK secret: must start with "P2PK"');
	});
	test('permanent lock, unspecified n_sigs', async () => {
		const PRIVKEY2 = schnorr.utils.randomSecretKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["pubkeys","${PUBKEY2}"]]}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKNSigs(parsed);
		expect(result).toBe(1); // 1 is default
		expect(getP2PKNSigs(secretStr)).toBe(1); // 1 is default
	});
	test('permanent lock, 2 n_sigs', async () => {
		const PRIVKEY2 = schnorr.utils.randomSecretKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["n_sigs","2"],["pubkeys","${PUBKEY2}"]]}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKNSigs(parsed);
		expect(result).toBe(2);
		expect(getP2PKNSigs(secretStr)).toBe(2);
	});
	test('expired lock, 2 n_sigs, no refund keys', async () => {
		const PRIVKEY2 = schnorr.utils.randomSecretKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["n_sigs","2"],["locktime","212"],["pubkeys","${PUBKEY2}"]]}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKNSigs(parsed);
		expect(result).toBe(0);
		expect(getP2PKNSigs(secretStr)).toBe(0);
	});
	test('expired lock, 2 n_sigs, 2 refund keys, unspecified n_sigs_refund', async () => {
		const PRIVKEY2 = schnorr.utils.randomSecretKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));
		const PRIVKEY3 = schnorr.utils.randomSecretKey();
		const PUBKEY3 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY3));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["n_sigs","2"],["locktime","212"],["pubkeys","${PUBKEY2}"],["refund","${PUBKEY2}","${PUBKEY3}"]]}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKNSigs(parsed);
		expect(result).toBe(1);
		expect(getP2PKNSigs(secretStr)).toBe(1);
	});
	test('expired lock, 1 n_sigs, 2 refund keys, 2 n_sigs_refund', async () => {
		const PRIVKEY2 = schnorr.utils.randomSecretKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));
		const PRIVKEY3 = schnorr.utils.randomSecretKey();
		const PUBKEY3 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY3));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["n_sigs","1"],["n_sigs_refund","2"],["locktime","212"],["pubkeys","${PUBKEY2}"],["refund","${PUBKEY2}","${PUBKEY3}"]]}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKNSigs(parsed);
		expect(result).toBe(2);
		expect(getP2PKNSigs(secretStr)).toBe(2);
	});
});

describe('test getP2PKSigFlag', () => {
	test('non-p2pk secret', async () => {
		const secretStr = `["BAD",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}"}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		expect(() => getP2PKSigFlag(parsed)).toThrow('Invalid P2PK secret: must start with "P2PK"');
		expect(() => getP2PKSigFlag(secretStr)).toThrow('Invalid P2PK secret: must start with "P2PK"');
	});
	test('unspecified sigflag', async () => {
		const PRIVKEY2 = schnorr.utils.randomSecretKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["pubkeys","${PUBKEY2}"]]}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKSigFlag(parsed);
		expect(result).toBe('SIG_INPUTS'); // default
		expect(getP2PKSigFlag(secretStr)).toBe('SIG_INPUTS'); // default
	});
	test('SIG_INPUTS sigflag', async () => {
		const PRIVKEY2 = schnorr.utils.randomSecretKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["sigflag","SIG_INPUTS"],["pubkeys","${PUBKEY2}"]]}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKSigFlag(parsed);
		expect(result).toBe('SIG_INPUTS'); // default
		expect(getP2PKSigFlag(secretStr)).toBe('SIG_INPUTS'); // default
	});
	test('SIG_ALL sigflag', async () => {
		const PRIVKEY2 = schnorr.utils.randomSecretKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["sigflag","SIG_ALL"],["pubkeys","${PUBKEY2}"]]}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKSigFlag(parsed);
		expect(result).toBe('SIG_ALL');
		expect(getP2PKSigFlag(secretStr)).toBe('SIG_ALL');
	});
});

describe('test getP2PKLocktime', () => {
	test('non-p2pk secret', async () => {
		const secretStr = `["BAD",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}"}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		expect(() => getP2PKLocktime(parsed)).toThrow('Invalid P2PK secret: must start with "P2PK"');
		expect(() => getP2PKLocktime(secretStr)).toThrow('Invalid P2PK secret: must start with "P2PK"');
	});
	test('unspecified locktime', async () => {
		const PRIVKEY2 = schnorr.utils.randomSecretKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["pubkeys","${PUBKEY2}"]]}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKLocktime(parsed);
		expect(result).toBe(Infinity); // default
		expect(getP2PKLocktime(secretStr)).toBe(Infinity); // default
	});
	test('specified locktime', async () => {
		const PRIVKEY2 = schnorr.utils.randomSecretKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["locktime","212"],["pubkeys","${PUBKEY2}"]]}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKLocktime(parsed);
		expect(result).toBe(212);
		expect(getP2PKLocktime(secretStr)).toBe(212);
	});
});

describe('test getP2PKWitnessPubkeys', () => {
	test('data pubkey only', async () => {
		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}"}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKWitnessPubkeys(parsed);
		expect(result).toEqual([PUBKEY]);
		expect(getP2PKWitnessPubkeys(secretStr)).toEqual([PUBKEY]);
	});
	test('data + one pubkey', async () => {
		const PRIVKEY2 = schnorr.utils.randomSecretKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));
		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["pubkeys","${PUBKEY2}"]]}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKWitnessPubkeys(parsed);
		expect(result).toEqual([PUBKEY, PUBKEY2]);
		expect(getP2PKWitnessPubkeys(secretStr)).toEqual([PUBKEY, PUBKEY2]);
	});
	test('data + 2 pubkeys', async () => {
		const PRIVKEY2 = schnorr.utils.randomSecretKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));
		const PRIVKEY3 = schnorr.utils.randomSecretKey();
		const PUBKEY3 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY3));
		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["pubkeys","${PUBKEY2}","${PUBKEY3}"]]}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKWitnessPubkeys(parsed);
		expect(result).toEqual([PUBKEY, PUBKEY2, PUBKEY3]);
		expect(getP2PKWitnessPubkeys(secretStr)).toEqual([PUBKEY, PUBKEY2, PUBKEY3]);
	});
	test('getP2PKWitnessPubkeys throws for non P2PK secret', () => {
		const s = `["BAD",{"nonce":"aa","data":"${PUBKEY}"}]`;
		expect(() => getP2PKWitnessPubkeys(s)).toThrow('Invalid P2PK secret');
	});
});

describe('test getP2PKWitnessRefundkeys', () => {
	test('no refund keys', async () => {
		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}"}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKWitnessRefundkeys(parsed);
		expect(result).toEqual([]);
		expect(getP2PKWitnessRefundkeys(secretStr)).toEqual([]);
	});
	test('one refund pubkey', async () => {
		const PRIVKEY2 = schnorr.utils.randomSecretKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));
		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["refund","${PUBKEY2}"]]}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKWitnessRefundkeys(parsed);
		expect(result).toEqual([PUBKEY2]);
		expect(getP2PKWitnessRefundkeys(secretStr)).toEqual([PUBKEY2]);
	});
	test('2 refund pubkeys', async () => {
		const PRIVKEY2 = schnorr.utils.randomSecretKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));
		const PRIVKEY3 = schnorr.utils.randomSecretKey();
		const PUBKEY3 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY3));
		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["refund","${PUBKEY2}","${PUBKEY3}"]]}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKWitnessRefundkeys(parsed);
		expect(result).toEqual([PUBKEY2, PUBKEY3]);
		expect(getP2PKWitnessRefundkeys(secretStr)).toEqual([PUBKEY2, PUBKEY3]);
	});
});

describe('test getP2PKExpectedKWitnessPubkeys', () => {
	test('non-p2pk secret', async () => {
		const secretStr = `["BAD",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}"}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKExpectedKWitnessPubkeys(parsed);
		expect(result).toEqual([]);
		expect(getP2PKExpectedKWitnessPubkeys(secretStr)).toEqual([]);
	});
	test('permanent lock, 1 pubkey', async () => {
		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}"}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKExpectedKWitnessPubkeys(parsed);
		expect(result).toStrictEqual([PUBKEY]);
		expect(getP2PKExpectedKWitnessPubkeys(secretStr)).toEqual([PUBKEY]);
	});
	test('permanent lock, 2 pubkeys', async () => {
		const PRIVKEY2 = schnorr.utils.randomSecretKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["pubkeys","${PUBKEY2}"]]}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKExpectedKWitnessPubkeys(parsed);
		expect(result).toStrictEqual([PUBKEY, PUBKEY2]);
		expect(getP2PKExpectedKWitnessPubkeys(secretStr)).toEqual([PUBKEY, PUBKEY2]);
	});
	test('expired lock, 2 pubkeys, no refund keys', async () => {
		const PRIVKEY2 = schnorr.utils.randomSecretKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["n_sigs","2"],["locktime","212"],["pubkeys","${PUBKEY2}"]]}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKExpectedKWitnessPubkeys(parsed);
		expect(result).toStrictEqual([]);
		expect(getP2PKExpectedKWitnessPubkeys(secretStr)).toEqual([]);
	});
	test('expired lock, 2 pubkeys, 2 refund keys', async () => {
		const PRIVKEY2 = schnorr.utils.randomSecretKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));
		const PRIVKEY3 = schnorr.utils.randomSecretKey();
		const PUBKEY3 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY3));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["n_sigs","2"],["locktime","212"],["pubkeys","${PUBKEY2}"],["refund","${PUBKEY2}","${PUBKEY3}"]]}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKExpectedKWitnessPubkeys(parsed);
		expect(result).toStrictEqual([PUBKEY2, PUBKEY3]);
		expect(getP2PKExpectedKWitnessPubkeys(secretStr)).toEqual([PUBKEY2, PUBKEY3]);
	});
});

describe('test signP2PKProof', () => {
	test('non-p2pk secret', async () => {
		const secretStr = `["BAD",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}"}]`;
		const proof: Proof = {
			amount: 1,
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			id: '00000000000',
			secret: secretStr,
		};
		expect(() => signP2PKProof(proof, bytesToHex(PRIVKEY))).toThrow('not a P2PK secret');
	});
	test('can only sign and verify once', async () => {
		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}"}]`;
		const proof: Proof = {
			amount: 1,
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			id: '00000000000',
			secret: secretStr,
			witness:
				'{"signatures":["60f3c9b766770b46caac1d27e1ae6b77c8866ebaeba0b9489fe6a15a837eaa6fcd6eaa825499c72ac342983983fd3ba3a8a41f56677cc99ffd73da68b59e1383"]}',
		};
		// first signing
		const signedProof = signP2PKProof(proof, bytesToHex(PRIVKEY));
		const verify = verifyP2PKSig(signedProof);
		expect(verify).toBe(true);
		expect((signedProof.witness as P2PKWitness).signatures).toHaveLength(2);
		// try signing again
		expect(() => signP2PKProof(signedProof, bytesToHex(PRIVKEY))).toThrow(
			`Proof already signed by [02|03]${PUBKEY.slice(2)}`,
		);
	});
	test('not eligible to sign', async () => {
		const PRIVKEY2 = schnorr.utils.randomSecretKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}"}]`;
		const proof: Proof = {
			amount: 1,
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			id: '00000000000',
			secret: secretStr,
			witness:
				'{"signatures":["60f3c9b766770b46caac1d27e1ae6b77c8866ebaeba0b9489fe6a15a837eaa6fcd6eaa825499c72ac342983983fd3ba3a8a41f56677cc99ffd73da68b59e1383"]}',
		};
		expect(() => signP2PKProof(proof, bytesToHex(PRIVKEY2))).toThrow(
			`Signature not required from [02|03]${PUBKEY2.slice(2)}`,
		);
	});
	test('sign with 02-prepended Nostr key', async () => {
		const PRIVKEY2 = '622320785910d6aac0d5406ce1b6ef1640ab97c2acdea6a246eb6859decd6230'; // produces an Odd Y-parity pubkey
		const PUBKEY2 = '02' + bytesToHex(schnorr.getPublicKey(PRIVKEY2)); // Prepended x-only pubkey
		const PUBKEY3 = bytesToHex(getPubKeyFromPrivKey(hexToBytes(PRIVKEY2))); // full 33-byte pubkey
		expect(PUBKEY3).toMatch(/^03/); // Verify it really is an odd Y-parity key
		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY2}"}]`;
		const proof: Proof = {
			amount: 1,
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			id: '00000000000',
			secret: secretStr,
			witness:
				'{"signatures":["60f3c9b766770b46caac1d27e1ae6b77c8866ebaeba0b9489fe6a15a837eaa6fcd6eaa825499c72ac342983983fd3ba3a8a41f56677cc99ffd73da68b59e1383"]}',
		};
		const signedProof = signP2PKProof(proof, PRIVKEY2);
		const verify = verifyP2PKSig(signedProof);
		expect(verify).toBe(true);
		expect((signedProof.witness as P2PKWitness).signatures).toHaveLength(2);
	});
});

describe('test getP2PKWitnessSignatures', () => {
	test('undefined witness', async () => {
		const witness = undefined;
		const result = getP2PKWitnessSignatures(witness);
		expect(result).toStrictEqual([]);
	});
	test('malformed witness', async () => {
		// Spy on console.error and mock its implementation to do nothing
		const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
		const witness = 'malformed';
		const result = getP2PKWitnessSignatures(witness);
		expect(result).toStrictEqual([]);
		expect(consoleErrorSpy).toHaveBeenCalledWith(
			'Failed to parse witness string:',
			expect.any(Error),
		); // Verify console.error was called
	});
	test('string witness', async () => {
		const witness =
			'{"signatures":["60f3c9b766770b46caac1d27e1ae6b77c8866ebaeba0b9489fe6a15a837eaa6fcd6eaa825499c72ac342983983fd3ba3a8a41f56677cc99ffd73da68b59e1383"]}';
		const result = getP2PKWitnessSignatures(witness);
		expect(result).toStrictEqual([
			'60f3c9b766770b46caac1d27e1ae6b77c8866ebaeba0b9489fe6a15a837eaa6fcd6eaa825499c72ac342983983fd3ba3a8a41f56677cc99ffd73da68b59e1383',
		]);
	});
	test('P2PKWitness witness', async () => {
		const witness: P2PKWitness = {
			signatures: [
				'60f3c9b766770b46caac1d27e1ae6b77c8866ebaeba0b9489fe6a15a837eaa6fcd6eaa825499c72ac342983983fd3ba3a8a41f56677cc99ffd73da68b59e1383',
				'70f3c9b766770b46caac1d27e1ae6b77c8866ebaeba0b9489fe6a15a837eaa6fcd6eaa825499c72ac342983983fd3ba3a8a41f56677cc99ffd73da68b59e1383',
			],
		};
		const result = getP2PKWitnessSignatures(witness);
		expect(result).toStrictEqual([
			'60f3c9b766770b46caac1d27e1ae6b77c8866ebaeba0b9489fe6a15a837eaa6fcd6eaa825499c72ac342983983fd3ba3a8a41f56677cc99ffd73da68b59e1383',
			'70f3c9b766770b46caac1d27e1ae6b77c8866ebaeba0b9489fe6a15a837eaa6fcd6eaa825499c72ac342983983fd3ba3a8a41f56677cc99ffd73da68b59e1383',
		]);
	});
});

describe('test p2pk verify', () => {
	test('test no witness', () => {
		const proof: Proof = {
			amount: 1,
			id: '00000000',
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			secret: `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${bytesToHex(
				randomBytes(32),
			)}"}]`,
		};
		expect(() => verifyP2PKSig(proof)).toThrow(
			new Error('could not verify signature, no witness provided'),
		);
	});
});

describe('P2BK fixed-vector ECDH tweak', () => {
	test('recomputes r and signs with derived k', () => {
		// From your stdout (integration)
		const pubKeyAlice = '02201ced66da54f918074abb60ccd55aa51b3c917d268ddebb392f1fb7737e73c2';
		const pubKeyBob = '02afe83b2e52fb6a8e812e345252ef93cef8ca9f3267e64a5779da0c20a8d19aaf';
		const privKeyAlice = '8e41503e855ba9b08dd0883ab2f70ac2f66147489002e0c933d9e6f6db79505a';
		const privKeyBob = '834b0304b83bb285b99982a83a3c1b6ebe0257171c3998a99fb5c7973164fa5d';

		// Setup the Proof
		const idHex = '009a1f293253e41e';
		const p2pk_e = '02909b0298835a72f5bd08c478a36ead7e3d7594df1148a70fd146a99bd5368772';
		const secretStr =
			'["P2PK",{"nonce":"99ee92f310d92932019827217ba1ed9a902529186d7e5ae12f1fd85df5a13ef0","data":"028c7651fc36f8c10287833a2ad78c996febf5213dc7aab798f744f86385e28d9a","tags":[]}]';
		const secret = JSON.parse(secretStr) as ['P2PK', { data: string; tags?: string[][] }];

		// Base pubkey P (Bob) and blinded P′ from secret.data (slot i = 0)
		const P = secp256k1.Point.fromHex(pubKeyBob);
		const Pblnd = secp256k1.Point.fromHex(secret[1].data);

		// ECDH: Z = p*E, r0 = H(DST||X(Z)||kid||i) mod n
		const kid = hexToBytes(idHex);
		const E = secp256k1.Point.fromHex(p2pk_e);
		const pBig = secp256k1.Point.Fn.fromBytes(hexToBytes(privKeyBob));
		const Z = E.multiply(pBig);
		const Zx = Z.toBytes(false).slice(1, 33); // 32B X from uncompressed SEC1
		const i0 = new Uint8Array([0x00]);
		let r = secp256k1.Point.Fn.fromBytes(
			sha256(new Uint8Array([...P2BK_DST, ...Zx, ...kid, ...i0])),
		);

		// Check blinded point matches P + r·G
		const expectPprime = P.add(secp256k1.Point.BASE.multiply(r));
		expect(Pblnd.toHex(true)).toBe(expectPprime.toHex(true));

		// Now exercise signing end-to-end
		const proof = {
			amount: 64,
			id: idHex,
			C: '03657c5d884350d232dd219cfd68b1f19bc844c324d08d66e1f1db64106410de39', // any point is fine here
			secret: secretStr,
			p2pk_e,
		};

		const [signed] = signP2PKProofs([proof], privKeyBob);
		expect(verifyP2PKSig(signed as any)).toBe(true);
		// Also assert witness actually got added
		expect((signed as any).witness?.signatures?.length).toBeGreaterThan(0);
	});
});

describe('P2BK roundtrips (createP2BKBlindedPubkeys in secret -> signP2PKProofs)', () => {
	const pAlice = bytesToHex(createRandomSecretKey());
	const pBob = bytesToHex(createRandomSecretKey());
	const PAlice = bytesToHex(getPubKeyFromPrivKey(hexToBytes(pAlice))); // 33-byte SEC1 hex
	const PBob = bytesToHex(getPubKeyFromPrivKey(hexToBytes(pBob)));
	const kidHex = '009a1f293253e41e'; // keyset id (hex)
	test('single key: derived k signs (ECDH path via p2pk_e)', () => {
		// Create blinded key for Bob, along with ephemeral pubkey "E"
		const {
			blinded: [P0_],
			Ehex: E,
		} = createP2BKBlindedPubkeys([PBob], kidHex);

		// Minimal P2PK secret with the blinded data key
		const secret = JSON.stringify(['P2PK', { nonce: 'aa', data: P0_, tags: [] }]);

		// Proof-like object handed to signer
		const proof = { amount: 1, id: kidHex, C: '03'.padEnd(66, '0'), secret, p2pk_e: E } as any;

		// Bob signs using derived k; verify succeeds and witness is present
		const [signed] = signP2PKProofs([proof], pBob);
		expect(verifyP2PKSig(signed)).toBe(true);
		expect(getP2PKWitnessSignatures((signed as any).witness).length).toBeGreaterThan(0);
	});

	test('multi-key 2-of-2: one signature insufficient, two succeed', () => {
		// Create blinded keys for Alice and Bob, along with ephemeral pubkey "E"
		const {
			blinded: [P0_, P1_],
			Ehex: E,
		} = createP2BKBlindedPubkeys([PAlice, PBob], kidHex);

		// P2PK secret: lock requires 2 signatures across [P0_, P1_]
		const secret = JSON.stringify([
			'P2PK',
			{
				nonce: 'bb',
				data: P0_,
				tags: [
					['pubkeys', P1_],
					['n_sigs', '2'],
				],
			},
		]);
		// Proof-like object handed to signer
		const base = { amount: 1, id: kidHex, C: '03'.padEnd(66, '0'), secret, p2pk_e: E } as any;

		// Only Alice signs -> insufficient (witness added, but verify = false)
		const [oneSigned] = signP2PKProofs([structuredClone(base)], pAlice);
		expect(verifyP2PKSig(oneSigned)).toBe(false);
		expect(getP2PKWitnessSignatures(oneSigned.witness).length).toBe(1);

		// Both Alice & Bob sign -> satisfies 2-of-2
		const [twoSigned] = signP2PKProofs([structuredClone(base)], [pAlice, pBob]);
		expect(verifyP2PKSig(twoSigned)).toBe(true);
		expect(getP2PKWitnessSignatures(twoSigned.witness).length).toBe(2);
	});
});

describe('NUT-11 helper edge cases', () => {
	test('parseP2PKSecret: Uint8Array input and invalid JSON path', () => {
		const s = `["P2PK",{"nonce":"aa","data":"${PUBKEY}"}]`;
		const parsed = parseP2PKSecret(new TextEncoder().encode(s));
		expect(parsed[0]).toBe('P2PK');
		expect(() => parseP2PKSecret('not-json')).toThrow("can't parse secret");
	});

	test('getP2PKWitnessPubkeys: empty pubkeys tag returns only data', () => {
		const s = `["P2PK",{"nonce":"aa","data":"${PUBKEY}","tags":[["pubkeys"]]}]`;
		expect(getP2PKWitnessPubkeys(s)).toEqual([PUBKEY]);
	});

	test('getP2PKWitnessRefundkeys: empty refund tag returns []', () => {
		const s = `["P2PK",{"nonce":"aa","data":"${PUBKEY}","tags":[["refund"]]}]`;
		expect(getP2PKWitnessRefundkeys(s)).toEqual([]);
	});

	test('getP2PKExpectedKWitnessPubkeys: malformed secret -> []', () => {
		expect(getP2PKExpectedKWitnessPubkeys('not-json')).toEqual([]);
	});
});

describe('verifyP2PKSecretSignature & hasP2PKSignedProof', () => {
	test('direct verify works with 33-byte compressed pubkey and fails with wrong pubkey', () => {
		const priv = schnorr.utils.randomSecretKey();
		const pubCompressed = bytesToHex(getPubKeyFromPrivKey(priv)); // 33 bytes (66 hex)
		const secret = `["P2PK",{"nonce":"aa","data":"${pubCompressed}"}]`;
		const sig = signP2PKSecret(secret, priv);

		expect(verifyP2PKSecretSignature(sig, secret, pubCompressed)).toBe(true);

		const wrongPriv = schnorr.utils.randomSecretKey();
		const wrongPubCompressed = bytesToHex(getPubKeyFromPrivKey(wrongPriv));
		expect(verifyP2PKSecretSignature(sig, secret, wrongPubCompressed)).toBe(false);
	});

	test('logs and returns false on invalid pubkey hex', () => {
		const secret = `["P2PK",{"nonce":"aa","data":"${PUBKEY}"}]`;
		const sig = signP2PKSecret(secret, PRIVKEY);
		const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
		expect(verifyP2PKSecretSignature(sig, secret, 'nothex')).toBe(false);
		expect(spy).toHaveBeenCalledWith('verifyP2PKsecret error:', expect.anything());
		spy.mockRestore();
	});

	test('hasP2PKSignedProof true/false/no-witness', () => {
		const priv = schnorr.utils.randomSecretKey();
		const pub = bytesToHex(getPubKeyFromPrivKey(priv));
		const secret = `["P2PK",{"nonce":"aa","data":"${pub}"}]`;
		const sig = signP2PKSecret(secret, priv);

		const proofWithMatch: Proof = {
			amount: 1,
			id: 'a',
			C: '03'.padEnd(66, '0'),
			secret,
			witness: { signatures: [sig] },
		};
		expect(hasP2PKSignedProof(pub, proofWithMatch)).toBe(true);

		const otherPriv = schnorr.utils.randomSecretKey();
		const otherPub = bytesToHex(getPubKeyFromPrivKey(otherPriv));
		expect(hasP2PKSignedProof(otherPub, proofWithMatch)).toBe(false);

		const noWitness: Proof = { amount: 1, id: 'b', C: '03'.padEnd(66, '0'), secret };
		expect(hasP2PKSignedProof(pub, noWitness)).toBe(false);
	});
	test('returns false with non json witness string', () => {
		const proof: Proof = {
			amount: 1,
			id: 'mw',
			C: '03'.padEnd(66, '0'),
			secret: `["P2PK",{"nonce":"aa","data":"${PUBKEY}"}]`,
			witness: 'not-json',
		};
		expect(hasP2PKSignedProof(PUBKEY, proof)).toBe(false);
	});
});

describe('getSignedOutput(s) & verifyP2PKSigOutput errors', () => {
	test('verifyP2PKSigOutput throws when no witness signatures provided', () => {
		const out = createRandomBlindedMessage(PRIVKEY);
		// strip the witness
		delete (out as any).witness;
		expect(() => verifyP2PKSigOutput(out, PUBKEY)).toThrow(/no witness signatures provided/i);
	});

	test('getSignedOutput signs a single output', () => {
		const out = createRandomBlindedMessage(PRIVKEY);
		delete (out as any).witness;

		const signed = getSignedOutput(out, PRIVKEY);
		expect(verifyP2PKSigOutput(signed, PUBKEY)).toBe(true);
	});

	test('getSignedOutputs signs all outputs in array', () => {
		const a = createRandomBlindedMessage(PRIVKEY);
		const b = createRandomBlindedMessage(PRIVKEY);
		delete (a as any).witness;
		delete (b as any).witness;

		const signed = getSignedOutputs([a, b], bytesToHex(PRIVKEY));
		expect(verifyP2PKSigOutput(signed[0], PUBKEY)).toBe(true);
		expect(verifyP2PKSigOutput(signed[1], PUBKEY)).toBe(true);
	});
});
