import type { P2PKWitness, Proof, MeltQuoteBaseResponse, SerializedBlindedMessage } from './types';
import type { MeltPreview, SwapPreview } from '../wallet/types';
import {
	computeMessageDigest,
	buildLegacyP2PKSigAllMessage,
	buildP2PKSigAllMessage,
	schnorrSignDigest,
} from '../crypto';
import { parseWitnessData } from '../crypto/NUT11';
import { Bytes, encodeUint8toBase64Url } from '../utils';

/**
 * @experimental
 */
const SIGALL_PREFIX = 'sigallA';

/**
 * @experimental
 */
export type SigAllDigests = {
	legacy: string;
	current: string;
};

/**
 * Represents a signing package for SigAll multi-party signing.
 *
 * This is a wallet-led transport format, it contains only the minimum data required to reconstruct
 * the SIG_ALL message.
 *
 * @experimental
 */
export type SigAllSigningPackage = {
	/**
	 * Signing package version.
	 */
	version: 'cashu-sigall-v1';
	/**
	 * Type of signing package.
	 */
	type: 'swap' | 'melt';
	/**
	 * For melt packages only.
	 */
	quote?: string;
	/**
	 * Minimal input data required for signing verification.
	 */
	inputs: Array<Pick<Proof, 'secret' | 'C'>>;
	/**
	 * NUT-00 `BlindedMessages` for signing verification.
	 */
	outputs: SerializedBlindedMessage[];
	/**
	 * Per-format digests to support multiple SIG_ALL formats.
	 */
	digests: {
		/**
		 * For Nutshell (all releases), CDK < 0.14.0.
		 */
		legacy?: string;
		/**
		 * From CDK >= 0.14.0.
		 */
		current: string;
	};
	/**
	 * Signatures collected (to be injected into the first proof witness).
	 */
	witness?: { signatures: string[] };
};

function computeDigests(
	inputs: Array<Pick<Proof, 'secret' | 'C'>>,
	outputs: SerializedBlindedMessage[],
	quoteId?: string,
): SigAllDigests {
	const sigAllOutputs = outputs.map((blindedMessage) => ({ blindedMessage }));
	const legacyMsg = buildLegacyP2PKSigAllMessage(inputs, sigAllOutputs, quoteId);
	const currentMsg = buildP2PKSigAllMessage(inputs, sigAllOutputs, quoteId);

	return {
		legacy: computeMessageDigest(legacyMsg, true),
		current: computeMessageDigest(currentMsg, true),
	};
}

function serializePackage(pkg: SigAllSigningPackage): string {
	// Build object with fixed key order for determinism
	const ordered: Record<string, unknown> = { version: pkg.version, type: pkg.type };

	if (pkg.quote) ordered.quote = pkg.quote;

	ordered.inputs = pkg.inputs;
	ordered.outputs = pkg.outputs;

	if (pkg.digests) ordered.digests = pkg.digests;
	if (pkg.witness) ordered.witness = pkg.witness;

	const json = JSON.stringify(ordered);
	const base64url = encodeUint8toBase64Url(Bytes.fromString(json));

	return `${SIGALL_PREFIX}${base64url}`;
}

function deserializePackage(
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

		if (typeof inp.secret !== 'string') throw new Error(`Input ${i}: secret must be string`);

		if (typeof inp.C !== 'string') throw new Error(`Input ${i}: C must be string`);
	}

	if (!Array.isArray(pkg.outputs)) {
		throw new Error('Signing package outputs must be an array');
	}

	for (let i = 0; i < pkg.outputs.length; i++) {
		const output = pkg.outputs[i] as Record<string, unknown>;

		if (!output || typeof output !== 'object') throw new Error(`Invalid output at index ${i}`);

		if (typeof output.amount !== 'number') throw new Error(`Output ${i}: amount must be number`);

		if (!output.B_ || typeof output.B_ !== 'string') throw new Error(`Output ${i}: B_ invalid`);

		if (!output.id || typeof output.id !== 'string') throw new Error(`Output ${i}: id invalid`);
	}

	const digests = pkg.digests as Record<string, string> | undefined;
	if (!digests || typeof digests.current !== 'string' || digests.current.length === 0) {
		throw new Error('Signing package digests.current is required');
	}

	// Optional digest validation
	if (options?.validateDigest) {
		const recomputed = computeDigests(pkg.inputs, pkg.outputs, pkg.quote);
		if (recomputed.current !== digests.current) {
			throw new Error('Digest validation failed');
		}
	}

	return pkg;
}

function signPackage(pkg: SigAllSigningPackage, privkey: string): SigAllSigningPackage {
	const newSigs: string[] = [];

	if (!pkg.digests?.current) {
		throw new Error('digests.current is required to sign package');
	}

	// Sign precomputed digests
	newSigs.push(schnorrSignDigest(pkg.digests.current, privkey));
	if (pkg.digests.legacy) {
		newSigs.push(schnorrSignDigest(pkg.digests.legacy, privkey));
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

function extractSwapPackage(preview: SwapPreview): SigAllSigningPackage {
	// Merge keep + send outputs in order (both needed for complete transaction message)
	const allOutputs = [...(preview.keepOutputs || []), ...(preview.sendOutputs || [])];
	return buildSigningPackage(
		'swap',
		preview.inputs,
		allOutputs.map((output) => output.blindedMessage),
	);
}

function extractMeltPackage<TQuote extends MeltQuoteBaseResponse>(
	preview: MeltPreview<TQuote>,
): SigAllSigningPackage {
	return buildSigningPackage(
		'melt',
		preview.inputs,
		preview.outputData.map((output) => output.blindedMessage),
		preview.quote.quote,
	);
}

function buildSigningPackage(
	type: 'swap' | 'melt',
	inputs: Array<Pick<Proof, 'secret' | 'C'>>,
	outputs: SerializedBlindedMessage[],
	quoteId?: string,
): SigAllSigningPackage {
	// compute legacy and current SIG_ALL digests for backward compatibility
	const digests = computeDigests(inputs, outputs, quoteId);

	// verify current digest was computed correctly (catches bugs).
	const sigAllOutputs = outputs.map((blindedMessage) => ({ blindedMessage }));
	const msg = buildP2PKSigAllMessage(inputs, sigAllOutputs, quoteId);
	const expected = computeMessageDigest(msg, true);

	if (digests.current !== expected) {
		throw new Error(
			'SIG_ALL digest computation mismatch - current digest does not match expected value',
		);
	}

	return {
		version: 'cashu-sigall-v1',
		type,
		...(quoteId ? { quote: quoteId } : {}),
		inputs: inputs.map((p) => ({ secret: p.secret, C: p.C })),
		outputs,
		digests,
	};
}

function mergeSwapPackage(pkg: SigAllSigningPackage, preview: SwapPreview): SwapPreview {
	const updatedInputs = mergeSignatures(preview.inputs, pkg);
	return { ...preview, inputs: updatedInputs };
}

function mergeMeltPackage<TQuote extends MeltQuoteBaseResponse>(
	pkg: SigAllSigningPackage,
	preview: MeltPreview<TQuote>,
): MeltPreview<TQuote> {
	const updatedInputs = mergeSignatures(preview.inputs, pkg);
	return { ...preview, inputs: updatedInputs };
}

function mergeSignatures(proofs: Proof[], pkg: SigAllSigningPackage): Proof[] {
	if (!pkg.witness?.signatures.length) {
		throw new Error('No signatures to merge');
	}

	if (proofs.length === 0) return proofs;

	const [first, ...rest] = proofs;
	const witnessData = parseWitnessData(first.witness);
	const existingSignatures = witnessData?.signatures ?? [];
	const updatedFirst: Proof = {
		...first,
		witness: {
			...(witnessData ?? {}),
			signatures: [...existingSignatures, ...pkg.witness.signatures],
		} as P2PKWitness,
	};

	return [updatedFirst, ...rest];
}

/**
 * Helpers for SigAll multi-party signing coordination.
 *
 * @experimental
 */
export type SigAllApi = {
	/**
	 * Computes legacy and current SIG_ALL formats.
	 *
	 * @remarks
	 * Returns hex-encoded SHA256 digests for each format to support multi-format signing.
	 * @param inputs Proof array.
	 * @param outputs Array of SerializedBlindMessage (NUT-00 `BlindMessages`).
	 * @param quoteId Optional quote ID for melt transactions.
	 * @returns Object with legacy, and current digests (all hex strings)
	 * @experimental
	 */
	computeDigests: (
		inputs: Array<Pick<Proof, 'secret' | 'C'>>,
		outputs: SerializedBlindedMessage[],
		quoteId?: string,
	) => SigAllDigests;

	/**
	 * Extracts a signing package from a SwapPreview for multi-party SIG_ALL coordination.
	 *
	 * @remarks
	 * This creates a minimal, serializable package that can be passed to other signers. Secrets and
	 * blinding factors are NOT included - only what's needed to reconstruct the exact SIG_ALL message
	 * and produce signatures.
	 * @param preview SwapPreview from prepareSwapToSend or prepareSwapToReceive.
	 * @returns SigAllSigningPackage for distribution to signers.
	 * @experimental
	 */
	extractSwapPackage: (preview: SwapPreview) => SigAllSigningPackage;

	/**
	 * Extracts a signing package from a MeltPreview for multi-party SIG_ALL coordination.
	 *
	 * @param preview MeltPreview from prepareMelt.
	 * @returns SigAllSigningPackage for distribution to signers.
	 * @experimental
	 */
	extractMeltPackage: <TQuote extends MeltQuoteBaseResponse>(
		preview: MeltPreview<TQuote>,
	) => SigAllSigningPackage;

	/**
	 * @remarks
	 * Produces a deterministic JSON representation, base64url-encodes it and prefixes with sigallA
	 * for transport.
	 *
	 * - Field order is fixed and version field is always included for compatibility.
	 * - This enables consistent hashing and verification of package integrity.
	 *
	 * @param pkg The signing package to serialize.
	 * @returns JSON string with sorted keys.
	 * @experimental
	 */
	serializePackage: (pkg: SigAllSigningPackage) => string;

	/**
	 * @remarks
	 * Accepts a sigallA-prefixed base64url string and rehydrates it into a SigAllSigningPackage.
	 * @experimental
	 */
	deserializePackage: (
		input: string,
		options?: { validateDigest?: boolean },
	) => SigAllSigningPackage;

	/**
	 * Signs a SigAllSigningPackage and returns it with signatures attached.
	 *
	 * @remarks
	 * Collects signatures by signing legacy and current SIG_ALL formats for backward compatibility.
	 * Multiple parties can call this sequentially to aggregate signatures for multi-party signing.
	 * @param pkg The signing package (from extract*SigningPackage or another signer)
	 * @param privkey Private key to sign with.
	 * @returns Package with signatures appended to witness field.
	 * @experimental
	 */
	signPackage: (pkg: SigAllSigningPackage, privkey: string) => SigAllSigningPackage;

	/**
	 * Signs a hex-encoded digest with a Schnorr key.
	 */
	signDigest: (hexDigest: string, privkey: string) => string;

	/**
	 * Merges signatures from a signing package back into a SwapPreview.
	 *
	 * @remarks
	 * Injects collected signatures into the first proof's witness for mint submission. Call this
	 * after all parties have signed.
	 * @param pkg Signing package with collected signatures.
	 * @param preview Original SwapPreview.
	 * @returns SwapPreview ready for completeSwap.
	 * @experimental
	 */
	mergeSwapPackage: (pkg: SigAllSigningPackage, preview: SwapPreview) => SwapPreview;

	/**
	 * Merges signatures from a signing package back into a MeltPreview.
	 *
	 * @param pkg Signing package with collected signatures.
	 * @param preview Original MeltPreview.
	 * @returns MeltPreview ready for completeMelt.
	 * @experimental
	 */
	mergeMeltPackage: <TQuote extends MeltQuoteBaseResponse>(
		pkg: SigAllSigningPackage,
		preview: MeltPreview<TQuote>,
	) => MeltPreview<TQuote>;
};

/**
 * @experimental
 */
export const SigAll: SigAllApi = {
	computeDigests,
	extractSwapPackage,
	extractMeltPackage,
	serializePackage,
	deserializePackage,
	signPackage,
	signDigest: schnorrSignDigest,
	mergeSwapPackage,
	mergeMeltPackage,
};
