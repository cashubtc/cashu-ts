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
	getTags,
	assertSecretKind,
	createSecret,
	type Secret,
	getSecretKind,
} from './NUT10';

export const SigFlags = {
	SIG_INPUTS: 'SIG_INPUTS',
	SIG_ALL: 'SIG_ALL',
} as const;
export type SigFlag = (typeof SigFlags)[keyof typeof SigFlags];
const VALID_SIG_FLAGS: ReadonlySet<SigFlag> = new Set(Object.values(SigFlags));

export type LockState = 'PERMANENT' | 'ACTIVE' | 'EXPIRED';

export type P2PKSpendingPath = 'MAIN' | 'REFUND' | 'UNLOCKED' | 'FAILED';

/**
 * Tag entry for additional NUT-11 P2PK secret tags.
 */
export type P2PKTag = [key: string, ...values: string[]];

/**
 * Options for configuring P2PK (Pay-to-Public-Key) locked proofs according to NUT-11.
 */
export type P2PKOptions = {
	pubkey: string | string[];
	locktime?: number;
	refundKeys?: string[];
	requiredSignatures?: number;
	requiredRefundSignatures?: number;
	additionalTags?: P2PKTag[];
	blindKeys?: boolean; // default false
	sigFlag?: SigFlag;
	hashlock?: string; // NUT-14 (HTLC)
};

/**
 * Signature info for a single spending path (main or refund).
 */
export interface P2PKPathInfo {
	/**
	 * Canonical hex pubkeys eligible to sign for this path.
	 */
	pubkeys: string[];
	/**
	 * Number of signatures required (threshold).
	 */
	requiredSigners: number;
	/**
	 * Canonical hex pubkeys whose signatures were accepted.
	 */
	receivedSigners: string[];
}

export interface P2PKVerificationResult {
	/**
	 * True when the proof is currently spendable via the returned path.
	 */
	success: boolean;
	/**
	 * Which spending path was evaluated.
	 *
	 * - `MAIN`: main P2PK pubkeys satisfied the threshold.
	 * - `REFUND`: refund pubkeys satisfied the threshold after locktime expiry.
	 * - `UNLOCKED`: no active signer requirement remains, so anyone can spend.
	 * - `FAILED`: the proof is well-formed but the required threshold was not met.
	 */
	path: P2PKSpendingPath;
	/**
	 * Current lock state derived from the proof secret.
	 *
	 * - `PERMANENT`: no finite locktime is set.
	 * - `ACTIVE`: a finite locktime exists and has not expired yet.
	 * - `EXPIRED`: the finite locktime has already expired.
	 */
	lockState: LockState;
	/**
	 * Locktime from the proof secret as a unix timestamp, or `Infinity` for a permanent lock.
	 */
	locktime: number;
	/**
	 * Main spending path info — always populated.
	 */
	main: P2PKPathInfo;
	/**
	 * Refund spending path info — empty pubkeys/signers if no refund keys configured.
	 */
	refund: P2PKPathInfo;
}

/**
 * @internal
 */
type WitnessData = {
	preimage?: string;
	signatures: string[];
};

/**
 * @internal
 */
const P2PK_KNOWN_TAG_KEYS = new Set([
	'locktime',
	'pubkeys',
	'n_sigs',
	'refund',
	'n_sigs_refund',
	'sigflag',
]);

// ------------------------------
// NUT-11 Secrets
// ------------------------------

/**
 * Create a P2PK secret.
 *
 * @param pubkey - The pubkey to add to Secret.data.
 * @param tags - Optional. Additional P2PK tags.
 * @throws If the sigflag is unrecognised.
 */
export function createP2PKsecret(pubkey: string, tags?: string[][]): string {
	const secret = createSecret('P2PK', pubkey, tags);
	parseP2PKSecret(secret); // validates
	return secret;
}

/**
 * Parse a P2PK Secret and validate NUT-10 shape and NUT-11 tag-level constraints.
 *
 * @remarks
 * Layer 1 validation: Checks NUT-10 structure, rejects duplicate P2PK tag keys, and validates
 * sigflag value. Does NOT validate cross-tag semantics (e.g. n_sigs <= pubkeys) — use
 * {@link verifyP2PKSpendingConditions} for full semantic validation.
 * @param secret - The Proof secret.
 * @returns Secret object.
 * @throws If the NUT-10 secret is malformed, tags are duplicated, or sigflag is unrecognised.
 */
export function parseP2PKSecret(secret: string | Secret): Secret {
	// HTLC extends P2PK, so we include it in our expected list.
	const parsed = assertSecretKind(['P2PK', 'HTLC'], secret);
	assertNoDuplicateP2PKTags(getTags(parsed));
	const flag = getTagScalar(parsed, 'sigflag');
	if (flag !== undefined) assertSigFlag(flag);
	return parsed;
}

// ------------------------------
// Normalizer Functions
// ------------------------------

/**
 * Normalizes to lowercase 33 byte with 02 prefix for x only.
 *
 * @param pk 33 byte compressed (02|03...), or 32 byte x-only. *
 * @throws If malformed.
 */
function normalizePubkey(pk: string): string {
	const hex = pk.toLowerCase();
	if (hex.length === 66 && (hex.startsWith('02') || hex.startsWith('03'))) return hex;
	if (hex.length === 64) return `02${hex}`;
	throw new Error(
		`Invalid pubkey, expected 33 byte compressed or 32 byte x only, got length ${hex.length}`,
	);
}

/**
 * Dedupes pubkeys by their x-only portion (last 64 chars).
 *
 * @remarks
 * Pubkeys are normalized before dedupe.
 * @param keys - Raw key strings.
 * @throws If any key is malformed.
 * @internal
 */
export function dedupeP2PKPubkeys(keys: string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const raw of keys) {
		const k = normalizePubkey(raw);
		const xOnly = k.slice(-64);
		if (!seen.has(xOnly)) {
			seen.add(xOnly);
			result.push(k);
		}
	}
	return result;
}

/**
 * Validate and normalize P2PK/HTLC output options.
 *
 * @remarks
 * Normalizes and deduplicates pubkeys, then enforces that requested signature thresholds are
 * satisfiable by the resulting key sets.
 *
 * External callers use {@link P2PKBuilder}: `P2PKBuilder.fromOptions(opts).toOptions()`
 * @internal
 */
export function normalizeP2PKOptions(p2pk: P2PKOptions): P2PKOptions {
	const pubkeys = dedupeP2PKPubkeys(Array.isArray(p2pk.pubkey) ? p2pk.pubkey : [p2pk.pubkey]);
	const refundKeys = dedupeP2PKPubkeys(p2pk.refundKeys ?? []);
	if (pubkeys.length === 0) {
		throw new Error('P2PK requires at least one pubkey');
	}
	const totalKeys = pubkeys.length + refundKeys.length;
	if (totalKeys > 10) {
		throw new Error(`Too many pubkeys, ${totalKeys} provided, maximum allowed is 10 in total`);
	}
	if (p2pk.sigFlag !== undefined) assertSigFlag(p2pk.sigFlag);

	const requiredSignatures = p2pk.requiredSignatures ?? 1;
	const requiredRefundSignatures = p2pk.requiredRefundSignatures;

	// Shared semantic validation
	assertSpendingConditionRules({
		mainKeyCount: pubkeys.length,
		refundKeyCount: refundKeys.length,
		nSigs: requiredSignatures,
		nSigsRefund: requiredRefundSignatures,
		hasLocktime: p2pk.locktime !== undefined,
	});

	return {
		pubkey: pubkeys.length === 1 ? pubkeys[0] : pubkeys,
		...(p2pk.locktime !== undefined ? { locktime: p2pk.locktime } : {}),
		...(refundKeys.length > 0 ? { refundKeys } : {}),
		...(requiredSignatures > 1 ? { requiredSignatures } : {}),
		...(requiredRefundSignatures !== undefined && requiredRefundSignatures > 1
			? { requiredRefundSignatures }
			: {}),
		...(p2pk.additionalTags?.length ? { additionalTags: p2pk.additionalTags } : {}),
		...(p2pk.blindKeys ? { blindKeys: true } : {}),
		...(p2pk.sigFlag !== undefined ? { sigFlag: p2pk.sigFlag } : {}),
		...(p2pk.hashlock ? { hashlock: p2pk.hashlock } : {}),
	};
}

// ------------------------------
// Public Getters
// ------------------------------

/**
 * Returns the expected witness public keys from a NUT-11 P2PK secret.
 *
 * @remarks
 * Does not tell you the pathway (Locktime or Refund MultiSig), only the keys that CAN currently
 * sign. If no keys are returned, the proof is unlocked or expired with no refund path.
 * @param secretStr - The NUT-11 P2PK secret.
 * @returns Array of public keys or empty array.
 * @throws If the secret is malformed or not P2PK.
 */
export function getP2PKExpectedWitnessPubkeys(secretStr: string | Secret): string[] {
	const secret: Secret = parseP2PKSecret(secretStr);
	const lockState: LockState = deriveLockState(getLocktime(secret));
	const mainKeys = getP2PKWitnessPubkeys(secret);
	const refundKeys = getP2PKWitnessRefundkeys(secret);
	// Locktime pathway
	if (lockState === 'ACTIVE' || lockState === 'PERMANENT') {
		return mainKeys;
	}
	// Refund pathway
	if (lockState === 'EXPIRED' && refundKeys.length) {
		return Array.from(new Set([...mainKeys, ...refundKeys]));
	}
	return []; // Unlocked or expired with no refund keys
}

/**
 * Returns the sigflag from a NUT-11 P2PK secret.
 *
 * @param secretStr - The NUT-11 P2PK secret.
 * @returns The sigflag (`'SIG_INPUTS'` or `'SIG_ALL'`).
 * @throws If secret is not P2PK, or if the sigflag tag contains an unrecognised value.
 */
export function getP2PKSigFlag(secretStr: string | Secret): SigFlag {
	const secret = parseP2PKSecret(secretStr); // also validates sigflag
	return (getTagScalar(secret, 'sigflag') as SigFlag) ?? 'SIG_INPUTS';
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
 * Normalize Proof.witness into a WitnessData object.
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
		// always normalize signatures to an array
		signatures: parsed.signatures ?? [],
	};

	// Only set preimage if it is a non empty string
	if (typeof parsed.preimage === 'string' && parsed.preimage.length > 0) {
		data.preimage = parsed.preimage;
	}
	return data;
}

// ------------------------------
// Signing Proofs
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

// ------------------------------
// Verifying Proofs
// ------------------------------

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
 * First validates the spending conditions are well-formed, then checks whether the proof's witness
 * signatures meet the threshold.
 *
 * Wallets can call this with unsigned proofs on receive to validate conditions. Returns a detailed
 * P2PKVerificationResult showing the conditions. If you just want a boolean result, use
 * isP2PKSpendAuthorised().
 * @param proof - The Proof to check.
 * @param logger - Optional logger (default: NULL_LOGGER)
 * @param message - Optional. The message to sign (for SIG_ALL)
 * @returns A P2PKVerificationResult describing the spending outcome.
 * @throws If spending conditions are malformed, or verification is impossible.
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

	// Parse once — all tag reads below use the pre-parsed Secret (no re-parsing)
	message = message ?? proof.secret;
	const secret: Secret = parseP2PKSecret(proof.secret);

	// Extract keys and validate cross-tag semantics
	const mainKeys = getP2PKWitnessPubkeys(secret);
	const refundKeys = getP2PKWitnessRefundkeys(secret);
	assertSpendingConditionRules({
		mainKeyCount: mainKeys.length,
		refundKeyCount: refundKeys.length,
		nSigs: getTagInt(secret, 'n_sigs'),
		nSigsRefund: getTagInt(secret, 'n_sigs_refund'),
		hasLocktime: Number.isFinite(getLocktime(secret)),
	});

	const signatures = getP2PKWitnessSignatures(proof.witness);
	const locktime = getLocktime(secret);
	const lockState: LockState = deriveLockState(locktime);
	const nsigs = resolveNSigs(secret, lockState, refundKeys);
	const nSigsRefund = resolveNSigsRefund(secret, lockState, refundKeys);

	// Verify signatures against both key sets
	const mainSigners = getValidSigners(signatures, message, mainKeys);
	const refundSigners = refundKeys.length ? getValidSigners(signatures, message, refundKeys) : [];

	// Build path info (always fully populated)
	const main: P2PKPathInfo = {
		pubkeys: mainKeys,
		requiredSigners: nsigs,
		receivedSigners: mainSigners,
	};
	const refund: P2PKPathInfo = {
		pubkeys: refundKeys,
		requiredSigners: nSigsRefund,
		receivedSigners: refundSigners,
	};

	const resultBase = { locktime, lockState, main, refund };

	// Verify the normal pathway (main pubkeys)
	if (mainKeys.length && nsigs > 0 && mainSigners.length >= nsigs) {
		const result = { ...resultBase, success: true, path: 'MAIN' as const };
		logger.debug('Spending condition satisfied via main pubkeys', { result });
		return result;
	}

	// Check locktime status, continue only if expired
	if (lockState !== 'EXPIRED') {
		const result = { ...resultBase, success: false, path: 'FAILED' as const };
		logger.debug('P2PK lock enabled, but threshold not met by main pubkeys', { result });
		return result;
	}

	// Verify the refund pathway
	logger.debug('P2PK lock expired. Checking refund path.', { lockState });
	if (refundKeys.length) {
		if (nSigsRefund > 0 && refundSigners.length >= nSigsRefund) {
			const result = { ...resultBase, success: true, path: 'REFUND' as const };
			logger.debug('Spending condition satisfied via refund pubkeys', { result });
			return result;
		}
		const result = { ...resultBase, success: false, path: 'FAILED' as const };
		logger.debug('Spending threshold not met by either pathway', { result });
		return result;
	}

	// No refund keys + expired = unlocked
	const result = { ...resultBase, success: true, path: 'UNLOCKED' as const };
	logger.debug('No refund pubkeys, anyone can spend.', { result });
	return result;
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
// Internal helpers
// ------------------------------

function assertNoDuplicateP2PKTags(tags: string[][]): void {
	const seen = new Set<string>();
	for (const tag of tags) {
		const key = tag[0];
		if (!P2PK_KNOWN_TAG_KEYS.has(key)) continue;
		if (seen.has(key)) {
			throw new Error(`Duplicate P2PK tag "${key}"`);
		}
		seen.add(key);
	}
}

function assertSigFlag(flag: string): asserts flag is SigFlag {
	if (!VALID_SIG_FLAGS.has(flag as SigFlag)) {
		throw new Error(`Invalid sigflag "${flag}": must be "SIG_INPUTS" or "SIG_ALL"`);
	}
}

function assertPositiveInteger(value: number, field: string): number {
	if (!Number.isInteger(value) || value < 1) {
		throw new Error(`${field} must be a positive integer, got ${value}`);
	}
	return value;
}

/**
 * Shared semantic validation for P2PK spending conditions.
 *
 * @remarks
 * Used by both {@link normalizeP2PKOptions} (creation) and {@link assertP2PKSemantics} (receiving) to
 * enforce the same rules.
 * @internal
 */
function assertSpendingConditionRules(params: {
	mainKeyCount: number;
	refundKeyCount: number;
	nSigs?: number;
	nSigsRefund?: number;
	hasLocktime: boolean;
}): void {
	const { mainKeyCount, refundKeyCount, nSigs, nSigsRefund, hasLocktime } = params;

	if (nSigs !== undefined) {
		assertPositiveInteger(nSigs, 'requiredSignatures (n_sigs)');
		if (nSigs > mainKeyCount) {
			throw new Error(
				`requiredSignatures (n_sigs) (${nSigs}) exceeds available pubkeys (${mainKeyCount})`,
			);
		}
	}

	if (nSigsRefund !== undefined) {
		assertPositiveInteger(nSigsRefund, 'requiredRefundSignatures (n_sigs_refund)');
		if (refundKeyCount === 0) {
			throw new Error('requiredRefundSignatures (n_sigs_refund) requires refund keys');
		}
		if (nSigsRefund > refundKeyCount) {
			throw new Error(
				`requiredRefundSignatures (n_sigs_refund) (${nSigsRefund}) exceeds available refund keys (${refundKeyCount})`,
			);
		}
	}

	if (refundKeyCount > 0 && !hasLocktime) {
		throw new Error('refund keys require a locktime');
	}
}

function getP2PKWitnessPubkeys(secret: Secret): string[] {
	const data = getSecretKind(secret) === 'P2PK' ? getDataField(secret) : '';
	const pubkeys = getTag(secret, 'pubkeys') ?? [];
	const keys = (data ? [data, ...pubkeys] : pubkeys).map((key) => normalizePubkey(key));
	if (dedupeP2PKPubkeys(keys).length !== keys.length) {
		throw new Error('Duplicate main pubkeys are not allowed');
	}
	return keys;
}

function getP2PKWitnessRefundkeys(secret: Secret): string[] {
	const keys = (getTag(secret, 'refund') ?? []).map((key) => normalizePubkey(key));
	if (dedupeP2PKPubkeys(keys).length !== keys.length) {
		throw new Error('Duplicate refund pubkeys are not allowed');
	}
	return keys;
}

function getLocktime(secret: Secret): number {
	const ts = getTagInt(secret, 'locktime');
	if (ts === undefined || !Number.isFinite(ts) || ts <= 0) {
		return Infinity;
	}
	return ts;
}

function deriveLockState(
	locktime: number,
	nowSeconds: number = Math.floor(Date.now() / 1000),
): LockState {
	if (!Number.isFinite(locktime)) return 'PERMANENT';
	return nowSeconds < locktime ? 'ACTIVE' : 'EXPIRED';
}

function resolveNSigs(secret: Secret, lockState: LockState, refundKeys: string[]): number {
	if (!refundKeys.length && lockState === 'EXPIRED') return 0; // proof unlocked
	return Math.max(getTagInt(secret, 'n_sigs') ?? 1, 1);
}

function resolveNSigsRefund(secret: Secret, lockState: LockState, refundKeys: string[]): number {
	if (refundKeys.length && lockState === 'EXPIRED') {
		return Math.max(getTagInt(secret, 'n_sigs_refund') ?? 1, 1);
	}
	return 0; // refund lock inactive
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
