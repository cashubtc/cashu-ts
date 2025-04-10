import { PrivKey, bytesToHex, hexToBytes } from '@noble/curves/abstract/utils';
import { sha256 } from '@noble/hashes/sha256';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1';
import { randomBytes } from '@noble/hashes/utils';
import { parseP2PKSecret } from '../common/NUT11.js';
import { Secret } from '../common/index.js';
import { type P2PKWitness, type Proof } from '../../model/types/index.js';
import { BlindedMessage } from './index.js';

export const createP2PKsecret = (pubkey: string): string => {
	const newSecret: Secret = [
		'P2PK',
		{
			nonce: bytesToHex(randomBytes(32)),
			data: pubkey
		}
	];
	return JSON.stringify(newSecret);
};

export const signP2PKSecret = (secret: string, privateKey: PrivKey): string => {
	const msghash = sha256(secret);
	const sig = schnorr.sign(msghash, privateKey);
	return bytesToHex(sig);
};

export const signBlindedMessage = (B_: string, privateKey: PrivKey): string => {
	const msgHash = sha256(B_);
	const sig = schnorr.sign(msgHash, privateKey);
	return bytesToHex(sig);
};

/**
 * Verifies a Schnorr signature on a P2PK secret.
 * @param signature - The Schnorr signature (hex-encoded).
 * @param secret - The Secret to verify.
 * @param pubkey - The Cashu P2PK public key (hex-encoded, X-only or with 02/03 prefix).
 * @returns {boolean} True if the signature is valid, false otherwise.
 */
export const verifyP2PKSecretSignature = (
	signature: string,
	secret: string,
	pubkey: string
): boolean => {
	try {
		const msghash = sha256(secret);
		// Use X-only pubkey: strip 02/03 prefix if pubkey is 66 hex chars (33 bytes)
		const pubkeyX = pubkey.length === 66 ? pubkey.slice(2) : pubkey;
		if (schnorr.verify(signature, msghash, hexToBytes(pubkeyX))) {
			return true;
		}
	} catch (e) {
		console.error('verifyP2PKsecret error:', e);
	}
	return false; // no bueno
};

/**
 * Verifies a pubkey has signed a P2PK Proof.
 * @param pubkey - The Cashu P2PK public key (hex-encoded, X-only or with 02/03 prefix).
 * @param proof - A Cashu proof
 * @returns {boolean} True if one of the signatures is theirs, false otherwise
 */
export const hasP2PKSignedProof = (pubkey: string, proof: Proof): boolean => {
	if (!proof.witness) {
		return false;
	}
	const signatures = getP2PKWitnessSignatures(proof.witness);
	// See if any of the signatures belong to this pubkey.
	// We need to do this as Schnorr signatures are non-deterministic.
	return signatures.some((sig) => {
		try {
			return verifyP2PKSecretSignature(sig, proof.secret, pubkey);
		} catch {
			return false; // Invalid signature, treat as not signed
		}
	});
};

/**
 * Returns the expected witness public keys from a NUT-11 P2PK secret
 * @param secretStr - The NUT-11 P2PK secret.
 * @returns {array} with the public keys or empty array
 */
export function getP2PKExpectedKWitnessPubkeys(secretStr: string | Secret): Array<string> {
	try {
		// Validate secret
		const secret: Secret = typeof secretStr === 'string' ? parseP2PKSecret(secretStr) : secretStr;
		if (secret[0] !== 'P2PK') {
			throw new Error('Invalid P2PK secret: must start with "P2PK"');
		}
		const { data, tags } = secret[1];
		const now = Math.floor(Date.now() / 1000);
		const locktime = getP2PKLocktime(secret);
		if (locktime > now) {
			// Am interpretting NUT-11 as intending pubkeys to be usable for a
			// 1-of-m multisig if provided, even if n_sigs is not set
			const pubkeysTag = tags && tags.find((tag) => tag[0] === 'pubkeys');
			const pubkeys = pubkeysTag && pubkeysTag.length > 1 ? pubkeysTag.slice(1) : [];
			return [data, ...pubkeys];
		}
		const refundTag = tags && tags.find((tag) => tag[0] === 'refund');
		const refundKeys = refundTag && refundTag.length > 1 ? refundTag.slice(1) : [];
		if (refundKeys) {
			return refundKeys;
		}
	} catch {}
	return []; // Unlocked, malformed or expired with no refund keys
}

/**
 * Returns the locktime from a NUT-11 P2PK secret or Infinity if no locktime
 * @param secretStr - The NUT-11 P2PK secret.
 * @returns {number} The locktime unix timestamp or Infinity (permanent lock)
 */
export function getP2PKLocktime(secretStr: string | Secret): number {
	// Validate secret
	const secret: Secret = typeof secretStr === 'string' ? parseP2PKSecret(secretStr) : secretStr;
	if (secret[0] !== 'P2PK') {
		throw new Error('Invalid P2PK secret: must start with "P2PK"');
	}
	const { tags } = secret[1];
	const locktimeTag = tags && tags.find((tag) => tag[0] === 'locktime');
	return locktimeTag && locktimeTag.length > 1 ? parseInt(locktimeTag[1], 10) : Infinity; // Permanent lock if not set
}

/**
 * Returns the number of signatures required from a NUT-11 P2PK secret
 * @param secretStr - The NUT-11 P2PK secret.
 * @returns {number} The number of signatories (n_sigs / n_sigs_refund) or 0 if secret is unlocked
 */
export function getP2PKNSigs(secretStr: string | Secret): number {
	// Validate secret
	const secret: Secret = typeof secretStr === 'string' ? parseP2PKSecret(secretStr) : secretStr;
	if (secret[0] !== 'P2PK') {
		throw new Error('Invalid P2PK secret: must start with "P2PK"');
	}
	// Check for witnesses
	const witness = getP2PKExpectedKWitnessPubkeys(secret);
	if (!witness.length) {
		return 0; // unlocked if no witnesses needed
	}
	// Check for Lock multisig
	const { tags } = secret[1];
	const now = Math.floor(Date.now() / 1000);
	const locktime = getP2PKLocktime(secret);
	if (locktime > now) {
		const n_sigsTag = tags && tags.find((tag) => tag[0] === 'n_sigs');
		return n_sigsTag && n_sigsTag.length > 1 ? parseInt(n_sigsTag[1], 10) : 1; // Default: 1
	}
	// Refund multisig
	const n_sigs_refundTag = tags && tags.find((tag) => tag[0] === 'n_sigs_refund');
	return n_sigs_refundTag && n_sigs_refundTag.length > 1 ? parseInt(n_sigs_refundTag[1], 10) : 1; // Default: 1
}

/**
 * Returns the sigflag from a NUT-11 P2PK secret
 * @param secretStr - The NUT-11 P2PK secret.
 * @returns {string} The sigflag or 'SIG_INPUTS' (default)
 */
export function getP2PKSigFlag(secretStr: string | Secret): string {
	// Validate secret
	const secret: Secret = typeof secretStr === 'string' ? parseP2PKSecret(secretStr) : secretStr;
	if (secret[0] !== 'P2PK') {
		throw new Error('Invalid P2PK secret: must start with "P2PK"');
	}
	const { tags } = secret[1];
	const sigFlagTag = tags && tags.find((tag) => tag[0] === 'sigflag');
	return sigFlagTag && sigFlagTag.length > 1 ? sigFlagTag[1] : 'SIG_INPUTS';
}

/**
 * Gets witness signatures as an array
 * @type {array} of signatures
 */
export const getP2PKWitnessSignatures = (
	witness: string | P2PKWitness | undefined
): Array<string> => {
	if (!witness) return [];
	if (typeof witness === 'string') {
		try {
			return JSON.parse(witness).signatures || [];
		} catch (e) {
			console.error('Failed to parse witness string:', e);
			return [];
		}
	}
	return witness.signatures || [];
};

/**
 * Signs proofs with provided private key(s) if required
 * NB: Will only sign if the proof requires a signature from the key
 * @param proofs - An array of proofs to sign
 * @param privateKey - a single private key, or array of private keys
 */
export const signP2PKProofs = (
	proofs: Array<Proof>,
	privateKey: string | Array<string>
): Array<Proof> => {
	const privateKeys: Array<string> = Array.isArray(privateKey) ? privateKey : [privateKey];
	return proofs.map((proof) => {
		try {
			let signedProof = proof;
			for (const priv of privateKeys) {
				signedProof = signP2PKProof(signedProof, priv);
			}
			return signedProof;
		} catch {
			return proof;
		}
	});
};

/**
 * Signs a single proof with the provided private key if required
 * NB: Will only sign if the proof requires a signature from the key
 * @param proof - A proof to sign
 * @param privateKey - a single private key
 */
export const signP2PKProof = (proof: Proof, privateKey: string): Proof => {
	// Check secret is P2PK
	const parsed: Secret = parseP2PKSecret(proof.secret);
	if (parsed[0] !== 'P2PK') {
		throw new Error('not a P2PK secret');
	}
	// Check if the private key is required to sign by checking its
	// X-only pubkey (no 02/03 prefix) against the expected witness pubkeys
	// NB: Nostr pubkeys prepend 02 by convention, ignoring actual Y-parity
	const pubkey = bytesToHex(schnorr.getPublicKey(privateKey)); // x-only
	const witnesses = getP2PKExpectedKWitnessPubkeys(parsed);
	if (!witnesses.length || !witnesses.some((w) => w.includes(pubkey))) {
		console.warn(`Signature not required from [02|03]${pubkey}`);
		return proof; // nothing to sign
	}
	// Check if the public key has already signed
	const signatures = getP2PKWitnessSignatures(proof.witness);
	const alreadySigned = signatures.some((sig) => {
		try {
			return verifyP2PKSecretSignature(sig, proof.secret, pubkey);
		} catch {
			return false; // Invalid signature, treat as not signed
		}
	});
	if (alreadySigned) {
		console.warn(`Proof already signed by [02|03]${pubkey}`);
		return proof; // Skip signing if pubkey has a valid signature
	}
	// Add new signature
	const signature = signP2PKSecret(proof.secret, privateKey);
	signatures.push(signature);
	return { ...proof, witness: { signatures } };
};

export const getSignedOutput = (output: BlindedMessage, privateKey: PrivKey): BlindedMessage => {
	const B_ = output.B_.toHex(true);
	const signature = signBlindedMessage(B_, privateKey);
	output.witness = { signatures: [signature] };
	return output;
};

export const getSignedOutputs = (
	outputs: Array<BlindedMessage>,
	privateKey: string
): Array<BlindedMessage> => {
	return outputs.map((o) => getSignedOutput(o, privateKey));
};
