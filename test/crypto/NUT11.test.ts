import { schnorr } from '@noble/curves/secp256k1';
import { bytesToHex, randomBytes } from '@noble/hashes/utils';
import { describe, expect, test, vi } from 'vitest';
import { createP2PKsecret, signP2PKProof, signP2PKProofs, parseP2PKSecret,getP2PKWitnessPubkeys,
	getP2PKWitnessRefundkeys,
	getP2PKExpectedKWitnessPubkeys,
	getP2PKLocktime,
	getP2PKNSigs,
	getP2PKSigFlag,
	getP2PKWitnessSignatures,
	Secret,
	P2PKWitness,
	verifyP2PKSig, verifyP2PKSigOutput
} from '../../src/crypto';
import { pointFromHex, Proof } from '../../src/crypto/common';
import { getPubKeyFromPrivKey } from '../../src/crypto/mint';
import { createRandomBlindedMessage } from '../../src/crypto/client';

const PRIVKEY = schnorr.utils.randomPrivateKey();
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
			C: pointFromHex('034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'),
			id: '00000000000',
			secret: new TextEncoder().encode(secretStr),
		};
		const signedProof = signP2PKProof(proof, PRIVKEY);
		const verify = verifyP2PKSig(signedProof);
		expect(verify).toBe(true);
	});

	test('sign and verify proofs', async () => {
		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}"}]`;
		const proof1: Proof = {
			amount: 1,
			C: pointFromHex('034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'),
			id: '00000000000',
			secret: new TextEncoder().encode(secretStr),
		};

		const proof2: Proof = {
			amount: 1,
			C: pointFromHex('034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'),
			id: '00000000000',
			secret: new TextEncoder().encode(secretStr),
		};

		const proofs = [proof1, proof2];

		const signedProofs = signP2PKProofs(proofs, bytesToHex(PRIVKEY));
		const verify0 = verifyP2PKSig(signedProofs[0]);
		const verify1 = verifyP2PKSig(signedProofs[1]);
		expect(verify0).toBe(true);
		expect(verify1).toBe(true);
	});

	test('sign and verify proofs, different keys', async () => {
		const PRIVKEY2 = schnorr.utils.randomPrivateKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}"}]`;
		const secretStr2 = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY2}"}]`;
		const proof1: Proof = {
			amount: 1,
			C: pointFromHex('034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'),
			id: '00000000000',
			secret: new TextEncoder().encode(secretStr),
		};

		const proof2: Proof = {
			amount: 1,
			C: pointFromHex('034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'),
			id: '00000000000',
			secret: new TextEncoder().encode(secretStr2),
		};

		const proofs = [proof1, proof2];

		const signedProofs = signP2PKProofs(proofs, [bytesToHex(PRIVKEY), bytesToHex(PRIVKEY2)]);
		const verify0 = verifyP2PKSig(signedProofs[0]);
		const verify1 = verifyP2PKSig(signedProofs[1]);
		expect(verify0).toBe(true);
		expect(verify1).toBe(true);
	});

	test('sign and verify proofs, multiple keys', async () => {
		const PRIVKEY2 = schnorr.utils.randomPrivateKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["n_sigs","2"],["pubkeys","${PUBKEY2}"]]}]`;
		const secretStr2 = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["n_sigs","1"],["pubkeys","${PUBKEY2}"]]}]`;
		const proof1: Proof = {
			amount: 1,
			C: pointFromHex('034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'),
			id: '00000000000',
			secret: new TextEncoder().encode(secretStr),
		};

		const proof2: Proof = {
			amount: 1,
			C: pointFromHex('034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'),
			id: '00000000000',
			secret: new TextEncoder().encode(secretStr2),
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
		const PRIVKEY2 = schnorr.utils.randomPrivateKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["pubkeys","${PUBKEY2}"]]}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKNSigs(parsed);
		expect(result).toBe(1); // 1 is default
		expect(getP2PKNSigs(secretStr)).toBe(1); // 1 is default
	});
	test('permanent lock, 2 n_sigs', async () => {
		const PRIVKEY2 = schnorr.utils.randomPrivateKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["n_sigs","2"],["pubkeys","${PUBKEY2}"]]}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKNSigs(parsed);
		expect(result).toBe(2);
		expect(getP2PKNSigs(secretStr)).toBe(2);
	});
	test('expired lock, 2 n_sigs, no refund keys', async () => {
		const PRIVKEY2 = schnorr.utils.randomPrivateKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["n_sigs","2"],["locktime","212"],["pubkeys","${PUBKEY2}"]]}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKNSigs(parsed);
		expect(result).toBe(0);
		expect(getP2PKNSigs(secretStr)).toBe(0);
	});
	test('expired lock, 2 n_sigs, 2 refund keys, unspecified n_sigs_refund', async () => {
		const PRIVKEY2 = schnorr.utils.randomPrivateKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));
		const PRIVKEY3 = schnorr.utils.randomPrivateKey();
		const PUBKEY3 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY3));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["n_sigs","2"],["locktime","212"],["pubkeys","${PUBKEY2}"],["refund","${PUBKEY2}","${PUBKEY3}"]]}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKNSigs(parsed);
		expect(result).toBe(1);
		expect(getP2PKNSigs(secretStr)).toBe(1);
	});
	test('expired lock, 1 n_sigs, 2 refund keys, 2 n_sigs_refund', async () => {
		const PRIVKEY2 = schnorr.utils.randomPrivateKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));
		const PRIVKEY3 = schnorr.utils.randomPrivateKey();
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
		const PRIVKEY2 = schnorr.utils.randomPrivateKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["pubkeys","${PUBKEY2}"]]}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKSigFlag(parsed);
		expect(result).toBe('SIG_INPUTS'); // default
		expect(getP2PKSigFlag(secretStr)).toBe('SIG_INPUTS'); // default
	});
	test('SIG_INPUTS sigflag', async () => {
		const PRIVKEY2 = schnorr.utils.randomPrivateKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["sigflag","SIG_INPUTS"],["pubkeys","${PUBKEY2}"]]}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKSigFlag(parsed);
		expect(result).toBe('SIG_INPUTS'); // default
		expect(getP2PKSigFlag(secretStr)).toBe('SIG_INPUTS'); // default
	});
	test('SIG_ALL sigflag', async () => {
		const PRIVKEY2 = schnorr.utils.randomPrivateKey();
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
		const PRIVKEY2 = schnorr.utils.randomPrivateKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["pubkeys","${PUBKEY2}"]]}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKLocktime(parsed);
		expect(result).toBe(Infinity); // default
		expect(getP2PKLocktime(secretStr)).toBe(Infinity); // default
	});
	test('specified locktime', async () => {
		const PRIVKEY2 = schnorr.utils.randomPrivateKey();
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
		const PRIVKEY2 = schnorr.utils.randomPrivateKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));
		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["pubkeys","${PUBKEY2}"]]}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKWitnessPubkeys(parsed);
		expect(result).toEqual([PUBKEY, PUBKEY2]);
		expect(getP2PKWitnessPubkeys(secretStr)).toEqual([PUBKEY, PUBKEY2]);
	});
	test('data + 2 pubkeys', async () => {
		const PRIVKEY2 = schnorr.utils.randomPrivateKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));
		const PRIVKEY3 = schnorr.utils.randomPrivateKey();
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
		const PRIVKEY2 = schnorr.utils.randomPrivateKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));
		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["refund","${PUBKEY2}"]]}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKWitnessRefundkeys(parsed);
		expect(result).toEqual([PUBKEY2]);
		expect(getP2PKWitnessRefundkeys(secretStr)).toEqual([PUBKEY2]);
	});
	test('2 refund pubkeys', async () => {
		const PRIVKEY2 = schnorr.utils.randomPrivateKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));
		const PRIVKEY3 = schnorr.utils.randomPrivateKey();
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
		const PRIVKEY2 = schnorr.utils.randomPrivateKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["pubkeys","${PUBKEY2}"]]}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKExpectedKWitnessPubkeys(parsed);
		expect(result).toStrictEqual([PUBKEY, PUBKEY2]);
		expect(getP2PKExpectedKWitnessPubkeys(secretStr)).toEqual([PUBKEY, PUBKEY2]);
	});
	test('expired lock, 2 pubkeys, no refund keys', async () => {
		const PRIVKEY2 = schnorr.utils.randomPrivateKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}","tags":[["n_sigs","2"],["locktime","212"],["pubkeys","${PUBKEY2}"]]}]`;
		const parsed: Secret = parseP2PKSecret(secretStr);
		const result = getP2PKExpectedKWitnessPubkeys(parsed);
		expect(result).toStrictEqual([]);
		expect(getP2PKExpectedKWitnessPubkeys(secretStr)).toEqual([]);
	});
	test('expired lock, 2 pubkeys, 2 refund keys', async () => {
		const PRIVKEY2 = schnorr.utils.randomPrivateKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));
		const PRIVKEY3 = schnorr.utils.randomPrivateKey();
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
			C: pointFromHex('034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'),
			id: '00000000000',
			secret: new TextEncoder().encode(secretStr),
		};
		expect(() => signP2PKProof(proof, PRIVKEY).toThrow('not a P2PK secret'));
	});
	test('can only sign and verify once', async () => {
		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}"}]`;
		const proof: Proof = {
			amount: 1,
			C: pointFromHex('034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'),
			id: '00000000000',
			secret: new TextEncoder().encode(secretStr),
			witness:
				'{"signatures":["60f3c9b766770b46caac1d27e1ae6b77c8866ebaeba0b9489fe6a15a837eaa6fcd6eaa825499c72ac342983983fd3ba3a8a41f56677cc99ffd73da68b59e1383"]}',
		};
		// first signing
		const signedProof = signP2PKProof(proof, PRIVKEY);
		const verify = verifyP2PKSig(signedProof);
		expect(verify).toBe(true);
		expect(signedProof.witness.signatures).toHaveLength(2);
		// try signing again
		expect(() => signP2PKProof(signedProof, PRIVKEY)).toThrow(
			`Proof already signed by [02|03]${PUBKEY.slice(2)}`,
		);
	});
	test('not eligible to sign', async () => {
		const PRIVKEY2 = schnorr.utils.randomPrivateKey();
		const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));

		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY}"}]`;
		const proof: Proof = {
			amount: 1,
			C: pointFromHex('034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'),
			id: '00000000000',
			secret: new TextEncoder().encode(secretStr),
			witness:
				'{"signatures":["60f3c9b766770b46caac1d27e1ae6b77c8866ebaeba0b9489fe6a15a837eaa6fcd6eaa825499c72ac342983983fd3ba3a8a41f56677cc99ffd73da68b59e1383"]}',
		};
		expect(() => signP2PKProof(proof, PRIVKEY2)).toThrow(
			`Signature not required from [02|03]${PUBKEY2.slice(2)}`,
		);
	});
	test('sign with 02-prepended Nostr key', async () => {
		const PRIVKEY2 = '622320785910d6aac0d5406ce1b6ef1640ab97c2acdea6a246eb6859decd6230'; // produces an Odd Y-parity pubkey
		const PUBKEY2 = '02' + bytesToHex(schnorr.getPublicKey(PRIVKEY2)); // Prepended x-only pubkey
		const PUBKEY3 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2)); // full 33-byte pubkey
		expect(PUBKEY3).toMatch(/^03/); // Verify it really is an odd Y-parity key
		const secretStr = `["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${PUBKEY2}"}]`;
		const proof: Proof = {
			amount: 1,
			C: pointFromHex('034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'),
			id: '00000000000',
			secret: new TextEncoder().encode(secretStr),
			witness:
				'{"signatures":["60f3c9b766770b46caac1d27e1ae6b77c8866ebaeba0b9489fe6a15a837eaa6fcd6eaa825499c72ac342983983fd3ba3a8a41f56677cc99ffd73da68b59e1383"]}',
		};
		const signedProof = signP2PKProof(proof, PRIVKEY2);
		const verify = verifyP2PKSig(signedProof);
		expect(verify).toBe(true);
		expect(signedProof.witness.signatures).toHaveLength(2);
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
			C: pointFromHex('034268c0bd30b945adf578aca2dc0d1e26ef089869aaf9a08ba3a6da40fda1d8be'),
			secret: new TextEncoder().encode(
				`["P2PK",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"${bytesToHex(
					randomBytes(32),
				)}"}]`,
			),
		};
		expect(() => verifyP2PKSig(proof)).toThrow(
			new Error('could not verify signature, no witness provided'),
		);
	});
});
