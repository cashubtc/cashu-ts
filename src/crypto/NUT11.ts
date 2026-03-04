import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import { schnorr } from '@noble/curves/secp256k1.js';
import { type HTLCWitness, type P2PKWitness, type Proof } from '../model/types';
import { getValidSigners, schnorrSignMessage, schnorrVerifyMessage, type PrivKey } from './core';
import { deriveP2BKSecretKeys } from './NUT28';
import { type Logger, NULL_LOGGER } from '../logger';
import { type OutputDataLike } from '../model/OutputData';
import {
	getTagInt,
	getTagScalar,
	getDataField,
	getTag,
	assertSecretKind,
	createSecret,
	type Secret,
	getSecretKind,
} from './NUT10';

export type SigFlag = 'SIG_INPUTS' | 'SIG_ALL';

export type LockState = 'PERMANENT' | 'ACTIVE' | 'EXPIRED';

export type P2PKSpendingPath = 'MAIN' | 'REFUND' | 'UNLOCKED' | 'FAILED';

export interface P2PKVerificationResult {
	success: boolean;
	path: P2PKSpendingPath;
	lockState: LockState;
	requiredSigners: number;
	eligibleSigners: number;
	receivedSigners: string[]; // hex pubkeys that actually signed
}

/**
 * @internal
 */
type WitnessData = {
	preimage?: string;
	signatures: string[];
};

// ------------------------------
// NUT-11 Secrets
// ------------------------------

/**
 * Create a P2PK secret.
 *
 * @param pubkey - The pubkey to add to Secret.data.
 * @param tags - Optional. Additional P2PK tags.
 */
export function createP2PKsecret(pubkey: string, tags?: string[][]): string {
	return createSecret('P2PK', pubkey, tags);
}

/**
 * Parse a P2PK Secret and validate NUT-10 shape.
 *
 * @param secret - The Proof secret.
 * @returns Secret object.
 * @throws If the JSON is invalid or NUT-10 secret is malformed.
 */
export function parseP2PKSecret(secret: string | Secret): Secret;
/**
 * @deprecated Pass a string or Secret instead.
 */
export function parseP2PKSecret(secret: Uint8Array): Secret;
export function parseP2PKSecret(secret: string | Uint8Array | Secret): Secret {
	// Handle deprecated format
	if (secret instanceof Uint8Array) {
		secret = new TextDecoder().decode(secret);
	}
	// HTLC extends P2PK, so we include it in our expected list.
	return assertSecretKind(['P2PK', 'HTLC'], secret);
}

// ------------------------------
// Spending Condition Helpers
// ------------------------------

/**
 * Returns the expected witness public keys from a NUT-11 P2PK secret.
 *
 * @remarks
 * Does not tell you the pathway (Locktime or Refund MultiSig), only the keys that CAN currently
 * sign. If no keys are returned, the proof is unlocked.
 * @param secretStr - The NUT-11 P2PK secret.
 * @returns Array of public keys or empty array.
 * @throws If secret is not P2PK.
 */
export function getP2PKExpectedWitnessPubkeys(secretStr: string | Secret): string[] {
	try {
		const secret: Secret = parseP2PKSecret(secretStr); // decode JSON once
		const lockState: LockState = getP2PKLockState(secret);
		const locktimeKeys = getP2PKWitnessPubkeys(secret);
		const refundKeys = getP2PKWitnessRefundkeys(secret);

		// Locktime pathway active?
		if (lockState === 'ACTIVE' || lockState === 'PERMANENT') {
			return locktimeKeys;
		}

		// Refund pathway active?
		if (lockState === 'EXPIRED' && refundKeys.length) {
			const allKeys = [...locktimeKeys, ...refundKeys];
			return Array.from(new Set(allKeys));
		}
	} catch {
		// do nothing
	}
	return []; // Unlocked, malformed or expired with no refund keys
}

/**
 * Returns ALL locktime witnesses from a NUT-11 P2PK secret NB: Does not specify if they are
 * expected to sign - see: getP2PKExpectedWitnessPubkeys()
 *
 * @param secretStr - The NUT-11 P2PK secret.
 * @returns Array of public key(s or empty array.
 * @throws If secret is not P2PK.
 */
export function getP2PKWitnessPubkeys(secretStr: string | Secret): string[] {
	const secret = parseP2PKSecret(secretStr); // decode JSON once

	// Add data field if P2PK
	let data: string = '';
	if (getSecretKind(secret) === 'P2PK') {
		data = getDataField(secret);
	}

	// Add pubkeys
	const pubkeys = getTag(secret, 'pubkeys') ?? [];
	const allKeys = [data, ...pubkeys].filter(Boolean); // filter empty
	return Array.from(new Set(allKeys)); // unique keys
}

/**
 * Returns ALL refund witnesses from a NUT-11 P2PK secret NB: Does not specify if they are expected
 * to sign - see: getP2PKExpectedWitnessPubkeys()
 *
 * @param secretStr - The NUT-11 P2PK secret.
 * @returns Array of public keys or empty array.
 * @throws If secret is not P2PK.
 */
export function getP2PKWitnessRefundkeys(secretStr: string | Secret): string[] {
	const secret = parseP2PKSecret(secretStr);
	return getTag(secret, 'refund') ?? [];
}

/**
 * Returns the locktime from a NUT-11 P2PK secret or Infinity if no locktime.
 *
 * @param secretStr - The NUT-11 P2PK secret.
 * @returns The locktime unix timestamp or Infinity (permanent lock)
 * @throws If secret is not P2PK.
 */
export function getP2PKLocktime(secretStr: string | Secret): number {
	const secret = parseP2PKSecret(secretStr);
	const ts = getTagInt(secret, 'locktime');
	if (ts === undefined || !Number.isFinite(ts) || ts <= 0) {
		return Infinity;
	}
	return ts;
}

/**
 * Interpret the Secret's locktime relative to a given time.
 *
 * - PERMANENT: no valid locktime tag.
 * - ACTIVE: now < locktime.
 * - EXPIRED: now >= locktime.
 *
 * @param secretStr - The NUT-11 P2PK secret.
 * @param nowSeconds - Optional. The unix timestamp in seconds (Default: now)
 */
export function getP2PKLockState(
	secretStr: Secret | string,
	nowSeconds: number = Math.floor(Date.now() / 1000),
): LockState {
	const secret = parseP2PKSecret(secretStr);
	const locktime = getP2PKLocktime(secret);
	if (!Number.isFinite(locktime)) {
		return 'PERMANENT';
	}
	return nowSeconds < locktime ? 'ACTIVE' : 'EXPIRED';
}

/**
 * Returns the number of Locktime signatures required for a NUT-11 P2PK secret.
 *
 * @remarks
 * Returns `0` if the proof is unlocked and spendable by anyone (locktime EXPIRED, no refund keys).
 * @param secretStr - The NUT-11 P2PK secret.
 * @returns Number of Locktime signatories (n_sigs) required or `0` if unlocked.
 * @throws If secret is not P2PK.
 */
export function getP2PKNSigs(secretStr: string | Secret): number {
	const secret = parseP2PKSecret(secretStr);
	const lockState: LockState = getP2PKLockState(secret);
	const refundKeys = getP2PKWitnessRefundkeys(secret);
	// Locking applies except when NO refund keys AND lock is expired
	if (!refundKeys.length && lockState === 'EXPIRED') {
		return 0; // proof unlocked
	}
	return getTagInt(secret, 'n_sigs') ?? 1;
}

/**
 * Returns the number of Refund signatures required for a NUT-11 P2PK secret.
 *
 * @remarks
 * Returns `0` if the refund lock is currently inactive.
 *
 * Proof may still be locked - use: getP2PKNSigs() to check!
 * @param secretStr - The NUT-11 P2PK secret.
 * @returns Number of Refund signatories (n_sigs_refund) required, or `0` if lock is inactive.
 * @throws If secret is not P2PK.
 */
export function getP2PKNSigsRefund(secretStr: string | Secret): number {
	const secret = parseP2PKSecret(secretStr);
	const lockState: LockState = getP2PKLockState(secret);
	const refundKeys = getP2PKWitnessRefundkeys(secret);
	// Refund lock applies if there are refund keys AND lock is expired
	if (refundKeys.length && lockState === 'EXPIRED') {
		return getTagInt(secret, 'n_sigs_refund') ?? 1;
	}
	return 0; // refund lock inactive
}

/**
 * Returns the sigflag from a NUT-11 P2PK secret.
 *
 * @param secretStr - The NUT-11 P2PK secret.
 * @returns The sigflag or 'SIG_INPUTS' (default)
 * @throws If secret is not P2PK.
 */
export function getP2PKSigFlag(secretStr: string | Secret): SigFlag {
	const secret = parseP2PKSecret(secretStr);
	const flag = getTagScalar(secret, 'sigflag');
	return flag === 'SIG_ALL' ? 'SIG_ALL' : 'SIG_INPUTS';
}

/**
 * Gets witness signatures as an array.
 *
 * @param witness From Proof.
 * @returns Array of witness signatures.
 */
export function getP2PKWitnessSignatures(witness: Proof['witness']): string[] {
	return parseWitnessData(witness)?.signatures ?? [];
}

/**
 * Normalise Proof.witness into a WitnessData object.
 *
 * @param witness From Proof.
 * @returns WitnessData object or undefined.
 * @internal
 */
export function parseWitnessData(witness: Proof['witness']): WitnessData | undefined {
	if (!witness) return undefined;
	let parsed: Partial<HTLCWitness & P2PKWitness>;
	try {
		parsed =
			typeof witness === 'string'
				? (JSON.parse(witness) as Partial<HTLCWitness & P2PKWitness>)
				: witness;
	} catch (e) {
		console.error('Failed to parse witness string:', e);
		return undefined;
	}
	const data: WitnessData = {
		// always normalise signatures to an array
		signatures: parsed.signatures ?? [],
	};

	// Only set preimage if it is a non empty string
	if (typeof parsed.preimage === 'string' && parsed.preimage.length > 0) {
		data.preimage = parsed.preimage;
	}
	return data;
}

// ------------------------------
// Signing and Verifying Proofs
// ------------------------------

/**
 * Signs proofs with provided private key(s) if required.
 *
 * @remarks
 * NB: Will only sign if the proof requires a signature from the key.
 * @param proofs - An array of proofs to sign.
 * @param privateKey - A single private key or array of private keys (hex string or Uint8Array).
 * @param logger - Optional logger (default: NULL_LOGGER)
 * @param message - Optional. The message to sign (for SIG_ALL)
 * @returns Signed proofs.
 * @throws On general errors.
 */
export function signP2PKProofs(
	proofs: Proof[],
	privateKey: PrivKey | PrivKey[],
	logger: Logger = NULL_LOGGER,
	message?: string,
): Proof[] {
	// Convert to hex strings for maybeDeriveP2BKPrivateKeys
	const toHex = (k: PrivKey): string => (typeof k === 'string' ? k : bytesToHex(k));
	const privateKeyHex = Array.isArray(privateKey) ? privateKey.map(toHex) : toHex(privateKey);
	return proofs.map((proof, index) => {
		const privateKeys: string[] = maybeDeriveP2BKPrivateKeys(privateKeyHex, proof);
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
}

/**
 * Signs a single proof with the provided private key if required.
 *
 * @remarks
 * Will only sign if the proof requires a signature from the key.
 * @param proof - A proof to sign.
 * @param privateKey - A single private key (hex string or Uint8Array).
 * @param message - Optional. The message to sign (for SIG_ALL)
 * @returns Signed proofs.
 * @throws Error if signature is not required or proof is already signed.
 */
export function signP2PKProof(proof: Proof, privateKey: PrivKey, message?: string): Proof {
	const secret: Secret = parseP2PKSecret(proof.secret);
	message = message ?? proof.secret; // default message is secret

	// Check if the private key is required to sign by checking its
	// X-only pubkey (no 02/03 prefix) against the expected witness pubkeys
	// NB: Nostr pubkeys prepend 02 by convention, ignoring actual Y-parity
	const privKeyBytes = typeof privateKey === 'string' ? hexToBytes(privateKey) : privateKey;
	const pubkey = bytesToHex(schnorr.getPublicKey(privKeyBytes)); // x-only
	const witnesses = getP2PKExpectedWitnessPubkeys(secret);
	if (!witnesses.length || !witnesses.some((w) => w.includes(pubkey))) {
		throw new Error(`Signature not required from [02|03]${pubkey}`);
	}

	// Check if the public key has already signed
	const signatures = getP2PKWitnessSignatures(proof.witness);
	const alreadySigned = signatures.some((sig) => {
		return schnorrVerifyMessage(sig, message, pubkey);
	});

	if (alreadySigned) {
		throw new Error(`Proof already signed by [02|03]${pubkey}`);
	}

	// Add new signature
	const signature = schnorrSignMessage(message, privateKey);
	const witness = parseWitnessData(proof.witness);
	const newWitness: WitnessData = {
		...(witness && witness.preimage !== undefined ? { preimage: witness.preimage } : {}),
		signatures: [...(witness?.signatures ?? []), signature],
	};
	return { ...proof, witness: newWitness };
}

/**
 * Verifies a pubkey has signed a P2PK Proof.
 *
 * @param pubkey - The Cashu P2PK public key (hex-encoded, X-only or with 02/03 prefix).
 * @param proof - A Cashu proof.
 * @param message - Optional. The message that was signed (for SIG_ALL)
 * @returns True if one of the signatures is theirs, false otherwise.
 */
export function hasP2PKSignedProof(pubkey: string, proof: Proof, message?: string): boolean {
	if (!proof.witness) {
		return false;
	}
	// Check if message is needed
	if (isP2PKSigAll([proof]) && !message) {
		throw new Error('Cannot verify a SIG_ALL proof without the message to sign');
	}
	message = message ?? proof.secret; // default message is secret

	const signatures = getP2PKWitnessSignatures(proof.witness);
	// See if any of the signatures belong to this pubkey. We need to do this
	// as Schnorr signatures are non-deterministic (see: signMessage)
	return signatures.some((sig) => {
		return schnorrVerifyMessage(sig, message, pubkey);
	});
}

/**
 * Verify P2PK spending conditions for a single input.
 *
 * Two spending paths are available:
 *
 * 1. Normal path: signatures from the main pubkeys (always valid)
 * 2. Refund path: signatures from refund pubkeys (only valid after locktime)
 *
 * In addition, if the lock has expired and no refund keys are present, the proof is considered
 * unlocked and spendable without witness signatures.
 *
 * @remarks
 * Returns a detailed P2PKVerificationResult showing the conditions. If you just want a boolean
 * result, use isP2PKSpendAuthorised().
 * @param proof - The Proof to check.
 * @param logger - Optional logger (default: NULL_LOGGER)
 * @param message - Optional. The message to sign (for SIG_ALL)
 * @returns A P2PKVerificationResult describing the spending outcome.
 * @throws If verification is impossible.
 */
export function verifyP2PKSpendingConditions(
	proof: Proof,
	logger: Logger = NULL_LOGGER,
	message?: string,
): P2PKVerificationResult {
	// Check if message is needed
	if (isP2PKSigAll([proof]) && !message) {
		logger.error('Cannot verify a SIG_ALL proof without the message to sign');
		throw new Error('Cannot verify a SIG_ALL proof without the message to sign');
	}

	// Init
	message = message ?? proof.secret; // default message is proof secret
	const secret: Secret = parseP2PKSecret(proof.secret);
	const signatures = getP2PKWitnessSignatures(proof.witness);
	const lockState: LockState = getP2PKLockState(secret);
	const mainKeys = getP2PKWitnessPubkeys(secret);
	const nsigs = getP2PKNSigs(secret);
	const mainSigners = getValidSigners(signatures, message, mainKeys);
	const resultBase = {
		success: true,
		path: 'MAIN' as P2PKSpendingPath,
		lockState,
		requiredSigners: nsigs,
		eligibleSigners: mainKeys.length,
		receivedSigners: mainSigners,
	};
	let result: P2PKVerificationResult = resultBase;

	// Verify the normal pathway (main pubkeys)
	if (mainKeys.length && nsigs > 0 && mainSigners.length >= nsigs) {
		logger.debug('Spending condition satisfied via main pubkeys', { result });
		return result; // success, MAIN pathway
	}

	// Check locktime status, continue only if expired
	if (lockState !== 'EXPIRED') {
		result = { ...resultBase, success: false, path: 'FAILED' };
		logger.debug('P2PK lock enabled, but threshold not met by main pubkeys', { result });
		return result; // failed, MAIN pathway
	}

	// Verify the refund pathway
	logger.debug('P2PK lock expired. Checking refund path.', { lockState });
	const refundKeys = getP2PKWitnessRefundkeys(secret);
	if (refundKeys.length) {
		const nSigsRefund = getP2PKNSigsRefund(secret);
		const refundSigners = getValidSigners(signatures, message, refundKeys);
		const refundBase: P2PKVerificationResult = {
			...resultBase,
			path: 'REFUND',
			requiredSigners: nSigsRefund,
			eligibleSigners: refundKeys.length,
			receivedSigners: refundSigners,
		};
		if (nSigsRefund > 0 && refundSigners.length >= nSigsRefund) {
			result = refundBase;
			logger.debug('Spending condition satisfied via refund pubkeys', { result });
			return result; // success, REFUND pathway
		}
		// Still here?
		result = { ...refundBase, success: false, path: 'FAILED' };
		logger.debug('Spending threshold not met by refund pubkeys', { result });
		return result; // failed, REFUND pathway
	}

	// No spending conditions
	result = { ...resultBase, path: 'UNLOCKED' };
	logger.debug('No refund pubkeys, anyone can spend.', { result });
	return result; // success, UNLOCKED
}

/**
 * Verify P2PK spending conditions for a single input.
 *
 * @param proof - The Proof to check.
 * @param logger - Optional logger (default: NULL_LOGGER)
 * @param message - Optional. The message to sign (for SIG_ALL)
 * @returns True if the witness threshold was reached, false otherwise.
 * @throws If verification is impossible.
 */
export function isP2PKSpendAuthorised(
	proof: Proof,
	logger: Logger = NULL_LOGGER,
	message?: string,
): boolean {
	return verifyP2PKSpendingConditions(proof, logger, message).success;
}

// ------------------------------
// P2BK - Pay To Blinded Key
// ------------------------------

/**
 * Derives blinded secret keys for a P2BK proof.
 *
 * @remarks
 * Calculates the deterministic blinding factor for each P2PK pubkey (data, pubkeys, refund) and
 * calling our parity-aware derivation.
 * @param privateKey Secret key (or array of secret keys)
 * @param proof The proof.
 * @returns Deduplicated list of derived secret keys (hex, 64 chars)
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
	return deriveP2BKSecretKeys(Ehex, privs, pubs);
}

// ------------------------------
// SIG_ALL Handling
// ------------------------------

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
	if (getP2PKSigFlag(first) !== 'SIG_ALL') throw new Error('First proof is not SIG_ALL');
	const data0 = first[1].data;
	const tags0 = JSON.stringify(first[1].tags ?? []);
	// Compare remaining proofs
	for (let i = 1; i < inputs.length; i++) {
		const si = parseP2PKSecret(inputs[i].secret);
		if (si[0] !== first[0]) throw new Error(`Proof #${i + 1} is not ${first[0]}`);
		if (getP2PKSigFlag(si) !== 'SIG_ALL') throw new Error(`Proof #${i + 1} is not SIG_ALL`);
		if (si[1].data !== data0) throw new Error('SIG_ALL inputs must share identical Secret.data');
		if (JSON.stringify(si[1].tags ?? []) !== tags0)
			throw new Error('SIG_ALL inputs must share identical Secret.tags');
	}
}

/**
 * Message aggregation for SIG_ALL.
 *
 * NOTE: Use `assertSigAllInputs()` to ensure valid message inputs.
 *
 * @remarks
 * Melt transactions MUST include the quoteId.
 * @param inputs Array of Proofs (only `secret` and `C` fields required).
 * @param outputs Array of OutputDataLike objects (OutputData, Factory etc).
 * @param quoteId Optional. Quote id for Melt transactions.
 * @internal
 */
export function buildP2PKSigAllMessage(
	inputs: Array<Pick<Proof, 'secret' | 'C'>>,
	outputs: Array<Pick<OutputDataLike, 'blindedMessage'>>,
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

// ------------------------------
// Deprecated
// ------------------------------

/**
 * Message aggregation for SIG_ALL (legacy format).
 *
 * @remarks
 * Melt transactions MUST include the quoteId.
 *
 * For compatibility with NutShell (all releases), CDK <v0.14.0.
 * @internal
 */
export function buildLegacyP2PKSigAllMessage(
	inputs: Array<Pick<Proof, 'secret'>>,
	outputs: Array<Pick<OutputDataLike, 'blindedMessage'>>,
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
 * @deprecated - Use SecretKind for NUT-10 kinds.
 */
export type WellKnownSecret = 'P2PK';

/**
 * Signs a P2PK secret using Schnorr.
 *
 * @deprecated Use {@link schnorrSignMessage}
 */
export const signP2PKSecret = (secret: string, privateKey: PrivKey): string => {
	return schnorrSignMessage(secret, privateKey);
};

/**
 * Verifies a Schnorr signature on a P2PK secret.
 *
 * @deprecated Use {@link schnorrVerifyMessage}
 */
export const verifyP2PKSecretSignature = (
	signature: string,
	secret: string,
	pubkey: string,
): boolean => {
	return schnorrVerifyMessage(signature, secret, pubkey);
};

/**
 * @deprecated - Typo: use {@link getP2PKExpectedWitnessPubkeys} instead.
 */
export function getP2PKExpectedKWitnessPubkeys(secretStr: string | Secret): string[] {
	return getP2PKExpectedWitnessPubkeys(secretStr);
}

/**
 * @deprecated Use {@link isP2PKSpendAuthorised} or {@link verifyP2PKSpendingConditions} instead.
 */
export function verifyP2PKSig(proof: Proof): boolean {
	return isP2PKSpendAuthorised(proof);
}
