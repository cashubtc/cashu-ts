import { type PrivKey, bytesToHex, hexToBytes, randomBytes } from '@noble/curves/utils';
import { sha256 } from '@noble/hashes/sha2';
import { schnorr } from '@noble/curves/secp256k1';
import { type P2PKWitness, type Proof } from '../model/types';
import { deriveP2BKSecretKeys } from './NUT26';
import { type Logger, NULL_LOGGER } from '../logger';
import { type OutputDataLike } from '../model/OutputData';

export type SigFlag = 'SIG_INPUTS' | 'SIG_ALL';

export type Secret = [WellKnownSecret, SecretData];

export type WellKnownSecret = 'P2PK';

export type SecretData = {
	nonce: string;
	data: string;
	tags?: string[][];
};

/**
 * Validates proof secret is P2PK.
 *
 * @param secretStr - The Proof secret.
 * @throws If secret is not P2PK.
 * @internal
 */
const validateP2PKSecret = (secretStr: string | Secret): Secret => {
	const secret: Secret = typeof secretStr === 'string' ? parseP2PKSecret(secretStr) : secretStr;
	if (secret[0] !== 'P2PK') {
		throw new Error('Invalid P2PK secret: must start with "P2PK"');
	}
	return secret;
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

/**
 * Signs a P2PK secret using Schnorr.
 *
 * @remarks
 * Signatures are non-deterministic because schnorr.sign() generates a new random auxiliary value
 * (auxRand) each time it is called.
 */
export const signP2PKSecret = (secret: string, privateKey: PrivKey): string => {
	const msghash = sha256(new TextEncoder().encode(secret));
	const sig = schnorr.sign(msghash, privateKey); // auxRand is random by default
	return bytesToHex(sig);
};

/**
 * Verifies a Schnorr signature on a P2PK secret.
 *
 * @param signature - The Schnorr signature (hex-encoded).
 * @param secret - The Secret to verify.
 * @param pubkey - The Cashu P2PK public key (hex-encoded, X-only or with 02/03 prefix).
 * @returns True if the signature is valid, false otherwise.
 */
export const verifyP2PKSecretSignature = (
	signature: string,
	secret: string,
	pubkey: string,
): boolean => {
	try {
		const msghash = sha256(new TextEncoder().encode(secret));
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
 * @returns True if one of the signatures is theirs, false otherwise.
 */
export const hasP2PKSignedProof = (pubkey: string, proof: Proof): boolean => {
	if (!proof.witness) {
		return false;
	}
	const signatures = getP2PKWitnessSignatures(proof.witness);
	// See if any of the signatures belong to this pubkey. We need to do this
	// as Schnorr signatures are non-deterministic (see: signP2PKSecret)
	return signatures.some((sig) => {
		return verifyP2PKSecretSignature(sig, proof.secret, pubkey);
	});
};

/**
 * Returns the expected witness public keys from a NUT-11 P2PK secret.
 *
 * @param secretStr - The NUT-11 P2PK secret.
 * @returns Array of public keys or empty array.
 * @throws If secret is not P2PK.
 */
export function getP2PKExpectedKWitnessPubkeys(secretStr: string | Secret): string[] {
	try {
		const secret: Secret = validateP2PKSecret(secretStr);
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
 * @returns Array of public key(s or empty array.
 * @throws If secret is not P2PK.
 */
export function getP2PKWitnessPubkeys(secretStr: string | Secret): string[] {
	const secret: Secret = validateP2PKSecret(secretStr);
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
 * @returns Array of public keys or empty array.
 * @throws If secret is not P2PK.
 */
export function getP2PKWitnessRefundkeys(secretStr: string | Secret): string[] {
	const secret: Secret = validateP2PKSecret(secretStr);
	const { tags } = secret[1];
	const refundTag = tags && tags.find((tag) => tag[0] === 'refund');
	return refundTag && refundTag.length > 1 ? refundTag.slice(1).filter(Boolean) : [];
}

/**
 * Returns the locktime from a NUT-11 P2PK secret or Infinity if no locktime.
 *
 * @param secretStr - The NUT-11 P2PK secret.
 * @returns The locktime unix timestamp or Infinity (permanent lock)
 * @throws If secret is not P2PK.
 */
export function getP2PKLocktime(secretStr: string | Secret): number {
	const secret: Secret = validateP2PKSecret(secretStr);
	const { tags } = secret[1];
	const locktimeTag = tags && tags.find((tag) => tag[0] === 'locktime');
	return locktimeTag && locktimeTag.length > 1 ? parseInt(locktimeTag[1], 10) : Infinity; // Permanent lock if not set
}

/**
 * Returns the number of signatures required from a NUT-11 P2PK secret.
 *
 * @param secretStr - The NUT-11 P2PK secret.
 * @returns The number of signatories (n_sigs / n_sigs_refund) or 0 if secret is unlocked.
 * @throws If secret is not P2PK.
 */
export function getP2PKNSigs(secretStr: string | Secret): number {
	const secret: Secret = validateP2PKSecret(secretStr);
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
 * @returns The sigflag or 'SIG_INPUTS' (default)
 * @throws If secret is not P2PK.
 */
export function getP2PKSigFlag(secretStr: string | Secret): SigFlag {
	const secret: Secret = validateP2PKSecret(secretStr);
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
 * Signs proofs with provided private key(s) if required.
 *
 * @remarks
 * NB: Will only sign if the proof requires a signature from the key.
 * @param proofs - An array of proofs to sign.
 * @param privateKey - A single private key or array of private keys.
 * @param logger - Optional logger (default: NULL_LOGGER)
 * @param message - Optional. The message to sign (for SIG_ALL)
 * @returns Signed proofs.
 * @throws On general errors.
 */
export const signP2PKProofs = (
	proofs: Proof[],
	privateKey: string | string[],
	logger: Logger = NULL_LOGGER,
	message?: string,
): Proof[] => {
	return proofs.map((proof, index) => {
		const privateKeys: string[] = maybeDeriveP2BKPrivateKeys(privateKey, proof);
		let signedProof = proof;
		for (const priv of privateKeys) {
			try {
				signedProof = signP2PKProof(signedProof, priv, message);
			} catch (error: unknown) {
				// Log signature failures only - these are not fatal, just informational
				// as not all keys will be needed for some proofs (eg P2BK, NIP60 etc)
				const message = error instanceof Error ? error.message : 'Unknown error';
				logger.warn(`Proof #${index + 1}: ${message}`);
			}
		}
		return signedProof;
	});
};

/**
 * Signs a single proof with the provided private key if required.
 *
 * @remarks
 * Will only sign if the proof requires a signature from the key.
 * @param proof - A proof to sign.
 * @param privateKey - A single private key.
 * @param message - Optional. The message to sign (for SIG_ALL)
 * @returns Signed proofs.
 * @throws Error if signature is not required or proof is already signed.
 */
export const signP2PKProof = (proof: Proof, privateKey: string, message?: string): Proof => {
	const secret: Secret = validateP2PKSecret(proof.secret);
	message = message ?? proof.secret; // default message is secret

	// Check if the private key is required to sign by checking its
	// X-only pubkey (no 02/03 prefix) against the expected witness pubkeys
	// NB: Nostr pubkeys prepend 02 by convention, ignoring actual Y-parity
	const pubkey = bytesToHex(schnorr.getPublicKey(privateKey)); // x-only
	const witnesses = getP2PKExpectedKWitnessPubkeys(secret);
	if (!witnesses.length || !witnesses.some((w) => w.includes(pubkey))) {
		throw new Error(`Signature not required from [02|03]${pubkey}`);
	}
	// Check if the public key has already signed
	const signatures = getP2PKWitnessSignatures(proof.witness);
	const alreadySigned = signatures.some((sig) => {
		return verifyP2PKSecretSignature(sig, message, pubkey);
	});
	if (alreadySigned) {
		throw new Error(`Proof already signed by [02|03]${pubkey}`);
	}
	// Add new signature
	const signature = signP2PKSecret(message, privateKey);
	return { ...proof, witness: { signatures: [...signatures, signature] } };
};

export const verifyP2PKSig = (proof: Proof): boolean => {
	if (!proof.witness) {
		throw new Error('could not verify signature, no witness provided');
	}
	const secret: Secret = parseP2PKSecret(proof.secret);
	const witnesses = getP2PKExpectedKWitnessPubkeys(secret);
	if (!witnesses.length) {
		throw new Error('no signatures required, proof is unlocked');
	}
	let signatories = 0;
	const requiredSigs = getP2PKNSigs(secret);
	const signatures = getP2PKWitnessSignatures(proof.witness);
	// Loop through witnesses to see if any of the signatures belong to them.
	// We need to do this as Schnorr signatures are non-deterministic
	// (see: signP2PKSecret), so we count the number of valid witnesses,
	// not the number of valid signatures
	for (const pubkey of witnesses) {
		const hasSigned = signatures.some((sig) => {
			return verifyP2PKSecretSignature(sig, proof.secret, pubkey);
		});
		if (hasSigned) {
			signatories++;
		}
	}
	return signatories >= requiredSigs;
};

/**
 * Derives blinded secret keys for a P2BK proof.
 *
 * @remarks
 * Calculates the deterministic blinding factor for each P2PK pubkey (data, pubkeys, refund) and
 * calling our parity-aware derivation.
 * @param privateKey Secret key (or array of secret keys)
 * @param proof The proof.
 * @returns Deduplicated list of derived secret keys (hex, 64 chars)
 * @experimental
 */
export function maybeDeriveP2BKPrivateKeys(privateKey: string | string[], proof: Proof): string[] {
	const privs = Array.isArray(privateKey) ? privateKey : [privateKey];
	const Ehex: string | undefined = proof?.p2pk_e;
	if (!Ehex) {
		return Array.from(new Set(privs));
	}
	// Extract pubkeys and keyset ID from proof
	const secret = parseP2PKSecret(proof.secret);
	const pubs = [...getP2PKWitnessPubkeys(secret), ...getP2PKWitnessRefundkeys(secret)];
	const kid = proof.id; // keyset id is hex
	return deriveP2BKSecretKeys(Ehex, privs, pubs, kid);
}

/**
 * Validates SIG_ALL inputs have matching secrets and tags.
 *
 * @param inputs Array of Proofs.
 * @throws If proofs are not valid for SIG_ALL.
 * @internal
 */
export function assertSigAllInputs(inputs: Proof[]): void {
	if (inputs.length === 0) throw new Error('No proofs');
	// Check first proof
	const first = parseP2PKSecret(inputs[0].secret);
	if (first[0] !== 'P2PK') throw new Error('Not a P2PK secret');
	if (getP2PKSigFlag(first) !== 'SIG_ALL') throw new Error('First proof is not SIG_ALL');
	const data0 = first[1].data;
	const tags0 = JSON.stringify(first[1].tags ?? []);
	// Compare remaining proofs
	for (let i = 1; i < inputs.length; i++) {
		const si = parseP2PKSecret(inputs[i].secret);
		if (si[0] !== 'P2PK') throw new Error(`Proof #${i + 1} is not P2PK`);
		if (getP2PKSigFlag(si) !== 'SIG_ALL') throw new Error(`Proof #${i + 1} is not SIG_ALL`);
		if (si[1].data !== data0) throw new Error('SIG_ALL inputs must share identical Secret.data');
		if (JSON.stringify(si[1].tags ?? []) !== tags0)
			throw new Error('SIG_ALL inputs must share identical Secret.tags');
	}
}

/**
 * Message aggregation for SIG_ALL.
 *
 * @remarks
 * Melt transactions MUST include the quoteId.
 * @param inputs Array of Proofs.
 * @param outputs Array of OutputDataLike objects (OutputData, Factory etc).
 * @param quoteId Optional. Quote id for Melt transactions.
 * @internal
 */
export function buildP2PKSigAllMessage(
	inputs: Proof[],
	outputs: OutputDataLike[],
	quoteId?: string,
): string {
	const parts: string[] = [];
	// Concat inputs: secret_0 || C_0 ...
	for (const p of inputs) {
		parts.push(p.secret, p.C);
	}
	// Concat outputs: amount_0 ||  B_0 ...
	for (const o of outputs) {
		parts.push(String(o.blindedMessage.amount), o.blindedMessage.B_);
	}
	// Add quoteId for melts
	if (quoteId) {
		parts.push(quoteId);
	}
	return parts.join('');
}

/**
 * Message aggregation for SIG_ALL (interim format).
 *
 * @remarks
 * Melt transactions MUST include the quoteId.
 * @param inputs Array of Proofs.
 * @param outputs Array of OutputDataLike objects (OutputData, Factory etc).
 * @param quoteId Optional. Quote id for Melt transactions.
 * @internal
 */
export function buildInterimP2PKSigAllMessage(
	inputs: Proof[],
	outputs: OutputDataLike[],
	quoteId?: string,
): string {
	const parts: string[] = [];
	// Concat inputs: secret_0 || C_0 ...
	for (const p of inputs) {
		parts.push(p.secret, p.C);
	}
	// Concat outputs: amount_0 || id_0 || B_0 ...
	for (const o of outputs) {
		parts.push(String(o.blindedMessage.amount), o.blindedMessage.id, o.blindedMessage.B_);
	}
	// Add quoteId for melts
	if (quoteId) {
		parts.push(quoteId);
	}
	return parts.join('');
}

/**
 * Message aggregation for SIG_ALL (legacy format).
 *
 * @remarks
 * Melt transactions MUST include the quoteId.
 * @param inputs Array of Proofs.
 * @param outputs Array of OutputDataLike objects (OutputData, Factory etc).
 * @param quoteId Optional. Quote id for Melt transactions.
 * @internal
 */
export function buildLegacyP2PKSigAllMessage(
	inputs: Proof[],
	outputs: OutputDataLike[],
	quoteId?: string,
): string {
	const parts: string[] = [];
	// Concat inputs: secret_0 ...
	for (const p of inputs) {
		parts.push(p.secret);
	}
	// Concat outputs: B_0 ...
	for (const o of outputs) {
		parts.push(o.blindedMessage.B_);
	}
	// Add quoteId for melts
	if (quoteId) {
		parts.push(quoteId);
	}
	return parts.join('');
}

/**
 * Check if proofs are SIG_ALL.
 *
 * @remarks
 * Returns true if ANY proof has SIG_ALL, false otherwise.
 * @param inputs Array of Proofs.
 * @internal
 */
export function isP2PKSigAll(inputs: Proof[]): boolean {
	return inputs.some((p) => {
		try {
			return getP2PKSigFlag(p.secret) === 'SIG_ALL';
		} catch {
			return false;
		}
	});
}
