import type { OutputDataLike } from './OutputData';
import type { P2PKWitness, Proof, MeltQuoteBaseResponse, SerializedBlindedMessage } from './types';
import type { MeltPreview, SwapPreview } from '../wallet/types';
import {
	buildLegacyP2PKSigAllMessage,
	buildP2PKSigAllMessage,
	schnorrSignMessage,
} from '../crypto';
import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { Bytes, encodeUint8toBase64Url } from '../utils';

const SIGALL_PREFIX = 'sigallA';

export type SigAllDigests = {
	legacy: string;
	current: string;
};

/**
 * Represents a signing package for SigAll multi-party signing.
 *
 * This is a wallet-led transport format, it contains only the minimum data required to reconstruct
 * the SIG_ALL message.
 */
export type SigAllSigningPackage = {
	version: 'cashu-sigall-v1';
	type: 'swap' | 'melt';
	quote?: string; // melt only
	inputs: Array<{
		id: string;
		amount: number;
		C: string;
	}>; //minimal inputs required for signing transport to prevent leaking sensitive data.
	outputs: Array<{ amount: number; blindedMessage: SerializedBlindedMessage }>;
	messageDigest?: string; //hex SHA256 digest of the message-to-sign.
	digests?: {
		legacy?: string;
		current: string;
	}; //per-format digests to support signing multiple SIG_ALL formats (legacy / current)
	witness?: { signatures: string[] }; //collected signatures to be injected into the first proof witness.
};

/**
 * Computes legacy and current SIG_ALL formats.
 *
 * @remarks
 * Returns hex-encoded SHA256 digests for each format to support multi-format signing.
 * @param inputs Proof array.
 * @param outputs OutputDataLike array.
 * @param quoteId Optional quote ID for melt transactions.
 * @returns Object with legacy, and current digests (all hex strings)
 */
function computeSigAllDigests(
	inputs: Proof[],
	outputs: OutputDataLike[],
	quoteId?: string,
): SigAllDigests {
	const legacyMsg = buildLegacyP2PKSigAllMessage(inputs, outputs, quoteId);
	const currentMsg = buildP2PKSigAllMessage(inputs, outputs, quoteId);

	const encoder = new TextEncoder();

	return {
		legacy: bytesToHex(sha256(encoder.encode(legacyMsg))),
		current: bytesToHex(sha256(encoder.encode(currentMsg))),
	};
}

/**
 * @remarks
 * Produces a deterministic JSON representation, base64url-encodes it and prefixes with sigallA for
 * transport.
 *
 * - Field order is fixed and version field is always included for compatibility.
 * - This enables consistent hashing and verification of package integrity.
 *
 * @param pkg The signing package to serialize.
 * @returns JSON string with sorted keys.
 */
function serializeSigningPackage(pkg: SigAllSigningPackage): string {
	// Build object with fixed key order for determinism
	const ordered: Record<string, unknown> = { version: pkg.version, type: pkg.type };

	if (pkg.quote) ordered.quote = pkg.quote;

	ordered.inputs = pkg.inputs;
	ordered.outputs = pkg.outputs;

	if (pkg.messageDigest) ordered.messageDigest = pkg.messageDigest;
	if (pkg.digests) ordered.digests = pkg.digests;
	if (pkg.witness) ordered.witness = pkg.witness;

	const json = JSON.stringify(ordered);
	const base64url = encodeUint8toBase64Url(Bytes.fromString(json));

	return `${SIGALL_PREFIX}${base64url}`;
}

/**
 * @remarks
 * Accepts a sigallA-prefixed base64url string and rehydrates it into a SigAllSigningPackage.
 */
function deserializeSigningPackage(
	input: string,
	options?: { validateDigest?: boolean },
): SigAllSigningPackage {
	if (!input.startsWith(SIGALL_PREFIX)) {
		throw new Error(`Invalid signing package: must start with "${SIGALL_PREFIX}"`);
	}

	const base64url = input.slice(SIGALL_PREFIX.length);
	let json: string;

	try {
		json = Bytes.toString(Bytes.fromBase64(base64url));
	} catch (e) {
		throw new Error(
			`Failed to parse signing package: ${e instanceof Error ? e.message : String(e)}`,
		);
	}

	let data: unknown;

	try {
		data = JSON.parse(json);
	} catch (e) {
		throw new Error(
			`Failed to parse signing package JSON: ${e instanceof Error ? e.message : String(e)}`,
		);
	}

	if (!data || typeof data !== 'object') {
		throw new Error('Signing package must be a JSON object');
	}

	const pkg = data as SigAllSigningPackage;

	const version = pkg.version as string;
	if (version !== 'cashu-sigall-v1') {
		throw new Error(`Invalid signing package version: ${version}`);
	}

	const type = pkg.type as string;
	if (type !== 'swap' && type !== 'melt') {
		throw new Error(`Invalid signing package type: ${type}`);
	}

	if (!Array.isArray(pkg.inputs)) {
		throw new Error('Signing package inputs must be an array');
	}

	for (let i = 0; i < pkg.inputs.length; i++) {
		const inp = pkg.inputs[i] as Record<string, unknown>;

		if (!inp || typeof inp !== 'object') throw new Error(`Invalid input at index ${i}`);

		if (typeof inp.id !== 'string') throw new Error(`Input ${i}: id must be string`);

		if (typeof inp.amount !== 'number') throw new Error(`Input ${i}: amount must be number`);

		if (typeof inp.C !== 'string') throw new Error(`Input ${i}: C must be string`);
	}

	if (!Array.isArray(pkg.outputs)) {
		throw new Error('Signing package outputs must be an array');
	}

	for (let i = 0; i < pkg.outputs.length; i++) {
		const out = pkg.outputs[i] as Record<string, unknown>;

		if (!out || typeof out !== 'object') throw new Error(`Invalid output at index ${i}`);

		if (typeof out.amount !== 'number') throw new Error(`Output ${i}: amount must be number`);

		if (!out.blindedMessage || typeof out.blindedMessage !== 'object')
			throw new Error(`Output ${i}: blindedMessage invalid`);
	}

	// --- Optional digest validation ---
	const digests = pkg.digests as Record<string, string> | undefined;

	if (options?.validateDigest && digests?.current) {
		const quote = pkg.quote;

		const proofLike = pkg.inputs.map((i) => ({
			...i,
			secret: '',
		})) as Proof[];

		const outputLike = pkg.outputs.map((o) => ({
			amount: o.amount,
			blindedMessage: o.blindedMessage,
			blindingFactor: 0n,
			secret: new Uint8Array(),
			toProof: () => {
				throw new Error('Not a real OutputDataLike');
			},
		})) as OutputDataLike[];

		const recomputed = computeSigAllDigests(proofLike, outputLike, quote);

		if (recomputed.current !== digests.current) {
			throw new Error('Digest validation failed');
		}
	}

	return pkg;
}

/**
 * Signs a SigAllSigningPackage and returns it with signatures attached.
 *
 * @remarks
 * Collects signatures by signing legacy and current SIG_ALL formats for backward compatibility.
 * Prefers digest-based signing (safer, avoids secrets) but falls back to message reconstruction for
 * legacy packages without digests. Multiple parties can call this sequentially to aggregate
 * signatures for multi-party signing.
 * @param pkg The signing package (from extract*SigningPackage or another signer)
 * @param privkey Private key to sign with.
 * @returns Package with signatures appended to witness field.
 */
function signSigningPackage(pkg: SigAllSigningPackage, privkey: string): SigAllSigningPackage {
	const newSigs: string[] = [];

	if (pkg.digests) {
		// Preferred path: sign precomputed digests (secure, no secrets exposed)
		if (pkg.digests.legacy) newSigs.push(signHexDigest(pkg.digests.legacy, privkey));
		if (pkg.digests.current) newSigs.push(signHexDigest(pkg.digests.current, privkey));
	} else {
		// Legacy fallback: reconstruct messages from package.
		_signLegacyPackage(pkg, privkey, newSigs);
	}

	// validate that signing actually produced signatures
	if (newSigs.length === 0) {
		throw new Error('No signatures produced during signing');
	}

	return {
		...pkg,
		witness: { signatures: [...(pkg.witness?.signatures || []), ...newSigs] },
	};
}

/**
 * Signs package without digests by reconstructing legacy and current SIG_ALL formats.
 *
 * @remarks
 * Used only when digests are unavailable (legacy packages). Reconstructs messages from package
 * inputs/outputs and signs each format. Appends signatures to the provided array.
 * @param pkg Signing package without digests.
 * @param privkey Private key to sign with.
 * @param newSigs Array to accumulate signatures (mutated in place)
 */
function _signLegacyPackage(pkg: SigAllSigningPackage, privkey: string, newSigs: string[]): void {
	// Construct minimal output objects compatible with build functions.
	// The build functions expect { blindedMessage: ... } shape for outputs.
	const minimalOutputs: Array<{ blindedMessage: SerializedBlindedMessage }> = pkg.outputs.map(
		(o) => ({
			blindedMessage: o.blindedMessage,
		}),
	);

	// Reconstruct legacy and current SIG_ALL formats. Note: pkg.inputs here is sanitized
	// (no secrets), so we pass through as-is to the build functions which only
	// use the public fields (id, amount, C).
	const proofLike = pkg.inputs as unknown as Proof[];
	const outputLike = minimalOutputs as unknown as OutputDataLike[];

	const legacyMsg = buildLegacyP2PKSigAllMessage(proofLike, outputLike, pkg.quote);
	const currentMsg = buildP2PKSigAllMessage(proofLike, outputLike, pkg.quote);

	newSigs.push(schnorrSignMessage(legacyMsg, privkey));
	newSigs.push(schnorrSignMessage(currentMsg, privkey));
}

function signHexDigest(hexDigest: string, privkey: string): string {
	const digestBytes = hexToBytes(hexDigest);
	const keyBytes = hexToBytes(privkey);
	const signature = schnorr.sign(digestBytes, keyBytes);
	return bytesToHex(signature);
}

/**
 * Extracts a signing package from a SwapPreview for multi-party SIG_ALL coordination.
 *
 * @remarks
 * This creates a minimal, serializable package that can be passed to other signers. Secrets and
 * blinding factors are NOT included - only what's needed to reconstruct the exact SIG_ALL message
 * and produce signatures.
 * @param preview SwapPreview from prepareSwapToSend or prepareSwapToReceive.
 * @returns SigAllSigningPackage for distribution to signers.
 */
function extractSwapSigningPackage(preview: SwapPreview): SigAllSigningPackage {
	// Merge keep + send outputs in order (both needed for complete transaction message)
	const allOutputs = [...(preview.keepOutputs || []), ...(preview.sendOutputs || [])];
	return _extractSigningPackage('swap', preview.inputs, allOutputs);
}

/**
 * Extracts a signing package from a MeltPreview for multi-party SIG_ALL coordination.
 *
 * @param preview MeltPreview from prepareMelt.
 * @returns SigAllSigningPackage for distribution to signers.
 */
function extractMeltSigningPackage<TQuote extends MeltQuoteBaseResponse>(
	preview: MeltPreview<TQuote>,
): SigAllSigningPackage {
	return _extractSigningPackage('melt', preview.inputs, preview.outputData, preview.quote.quote);
}

/**
 * Unified extractor for swap and melt signing packages.
 *
 * @remarks
 * Sanitizes inputs, computes legacy and current SIG_ALL formats, and returns a signing package
 * ready for distribution to signers.
 * @param type Transaction type ('swap' or 'melt')
 * @param inputs Proof array from the preview.
 * @param outputs OutputDataLike array.
 * @param quoteId Optional quote ID for melt transactions.
 * @returns SigAllSigningPackage.
 */
function _extractSigningPackage(
	type: 'swap' | 'melt',
	inputs: Proof[],
	outputs: OutputDataLike[],
	quoteId?: string,
): SigAllSigningPackage {
	//sanitize inputs - do NOT include secrets or other private fields.
	const sanitizedInputs = inputs.map((p) => ({ id: p.id, amount: p.amount, C: p.C }));

	//compute legacy and current SIG_ALL digests for backward compatibility
	const digests = computeSigAllDigests(inputs, outputs, quoteId);

	//verify current digest was computed correctly (catches bugs).
	const msg = buildP2PKSigAllMessage(inputs, outputs, quoteId);
	const expected = bytesToHex(sha256(new TextEncoder().encode(msg)));

	if (digests.current !== expected) {
		throw new Error(
			'SIG_ALL digest computation mismatch - current digest does not match expected value',
		);
	}

	return {
		version: 'cashu-sigall-v1',
		type,
		...(quoteId ? { quote: quoteId } : {}),
		inputs: sanitizedInputs,
		outputs: outputs.map((o) => ({
			amount: o.blindedMessage.amount,
			blindedMessage: o.blindedMessage,
		})),
		messageDigest: digests.current,
		digests,
	};
}

/**
 * Merges signatures from a signing package back into a SwapPreview.
 *
 * @remarks
 * Injects collected signatures into the first proof's witness for mint submission. Call this after
 * all parties have signed.
 * @param pkg Signing package with collected signatures.
 * @param preview Original SwapPreview.
 * @returns SwapPreview ready for completeSwap.
 */
function mergeSignaturesToSwapPreview(
	pkg: SigAllSigningPackage,
	preview: SwapPreview,
): SwapPreview {
	const updatedInputs = _mergeSignatures(preview.inputs, pkg);
	return { ...preview, inputs: updatedInputs };
}

/**
 * Merges signatures from a signing package back into a MeltPreview.
 *
 * @param pkg Signing package with collected signatures.
 * @param preview Original MeltPreview.
 * @returns MeltPreview ready for completeMelt.
 */
function mergeSignaturesToMeltPreview<TQuote extends MeltQuoteBaseResponse>(
	pkg: SigAllSigningPackage,
	preview: MeltPreview<TQuote>,
): MeltPreview<TQuote> {
	const updatedInputs = _mergeSignatures(preview.inputs, pkg);
	return { ...preview, inputs: updatedInputs };
}

/**
 * Merges collected signatures into the first proof's witness (NUT-11 convention).
 *
 * @remarks
 * Both Swap and Melt transactions use the same signature injection pattern: all signatures go into
 * the first proof only. This centralizes that logic.
 * @param proofs Proof array from the preview.
 * @param pkg Signing package with collected signatures.
 * @returns Updated proofs with signatures injected into first proof's witness.
 * @throws If no signatures are present in the package.
 */
function _mergeSignatures(proofs: Proof[], pkg: SigAllSigningPackage): Proof[] {
	if (!pkg.witness?.signatures.length) {
		throw new Error('No signatures to merge');
	}

	return proofs.map((p, idx) => {
		if (idx !== 0) return p;

		let witnessObj: Partial<P2PKWitness> = {};
		if (typeof p.witness === 'string') {
			try {
				witnessObj = (JSON.parse(p.witness) as Partial<P2PKWitness>) || {};
			} catch {
				witnessObj = {};
			}
		} else if (p.witness) {
			witnessObj = p.witness;
		}

		const existingSignatures = Array.isArray(witnessObj.signatures) ? witnessObj.signatures : [];
		return {
			...p,
			witness: {
				...witnessObj,
				signatures: [...existingSignatures, ...pkg.witness!.signatures],
			} as P2PKWitness,
		};
	});
}

export const SigAll = {
	computeDigests: computeSigAllDigests,

	extractSwapPackage: extractSwapSigningPackage,
	extractMeltPackage: extractMeltSigningPackage,

	serializePackage: serializeSigningPackage,
	deserializePackage: deserializeSigningPackage,

	signPackage: signSigningPackage,
	signDigest: signHexDigest,

	mergeSwapPackage: mergeSignaturesToSwapPreview,
	mergeMeltPackage: mergeSignaturesToMeltPreview,
} as const;
