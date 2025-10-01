import { schnorr, secp256k1 } from '@noble/curves/secp256k1';
import { Bytes, hexToNumber, numberToHexPadded64 } from '../utils';
import { pointFromHex } from './core';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { sha256 } from '@noble/hashes/sha2';
import { type WeierstrassPoint } from '@noble/curves/abstract/weierstrass';

export type BlindedPubkey = {
	P_: string;
	r: bigint;
};

// BIP340-style tag for domain separation
export const P2BK_DST = utf8ToBytes('Cashu_P2BK_v1');

/**
 * P2BK blinding via ECDH tweaks (one E per proof).
 *
 * @param pubkeys Ordered SEC1-compressed pubkeys: [data, ...pubkeys, ...refund]
 * @param keysetId Hex keyset id (bound into the message to be hashed)
 * @returns {blinded, Ehex} Blinded pubkeys in the same order, and the single ephemeral E.
 * @throws If inputs are out of range or derived secret key is zero.
 */
export function createP2BKBlindedPubkeys(
	pubkeys: string[],
	keysetId: string,
): { blinded: string[]; Ehex: string } {
	if (!pubkeys.length) return { blinded: [], Ehex: '' };
	// Create fresh ephemeral secret (e) and pubkey (E)
	const eBytes = secp256k1.utils.randomSecretKey(); // 32 bytes
	const e = secp256k1.Point.Fn.fromBytes(eBytes); // bigint in [1..n-1]
	const E = secp256k1.getPublicKey(eBytes, true); // SEC1 compressed (bytes)
	const kid = hexToBytes(keysetId);
	// Blind each pubkey in turn
	const blinded = pubkeys.map((pubkey, i) => {
		const P = pointFromHex(pubkey);
		const r = deriveDeterministicBlindingFactor(P, e, kid, i);
		const P_ = P.add(secp256k1.Point.BASE.multiply(r));
		if (P_.equals(secp256k1.Point.ZERO)) throw new Error('Blinded key at infinity');
		return P_.toHex(true);
	});
	return { blinded, Ehex: bytesToHex(E) };
}

/**
 * Derives the "per slot" deterministic P2BK blinding factor from an ephemeral public key and a
 * private key.
 *
 * @remarks
 * Computes rᵢ = SHA-256(P2BK_DST || Zx || keysetId || i) mod n, where Zx is the 32 byte x
 * coordinate of the shared point Z = p·E. If r reduces to zero, retries once with an extra 0xff
 * byte appended to the message. Throws if the retry also reduces to zero.
 *
 * Input values are provided as hex at the edges for ergonomics, the function converts them to
 * concrete types for computation.
 * @example Const r = deriveP2BKBlindingFactor(Ehex, privHex, keysetIdHex, i); // Apply to a public
 * key, P′ = P + r·G const P_ = P.add(secp256k1.Point.BASE.multiply(r));
 *
 * @param Ehex Ephemeral public key E as SEC1 encoded hex, compressed or uncompressed.
 * @param privHex Private key p as 64 character hex, big endian.
 * @param keysetIdHex Keyset identifier as hex, bound into the derivation.
 * @param slotIndex Zero based slot index, only the low 8 bits are used.
 * @returns Blinding factor r as a bigint in the range [1, n − 1]
 * @throws Error If the derived scalar is zero after the single retry.
 */
export function deriveP2BKBlindingFactor(
	Ehex: string,
	privHex: string,
	keysetIdHex: string,
	slotIndex: number,
): bigint {
	const E = secp256k1.Point.fromHex(Ehex);
	const p = secp256k1.Point.Fn.fromBytes(hexToBytes(privHex));
	const kid = hexToBytes(keysetIdHex);
	return deriveDeterministicBlindingFactor(E, p, kid, slotIndex);
}

/**
 * Derive a blinded secret key per NUT-26.
 *
 * Warning: Operates on long-lived secrets. This function targets algorithmic constant time, but
 * JavaScript BigInt and JIT compilers are not truly constant time. It is OK for browser and app use
 * where keys remain on the user’s device, but it should NOT be exposed in a public service that
 * holds private keys on the server.
 *
 * @remarks
 * Computes two candidates: standard (sk1 = p + r mod n) and negated (sk2 = -p + r mod n). If
 * expectedPub is provided, both candidates are encoded as both SEC1 (compressed) and Schnorr ('02'
 * prefixed x-only), and compared using constant-structure byte equality, there is no early return.
 * @param privkey The unblinded private key (64-character hex string or bigint).
 * @param rBlind The random blinding scalar (64-character hex string or bigint).
 * @param expectedPub Optional blinded public key (hex string) to match.
 * @returns The derived blinded secret key (64-character hex string).
 * @throws If inputs are out of range or derived secret key is zero.
 * @see https://github.com/cashubtc/nuts/pull/291
 */
export function deriveBlindedSecretKey(
	privkey: string | bigint,
	rBlind: string | bigint,
	expectedPub?: string,
): string {
	// Implementation note, keep algorithmic constant time:
	// compute both candidates, compute both encodings, compare at the end only.
	const n = secp256k1.Point.CURVE().n;
	const p = typeof privkey === 'string' ? hexToNumber(privkey) : privkey;
	const r = typeof rBlind === 'string' ? hexToNumber(rBlind) : rBlind;
	if (p <= 0n || p >= n) throw new Error('Invalid private key');
	if (r <= 0n || r >= n) throw new Error('Invalid scalar r');
	// Derive standard blinded secret key: (p + r) mod n
	const sk1: bigint = (p + r) % n;
	if (sk1 === 0n) throw new Error('Derived secret key is zero');
	// Derive Schnorr negated blinded secret key for even y: (-p + r) mod n
	const sk2: bigint = (n - p + r) % n; // may be 0n (handled below)
	// Validate expectedPub if provided, else return sk1
	if (!expectedPub) return numberToHexPadded64(sk1);
	const exp: Uint8Array = Bytes.fromHex(expectedPub);
	if (exp.length !== 33) throw new Error('expectedPub must be 33 bytes');
	// Calculate sk1 pubkeys - SEC1 compressed and Schnorr '02' prefixed x-only
	const pk1_secpcmp: Uint8Array = secp256k1.getPublicKey(sk1, true); // 33 bytes
	const pk1_schnorr: Uint8Array = getSchnorrPublicKeyWithPrefix(sk1);
	const m1 = Bytes.equals(exp, pk1_secpcmp) || Bytes.equals(exp, pk1_schnorr);
	// Calculate sk2 pubkeys as above, but only if sk2 != 0
	let m2 = false;
	if (sk2 !== 0n) {
		const pk2_secpcmp: Uint8Array = secp256k1.getPublicKey(sk2, true);
		const pk2_schnorr: Uint8Array = getSchnorrPublicKeyWithPrefix(sk2);
		m2 = Bytes.equals(exp, pk2_secpcmp) || Bytes.equals(exp, pk2_schnorr);
	}
	// Return standard (sk1) unless negated (sk2) is the only match
	const out = m2 && !m1 ? sk2 : sk1;
	return numberToHexPadded64(out);
}

/**
 * Gets Schnorr '02' prefixed x-only pubkey.
 */
function getSchnorrPublicKeyWithPrefix(secretKey: bigint): Uint8Array {
	const pubkey = schnorr.getPublicKey(numberToHexPadded64(secretKey));
	const pk = new Uint8Array(33);
	pk[0] = 0x02;
	pk.set(pubkey, 1);
	return pk;
}

/**
 * Internal helper that deterministically derives the P2BK blinding factor from a scalar·point ECDH.
 *
 * @remarks
 * Computes the shared point Z = scalar·point, takes its 32 byte x coordinate Zx, then derives rᵢ =
 * SHA-256(P2BK_DST || Zx || keysetId || i) mod n. If the result reduces to zero, retries once with
 * an extra 0xff byte appended to the message. Throws if the retry also reduces to zero.
 *
 * This function is symmetric. It can be called with either • point = E and scalar = p, or • point =
 * P and scalar = e Both yield the same Z and therefore the same r.
 * @example // Receiver side const r = deriveDeterministicBlindingFactor(E, p, kidBytes, i);
 *
 * // Sender side const r2 = deriveDeterministicBlindingFactor(P, e, kidBytes, i); // r === r2.
 *
 * @param point A valid secp256k1 point, either the ephemeral public key E or a recipient public key
 *   P.
 * @param scalar A valid secp256k1 scalar in [1, n − 1], either the long lived private key p or the
 *   ephemeral secret e.
 * @param keysetId Keyset identifier as raw bytes, bound into the derivation.
 * @param slotIndex Zero based slot index, only the low 8 bits are used.
 * @returns Blinding factor r as a bigint in the range [1, n − 1]
 * @throws Error If the derived scalar is zero after the single retry.
 */
function deriveDeterministicBlindingFactor(
	point: WeierstrassPoint<bigint>, // E or P
	scalar: bigint, // p or e
	keysetId: Uint8Array, // kid
	slotIndex: number, // i
): bigint {
	// Calculate ECDH shared point (Z) using either:
	// - the receiver's private key (p) and the sender's ephemeral public key (E)
	// - the sender's ephemeral secret (e) and the receiver's public key (P)
	// Both will resolve to the same point thanks to the magic of ECDH!
	const Zx = point.multiply(scalar).toBytes(false).slice(1, 33);
	const iByte = new Uint8Array([slotIndex & 0xff]);
	// Derive deterministic blinding factor (r):
	// r_i = SHA-256(P2BK_DST || Zx || kid || i) mod n; retry once if zero
	let r = secp256k1.Point.Fn.fromBytes(sha256(Bytes.concat(P2BK_DST, Zx, keysetId, iByte)));
	if (r === 0n) {
		// Very unlikely to get here (1/n)!
		r = secp256k1.Point.Fn.fromBytes(
			sha256(Bytes.concat(P2BK_DST, Zx, keysetId, iByte, new Uint8Array([0xff]))),
		);
		if (r === 0n) throw new Error('P2BK: tweak derivation failed');
	}
	return r;
}
