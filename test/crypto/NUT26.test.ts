import { schnorr, secp256k1 } from '@noble/curves/secp256k1';
import { pointFromHex, deriveP2BKSecretKey } from '../../src/crypto';
import { hexToNumber, numberToHexPadded64 } from '../../src/utils';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils';
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
		const xonly = schnorr.getPublicKey(pHex); // 32-byte x of even-Y lift
		const expectedFromX = new Uint8Array(33);
		expectedFromX[0] = 0x02;
		expectedFromX.set(xonly, 1);
		// Ensure opposite parity vs actual P, to force k2
		if ((expectedFromX[0] & 1) === (Pself[0] & 1)) expectedFromX[0] ^= 0x01;
		const out = deriveP2BKSecretKey(pHex, rHex, Pprime, expectedFromX);
		expect(out).toBe(toHex(k2));
	});

	test('returns null when blindPubkey is valid but does not correspond to this (p, r)', () => {
		const { p, r, k1 } = makePr();
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
