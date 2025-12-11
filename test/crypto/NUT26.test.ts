import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import {
	pointFromHex,
	deriveP2BKSecretKey,
	deriveP2BKBlindedPubkeys,
	deriveP2BKSecretKeys,
} from '../../src/crypto';
import { hexToNumber, numberToHexPadded64 } from '../../src/utils';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, test } from 'vitest';

describe('blinded pubkeys & scalar arithmetic', () => {
	test('deriveP2BKSecretKey corresponds to pubkey addition: (p+r)·G == p·G + r·G', () => {
		const pHex = bytesToHex(secp256k1.utils.randomSecretKey());
		const rHex = bytesToHex(secp256k1.utils.randomSecretKey());
		const P = bytesToHex(secp256k1.getPublicKey(hexToBytes(pHex), true));
		const r = hexToNumber(rHex);
		const P_ = pointFromHex(P).add(secp256k1.Point.BASE.multiply(r)).toHex(true);
		const kHex = deriveP2BKSecretKey(pHex, rHex)!;
		const K = bytesToHex(secp256k1.getPublicKey(hexToBytes(kHex), true));
		expect(K).toBe(P_);
	});

	test('deriveP2BKSecretKey works with bigint inputs', () => {
		const p = hexToNumber(bytesToHex(secp256k1.utils.randomSecretKey()));
		const r = hexToNumber(bytesToHex(secp256k1.utils.randomSecretKey()));
		const pHex = numberToHexPadded64(p);
		const P = bytesToHex(secp256k1.getPublicKey(hexToBytes(pHex), true));
		const P_ = pointFromHex(P).add(secp256k1.Point.BASE.multiply(r)).toHex(true);
		const kHex = deriveP2BKSecretKey(p, r)!;
		const K = bytesToHex(secp256k1.getPublicKey(hexToBytes(kHex), true));
		expect(K).toBe(P_);
	});

	test('deriveP2BKSecretKey throws on invalid inputs', () => {
		const n = secp256k1.Point.CURVE().n;
		expect(() => deriveP2BKSecretKey(0n, 1n)).toThrow('Invalid private key');
		expect(() => deriveP2BKSecretKey(n, 1n)).toThrow('Invalid private key');
		expect(() => deriveP2BKSecretKey(1n, 0n)).toThrow('Invalid scalar r');
		expect(() => deriveP2BKSecretKey(1n, n)).toThrow('Invalid scalar r');
	});

	test('deriveP2BKSecretKey throws when k = 0', () => {
		const p = 1n;
		const r = secp256k1.Point.CURVE().n - 1n;
		expect(() => deriveP2BKSecretKey(p, r)).toThrow('Derived secret key is zero');
	});
});

describe('deriveP2BKSecretKey with expectedPub hints', () => {
	const n = secp256k1.Point.CURVE().n;

	// helper to make (p, r) where k1 != 0 and k2 != 0
	function makePr() {
		while (true) {
			const p = hexToNumber(bytesToHex(secp256k1.utils.randomSecretKey()));
			const r = hexToNumber(bytesToHex(secp256k1.utils.randomSecretKey()));
			if (p > 0n && p < n && r > 0n && r < n) {
				const k1 = (p + r) % n;
				const k2 = (n - p + r) % n;
				if (k1 !== 0n && k2 !== 0n) return { p, r, k1, k2 };
			}
		}
	}

	// convenience helpers
	const toHex = (x: bigint) => numberToHexPadded64(x);
	const compFromScalar = (x: bigint) => secp256k1.getPublicKey(hexToBytes(toHex(x)), true);

	test('picks k1 when expectedPub equals SECP1 (compressed) of k1', () => {
		const { p, r, k1 } = makePr();
		const pHex = toHex(p);
		const rHex = toHex(r);
		const Pprime = compFromScalar(k1); // P′ = k1·G
		const expectedPub = compFromScalar(p); // P = p·G
		const out = deriveP2BKSecretKey(pHex, rHex, Pprime, expectedPub);
		expect(out).toBe(toHex(k1));
	});

	test('selects k2 when expectedPub is the opposite-parity lift of P = p·G', () => {
		const { p, r, k1, k2 } = makePr();
		const pHex = toHex(p);
		const rHex = toHex(r);
		const Pprime = compFromScalar(k1); // valid blinded key: P′ = (p r)·G
		const Pself = compFromScalar(p); // P = p·G
		const expectedOpp = new Uint8Array(Pself); // flip 02<->03 to force opposite parity
		expectedOpp[0] ^= 0x01;
		const out = deriveP2BKSecretKey(pHex, rHex, Pprime, expectedOpp);
		expect(out).toBe(toHex(k2));
	});

	test('accepts Schnorr x-only (02||x) for expectedPub and selects k2 when parity mismatches', () => {
		const { p, r, k1, k2 } = makePr();
		const pHex = toHex(p);
		const rHex = toHex(r);
		const Pprime = compFromScalar(k1); // valid blinded key
		const Pself = compFromScalar(p); // compressed P = p·G
		// Build 02||x(p) from Schnorr API
		const xonly = schnorr.getPublicKey(hexToBytes(pHex)); // 32-byte x of even-Y lift
		const expectedFromX = new Uint8Array(33);
		expectedFromX[0] = 0x02;
		expectedFromX.set(xonly, 1);
		// Ensure opposite parity vs actual P, to force k2
		if ((expectedFromX[0] & 1) === (Pself[0] & 1)) expectedFromX[0] ^= 0x01;
		const out = deriveP2BKSecretKey(pHex, rHex, Pprime, expectedFromX);
		expect(out).toBe(toHex(k2));
	});

	test('returns null when blindPubkey is valid but does not correspond to this (p, r)', () => {
		const { p, r } = makePr();
		const pHex = toHex(p);
		const rHex = toHex(r);
		// Valid but unrelated point: q·G
		const q = hexToNumber(bytesToHex(secp256k1.utils.randomSecretKey()));
		const PprimeWrong = compFromScalar(q);
		const out = deriveP2BKSecretKey(pHex, rHex, PprimeWrong, compFromScalar(p));
		expect(out).toBeNull();
	});

	test('selects k1 when expectedPub matches the actual parity of P = p·G', () => {
		const { p, r, k1 } = makePr();
		const out = deriveP2BKSecretKey(
			toHex(p),
			toHex(r),
			compFromScalar(k1), // P′ = (p + r)·G
			compFromScalar(p), // expectedPub = P = p·G, same parity
		);
		expect(out).toBe(toHex(k1));
	});

	test('handles odd y-parity in SECP1 compressed for sk1 (no negation needed)', () => {
		// Fixed key known to produce odd y (03 prefix) for sk1
		const p = hexToNumber('0000000000000000000000000000000000000000000000000000000000000001');
		const r = hexToNumber('0000000000000000000000000000000000000000000000000000000000000005');
		const k1 = (p + r) % n;
		const k1Hex = toHex(k1);
		const compressed = bytesToHex(compFromScalar(k1)); // P′ candidate
		if (compressed.startsWith('03')) {
			const out = deriveP2BKSecretKey(
				toHex(p),
				toHex(r),
				hexToBytes(compressed), // P′
				compFromScalar(p), // P
			);
			expect(out).toBe(k1Hex);
		} else {
			throw new Error('Fixed values did not produce odd y, adjust p or r');
		}
	});

	test('when sk2 === 0n and P′ matches k1, returns k1', () => {
		// Choose r = p, then sk2 = (n - p + r) % n = 0
		const p = hexToNumber(bytesToHex(secp256k1.utils.randomSecretKey()));
		const r = p;
		const k1 = (p + r) % n; // k1 = 2p mod n
		if (k1 === 0n) return; // extremely rare, skip if it happens
		const out = deriveP2BKSecretKey(
			toHex(p),
			toHex(r),
			compFromScalar(k1), // P′ = k1·G
			compFromScalar(p), // P = p·G
		);
		expect(out).toBe(toHex(k1));
	});
});

describe('P2BK test vectors, public API only', () => {
	test('reconstructs spend key from E, P′, keyset_id, and Bob’s privkey', () => {
		const keysetIdHex = '009a1f293253e41e'; // ASCII hex string from mint
		const eHex = '1cedb9df0c6872188b560ace9e35fd55c2532d53e19ae65b46159073886482ca';
		const Ehex = '02a8cda4cf448bfce9a9e46e588c06ea1780fcb94e3bbdf3277f42995d403a8b0c'; // proof.p2pk_e
		const pubKeyBob = '02771fed6cb88aaac38b8b32104a942bf4b8f4696bc361171b3c7d06fa2ebddf06';
		const privKeyBob = 'ad37e8abd800be3e8272b14045873f4353327eedeb702b72ddcc5c5adff5129c';
		const allSlotsBlinded = [
			'03f221b62aa21ee45982d14505de2b582716ae95c265168f586dc547f0ea8f135f', // slot 0
			'0299692178029fe08c49e8123bb0e84d6e960b27f82c8aed43013526489d46c0d5',
			'03ae189850bda004f9723e17372c99ff9df9e29750d2147d40efb45ac8ab2cdd2c',
			'03109838d718fbe02e9458ffa423f25bae0388146542534f8e2a094de6f7b697fa',
			'0339d5ed7ea93292e60a4211b2daf20dff53f050835614643a43edccc35c8313db',
			'0237861efcd52fe959bce07c33b5607aeae0929749b8339f68ba4365f2fb5d2d8d',
			'026d5500988a62cde23096047db61e9fb5ef2fea5c521019e23862108ea4e14d72',
			'039024fd20b26e73143509537d7c18595cfd101da4b18bb86ddd30e944aac6ef1b',
			'03017ec4218ca2ed0fbe050e3f1a91221407bf8c896b803a891c3a52d162867ef8',
			'0380dc0d2c79249e47b5afb61b7d40e37b9b0370ec7c80b50c62111021b886ab31',
			'0261a8a32e718f5f27610a2b7c2069d6bab05d1ead7da21aa9dd2a3c758bdf6479', // slot 10
		];
		const allDerivedKeysSk2 = [
			'947e08ad9df6c97ed96627d70e447f1238540da5ac2a25cf208614287592b4d2',
			'179ea3cde066aa0374f50b94eeb06ffbf0a29c3273c4f1ea02196f2b8ecf01f8',
			'57b50c84bd8770ea13ec753e014b861158d82b6d8780c40bb113eb1debb25b21',
			'942bd385db07bac3363fd108dbb3cf87abf94c3765c935172fdb957ffc80a752',
			'489ee9606197c9b4196af631208847df1b078e6107fa65812f731515a5a068c4',
			'453d579e395c18e26b96ee1d25f61e83b29f4a6cdb3dd6563936bf0a17e7b9d6',
			'8ca811f3295ffe9be11f51c5b68bb948e9cbb95e0d49509e5bc68599b170fc1d',
			'85f94ae2af5fce40b3b3ab5b0d341f7a139811dae5e59b4b19154dadfa1dfbf0',
			'975c9327940142bcdaea53d832d9f70ad2e2c8a550bbefff702df24edabe1fec',
			'221680d85033229c36347ee8ee4f09bb965b6914993f020bcfa557c5c8fbd942',
			'8901023cd187dd7f1403e4f70cd8d16eb44e3f1a44371f738266263742ddd7d4',
		];
		const P_0 = allSlotsBlinded[0]; // secret.data (slot 0)
		// Check sender side blinds ok
		const { blinded, Ehex: calcE } = deriveP2BKBlindedPubkeys(
			[
				pubKeyBob, // slot 0
				pubKeyBob,
				pubKeyBob,
				pubKeyBob,
				pubKeyBob,
				pubKeyBob,
				pubKeyBob,
				pubKeyBob,
				pubKeyBob,
				pubKeyBob,
				pubKeyBob, // slot 10
			],
			keysetIdHex,
			hexToBytes(eHex), // fixed ephemeral secret
		);
		expect(calcE).toEqual(Ehex);
		expect(blinded[0]).toEqual(P_0);
		expect(blinded).toStrictEqual(allSlotsBlinded);
		// Check receiver side dervives secret keys ok
		const derived = deriveP2BKSecretKeys(
			Ehex,
			privKeyBob,
			allSlotsBlinded, // all slots
			keysetIdHex, // API hex-decodes internally
		);
		expect(derived).toHaveLength(11);
		// expected pub (p.G): 03771fed6cb88aaac38b8b32104a942bf4b8f4696bc361171b3c7d06fa2ebddf06
		// but Bob's pubkey is 02771fed6cb88aaac38b8b32104a942bf4b8f4696bc361171b3c7d06fa2ebddf06
		// so this is a negated Schnorr privkey set (sk2)
		expect(derived).toStrictEqual(allDerivedKeysSk2);
		// For every slot, the derived public key must equal the corresponding blinded pubkey (P′)
		expect(derived.length).toBe(allSlotsBlinded.length);
		for (let i = 0; i < derived.length; i++) {
			const Kpub_i = bytesToHex(secp256k1.getPublicKey(hexToBytes(derived[i]), true));
			expect(Kpub_i).toBe(allSlotsBlinded[i]);
		}
	});
});
