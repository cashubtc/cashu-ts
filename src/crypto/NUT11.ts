import { type PrivKey, bytesToHex, hexToBytes, randomBytes } from '@noble/curves/utils';
import { sha256 } from '@noble/hashes/sha2';
import { schnorr } from '@noble/curves/secp256k1';
import { type P2PKWitness, type Proof } from '../model/types';
import { type BlindedMessage } from './core';
import { type Logger, NULL_LOGGER } from '../logger';

export type SigFlag = 'SIG_INPUTS' | 'SIG_ALL';

export type Secret = [WellKnownSecret, SecretData];

export type WellKnownSecret = 'P2PK';

export type SecretData = {
	nonce: string;
	data: string;
	tags?: string[][];
};

export const createP2PKsecret = (pubkey: string): string => {
	const newSecret: Secret = [
		'P2PK',
		{
			nonce: bytesToHex(randomBytes(32)),
			data: pubkey,
		},
	];
	return JSON.stringify(newSecret);
};

export const parseP2PKSecret = (secret: string | Uint8Array): Secret => {
	try {
		if (secret instanceof Uint8Array) {
			secret = new TextDecoder().decode(secret);
		}
		return JSON.parse(secret) as Secret;
	} catch {
		throw new Error("can't parse secret");
	}
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
 *
 * @param signature - The Schnorr signature (hex-encoded).
 * @param secret - The Secret to verify.
 * @param pubkey - The Cashu P2PK public key (hex-encoded, X-only or with 02/03 prefix).
 * @returns {boolean} True if the signature is valid, false otherwise.
 */
export const verifyP2PKSecretSignature = (
	signature: string,
	secret: string,
	pubkey: string,
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
 *
 * @param pubkey - The Cashu P2PK public key (hex-encoded, X-only or with 02/03 prefix).
 * @param proof - A Cashu proof.
 * @returns {boolean} True if one of the signatures is theirs, false otherwise.
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
 * Returns the expected witness public keys from a NUT-11 P2PK secret.
 *
 * @param secretStr - The NUT-11 P2PK secret.
 * @returns {array} With the public keys or empty array.
 */
export function getP2PKExpectedKWitnessPubkeys(secretStr: string | Secret): string[] {
	try {
		// Validate secret
		const secret: Secret = typeof secretStr === 'string' ? parseP2PKSecret(secretStr) : secretStr;
		if (secret[0] !== 'P2PK') {
			throw new Error('Invalid P2PK secret: must start with "P2PK"');
		}
		const now = Math.floor(Date.now() / 1000);
		const locktime = getP2PKLocktime(secret);
		if (locktime > now) {
			// Am interpretting NUT-11 as intending pubkeys to be usable for a
			// 1-of-m multisig if provided, even if n_sigs is not set
			return getP2PKWitnessPubkeys(secret);
		}
		return getP2PKWitnessRefundkeys(secret);
	} catch {
		// do nothing
	}
	return []; // Unlocked, malformed or expired with no refund keys
}

/**
 * Returns ALL locktime witnesses from a NUT-11 P2PK secret NB: Does not specify if they are
 * expected to sign - see: getP2PKExpectedKWitnessPubkeys()
 *
 * @param secretStr - The NUT-11 P2PK secret.
 * @returns {array} With the public key(s or empty array.
 */
export function getP2PKWitnessPubkeys(secretStr: string | Secret): string[] {
	// Validate secret
	const secret: Secret = typeof secretStr === 'string' ? parseP2PKSecret(secretStr) : secretStr;
	if (secret[0] !== 'P2PK') {
		throw new Error('Invalid P2PK secret: must start with "P2PK"');
	}
	const { data, tags } = secret[1];
	const pubkeysTag = tags && tags.find((tag) => tag[0] === 'pubkeys');
	const pubkeys = pubkeysTag && pubkeysTag.length > 1 ? pubkeysTag.slice(1) : [];
	return [data, ...pubkeys].filter(Boolean);
}

/**
 * Returns ALL refund witnesses from a NUT-11 P2PK secret NB: Does not specify if they are expected
 * to sign - see: getP2PKExpectedKWitnessPubkeys()
 *
 * @param secretStr - The NUT-11 P2PK secret.
 * @returns {array} With the public keys or empty array.
 */
export function getP2PKWitnessRefundkeys(secretStr: string | Secret): string[] {
	// Validate secret
	const secret: Secret = typeof secretStr === 'string' ? parseP2PKSecret(secretStr) : secretStr;
	if (secret[0] !== 'P2PK') {
		throw new Error('Invalid P2PK secret: must start with "P2PK"');
	}
	const { tags } = secret[1];
	const refundTag = tags && tags.find((tag) => tag[0] === 'refund');
	return refundTag && refundTag.length > 1 ? refundTag.slice(1).filter(Boolean) : [];
}

/**
 * Returns the locktime from a NUT-11 P2PK secret or Infinity if no locktime.
 *
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
 * Returns the number of signatures required from a NUT-11 P2PK secret.
 *
 * @param secretStr - The NUT-11 P2PK secret.
 * @returns {number} The number of signatories (n_sigs / n_sigs_refund) or 0 if secret is unlocked.
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
 * Returns the sigflag from a NUT-11 P2PK secret.
 *
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
	return sigFlagTag && sigFlagTag.length > 1 ? (sigFlagTag[1] as SigFlag) : 'SIG_INPUTS';
}

/**
 * Gets witness signatures as an array.
 *
 * @param witness From Proof.
 * @returns Array of witness signatures.
 */
export const getP2PKWitnessSignatures = (witness: string | P2PKWitness | undefined): string[] => {
	if (!witness) return [];
	if (typeof witness === 'string') {
		try {
			const parsed = JSON.parse(witness) as P2PKWitness;
			return parsed.signatures || [];
		} catch (e) {
			console.error('Failed to parse witness string:', e);
			return [];
		}
	}
	return witness.signatures || [];
};

/**
 * Signs proofs with provided private key(s) if required NB: Will only sign if the proof requires a
 * signature from the key.
 *
 * @param proofs - An array of proofs to sign.
 * @param privateKey - A single private key or array of private keys.
 * @param logger - Optional logger (default: NULL_LOGGER)
 */
export const signP2PKProofs = (
	proofs: Proof[],
	privateKey: string | string[],
	logger: Logger = NULL_LOGGER,
): Proof[] => {
	return proofs.map((proof, index) => {
		try {
			const privateKeys: string[] = Array.isArray(privateKey) ? privateKey : [privateKey];
			let signedProof = proof;
			for (const priv of privateKeys) {
				try {
					signedProof = signP2PKProof(signedProof, priv);
				} catch (error: unknown) {
					// Log signature failures only - these are not fatal, just informational
					// as not all keys will be needed for some proofs (eg P2BK, NIP60 etc)
					const message = error instanceof Error ? error.message : 'Unknown error';
					logger.warn(`Proof #${index + 1}: ${message}`);
				}
			}
			return signedProof;
		} catch (error: unknown) {
			// General errors
			const message = error instanceof Error ? error.message : 'Unknown error';
			logger.error(`Proof #${index + 1}: ${message}`);
			throw new Error(`Failed signing proof #${index + 1}: ${message}`);
		}
	});
};

/**
 * Signs a single proof with the provided private key if required NB: Will only sign if the proof
 * requires a signature from the key.
 *
 * @param proof - A proof to sign.
 * @param privateKey - A single private key.
 * @throws Error if signature is not required or proof is already signed.
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
		throw new Error(`Signature not required from [02|03]${pubkey}`);
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
		throw new Error(`Proof already signed by [02|03]${pubkey}`);
	}
	// Add new signature
	const signature = signP2PKSecret(proof.secret, privateKey);
	signatures.push(signature);
	return { ...proof, witness: { signatures } };
};

export const verifyP2PKSig = (proof: Proof): boolean => {
	if (!proof.witness) {
		throw new Error('could not verify signature, no witness provided');
	}
	const parsedSecret = parseP2PKSecret(proof.secret);
	const witnesses = getP2PKExpectedKWitnessPubkeys(parsedSecret);
	if (!witnesses.length) {
		throw new Error('no signatures required, proof is unlocked');
	}
	let signatories = 0;
	const requiredSigs = getP2PKNSigs(parsedSecret);
	const signatures = getP2PKWitnessSignatures(proof.witness);
	// Loop through witnesses to see if any of the signatures belong to them.
	// We need to do this as Schnorr signatures are non-deterministic, so we
	// count the number of valid witnesses, not the number of valid signatures
	for (const pubkey of witnesses) {
		const hasSigned = signatures.some((sig) => {
			try {
				return verifyP2PKSecretSignature(sig, proof.secret, pubkey);
			} catch {
				return false; // Invalid signature, treat as not signed
			}
		});
		if (hasSigned) {
			signatories++;
		}
	}
	if (signatories >= requiredSigs) {
		return true;
	}
	return false;
};

export const verifyP2PKSigOutput = (output: BlindedMessage, publicKey: string): boolean => {
	if (!output.witness?.signatures || output.witness.signatures.length === 0) {
		throw new Error('could not verify signature, no witness signatures provided');
	}
	return schnorr.verify(
		output.witness.signatures[0],
		sha256(output.B_.toHex(true)),
		publicKey.slice(2),
	);
};

export const getSignedOutput = (output: BlindedMessage, privateKey: PrivKey): BlindedMessage => {
	const B_ = output.B_.toHex(true);
	const signature = signBlindedMessage(B_, privateKey);
	output.witness = { signatures: [signature] };
	return output;
};

export const getSignedOutputs = (
	outputs: BlindedMessage[],
	privateKey: string,
): BlindedMessage[] => {
	return outputs.map((o) => getSignedOutput(o, privateKey));
};
