import { schnorr, secp256k1 } from '@noble/curves/secp256k1';
import { pointFromHex, deriveBlindedSecretKey } from '../../src/crypto';
import { hexToNumber, numberToHexPadded64 } from '../../src/utils';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils';
import { describe, expect, test } from 'vitest';

describe('blinded pubkeys & scalar arithmetic', () => {
	test('deriveBlindedSecretKey corresponds to pubkey addition: (p+r)·G == p·G + r·G', () => {
		const pHex = bytesToHex(secp256k1.utils.randomSecretKey());
		const rHex = bytesToHex(secp256k1.utils.randomSecretKey());
		const P = bytesToHex(secp256k1.getPublicKey(hexToBytes(pHex), true));
		const r = hexToNumber(rHex);
		const P_ = pointFromHex(P).add(secp256k1.Point.BASE.multiply(r)).toHex(true);
		const kHex = deriveBlindedSecretKey(pHex, rHex);
		const K = bytesToHex(secp256k1.getPublicKey(hexToBytes(kHex), true));
		expect(K).toBe(P_);
	});

	test('deriveBlindedSecretKey works with bigint inputs', () => {
		const p = hexToNumber(bytesToHex(secp256k1.utils.randomSecretKey()));
		const r = hexToNumber(bytesToHex(secp256k1.utils.randomSecretKey()));
		const pHex = numberToHexPadded64(p);
		const P = bytesToHex(secp256k1.getPublicKey(hexToBytes(pHex), true));
		const P_ = pointFromHex(P).add(secp256k1.Point.BASE.multiply(r)).toHex(true);
		const kHex = deriveBlindedSecretKey(p, r);
		const K = bytesToHex(secp256k1.getPublicKey(hexToBytes(kHex), true));
		expect(K).toBe(P_);
	});

	test('deriveBlindedSecretKey throws on invalid inputs', () => {
		const n = secp256k1.Point.CURVE().n;
		expect(() => deriveBlindedSecretKey(0n, 1n)).toThrow('Invalid private key');
		expect(() => deriveBlindedSecretKey(n, 1n)).toThrow('Invalid private key');
		expect(() => deriveBlindedSecretKey(1n, 0n)).toThrow('Invalid scalar r');
		expect(() => deriveBlindedSecretKey(1n, n)).toThrow('Invalid scalar r');
	});

	test('deriveBlindedSecretKey throws when k = 0', () => {
		const p = 1n;
		const r = secp256k1.Point.CURVE().n - 1n;
		expect(() => deriveBlindedSecretKey(p, r)).toThrow('Derived secret key is zero');
	});
});

describe('deriveBlindedSecretKey with expectedPub hints', () => {
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

	test('picks k1 when expectedPub equals SECP1 (compressed) of k1', () => {
		const { p, r, k1 } = makePr();
		const k1Hex = numberToHexPadded64(k1);
		const expectedPub = bytesToHex(secp256k1.getPublicKey(hexToBytes(k1Hex), true));
		const out = deriveBlindedSecretKey(numberToHexPadded64(p), numberToHexPadded64(r), expectedPub);
		expect(out).toBe(k1Hex);
	});

	test('picks k2 when expectedPub equals SECP1 (compressed) of k2', () => {
		const { p, r, k2 } = makePr();
		const k2Hex = numberToHexPadded64(k2);
		const expectedPub = bytesToHex(secp256k1.getPublicKey(hexToBytes(k2Hex), true));
		const out = deriveBlindedSecretKey(numberToHexPadded64(p), numberToHexPadded64(r), expectedPub);
		expect(out).toBe(k2Hex);
	});

	test('picks k2 when expectedPub equals Schnorr x-only (02||x) of k2', () => {
		const { p, r, k2 } = makePr();
		const k2Hex = numberToHexPadded64(k2);
		const schnorrXOnly = '02' + bytesToHex(schnorr.getPublicKey(k2Hex)); // x-only with 02 prefix
		const out = deriveBlindedSecretKey(
			numberToHexPadded64(p),
			numberToHexPadded64(r),
			schnorrXOnly,
		);
		console.log('out', out, 'k2Hex', k2Hex);
		expect(out).toBe(k2Hex);
	});

	test('falls back to k1 when expectedPub does not match either', () => {
		const { p, r, k1 } = makePr();
		const k1Hex = numberToHexPadded64(k1);
		const bogus = '02' + '0'.repeat(64); // well-formed, but won’t match
		const out = deriveBlindedSecretKey(numberToHexPadded64(p), numberToHexPadded64(r), bogus);
		expect(out).toBe(k1Hex);
	});

	test('picks k1 when expectedPub equals Schnorr x-only (02||x) of k1', () => {
		// Fixed values where (p + r) mod n yields even y (02 prefix for Schnorr)
		const p = 1n; // Simple scalar
		const r = 1n;
		const k1 = (p + r) % n;
		const k1Hex = numberToHexPadded64(k1);
		const schnorrXOnly = '02' + bytesToHex(schnorr.getPublicKey(hexToBytes(k1Hex))); // Forces even y
		const out = deriveBlindedSecretKey(
			numberToHexPadded64(p),
			numberToHexPadded64(r),
			schnorrXOnly,
		);
		expect(out).toBe(k1Hex);
	});

	test('handles odd y-parity in SECP1 compressed for sk1 (no negation needed)', () => {
		// Fixed key known to produce odd y (03 prefix) for sk1
		const p = hexToNumber('0000000000000000000000000000000000000000000000000000000000000001');
		const r = hexToNumber('0000000000000000000000000000000000000000000000000000000000000005');
		const k1 = (p + r) % n;
		const k1Hex = numberToHexPadded64(k1);
		const compressed = bytesToHex(secp256k1.getPublicKey(hexToBytes(k1Hex), true));
		if (compressed.startsWith('03')) {
			// Confirm odd y
			const out = deriveBlindedSecretKey(
				numberToHexPadded64(p),
				numberToHexPadded64(r),
				compressed,
			);
			expect(out).toBe(k1Hex);
		} else {
			throw new Error('Fixed values did not produce odd y; adjust p/r');
		}
	});

	test('skips sk2 and falls back to k1 when sk2 === 0n', () => {
		const p = hexToNumber(bytesToHex(secp256k1.utils.randomSecretKey())); // Random p
		const r = p; // Forces sk2 = (n - p + p) % n = 0n
		const sk1 = (p + r) % n;
		if (sk1 === 0n) return; // Rare, skip if sk1 also zero
		const sk1Hex = numberToHexPadded64(sk1);
		const bogus = '02' + '0'.repeat(64); // Mismatch forces fallback
		const out = deriveBlindedSecretKey(numberToHexPadded64(p), numberToHexPadded64(r), bogus);
		expect(out).toBe(sk1Hex);
	});
});
