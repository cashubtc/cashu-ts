import { secp256k1 } from '@noble/curves/secp256k1.js';
import { Bytes, bytesToNumber, hexToNumber, numberToHexPadded64 } from '../utils';
import { pointFromHex } from './core';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { type WeierstrassPoint } from '@noble/curves/abstract/weierstrass.js';

/**
 * BIP340-style domain separation tag (DST) for P2BK.
 *
 * @experimental
 */
export const P2BK_DST = utf8ToBytes('Cashu_P2BK_v1');

/**
 * Blind a sequence of public keys using ECDH derived tweaks, one tweak per slot.
 *
 * @remarks
 * Security note: "Ehex" must never be reused. Doing so would create linkability and leak privacy.
 * The only exception is for SIG_ALL proofs, as all secret tags must match.
 *
 * This is the Sender side API.
 * @param pubkeys Ordered SEC1 compressed pubkeys, [data, ...pubkeys, ...refund]
 * @param keysetId Hex keyset identifier, bound into the tweak.
 * @param eBytes Optional. Fixed ephemeral secret key to use (eg for SIG_ALL / testing)
 * @returns Blinded pubkeys in the same order, and Ehex as SEC1 compressed hex, 33 bytes.
 * @throws If a blinded key is at infinity.
 * @experimental
 */
export function deriveP2BKBlindedPubkeys(
	pubkeys: string[],
	keysetId: string,
	eBytes?: Uint8Array,
): { blinded: string[]; Ehex: string } {
	if (!pubkeys.length) return { blinded: [], Ehex: '' };
	// Create fresh ephemeral secret (e) if not supplied, and calculate pubkey (E)
	eBytes = eBytes ?? secp256k1.utils.randomSecretKey(); // 32 bytes
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
 * @param blindPubKey Blinded public key or array of blinded public keys, hex.
 * @param keysetIdHex Keyset identifier as hex.
 * @returns Array of derived secret keys as 64 char hex.
 * @experimental
 */
export function deriveP2BKSecretKeys(
	Ehex: string,
	privateKey: string | string[],
	blindPubKey: string | string[],
	keysetIdHex: string,
): string[] {
	const privs = Array.isArray(privateKey) ? privateKey : [privateKey];
	const pubs = Array.isArray(blindPubKey) ? blindPubKey : [blindPubKey];
	const out = new Set<string>();
	const E = secp256k1.Point.fromHex(Ehex);
	const kid = hexToBytes(keysetIdHex);
	for (const privHex of privs) {
		const p = secp256k1.Point.Fn.fromBytes(hexToBytes(privHex));
		const P = secp256k1.getPublicKey(hexToBytes(privHex), true); // 33 bytes, validates on curve
		pubs.forEach((hexP_, i) => {
			const r = deriveP2BKBlindingTweakFromECDH(E, p, kid, i);
			const P_ = hexToBytes(hexP_);
			const kHex = deriveP2BKSecretKey(privHex, r, P_, P);
			if (kHex) out.add(kHex); // add only when this priv matches this P′
		});
	}
	return Array.from(out);
}

/**
 * Derive a blinded secret key per NUT-26.
 *
 * Unblinds the pubkey (P = P_ - r·G), verifies x-coord against the naturalPub x(P) == x(p·G), then
 * choose skStd = (p + rᵢ) mod n if parity(P) == parity(p·G), otherwise skNeg = (-p + rᵢ) mod n.
 * Returns skStd if no blindPubkey is provided.
 *
 * @remarks
 * Security note, this operates on long lived secrets. JavaScript BigInt arithmetic in a JIT is not
 * guaranteed constant time. Do not expose this function on a server that holds private keys.
 * @param privkey Unblinded private key (p), hex or bigint.
 * @param rBlind Blinding scalar (r), hex or bigint.
 * @param blindPubkey Optional. Blinded pubkey (P_) to match, 33 byte hex.
 * @param naturalPub Optional. Pubkey calculated from private key (P = p·G), 33 byte hex.
 * @returns Derived blinded secret key as 64 char hex.
 * @throws If inputs are out of range, or the derived key would be zero.
 * @experimental
 */
export function deriveP2BKSecretKey(
	privkey: string | bigint,
	rBlind: string | bigint,
	blindPubkey?: Uint8Array,
	naturalPub?: Uint8Array,
): string | null {
	// Implementation note: must keep algorithmic constant time!
	const n = secp256k1.Point.CURVE().n;
	const p = typeof privkey === 'string' ? hexToNumber(privkey) : privkey;
	const r = typeof rBlind === 'string' ? hexToNumber(rBlind) : rBlind;
	if (p <= 0n || p >= n) throw new Error('Invalid private key');
	if (r <= 0n || r >= n) throw new Error('Invalid scalar r');
	// If caller didn't provide P = p·G, compute it in compressed form (33 bytes)
	naturalPub = naturalPub ?? secp256k1.Point.BASE.multiply(p).toBytes(true);
	if (naturalPub.length !== 33) throw new Error('naturalPub must be 33 bytes');
	// Calculate both sk candidates for constant time (add/subtract is cheap)
	const skStd: bigint = (p + r) % n;
	const skNeg: bigint = (n - p + r) % n;
	// Return skStd if no blinded pubkey was provided to verify against
	if (!blindPubkey) {
		if (skStd === 0n) throw new Error('Derived secret key is zero');
		return numberToHexPadded64(skStd);
	}
	if (blindPubkey.length !== 33) throw new Error('blindPubkey must be 33 bytes');
	// Decode P′, compute R and unblind
	const P_ = secp256k1.Point.fromHex(bytesToHex(blindPubkey)); // valid point
	const R = secp256k1.Point.BASE.multiply(r); // R = r·G
	const P = P_.subtract(R); // P = P_ - R
	if (P.equals(secp256k1.Point.ZERO)) return null;
	// Check x only equality, using constant time compare
	const xP = P.toBytes(true).slice(1);
	const xNaturalPub = naturalPub.slice(1);
	if (!Bytes.equals(xP, xNaturalPub)) {
		return null; // this P' is not for this privkey
	}
	// Select by parity, comparing the low bit only
	const yP = P.toBytes(true)[0] & 1;
	const yNaturalPub = naturalPub[0] & 1;
	const out = yP === yNaturalPub ? skStd : skNeg;
	if (out === 0n) throw new Error('Derived secret key is zero');
	return numberToHexPadded64(out);
}

/**
 * Internal helper, derive P2BK blinding tweak using ECDH.
 *
 * @remarks
 * Computes the shared point Z = scalar·point, takes its 32 byte x coordinate Zx, then derives:
 *
 *     rᵢ = SHA - 256(P2BK_DST || Zx || keysetId || i); // all inputs as raw bytes
 *
 * If the result reduces to zero, or is >= curve order (n), retries once with an extra 0xff byte
 * appended to the message. Throws if the retry also reduces to zero.
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
 * @experimental
 */
function deriveP2BKBlindingTweakFromECDH(
	point: WeierstrassPoint<bigint>, // E or P
	scalar: bigint, // p or e
	keysetId: Uint8Array, // kid
	slotIndex: number, // i
): bigint {
	// Calculate x-only ECDH shared point (Zx)
	const Zx = point.multiply(scalar).toBytes(true).slice(1);
	const iByte = new Uint8Array([slotIndex & 0xff]);
	// Derive deterministic blinding factor (r):
	let r = bytesToNumber(sha256(Bytes.concat(P2BK_DST, Zx, keysetId, iByte)));
	if (r === 0n || r >= secp256k1.Point.CURVE().n) {
		// Very unlikely to get here!
		r = bytesToNumber(sha256(Bytes.concat(P2BK_DST, Zx, keysetId, iByte, new Uint8Array([0xff]))));
		if (r === 0n || r >= secp256k1.Point.CURVE().n) {
			throw new Error('P2BK: tweak derivation failed');
		}
	}
	return r;
}
