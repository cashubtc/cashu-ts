import { schnorr, secp256k1 } from '@noble/curves/secp256k1';
import { Bytes, bytesToNumber, hexToNumber, numberToHexPadded64 } from '../utils';
import { pointFromHex } from './core';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';
import { sha256 } from '@noble/hashes/sha2';
import { type WeierstrassPoint } from '@noble/curves/abstract/weierstrass';

/**
 * BIP340-style domain separation tag (DST) for P2BK.
 */
export const P2BK_DST = utf8ToBytes('Cashu_P2BK_v1');

/**
 * Blind a sequence of public keys using ECDH derived tweaks, one tweak per slot.
 *
 * @remarks
 * Security note: "Ehex" must never be reused. Doing so would create linkability and leak privacy.
 *
 * This is the Sender side API.
 * @param pubkeys Ordered SEC1 compressed pubkeys, [data, ...pubkeys, ...refund]
 * @param keysetId Hex keyset identifier, bound into the tweak.
 * @returns Blinded pubkeys in the same order, and Ehex as SEC1 compressed hex, 33 bytes.
 * @throws If a blinded key is at infinity.
 */
export function deriveP2BKBlindedPubkeys(
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
		const r = deriveP2BKBlindingTweakFromECDH(P, e, kid, i);
		const P_ = P.add(secp256k1.Point.BASE.multiply(r));
		if (P_.equals(secp256k1.Point.ZERO)) throw new Error('Blinded key at infinity');
		return P_.toHex(true);
	});
	return { blinded, Ehex: bytesToHex(E) };
}

/**
 * Derive blinded secret keys that correspond to given P2BK blinded pubkeys.
 *
 * Pubkeys are processed in order, for a proof that is [data, ...pubkeys, ...refund]. Private key
 * order does not matter.
 *
 * @remarks
 * Security note, this operates on long lived secrets. JavaScript BigInt arithmetic in a JIT is not
 * guaranteed constant time. Do not expose this function on a server that holds private keys.
 *
 * This is the Receiver side API.
 * @param Ehex Ephemeral public key (E) as SEC1 hex.
 * @param privateKey Secret key or array of secret keys, hex.
 * @param pubKeys Blinded public key or array of blinded public keys, hex.
 * @param keysetIdHex Keyset identifier as hex.
 * @returns Array of derived secret keys as 64 char hex.
 */
export function deriveP2BKSecretKeys(
	Ehex: string,
	privateKey: string | string[],
	pubKeys: string | string[],
	keysetIdHex: string,
): string[] {
	const privs = Array.isArray(privateKey) ? privateKey : [privateKey];
	const pubs = Array.isArray(pubKeys) ? pubKeys : [pubKeys];
	const out = new Set<string>();
	const E = secp256k1.Point.fromHex(Ehex);
	const kid = hexToBytes(keysetIdHex);
	for (const privHex of privs) {
		const p = secp256k1.Point.Fn.fromBytes(hexToBytes(privHex));
		pubs.forEach((P_, i) => {
			const r = deriveP2BKBlindingTweakFromECDH(E, p, kid, i);
			out.add(deriveP2BKSecretKey(privHex, r, P_));
		});
	}
	return Array.from(out);
}

/**
 * Derive a blinded secret key per NUT-26.
 *
 * Computes two candidates: standard (sk1 = p + r mod n) and negated (sk2 = -p + r mod n). If
 * expectedPub is given, both are encoded as SEC1 compressed and as Schnorr x only with 0x02 prefix,
 * then compared with constant structure byte equality. Returns the matching one, or sk1 if both
 * match or if no expectedPub is provided.
 *
 * @remarks
 * Security note, this operates on long lived secrets. JavaScript BigInt arithmetic in a JIT is not
 * guaranteed constant time. Do not expose this function on a server that holds private keys.
 * @param privkey Unblinded private key (p), hex or bigint.
 * @param rBlind Blinding scalar (r), hex or bigint.
 * @param expectedPub Optional blinded pubkey (P_) to match, 33 byte hex.
 * @returns Derived blinded secret key as 64 char hex.
 * @throws If inputs are out of range, or the derived key would be zero.
 */
export function deriveP2BKSecretKey(
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
	// Derive the negated candidate to account for x only even y convention: (-p + r) mod n
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
 * Get a Schnorr x only public key with 0x02 prefix, 33 bytes.
 */
function getSchnorrPublicKeyWithPrefix(secretKey: bigint): Uint8Array {
	const pubkey = schnorr.getPublicKey(numberToHexPadded64(secretKey));
	const pk = new Uint8Array(33);
	pk[0] = 0x02; // '02' in bytes
	pk.set(pubkey, 1);
	return pk;
}

/**
 * Internal helper, derive P2BK blinding tweak using ECDH.
 *
 * @remarks
 * Computes the shared point Z = scalar·point, takes its 32 byte x coordinate Zx, then derives:
 *
 *     rᵢ = SHA-256(P2BK_DST || Zx || keysetId || i) mod n.
 *
 * If the result reduces to zero, retries once with an extra 0xff byte appended to the message.
 * Throws if the retry also reduces to zero.
 *
 * This function is symmetric. It can be called with either.
 *
 * - The receiver's private key (p) and the sender's ephemeral public key (E)
 * - The sender's ephemeral secret (e) and the receiver's public key (P)
 *
 * Both yield the same Z and therefore the same r thanks to the magic of ECDH!
 * @param point Ephemeral public key (E) or recipient public key (P)
 * @param scalar Private scalar (p) or ephemeral scalar (e) in [1, n − 1]
 * @param keysetId Keyset identifier as raw bytes.
 * @param slotIndex Zero based slot index, only lowest 8 bits (0–255) are used.
 * @returns Tweak (r) in [1, n − 1]
 * @throws If r reduces to zero after the retry.
 */
function deriveP2BKBlindingTweakFromECDH(
	point: WeierstrassPoint<bigint>, // E or P
	scalar: bigint, // p or e
	keysetId: Uint8Array, // kid
	slotIndex: number, // i
): bigint {
	// Calculate ECDH shared point (Z)
	const Zx = point.multiply(scalar).toBytes(false).slice(1, 33);
	const iByte = new Uint8Array([slotIndex & 0xff]);
	// Derive deterministic blinding factor (r):
	let r = bytesToNumber(sha256(Bytes.concat(P2BK_DST, Zx, keysetId, iByte)));
	if (r === 0n || r >= secp256k1.Point.CURVE().n) {
		// Very unlikely to get here (1/n)!
		r = bytesToNumber(sha256(Bytes.concat(P2BK_DST, Zx, keysetId, iByte, new Uint8Array([0xff]))));
		if (r === 0n || r >= secp256k1.Point.CURVE().n) {
			throw new Error('P2BK: tweak derivation failed');
		}
	}
	return r;
}
