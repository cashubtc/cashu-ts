import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { hexToBytes, bytesToHex, randomBytes } from '@noble/hashes/utils.js';
import { describe, expect, test, vi } from 'vitest';
import {
	createP2PKsecret,
	signP2PKProof,
	signP2PKProofs,
	parseP2PKSecret,
	getP2PKWitnessPubkeys,
	getP2PKWitnessRefundkeys,
	getP2PKExpectedWitnessPubkeys,
	getP2PKLocktime,
	getP2PKNSigs,
	getP2PKSigFlag,
	getP2PKWitnessSignatures,
	Secret,
	isP2PKSpendAuthorised,
	getPubKeyFromPrivKey,
	createRandomSecretKey,
	hasP2PKSignedProof,
	schnorrSignMessage,
	schnorrVerifyMessage,
	deriveP2BKBlindedPubkeys,
	P2BK_DST,
	buildP2PKSigAllMessage,
	assertSigAllInputs,
	buildLegacyP2PKSigAllMessage,
	createSecret,
	getP2PKNSigsRefund,
	isHTLCSpendAuthorised,
} from '../../src/crypto';
import { Proof, P2PKWitness } from '../../src/model/types';
import { sha256 } from '@noble/hashes/sha2.js';
import { OutputDataLike } from '../../src';
import { ConsoleLogger, NULL_LOGGER } from '../../src/logger';

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
		const decodedSecret2 = parseP2PKSecret(secret);
		expect(decodedSecret2[0]).toBe('P2PK');
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
		const verify = isP2PKSpendAuthorised(signedProof);
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
		const verify0 = isP2PKSpendAuthorised(signedProofs[0]);
		const verify1 = isP2PKSpendAuthorised(signedProofs[1]);
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
		const verify0 = isP2PKSpendAuthorised(signedProofs[0]);
		const verify1 = isP2PKSpendAuthorised(signedProofs[1]);
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
		expect(hasP2PKSignedProof(PUBKEY, proof1)).toBe(false);
		const signedProofs = signP2PKProofs(proofs, [bytesToHex(PRIVKEY), bytesToHex(PRIVKEY2)]);
		const verify0 = isP2PKSpendAuthorised(signedProofs[0]);
		const verify1 = isP2PKSpendAuthorised(signedProofs[1]);
		expect(verify0).toBe(true);
		expect(verify1).toBe(true);
	});

	test('sign and verify proofs, insufficient and incorrect keys', async () => {
		const PRIVKEY2 = schnorr.utils.randomSecretKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["n_sigs","2"],["pubkeys","${PUBKEY2}"]]}]`;
		const secretStr2 = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY2}","tags":[["n_sigs","1"]]}]`;
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

		const signedProofs = signP2PKProofs(proofs, [bytesToHex(PRIVKEY)]);
		const verify0 = isP2PKSpendAuthorised(signedProofs[0]);
		expect(verify0).toBe(false); // 2 required, 1 given
		const verify1 = isP2PKSpendAuthorised(signedProofs[1]);
		expect(verify1).toBe(false); // 1 required, wrong one given
	});

	test('sign and verify proofs, expired lock, 2 n_sigs, 2 refund keys, unspecified n_sigs_refund', async () => {
		const PRIVKEY2 = schnorr.utils.randomSecretKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));
		const PRIVKEY3 = schnorr.utils.randomSecretKey();
		const PUBKEY3 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY3));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["n_sigs","2"],["locktime","212"],["pubkeys","${PUBKEY2}"],["refund","${PUBKEY2}","${PUBKEY3}"]]}]`;
		const proof: Proof = {
			amount: 1,
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			id: '00000000000',
			secret: secretStr,
		};
		expect(isP2PKSpendAuthorised(proof)).toBe(false); // not signed
		const signedProofs = signP2PKProofs([proof], [bytesToHex(PRIVKEY2)]);
		expect(isP2PKSpendAuthorised(signedProofs[0])).toBe(true); // signed
	});

	test('verify unlocked proofs and bad witness', async () => {
		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["locktime","123"]]}]`;
		const proof1: Proof = {
			amount: 1,
			C: '034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be',
			id: '00000000000',
			secret: secretStr,
			witness: { signatures: ['foo'] },
		};
		// const signedProofs = signP2PKProofs([proof1], [bytesToHex(PRIVKEY)]);
		expect(isP2PKSpendAuthorised(proof1, new ConsoleLogger('debug'))).toBe(true);
		expect(hasP2PKSignedProof(PUBKEY, proof1)).toBe(false);
	});
});

describe('test getP2PKNSigs', () => {
	test('non-p2pk secret', async () => {
		const secretStr = `["BAD",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}"}]`;
		expect(() => getP2PKNSigs(secretStr)).toThrow(/Invalid secret kind/);
		expect(() => getP2PKNSigsRefund(secretStr)).toThrow(/Invalid secret kind/);
	});
	test('permanent lock, unspecified n_sigs', async () => {
		const PRIVKEY2 = schnorr.utils.randomSecretKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["pubkeys","${PUBKEY2}"]]}]`;
		expect(getP2PKNSigs(secretStr)).toBe(1); // 1 is default
		expect(getP2PKNSigsRefund(secretStr)).toBe(0);
	});
	test('permanent lock, 2 n_sigs', async () => {
		const PRIVKEY2 = schnorr.utils.randomSecretKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["n_sigs","2"],["pubkeys","${PUBKEY2}"]]}]`;
		expect(getP2PKNSigs(secretStr)).toBe(2);
		expect(getP2PKNSigsRefund(secretStr)).toBe(0);
	});
	test('expired lock, 2 n_sigs, no refund keys is unlocked', async () => {
		const PRIVKEY2 = schnorr.utils.randomSecretKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["n_sigs","2"],["locktime","212"],["pubkeys","${PUBKEY2}"]]}]`;
		expect(getP2PKNSigs(secretStr)).toBe(0); // unlocked
		expect(getP2PKNSigsRefund(secretStr)).toBe(0); // unlocked
	});
	test('expired lock, 2 n_sigs, 2 refund keys, unspecified n_sigs_refund', async () => {
		const PRIVKEY2 = schnorr.utils.randomSecretKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));
		const PRIVKEY3 = schnorr.utils.randomSecretKey();
		const PUBKEY3 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY3));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["n_sigs","2"],["locktime","212"],["pubkeys","${PUBKEY2}"],["refund","${PUBKEY2}","${PUBKEY3}"]]}]`;
		expect(getP2PKNSigs(secretStr)).toBe(2);
		expect(getP2PKNSigsRefund(secretStr)).toBe(1);
	});
	test('expired lock, 1 n_sigs, 2 refund keys, 2 n_sigs_refund', async () => {
		const PRIVKEY2 = schnorr.utils.randomSecretKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));
		const PRIVKEY3 = schnorr.utils.randomSecretKey();
		const PUBKEY3 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY3));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["n_sigs","1"],["n_sigs_refund","2"],["locktime","212"],["pubkeys","${PUBKEY2}"],["refund","${PUBKEY2}","${PUBKEY3}"]]}]`;
		expect(getP2PKNSigs(secretStr)).toBe(1);
		expect(getP2PKNSigsRefund(secretStr)).toBe(2);
	});
});

describe('test getP2PKSigFlag', () => {
	test('non-p2pk secret', async () => {
		const secretStr = `["BAD",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}"}]`;
		expect(() => getP2PKSigFlag(secretStr)).toThrow(/Invalid secret kind/);
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
		expect(() => getP2PKLocktime(secretStr)).toThrow(/Invalid secret kind/);
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

describe('test getP2PKExpectedWitnessPubkeys', () => {
	test('non-p2pk secret', async () => {
		const secretStr = `["BAD",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}"}]`;
		const result = getP2PKExpectedWitnessPubkeys(secretStr);
		expect(result).toEqual([]);
		expect(getP2PKExpectedWitnessPubkeys(secretStr)).toEqual([]);
	});
	test('permanent lock, 1 pubkey', async () => {
		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}"}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKExpectedWitnessPubkeys(parsed);
		expect(result).toStrictEqual([PUBKEY]);
		expect(getP2PKExpectedWitnessPubkeys(secretStr)).toEqual([PUBKEY]);
	});
	test('permanent lock, 2 pubkeys', async () => {
		const PRIVKEY2 = schnorr.utils.randomSecretKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["pubkeys","${PUBKEY2}"]]}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKExpectedWitnessPubkeys(parsed);
		expect(result).toStrictEqual([PUBKEY, PUBKEY2]);
		expect(getP2PKExpectedWitnessPubkeys(secretStr)).toEqual([PUBKEY, PUBKEY2]);
	});
	test('expired lock, 2 pubkeys, no refund keys', async () => {
		const PRIVKEY2 = schnorr.utils.randomSecretKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["n_sigs","2"],["locktime","212"],["pubkeys","${PUBKEY2}"]]}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKExpectedWitnessPubkeys(parsed);
		expect(result).toStrictEqual([]);
		expect(getP2PKExpectedWitnessPubkeys(secretStr)).toEqual([]);
	});
	test('expired lock, 2 pubkeys, 2 refund keys', async () => {
		const PRIVKEY2 = schnorr.utils.randomSecretKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));
		const PRIVKEY3 = schnorr.utils.randomSecretKey();
		const PUBKEY3 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY3));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["n_sigs","2"],["locktime","212"],["pubkeys","${PUBKEY2}"],["refund","${PUBKEY2}","${PUBKEY3}"]]}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKExpectedWitnessPubkeys(parsed);
		expect(result).toStrictEqual([PUBKEY, PUBKEY2, PUBKEY3]);
		expect(getP2PKExpectedWitnessPubkeys(secretStr)).toEqual([PUBKEY, PUBKEY2, PUBKEY3]);
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
		expect(() => signP2PKProof(proof, bytesToHex(PRIVKEY))).toThrow(/Invalid secret kind/);
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
		const verify = isP2PKSpendAuthorised(signedProof);
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
		const PUBKEY2 = '02' + bytesToHex(schnorr.getPublicKey(hexToBytes(PRIVKEY2))); // Prepended x-only pubkey
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
		const verify = isP2PKSpendAuthorised(signedProof);
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
		expect(isP2PKSpendAuthorised(proof)).toBe(false);
	});
});

describe('P2BK fixed-vector ECDH tweak', () => {
	test('recomputes r and signs with derived k', () => {
		// From your stdout (integration)
		// const pubKeyAlice = '02201ced66da54f918074abb60ccd55aa51b3c917d268ddebb392f1fb7737e73c2';
		const pubKeyBob = '02afe83b2e52fb6a8e812e345252ef93cef8ca9f3267e64a5779da0c20a8d19aaf';
		// const privKeyAlice = '8e41503e855ba9b08dd0883ab2f70ac2f66147489002e0c933d9e6f6db79505a';
		const privKeyBob = '834b0304b83bb285b99982a83a3c1b6ebe0257171c3998a99fb5c7973164fa5d';

		// Setup the Proof
		const idHex = '009a1f293253e41e';
		const p2pk_e = '02909b0298835a72f5bd08c478a36ead7e3d7594df1148a70fd146a99bd5368772';
		const secretStr =
			'["P2PK",{"nonce":"99ee92f310d92932019827217ba1ed9a902529186d7e5ae12f1fd85df5a13ef0","data":"03a0b460e6099f87751c1ca38887aed0586a2a59cb09334f3b4b401c7a2096384f","tags":[]}]';
		const secret = JSON.parse(secretStr) as ['P2PK', { data: string; tags?: string[][] }];

		// Base pubkey P (Bob) and blinded P′ from secret.data (slot i = 0)
		const P = secp256k1.Point.fromHex(pubKeyBob);
		const Pblnd = secp256k1.Point.fromHex(secret[1].data);

		// ECDH: Z = p*E, r0 = H(DST||X(Z)||kid||i) mod n
		const E = secp256k1.Point.fromHex(p2pk_e);
		const pBig = secp256k1.Point.Fn.fromBytes(hexToBytes(privKeyBob));
		const Z = E.multiply(pBig);
		const Zx = Z.toBytes(false).slice(1, 33); // 32B X from uncompressed SEC1
		const i0 = new Uint8Array([0x00]);
		let r = secp256k1.Point.Fn.fromBytes(sha256(new Uint8Array([...P2BK_DST, ...Zx, ...i0])));

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
		expect(isP2PKSpendAuthorised(signed as any)).toBe(true);
		// Also assert witness actually got added
		expect((signed as any).witness?.signatures?.length).toBeGreaterThan(0);
	});
});

describe('P2BK roundtrips (deriveP2BKBlindedPubkeys in secret -> signP2PKProofs)', () => {
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
		} = deriveP2BKBlindedPubkeys([PBob]);

		// Minimal P2PK secret with the blinded data key
		const secret = createP2PKsecret(P0_, []);

		// Proof-like object handed to signer
		const proof = { amount: 1, id: kidHex, C: '03'.padEnd(66, '0'), secret, p2pk_e: E } as any;

		// Bob signs using derived k; verify succeeds and witness is present
		const [signed] = signP2PKProofs([proof], pBob);
		expect(isP2PKSpendAuthorised(signed)).toBe(true);
		expect(getP2PKWitnessSignatures((signed as any).witness).length).toBeGreaterThan(0);
	});

	test('multi-key 2-of-2: one signature insufficient, two succeed', () => {
		// Create blinded keys for Alice and Bob, along with ephemeral pubkey "E"
		const {
			blinded: [P0_, P1_],
			Ehex: E,
		} = deriveP2BKBlindedPubkeys([PAlice, PBob]);

		// P2PK secret: lock requires 2 signatures across [P0_, P1_]
		const secret = createP2PKsecret(P0_, [
			['pubkeys', P1_],
			['n_sigs', '2'],
		]);
		// Proof-like object handed to signer
		const base = { amount: 1, id: kidHex, C: '03'.padEnd(66, '0'), secret, p2pk_e: E } as any;

		// Only Alice signs -> insufficient (witness added, but verify = false)
		const [oneSigned] = signP2PKProofs([structuredClone(base)], pAlice);
		expect(isP2PKSpendAuthorised(oneSigned)).toBe(false);
		expect(getP2PKWitnessSignatures(oneSigned.witness).length).toBe(1);

		// Both Alice & Bob sign -> satisfies 2-of-2
		const [twoSigned] = signP2PKProofs([structuredClone(base)], [pAlice, pBob]);
		expect(isP2PKSpendAuthorised(twoSigned)).toBe(true);
		expect(getP2PKWitnessSignatures(twoSigned.witness).length).toBe(2);
	});
});

describe('NUT-11 helper edge cases', () => {
	test('parseP2PKSecret: Uint8Array input and invalid JSON path', () => {
		const s = `["P2PK",{"nonce":"aa","data":"${PUBKEY}"}]`;
		const parsed = parseP2PKSecret(s);
		expect(parsed[0]).toBe('P2PK');
		expect(() => parseP2PKSecret('not-json')).toThrow("Can't parse secret");
	});

	test('getP2PKWitnessPubkeys: empty pubkeys tag returns only data', () => {
		const s = `["P2PK",{"nonce":"aa","data":"${PUBKEY}","tags":[["pubkeys"]]}]`;
		expect(getP2PKWitnessPubkeys(s)).toEqual([PUBKEY]);
	});

	test('getP2PKWitnessRefundkeys: empty refund tag returns []', () => {
		const s = `["P2PK",{"nonce":"aa","data":"${PUBKEY}","tags":[["refund"]]}]`;
		expect(getP2PKWitnessRefundkeys(s)).toEqual([]);
	});

	test('getP2PKExpectedWitnessPubkeys: malformed secret -> []', () => {
		expect(getP2PKExpectedWitnessPubkeys('not-json')).toEqual([]);
	});
});

describe('schnorrVerifyMessage & hasP2PKSignedProof', () => {
	test('direct verify works with 33-byte compressed pubkey and fails with wrong pubkey', () => {
		const priv = schnorr.utils.randomSecretKey();
		const pubCompressed = bytesToHex(getPubKeyFromPrivKey(priv)); // 33 bytes (66 hex)
		const secret = `["P2PK",{"nonce":"aa","data":"${pubCompressed}"}]`;
		const sig = schnorrSignMessage(secret, priv);

		expect(schnorrVerifyMessage(sig, secret, pubCompressed)).toBe(true);

		const wrongPriv = schnorr.utils.randomSecretKey();
		const wrongPubCompressed = bytesToHex(getPubKeyFromPrivKey(wrongPriv));
		expect(schnorrVerifyMessage(sig, secret, wrongPubCompressed)).toBe(false);
	});

	test('logs and returns false on invalid pubkey hex', () => {
		const secret = `["P2PK",{"nonce":"aa","data":"${PUBKEY}"}]`;
		const sig = schnorrSignMessage(secret, PRIVKEY);
		expect(schnorrVerifyMessage(sig, secret, 'nothex')).toBe(false);
	});

	test('returns false on invalid signature hex', () => {
		const secret = `["P2PK",{"nonce":"aa","data":"${PUBKEY}"}]`;
		expect(schnorrVerifyMessage('foo', secret, PUBKEY)).toBe(false);
	});

	test('hasP2PKSignedProof true/false/no-witness', () => {
		const priv = schnorr.utils.randomSecretKey();
		const pub = bytesToHex(getPubKeyFromPrivKey(priv));
		const secret = `["P2PK",{"nonce":"aa","data":"${pub}"}]`;
		const sig = schnorrSignMessage(secret, priv);

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
	test('throws on SIG_ALL secret', () => {
		const proof: Proof = {
			amount: 1,
			id: 'mw',
			C: '03'.padEnd(66, '0'),
			secret: `["P2PK",{"nonce":"aa","data":"${PUBKEY}","tags":[["sigflag","SIG_ALL"]]}]`,
			witness: 'not-json',
		};
		expect(() => {
			hasP2PKSignedProof(PUBKEY, proof);
		}).toThrow(/Cannot verify a SIG_ALL proof/);
		expect(() => {
			isP2PKSpendAuthorised(proof);
		}).toThrow(/Cannot verify a SIG_ALL proof/);
	});
});

describe('buildP2PKSigAllMessage, SIG_ALL aggregation', () => {
	// Helpers
	const mkProof = (secret: string, C: string) => ({ secret, C }) as any; // keep minimal shape for this unit

	const mkOutput = (amount: number | string, B_: string) =>
		({ blindedMessage: { amount, B_ } }) as any;

	test('concatenates inputs then outputs, no separators, in given order', () => {
		const inputs = [mkProof('sA', 'CA'), mkProof('sB', 'CB')];
		const outputs = [mkOutput(2, 'B2'), mkOutput(5, 'B5')];

		const msg = buildP2PKSigAllMessage(inputs, outputs);

		// manual expectation, inputs first, then outputs, no separators
		const expected = ['sA', 'CA', 'sB', 'CB', '2', 'B2', '5', 'B5'].join('');
		expect(msg).toBe(expected);
	});

	test('appends quoteId at the end when provided', () => {
		const inputs = [mkProof('s1', 'C1')];
		const outputs = [mkOutput(1, 'B1')];

		const msgNoQuote = buildP2PKSigAllMessage(inputs, outputs);
		const msgWithQuote = buildP2PKSigAllMessage(inputs, outputs, 'quote-xyz');

		expect(msgWithQuote).toBe(msgNoQuote + 'quote-xyz');
		expect(msgWithQuote).not.toBe(msgNoQuote);
	});

	test('amounts are stringified consistently', () => {
		const inputs = [mkProof('s', 'C')];
		const outNum = [mkOutput(7, 'B7')];
		const outStr = [mkOutput('7', 'B7')];

		const mNum = buildP2PKSigAllMessage(inputs, outNum);
		const mStr = buildP2PKSigAllMessage(inputs, outStr);

		expect(mNum).toBe(mStr);
	});

	test('changing any input field changes the message', () => {
		const baseInputs = [mkProof('s1', 'C1')];
		const outputs = [mkOutput(3, 'B3')];

		const m1 = buildP2PKSigAllMessage(baseInputs, outputs);
		const m2 = buildP2PKSigAllMessage([mkProof('s2', 'C1')], outputs);
		const m3 = buildP2PKSigAllMessage([mkProof('s1', 'C2')], outputs);

		expect(m2).not.toBe(m1);
		expect(m3).not.toBe(m1);
	});

	test('changing any output field changes the message', () => {
		const inputs = [mkProof('s1', 'C1')];
		const m1 = buildP2PKSigAllMessage(inputs, [mkOutput(3, 'B3')]);
		const m2 = buildP2PKSigAllMessage(inputs, [mkOutput(4, 'B3')]); // amount changed
		const m3 = buildP2PKSigAllMessage(inputs, [mkOutput(3, 'B4')]); // B_ changed

		expect(m2).not.toBe(m1);
		expect(m3).not.toBe(m1);
	});

	test('order of inputs affects the message', () => {
		const inputsA = [mkProof('sA', 'CA'), mkProof('sB', 'CB')];
		const inputsB = [...inputsA].reverse();
		const outputs = [mkOutput(1, 'B1')];

		const mA = buildP2PKSigAllMessage(inputsA, outputs);
		const mB = buildP2PKSigAllMessage(inputsB, outputs);

		expect(mA).not.toBe(mB);
	});

	test('order of outputs affects the message', () => {
		const inputs = [mkProof('s', 'C')];
		const outputsA = [mkOutput(1, 'B1'), mkOutput(2, 'B2')];
		const outputsB = [...outputsA].reverse();

		const mA = buildP2PKSigAllMessage(inputs, outputsA);
		const mB = buildP2PKSigAllMessage(inputs, outputsB);

		expect(mA).not.toBe(mB);
	});

	test('empty arrays are allowed, quoteId only contributes when present', () => {
		const mNone = buildP2PKSigAllMessage([], []);
		const mQuoteOnly = buildP2PKSigAllMessage([], [], 'q123');

		expect(mNone).toBe('');
		expect(mQuoteOnly).toBe('q123');
	});

	test('is stable across repeated calls with identical data', () => {
		const inputs = [mkProof('s1', 'C1'), mkProof('s2', 'C2')];
		const outputs = [mkOutput(9, 'B9')];
		const q = 'q999';

		const m1 = buildP2PKSigAllMessage(inputs, outputs, q);
		const m2 = buildP2PKSigAllMessage(inputs, outputs, q);

		expect(m1).toBe(m2);
	});
});

describe('assertSigAllInputs, SIG_ALL validation', () => {
	// Helpers to keep tests short and readable
	const mkSecret = (data: string, tags = [['sigflag', 'SIG_ALL']]) => createP2PKsecret(data, tags);

	const mkProof = (secret: string) => ({ secret }) as any;

	test('throws when no proofs are provided', () => {
		expect(() => assertSigAllInputs([])).toThrow('No proofs');
	});

	test('throws when first proof is not P2PK', () => {
		const badSecret = createSecret('OTHER', 'x', []);
		expect(() => assertSigAllInputs([mkProof(badSecret)])).toThrow(/Invalid secret kind/);
	});

	test('throws when first proof is not SIG_ALL', () => {
		const secret = createP2PKsecret('x', [['sigflag', 'SIG_INPUTS']]);
		expect(() => assertSigAllInputs([mkProof(secret)])).toThrow('First proof is not SIG_ALL');
	});

	test('returns silently when one valid SIG_ALL proof is present', () => {
		const secret = mkSecret('pubkey');
		expect(() => assertSigAllInputs([mkProof(secret)])).not.toThrow();
	});

	test('throws when any subsequent proof is not P2PK', () => {
		const s1 = mkSecret('pubkey');
		const s2 = createSecret('WRONG', 'x', [['sigflag', 'SIG_ALL']]);
		expect(() => assertSigAllInputs([mkProof(s1), mkProof(s2)])).toThrow(/Invalid secret kind/);
	});

	test('throws when any subsequent proof is not SIG_ALL', () => {
		const s1 = mkSecret('pubkey');
		const s2 = createP2PKsecret('pubkey', [['sigflag', 'SIG_INPUTS']]);
		expect(() => assertSigAllInputs([mkProof(s1), mkProof(s2)])).toThrow('not SIG_ALL');
	});

	test('throws when data fields differ across inputs', () => {
		const s1 = mkSecret('pkA');
		const s2 = mkSecret('pkB');
		expect(() => assertSigAllInputs([mkProof(s1), mkProof(s2)])).toThrow(
			'SIG_ALL inputs must share identical Secret.data',
		);
	});

	test('throws when tags differ across inputs', () => {
		const s1 = mkSecret('pk', [
			['sigflag', 'SIG_ALL'],
			['locktime', '123'],
		]);
		const s2 = mkSecret('pk', [
			['sigflag', 'SIG_ALL'],
			['locktime', '456'],
		]);
		expect(() => assertSigAllInputs([mkProof(s1), mkProof(s2)])).toThrow(
			'SIG_ALL inputs must share identical Secret.tags',
		);
	});

	test('passes when all inputs have identical data and tags', () => {
		const s1 = mkSecret('pk', [
			['sigflag', 'SIG_ALL'],
			['n_sigs', '2'],
		]);
		const s2 = mkSecret('pk', [
			['sigflag', 'SIG_ALL'],
			['n_sigs', '2'],
		]);
		expect(() => assertSigAllInputs([mkProof(s1), mkProof(s2)])).not.toThrow();
	});
});

describe('branch coverage helpers', () => {
	const mkSecret = (data: string, tags?: string[][]) => createP2PKsecret(data, tags);

	const p = (secret: string): Proof => ({
		secret,
		C: 'C',
		amount: 1 as any, // satisfy type if needed by your model
		id: 'x' as any,
		witness: undefined,
	});

	test('assertSigAllInputs, tags undefined on all inputs', () => {
		const s = mkSecret('PUB', [['sigflag', 'SIG_ALL']]);
		expect(() => assertSigAllInputs([p(s), p(s)])).not.toThrow();
	});

	test('assertSigAllInputs, tags present and identical on all inputs', () => {
		const tags: string[][] = [
			['sigflag', 'SIG_ALL'],
			['locktime', String(Math.floor(Date.now() / 1000) + 60)], // any extra tag is fine
			['pubkeys', 'PUB'],
		];
		const s = mkSecret('PUB', tags);
		expect(() => assertSigAllInputs([p(s), p(s)])).not.toThrow();
	});

	test('getP2PKWitnessSignatures, witness is string with no signatures field', () => {
		const sigs = getP2PKWitnessSignatures(JSON.stringify({}));
		expect(sigs).toEqual([]); // covers string path with fallback
	});

	test('getP2PKWitnessSignatures, witness object with signatures undefined', () => {
		const sigs = getP2PKWitnessSignatures({} as any);
		expect(sigs).toEqual([]); // covers object path with fallback
	});
});

describe('SIG_ALL, both message formats are actually signed', () => {
	test('first proof witness contains signatures for legacy and final SIG_ALL messages', () => {
		// 1. Set up a keypair and a SIG_ALL P2PK secret
		const privBytes = schnorr.utils.randomSecretKey();
		const privHex = bytesToHex(privBytes);
		const pubCompressed = bytesToHex(getPubKeyFromPrivKey(privBytes)); // 33-byte SEC1

		const secret = createP2PKsecret(pubCompressed, [['sigflag', 'SIG_ALL']]);

		// 2. Build a minimal SIG_ALL input set that passes assertSigAllInputs
		const proofs: Proof[] = [
			{
				amount: 1,
				id: '00a1',
				C: '03'.padEnd(66, '1'),
				secret,
			} as Proof,
			{
				amount: 2,
				id: '00a2',
				C: '03'.padEnd(66, '2'),
				secret,
			} as Proof,
		];

		// 3. Minimal outputs satisfying OutputDataLike
		const outputs: OutputDataLike[] = [
			{
				blindedMessage: {
					amount: 3,
					id: 'out-1',
					B_: '03'.padEnd(66, '3'),
				},
			} as any,
		];

		const quoteId = 'quote-xyz';

		// 4. Build the three distinct SIG_ALL messages the wallet is supposed to sign
		const legacyMsg = buildLegacyP2PKSigAllMessage(proofs, outputs, quoteId);
		const finalMsg = buildP2PKSigAllMessage(proofs, outputs, quoteId);

		const messages = [legacyMsg, finalMsg];

		// 5. Mimic the wallet SIG_ALL path:
		//    start from the first proof, then sign it three times with the three messages,
		//    threading the witness through on each call.
		let signedFirst: Proof = proofs[0];

		for (const msg of messages) {
			[signedFirst] = signP2PKProofs([signedFirst], privHex, NULL_LOGGER, msg);
		}

		const sigs = getP2PKWitnessSignatures(signedFirst.witness);

		// Sanity: we really appended two signatures
		expect(sigs.length).toBe(2);

		// 6. For each message variant, there must be at least one signature that verifies
		//    against that specific message and this pubkey.
		for (const msg of messages) {
			const hasValid = sigs.some((sig) => schnorrVerifyMessage(sig, msg, pubCompressed));
			expect(hasValid).toBe(true);
		}

		// Optional extra: none of these signatures should verify against the bare secret,
		// which would indicate we mistakenly signed proof.secret instead of the message.
		const anyOnSecret = sigs.some((sig) => schnorrVerifyMessage(sig, secret, pubCompressed));
		expect(anyOnSecret).toBe(false);
	});
});

// The following tests replicate and confirm the test vectors at:
// https://github.com/cashubtc/nuts/blob/main/tests/11-test.md
describe('NUT-11 test vectors', () => {
	const mkOutput = (amount: number | string, B_: string) =>
		({ blindedMessage: { amount, B_ } }) as any;

	test('Valid Locktime Multisig', async () => {
		const proof: Proof = {
			amount: 64,
			C: '02d7cd858d866fca404b5cb1ffd813946e6d19efa1af00d654080fd20266bdc0b1',
			id: '001b6c716bf42c7e',
			secret:
				'["P2PK",{"nonce":"395162bf2d0add3c66aea9f22c45251dbee6e04bd9282addbb366a94cd4fb482","data":"03ab50a667926fac858bac540766254c14b2b0334d10e8ec766455310224bbecf4","tags":[["locktime","21"],["pubkeys","0229a91adec8dd9badb228c628a07fc1bf707a9b7d95dd505c490b1766fa7dc541","033281c37677ea273eb7183b783067f5244933ef78d8c3f15b1a77cb246099c26e"],["n_sigs","2"],["refund","03ab50a667926fac858bac540766254c14b2b0334d10e8ec766455310224bbecf4","033281c37677ea273eb7183b783067f5244933ef78d8c3f15b1a77cb246099c26e"]]}]',
			witness:
				'{"signatures":["6a4dd46f929b4747efe7380d655be5cfc0ea943c679a409ea16d4e40968ce89de885d995937d5b85f24fa33a25df10990c5e11d5397199d779d5cf87d42f6627","0c266fffe2ea2358fb93b5d30dfbcefe52a5bb53d6c85f37d54723613224a256165d20dd095768f168ab2e97bc5a879f7c2a84eee8963c9bcedcd39552dbe093"]}',
		};
		expect(isP2PKSpendAuthorised(proof)).toBe(true);
	});

	test('Valid Refund Multisig', async () => {
		const proof: Proof = {
			amount: 64,
			C: '02d7cd858d866fca404b5cb1ffd813946e6d19efa1af00d654080fd20266bdc0b1',
			id: '001b6c716bf42c7e',
			secret:
				'["P2PK",{"nonce":"395162bf2d0add3c66aea9f22c45251dbee6e04bd9282addbb366a94cd4fb482","data":"03ab50a667926fac858bac540766254c14b2b0334d10e8ec766455310224bbecf4","tags":[["locktime","21"],["pubkeys","0229a91adec8dd9badb228c628a07fc1bf707a9b7d95dd505c490b1766fa7dc541","033281c37677ea273eb7183b783067f5244933ef78d8c3f15b1a77cb246099c26e"],["n_sigs","2"],["refund","03ab50a667926fac858bac540766254c14b2b0334d10e8ec766455310224bbecf4","033281c37677ea273eb7183b783067f5244933ef78d8c3f15b1a77cb246099c26e"]]}]',
			witness:
				'{"signatures":["d39631363480adf30433ee25c7cec28237e02b4808d4143469d4f390d4eae6ec97d18ba3cc6494ab1d04372f0838426ea296f25cb4bd8bddb296adc292eeaa96"]}',
		};
		expect(isP2PKSpendAuthorised(proof)).toBe(true);
	});

	test('SIG_INPUTS - valid signature', async () => {
		const proof: Proof = {
			amount: 1,
			secret:
				'["P2PK",{"nonce":"859d4935c4907062a6297cf4e663e2835d90d97ecdd510745d32f6816323a41f","data":"0249098aa8b9d2fbec49ff8598feb17b592b986e62319a4fa488a3dc36387157a7","tags":[["sigflag","SIG_INPUTS"]]}]',
			C: '02698c4e2b5f9534cd0687d87513c759790cf829aa5739184a3e3735471fbda904',
			id: '009a1f293253e41e',
			witness:
				'{"signatures":["60f3c9b766770b46caac1d27e1ae6b77c8866ebaeba0b9489fe6a15a837eaa6fcd6eaa825499c72ac342983983fd3ba3a8a41f56677cc99ffd73da68b59e1383"]}',
		};
		expect(isP2PKSpendAuthorised(proof)).toBe(true);
	});

	test('SIG_INPUTS - invalid signature', async () => {
		const proof: Proof = {
			amount: 1,
			secret:
				'["P2PK",{"nonce":"859d4935c4907062a6297cf4e663e2835d90d97ecdd510745d32f6816323a41f","data":"0249098aa8b9d2fbec49ff8598feb17b592b986e62319a4fa488a3dc36387157a7","tags":[["sigflag","SIG_INPUTS"]]}]',
			C: '02698c4e2b5f9534cd0687d87513c759790cf829aa5739184a3e3735471fbda904',
			id: '009a1f293253e41e',
			witness:
				'{"signatures":["83564aca48c668f50d022a426ce0ed19d3a9bdcffeeaee0dc1e7ea7e98e9eff1840fcc821724f623468c94f72a8b0a7280fa9ef5a54a1b130ef3055217f467b3"]}',
		};
		expect(isP2PKSpendAuthorised(proof)).toBe(false);
	});

	test('SIG_INPUTS - 2 signatures required to meet multi-signature', async () => {
		const proof: Proof = {
			amount: 1,
			secret:
				'["P2PK",{"nonce":"0ed3fcb22c649dd7bbbdcca36e0c52d4f0187dd3b6a19efcc2bfbebb5f85b2a1","data":"0249098aa8b9d2fbec49ff8598feb17b592b986e62319a4fa488a3dc36387157a7","tags":[["pubkeys","0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798","02142715675faf8da1ecc4d51e0b9e539fa0d52fdd96ed60dbe99adb15d6b05ad9"],["n_sigs","2"],["sigflag","SIG_INPUTS"]]}]',
			C: '02698c4e2b5f9534cd0687d87513c759790cf829aa5739184a3e3735471fbda904',
			id: '009a1f293253e41e',
			witness:
				'{"signatures":["83564aca48c668f50d022a426ce0ed19d3a9bdcffeeaee0dc1e7ea7e98e9eff1840fcc821724f623468c94f72a8b0a7280fa9ef5a54a1b130ef3055217f467b3","9a72ca2d4d5075be5b511ee48dbc5e45f259bcf4a4e8bf18587f433098a9cd61ff9737dc6e8022de57c76560214c4568377792d4c2c6432886cc7050487a1f22"]}',
		};
		expect(isP2PKSpendAuthorised(proof)).toBe(true);
	});

	test('SIG_INPUTS - one signature failing multi-signature', async () => {
		const proof: Proof = {
			amount: 1,
			secret:
				'["P2PK",{"nonce":"0ed3fcb22c649dd7bbbdcca36e0c52d4f0187dd3b6a19efcc2bfbebb5f85b2a1","data":"0249098aa8b9d2fbec49ff8598feb17b592b986e62319a4fa488a3dc36387157a7","tags":[["pubkeys","0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798","02142715675faf8da1ecc4d51e0b9e539fa0d52fdd96ed60dbe99adb15d6b05ad9"],["n_sigs","2"],["sigflag","SIG_INPUTS"]]}]',
			C: '02698c4e2b5f9534cd0687d87513c759790cf829aa5739184a3e3735471fbda904',
			id: '009a1f293253e41e',
			witness:
				'{"signatures":["83564aca48c668f50d022a426ce0ed19d3a9bdcffeeaee0dc1e7ea7e98e9eff1840fcc821724f623468c94f72a8b0a7280fa9ef5a54a1b130ef3055217f467b3"]}',
		};
		expect(isP2PKSpendAuthorised(proof)).toBe(false);
	});

	test('SIG_INPUTS - signature from refund key, spendable because locktime is in the past', async () => {
		const proof: Proof = {
			amount: 64,
			C: '0257353051c02e2d650dede3159915c8be123ba4f47cf33183c7fedd20bd91a79b',
			id: '001b6c716bf42c7e',
			secret:
				'["P2PK",{"nonce":"4bc88ee09d1886c7461d45da205ca3274e1e3d9da2667c4865045cb18265a407","data":"03d5edeb839be873df2348785506d36565f3b8f390fb931709a422b5a247ddefb1","tags":[["locktime","21"],["refund","0234ad87e907e117db1590cc20a3942ffdfd5137aa563d36095d5cf5f96bada122"]]}]',
			witness:
				'{"signatures":["b316c2ff9c15f0c5c3d230e99ad94bc76a11dfccbdc820366a3db7210288f22ef6cedcded1152904ec31056d1d5176d83a2d96df5cd4ff86afdde1c90c63af5e"]}',
		};
		expect(isP2PKSpendAuthorised(proof)).toBe(true);
	});

	test('SIG_INPUTS - signature from refund key, NOT spendable because locktime is in the future', async () => {
		const proof: Proof = {
			amount: 64,
			C: '0215865e3b30bdf6f5cdc1ee2c33379d5629bdf2eff2595603d939ff8c65d80586',
			id: '001b6c716bf42c7e',
			secret:
				'["P2PK",{"nonce":"0c3d085898f1abf2b5521035f4d0f4ecf68c6a5109f6bc836833a1188f06be65","data":"03206e0d488387a816bbafd957be51b073432c6c7a403ec4c2a0b27647326c5150","tags":[["locktime","99999999999"],["refund","026acbcd0fff3a424499c83ec892d3155c9d1984438659f448d9d0f1af3e92276a"]]}]',
			witness:
				'{"signatures":["e5b10d7627ab39bd0cefa219c63752a0026aa5ae754b91a0c7ee2596222f87942c442aca2957166a6b468350c09c9968792784d2ae7c42fc91739b55689f4c7a"]}',
		};
		expect(isP2PKSpendAuthorised(proof)).toBe(false);
	});

	test('SIG_ALL - SwapRequest valid msg_to_sign', async () => {
		const proof: Proof[] = [
			{
				amount: 2,
				id: '00bfa73302d12ffd',
				secret:
					'["P2PK",{"nonce":"c7f280eb55c1e8564e03db06973e94bc9b666d9e1ca42ad278408fe625950303","data":"030d8acedfe072c9fa449a1efe0817157403fbec460d8e79f957966056e5dd76c1","tags":[["sigflag","SIG_ALL"]]}]',
				C: '02c97ee3d1db41cf0a3ddb601724be8711a032950811bf326f8219c50c4808d3cd',
				witness:
					'{"signatures":["ce017ca25b1b97df2f72e4b49f69ac26a240ce14b3690a8fe619d41ccc42d3c1282e073f85acd36dc50011638906f35b56615f24e4d03e8effe8257f6a808538"]}',
			},
		];
		const outputs = mkOutput(
			2,
			'038ec853d65ae1b79b5cdbc2774150b2cb288d6d26e12958a16fb33c32d9a86c39',
		);
		expect(buildP2PKSigAllMessage(proof, [outputs])).toEqual(
			'["P2PK",{"nonce":"c7f280eb55c1e8564e03db06973e94bc9b666d9e1ca42ad278408fe625950303","data":"030d8acedfe072c9fa449a1efe0817157403fbec460d8e79f957966056e5dd76c1","tags":[["sigflag","SIG_ALL"]]}]02c97ee3d1db41cf0a3ddb601724be8711a032950811bf326f8219c50c4808d3cd2038ec853d65ae1b79b5cdbc2774150b2cb288d6d26e12958a16fb33c32d9a86c39',
		);
	});

	test('SIG_ALL - SwapRequest with a valid sig_all signature', async () => {
		const proof: Proof = {
			amount: 2,
			id: '00bfa73302d12ffd',
			secret:
				'["P2PK",{"nonce":"c7f280eb55c1e8564e03db06973e94bc9b666d9e1ca42ad278408fe625950303","data":"030d8acedfe072c9fa449a1efe0817157403fbec460d8e79f957966056e5dd76c1","tags":[["sigflag","SIG_ALL"]]}]',
			C: '02c97ee3d1db41cf0a3ddb601724be8711a032950811bf326f8219c50c4808d3cd',
			witness:
				'{"signatures":["ce017ca25b1b97df2f72e4b49f69ac26a240ce14b3690a8fe619d41ccc42d3c1282e073f85acd36dc50011638906f35b56615f24e4d03e8effe8257f6a808538"]}',
		};
		const outputs = mkOutput(
			2,
			'038ec853d65ae1b79b5cdbc2774150b2cb288d6d26e12958a16fb33c32d9a86c39',
		);
		expect(() => assertSigAllInputs([proof])).not.toThrow();
		const mts = buildP2PKSigAllMessage([proof], [outputs]);
		expect(isP2PKSpendAuthorised(proof, NULL_LOGGER, mts)).toBe(true);
	});

	test('SIG_ALL - SwapRequest invalid as the spending conditions are not identical across inputs', async () => {
		const proofs: Proof[] = [
			{
				amount: 1,
				id: '00bfa73302d12ffd',
				secret:
					'["P2PK",{"nonce":"fa6dd3fac9086c153878dec90b9e37163d38ff2ecf8b37db6470e9d185abbbae","data":"033b42b04e659fed13b669f8b16cdaffc3ee5738608810cf97a7631d09bd01399d","tags":[["sigflag","SIG_ALL"]]}]',
				C: '024d232312bab25af2e73f41d56864d378edca9109ae8f76e1030e02e585847786',
				witness:
					'{"signatures":["27b4d260a1186e3b62a26c0d14ffeab3b9f7c3889e78707b8fd3836b473a00601afbd53a2288ad20a624a8bbe3344453215ea075fc0ce479dd8666fd3d9162cc"]}',
			},
			{
				amount: 2,
				id: '00bfa73302d12ffd',
				secret:
					'["P2PK",{"nonce":"4007b21fc5f5b1d4920bc0a08b158d98fd0fb2b0b0262b57ff53c6c5d6c2ae8c","data":"033b42b04e659fed13b669f8b16cdaffc3ee5738608810cf97a7631d09bd01399d","tags":[["locktime","122222222222222"],["sigflag","SIG_ALL"]]}]',
				C: '02417400f2af09772219c831501afcbab4efb3b2e75175635d5474069608deb641',
			},
		];
		const outputs = [
			mkOutput(1, '038ec853d65ae1b79b5cdbc2774150b2cb288d6d26e12958a16fb33c32d9a86c39'),
			mkOutput(1, '03afe7c87e32d436f0957f1d70a2bca025822a84a8623e3a33aed0a167016e0ca5'),
			mkOutput(1, '02c0d4fce02a7a0f09e3f1bca952db910b17e81a7ebcbce62cd8dcfb127d21e37b'),
		];
		// The assert catches the error. The signature would otherwise be valid
		expect(() => assertSigAllInputs(proofs)).toThrow(/must share identical Secret\.tags/);
		const mts = buildP2PKSigAllMessage(proofs, outputs);
		expect(isP2PKSpendAuthorised(proofs[0], NULL_LOGGER, mts)).toBe(true);
	});

	test('SIG_ALL - SwapRequest where multiple valid signatures are required and provided', async () => {
		const proofs: Proof[] = [
			{
				amount: 2,
				id: '00bfa73302d12ffd',
				secret:
					'["P2PK",{"nonce":"04bfd885fc982d553711092d037fdceb7320fd8f96b0d4fd6d31a65b83b94272","data":"0275e78025b558dbe6cb8fdd032a2e7613ca14fda5c1f4c4e3427f5077a7bd90e4","tags":[["pubkeys","035163650bbd5ed4be7693f40f340346ba548b941074e9138b67ef6c42755f3449","02817d22a8edc44c4141e192995a7976647c335092199f9e076a170c7336e2f5cc"],["n_sigs","2"],["sigflag","SIG_ALL"]]}]',
				C: '03866a09946562482c576ca989d06371e412b221890804c7da8887d321380755be',
				witness:
					'{"signatures":["be1d72c5ca16a93c5a34f25ec63ce632ddc3176787dac363321af3fd0f55d1927e07451bc451ffe5c682d76688ea9925d7977dffbb15bd79763b527f474734b0","669d6d10d7ed35395009f222f6c7bdc28a378a1ebb72ee43117be5754648501da3bedf2fd6ff0c7849ac92683538c60af0af504102e40f2d8daca8e08b1ca16b"]}',
			},
		];
		const outputs = [
			mkOutput(2, '038ec853d65ae1b79b5cdbc2774150b2cb288d6d26e12958a16fb33c32d9a86c39'),
		];
		// The assert catches the error. The signature would otherwise be valid
		expect(() => assertSigAllInputs(proofs)).not.toThrow();
		const mts = buildP2PKSigAllMessage(proofs, outputs);
		expect(isP2PKSpendAuthorised(proofs[0], NULL_LOGGER, mts)).toBe(true);
	});

	test('SIG_ALL - SwapRequest - locktime has passed and the refund key signatures are valid', async () => {
		const proofs: Proof[] = [
			{
				amount: 2,
				id: '00bfa73302d12ffd',
				secret:
					'["P2PK",{"nonce":"9ea35553beb18d553d0a53120d0175a0991ca6109370338406eed007b26eacd1","data":"02af21e09300af92e7b48c48afdb12e22933738cfb9bba67b27c00c679aae3ec25","tags":[["locktime","1"],["refund","02637c19143c58b2c58bd378400a7b82bdc91d6dedaeb803b28640ef7d28a887ac","0345c7fdf7ec7c8e746cca264bf27509eb4edb9ac421f8fbfab1dec64945a4d797"],["n_sigs_refund","2"],["sigflag","SIG_ALL"]]}]',
				C: '03dd83536fbbcbb74ccb3c87147df26753fd499cc2c095f74367fff0fb459c312e',
				witness:
					'{"signatures":["23b58ef28cd22f3dff421121240ddd621deee83a3bc229fd67019c2e338d91e2c61577e081e1375dbab369307bba265e887857110ca3b4bd949211a0a298805f","7e75948ef1513564fdcecfcbd389deac67c730f7004f8631ba90c0844d3e8c0cf470b656306877df5141f65fd3b7e85445a8452c3323ab273e6d0d44843817ed"]}',
			},
		];
		const outputs = [
			mkOutput(2, '038ec853d65ae1b79b5cdbc2774150b2cb288d6d26e12958a16fb33c32d9a86c39'),
		];
		expect(() => assertSigAllInputs(proofs)).not.toThrow();
		const mts = buildP2PKSigAllMessage(proofs, outputs);
		expect(isP2PKSpendAuthorised(proofs[0], NULL_LOGGER, mts)).toBe(true);
	});

	test('SIG_ALL - SwapRequest - with an HTLC also locked to a public key', async () => {
		const proofs: Proof[] = [
			{
				amount: 2,
				id: '00bfa73302d12ffd',
				secret:
					'["HTLC",{"nonce":"d730dd70cd7ec6e687829857de8e70aab2b970712f4dbe288343eca20e63c28c","data":"ec4916dd28fc4c10d78e287ca5d9cc51ee1ae73cbfde08c6b37324cbfaac8bc5","tags":[["pubkeys","0350cda8a1d5257dbd6ba8401a9a27384b9ab699e636e986101172167799469b14"],["sigflag","SIG_ALL"]]}]',
				C: '03ff6567e2e6c31db5cb7189dab2b5121930086791c93899e4eff3dda61cb57273',
				witness:
					'{"preimage":"0000000000000000000000000000000000000000000000000000000000000001","signatures":["a4c00a9ad07f9936e404494fda99a9b935c82d7c053173b304b8663124c81d4b00f64a225f5acf41043ca52b06382722bd04ded0fbeb0fcc404eed3b24778b88"]}',
			},
		];
		const outputs = [
			mkOutput(2, '038ec853d65ae1b79b5cdbc2774150b2cb288d6d26e12958a16fb33c32d9a86c39'),
		];
		expect(() => assertSigAllInputs(proofs)).not.toThrow();
		const mts = buildP2PKSigAllMessage(proofs, outputs);
		expect(isHTLCSpendAuthorised(proofs[0], NULL_LOGGER, mts)).toBe(true);
	});

	test('SIG_ALL - SwapRequest - with an HTLC, invalid, locktime not expired, but proof is signed with the refund key', async () => {
		const proofs: Proof[] = [
			{
				amount: 2,
				id: '00bfa73302d12ffd',
				secret:
					'["HTLC",{"nonce":"512c4045f12fdfd6f55059669c189e040c37c1ce2f8be104ed6aec296acce4e9","data":"ec4916dd28fc4c10d78e287ca5d9cc51ee1ae73cbfde08c6b37324cbfaac8bc5","tags":[["pubkeys","03ba83defd31c63f8841d188f0d41b5bb3af1bb3c08d0ba46f8f1d26a4d45e8cad"],["locktime","4854185133"],["refund","032f1008a79c722e93a1b4b853f85f38283f9ef74ee4c5c91293eb1cc3c5e46e34"],["sigflag","SIG_ALL"]]}]',
				C: '02207abeff828146f1fc3909c74613d5605bd057f16791994b3c91f045b39a6939',
				witness:
					'{"preimage":"0000000000000000000000000000000000000000000000000000000000000001","signatures":["7816d57871bde5be2e4281065dbe5b15f641d8f1ed9437a3ae556464d6f9b8a0a2e6660337a915f2c26dce1453a416daf682b8fb593b67a0750fce071e0759b9"]}',
			},
		];
		const outputs = [
			mkOutput(1, '038ec853d65ae1b79b5cdbc2774150b2cb288d6d26e12958a16fb33c32d9a86c39'),
			mkOutput(1, '03afe7c87e32d436f0957f1d70a2bca025822a84a8623e3a33aed0a167016e0ca5'),
		];
		expect(() => assertSigAllInputs(proofs)).not.toThrow();
		const mts = buildP2PKSigAllMessage(proofs, outputs);
		expect(isHTLCSpendAuthorised(proofs[0], NULL_LOGGER, mts)).toBe(false);
	});

	test('SIG_ALL - SwapRequest - valid multisig HTLC also locked to locktime and refund keys', async () => {
		const proofs: Proof[] = [
			{
				amount: 2,
				id: '00bfa73302d12ffd',
				secret:
					'["HTLC",{"nonce":"c9b0fabb8007c0db4bef64d5d128cdcf3c79e8bb780c3294adf4c88e96c32647","data":"ec4916dd28fc4c10d78e287ca5d9cc51ee1ae73cbfde08c6b37324cbfaac8bc5","tags":[["pubkeys","039e6ec7e922abb4162235b3a42965eb11510b07b7461f6b1a17478b1c9c64d100"],["locktime","1"],["refund","02ce1bbd2c9a4be8029c9a6435ad601c45677f5cde81f8a7f0ed535e0039d0eb6c","03c43c00ff57f63cfa9e732f0520c342123e21331d0121139f1b636921eeec095f"],["n_sigs_refund","2"],["sigflag","SIG_ALL"]]}]',
				C: '0344b6f1471cf18a8cbae0e624018c816be5e3a9b04dcb7689f64173c1ae90a3a5',
				witness:
					'{"preimage":"0000000000000000000000000000000000000000000000000000000000000001","signatures":["98e21672d409cc782c720f203d8284f0af0c8713f18167499f9f101b7050c3e657fb0e57478ebd8bd561c31aa6c30f4cd20ec38c73f5755b7b4ddee693bca5a5","693f40129dbf905ed9c8008081c694f72a36de354f9f4fa7a61b389cf781f62a0ae0586612fb2eb504faaf897fefb6742309186117f4743bcebcb8e350e975e2"]}',
			},
		];
		const outputs = [
			mkOutput(2, '038ec853d65ae1b79b5cdbc2774150b2cb288d6d26e12958a16fb33c32d9a86c39'),
		];
		expect(() => assertSigAllInputs(proofs)).not.toThrow();
		const mts = buildP2PKSigAllMessage(proofs, outputs);
		expect(isHTLCSpendAuthorised(proofs[0], NULL_LOGGER, mts)).toBe(true);
	});

	test('SIG_ALL - MeltRequest - valid msg_to_sign', () => {
		const quote = 'cF8911fzT88aEi1d-6boZZkq5lYxbUSVs-HbJxK0';
		const sig =
			'478224fbe715e34f78cb33451db6fcf8ab948afb8bd04ff1a952c92e562ac0f7c1cb5e61809410635be0aa94d0448f7f7959bd5762cc3802b0a00ff58b2da747';
		const pub = '029116d32e7da635c8feeb9f1f4559eb3d9b42d400f9d22a64834d89cde0eb6835';
		const inputs = [
			{
				amount: 2,
				id: '00bfa73302d12ffd',
				secret: `[\"P2PK\",{\"nonce\":\"bbf9edf441d17097e39f5095a3313ba24d3055ab8a32f758ff41c10d45c4f3de\",\"data\":\"${pub}\",\"tags\":[[\"sigflag\",\"SIG_ALL\"]]}]`,
				C: '02a9d461ff36448469dccf828fa143833ae71c689886ac51b62c8d61ddaa10028b',
				witness: `{\"signatures\":[\"${sig}\"]}`,
			},
		];
		const outputs = [
			mkOutput(0, '038ec853d65ae1b79b5cdbc2774150b2cb288d6d26e12958a16fb33c32d9a86c39'),
		];
		const message = buildP2PKSigAllMessage(inputs, outputs, quote);

		expect(message).toBe(
			'["P2PK",{"nonce":"bbf9edf441d17097e39f5095a3313ba24d3055ab8a32f758ff41c10d45c4f3de","data":"029116d32e7da635c8feeb9f1f4559eb3d9b42d400f9d22a64834d89cde0eb6835","tags":[["sigflag","SIG_ALL"]]}]02a9d461ff36448469dccf828fa143833ae71c689886ac51b62c8d61ddaa10028b0038ec853d65ae1b79b5cdbc2774150b2cb288d6d26e12958a16fb33c32d9a86c39cF8911fzT88aEi1d-6boZZkq5lYxbUSVs-HbJxK0',
		);
		expect(schnorrVerifyMessage(sig, message, pub)).toBeTruthy();
	});

	test('SIG_ALL - MeltRequest - valid request', async () => {
		const proofs: Proof[] = [
			{
				amount: 2,
				id: '00bfa73302d12ffd',
				secret:
					'["P2PK",{"nonce":"bbf9edf441d17097e39f5095a3313ba24d3055ab8a32f758ff41c10d45c4f3de","data":"029116d32e7da635c8feeb9f1f4559eb3d9b42d400f9d22a64834d89cde0eb6835","tags":[["sigflag","SIG_ALL"]]}]',
				C: '02a9d461ff36448469dccf828fa143833ae71c689886ac51b62c8d61ddaa10028b',
				witness:
					'{"signatures":["478224fbe715e34f78cb33451db6fcf8ab948afb8bd04ff1a952c92e562ac0f7c1cb5e61809410635be0aa94d0448f7f7959bd5762cc3802b0a00ff58b2da747"]}',
			},
		];
		const outputs = [
			mkOutput(0, '038ec853d65ae1b79b5cdbc2774150b2cb288d6d26e12958a16fb33c32d9a86c39'),
		];
		const quote = 'cF8911fzT88aEi1d-6boZZkq5lYxbUSVs-HbJxK0';
		expect(() => assertSigAllInputs(proofs)).not.toThrow();
		const mts = buildP2PKSigAllMessage(proofs, outputs, quote);
		expect(isHTLCSpendAuthorised(proofs[0], NULL_LOGGER, mts)).toBe(true);
	});

	test('SIG_ALL - MeltRequest - valid multisig', async () => {
		const proofs: Proof[] = [
			{
				amount: 2,
				id: '00bfa73302d12ffd',
				secret:
					'["P2PK",{"nonce":"68d7822538740e4f9c9ebf5183ef6c4501c7a9bca4e509ce2e41e1d62e7b8a99","data":"0394e841bd59aeadce16380df6174cb29c9fea83b0b65b226575e6d73cc5a1bd59","tags":[["pubkeys","033d892d7ad2a7d53708b7a5a2af101cbcef69522bd368eacf55fcb4f1b0494058"],["n_sigs","2"],["sigflag","SIG_ALL"]]}]',
				C: '03a70c42ec9d7192422c7f7a3ad017deda309fb4a2453fcf9357795ea706cc87a9',
				witness:
					'{"signatures":["ed739970d003f703da2f101a51767b63858f4894468cc334be04aa3befab1617a81e3eef093441afb499974152d279e59d9582a31dc68adbc17ffc22a2516086","f9efe1c70eb61e7ad8bd615c50ff850410a4135ea73ba5fd8e12a734743ad045e575e9e76ea5c52c8e7908d3ad5c0eaae93337e5c11109e52848dc328d6757a2"]}',
			},
		];
		const outputs = [
			mkOutput(0, '038ec853d65ae1b79b5cdbc2774150b2cb288d6d26e12958a16fb33c32d9a86c39'),
		];
		const quote = 'Db3qEMVwFN2tf_1JxbZp29aL5cVXpSMIwpYfyOVF';
		expect(() => assertSigAllInputs(proofs)).not.toThrow();
		const mts = buildP2PKSigAllMessage(proofs, outputs, quote);
		expect(isHTLCSpendAuthorised(proofs[0], NULL_LOGGER, mts)).toBe(true);
	});
});
