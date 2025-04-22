import { PrivKey, bytesToHex, hexToBytes } from '@noble/curves/abstract/utils';
import { sha256 } from '@noble/hashes/sha256';
import { schnorr, secp256k1 } from '@noble/curves/secp256k1';
import { randomBytes } from '@noble/hashes/utils';
import { parseSecret } from '../common/NUT11.js';
import { Proof, Secret } from '../common/index.js';
import { type P2PKWitness } from '../../model/types/index.js';
import { BlindedMessage } from './index.js';

export const createP2PKsecret = (pubkey: string): Uint8Array => {
	const newSecret: Secret = [
		'P2PK',
		{
			nonce: bytesToHex(randomBytes(32)),
			data: pubkey
		}
	];
	const parsed = JSON.stringify(newSecret);
	return new TextEncoder().encode(parsed);
};

export const signP2PKsecret = (secret: Uint8Array, privateKey: PrivKey): Uint8Array => {
	const msghash = sha256(new TextDecoder().decode(secret));
	const sig = schnorr.sign(msghash, privateKey);
	return sig;
};

export const signBlindedMessage = (B_: string, privateKey: PrivKey): Uint8Array => {
	const msgHash = sha256(B_);
	const sig = schnorr.sign(msgHash, privateKey);
	return sig;
};

/**
 * Verifies a Schnorr signature on a P2PK secret.
 * @param signature - The Schnorr signature (hex-encoded).
 * @param secret - The Secret to verify.
 * @param pubkey - The Cashu P2PK public key (hex-encoded, starting with 02 or 03).
 * @returns {boolean} True if the signature is valid, false otherwise.
 */
export const verifyP2PKSecretSignature = (
	signature: string,
	secret: Uint8Array,
	pubkey: string
): boolean => {
	try {
		const msghash = sha256(new TextDecoder().decode(secret));
		const pubkeyX = pubkey.slice(2);
		if (schnorr.verify(signature, msghash, hexToBytes(pubkeyX))) {
			return true;
		}
	} catch (e) {
		console.error('verifyP2PKsecret error:', e);
	}
	return false; // no bueno
};

/**
 * Returns the expected witness public keys from a NUT-11 P2PK secret
 * @param secret - The NUT-11 P2PK secret.
 * @returns {array} with the public keys or empty array
 */
export function getP2PKExpectedKWitnessPubkeys(secret: Secret): Array<string> {
	try {
		const now = Math.floor(Date.now() / 1000);
		const { data, tags } = secret[1];
		const locktime = getP2PKLocktime(secret);
		const n_sigsTag = tags && tags.find((tag) => tag[0] === 'n_sigs');
		const n_sigs = n_sigsTag && n_sigsTag.length > 1 ? parseInt(n_sigsTag[1], 10) : null;
		if (locktime > now) {
			// NB: Am interpretting NUT-11 as intending the pubkeys tag is only used
			// if n_sigs is a positive integer. Otherwise we can just return
			// [data, ...pubkeys] when locktime > now
			if (n_sigs && n_sigs >= 1) {
				const pubkeysTag = tags && tags.find((tag) => tag[0] === 'pubkeys');
				const pubkeys = pubkeysTag && pubkeysTag.length > 1 ? pubkeysTag.slice(1) : [];
				return [data, ...pubkeys];
			}
			return [data];
		}
		const refundTag = tags && tags.find((tag) => tag[0] === 'refund');
		const refundKeys = refundTag && refundTag.length > 1 ? refundTag.slice(1) : [];
		if (refundKeys) {
			return refundKeys;
		}
	} catch {}
	return []; // Unlocked or expired with no refund keys
}

/**
 * Returns the locktime from a NUT-11 P2PK secret or Infinity if no locktime
 * @param secret - The NUT-11 P2PK secret.
 * @returns {number} The locktime unix timestamp or Infinity (permanent lock)
 */
export function getP2PKLocktime(secret: Secret): number {
	// Validate secret format
	if (secret[0] !== 'P2PK') {
		throw new Error('Invalid P2PK secret: must start with "P2PK"');
	}
	const { tags } = secret[1];
	const locktimeTag = tags && tags.find((tag) => tag[0] === 'locktime');
	return locktimeTag && locktimeTag.length > 1 ? parseInt(locktimeTag[1], 10) : Infinity; // Permanent lock if not set
}

/**
 * Returns the number of signatures required from a NUT-11 P2PK secret
 * @param secret - The NUT-11 P2PK secret.
 * @returns {number} The number of signatories (n_sigs / n_sigs_refund) or 0 if secret is unlocked
 */
export function getP2PKNSigs(secret: Secret): number {
	// Validate secret format
	if (secret[0] !== 'P2PK') {
		throw new Error('Invalid P2PK secret: must start with "P2PK"');
	}
	const now = Math.floor(Date.now() / 1000);
	const witness = getP2PKExpectedKWitnessPubkeys(secret);
	const locktime = getP2PKLocktime(secret);
	const { tags } = secret[1];
	// Check lock multisig
	const n_sigsTag = tags && tags.find((tag) => tag[0] === 'n_sigs');
	const n_sigs = n_sigsTag && n_sigsTag.length > 1 ? parseInt(n_sigsTag[1], 10) : 1; // Default: 1
	if (locktime > now) {
		return n_sigs; // locked
	}
	// Check refund multisig
	const n_sigs_refundTag = tags && tags.find((tag) => tag[0] === 'n_sigs_refund');
	const n_sigs_refund =
		n_sigs_refundTag && n_sigs_refundTag.length > 1 ? parseInt(n_sigs_refundTag[1], 10) : 1; // Default: 1
	return witness.length > 0 ? n_sigs_refund : 0; // unlocked if no witnesses needed
}

/**
 * Returns the sigflag from a NUT-11 P2PK secret
 * @param secret - The NUT-11 P2PK secret.
 * @returns {string} The sigflag or 'SIG_INPUTS' (default)
 */
export function getP2PKSigFlag(secret: Secret): string {
	// Validate secret format
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
export const getSignatures = (witness: string | P2PKWitness | undefined): Array<string> => {
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
export const getSignedProofs = (
	proofs: Array<Proof>,
	privateKey: string | Array<string>
): Array<Proof> => {
	const privateKeys: Array<string> = Array.isArray(privateKey) ? privateKey : [privateKey];
	return proofs.map((proof) => {
		try {
			let signedProof = proof;
			for (const priv of privateKeys) {
				signedProof = getSignedProof(signedProof, priv);
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
export const getSignedProof = (proof: Proof, privateKey: string): Proof => {
	// Check secret is P2PK
	const parsed: Secret = parseSecret(proof.secret);
	if (parsed[0] !== 'P2PK') {
		throw new Error('not a P2PK secret');
	}
	// Check this pubkey is required to sign
	const pubkey = bytesToHex(secp256k1.getPublicKey(privateKey)); // for Cashu
	const witnesses = getP2PKExpectedKWitnessPubkeys(parsed);
	if (!witnesses.length || !witnesses.includes(pubkey)) {
		return proof; // nothing to sign
	}
	// Check if this pubkey has already signed
	const signatures = getSignatures(proof.witness);
	const alreadySigned = signatures.some((sig) => {
		try {
			return verifyP2PKSecretSignature(sig, proof.secret, pubkey);
		} catch {
			return false; // Invalid signature, treat as not signed
		}
	});
	if (alreadySigned) {
		return proof; // Skip signing if pubkey has a valid signature
	}
	// Add new signature
	const signature = signP2PKsecret(proof.secret, privateKey);
	signatures.push(bytesToHex(signature));
	return { ...proof, witness: { signatures } };
};

export const getSignedOutput = (output: BlindedMessage, privateKey: PrivKey): BlindedMessage => {
	const B_ = output.B_.toHex(true);
	const signature = signBlindedMessage(B_, privateKey);
	output.witness = { signatures: [bytesToHex(signature)] };
	return output;
};

export const getSignedOutputs = (
	outputs: Array<BlindedMessage>,
	privateKey: string
): Array<BlindedMessage> => {
	return outputs.map((o) => getSignedOutput(o, privateKey));
};
