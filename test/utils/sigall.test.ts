import {
	computeSigAllDigests,
	serializeSigningPackage,
	deserializeSigningPackage,
	signSigningPackage,
	signHexDigest,
	extractSwapSigningPackage,
	extractMeltSigningPackage,
	mergeSignaturesToSwapPreview,
	mergeSignaturesToMeltPreview,
	SigAllSigningPackage,
} from '../../src/utils/sigall';
import type { Proof, P2PKWitness, SerializedBlindedMessage } from '../../src/model/types';
import type { OutputDataLike } from '../../src/model/OutputData';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/curves/utils.js';
import { test, describe, expect } from 'vitest';
import { MeltQuoteState } from '../../src/model/types/NUT05';

// Dummy data for tests
const dummyProof: Proof = {
	id: 'testid',
	amount: 42,
	secret: 'dummysecret',
	C: '02' + '1'.repeat(64),
};

const dummyBlindedMessage: SerializedBlindedMessage = {
	amount: 42,
	id: 'bm1',
	B_: 'dummyB',
};

const dummyOutput: OutputDataLike = {
	blindedMessage: dummyBlindedMessage,
	blindingFactor: 0n,
	secret: new Uint8Array(),
	toProof: () => dummyProof,
};

const dummyPrivkey = '1'.repeat(64); // Minimal valid secp256k1 hex scalar

function makeSwapPreview() {
	return {
		inputs: [dummyProof],
		keepOutputs: [dummyOutput],
		sendOutputs: [dummyOutput],
		amount: 42,
		fees: 0,
		keysetIdts: [],
		method: 'swap',
		keysetId: 'dummy-keyset-id',
	};
}

function makeMeltPreview() {
	return {
		inputs: [dummyProof],
		outputData: [dummyOutput],
		quote: {
			quote: 'dummyquote',
			amount: 42,
			unit: 'sat',
			state: MeltQuoteState.PENDING,
			expiry: Date.now() + 10000,
		},
		amount: 42,
		fees: 0,
		keysetIdts: [],
		method: 'melt',
		keysetId: 'dummy-keyset-id',
	};
}

describe('SIGALL helpers', () => {
	test('computeSigAllDigests produces all formats', () => {
		const digests = computeSigAllDigests([dummyProof], [dummyOutput], 'dummyquote');
		expect(typeof digests.legacy).toBe('string');
		expect(typeof digests.interim).toBe('string');
		expect(typeof digests.current).toBe('string');
		expect(digests.legacy.length).toBe(64);
		expect(digests.current.length).toBe(64);
	});

	test('serialize/deserialize round-trip', () => {
		const pkg: SigAllSigningPackage = {
			version: 'cashu-sigall-v1',
			type: 'swap',
			inputs: [{ id: 'testid', amount: 42, C: 'dummyC' }],
			outputs: [{ amount: 42, blindedMessage: dummyBlindedMessage }],
			digests: computeSigAllDigests([dummyProof], [dummyOutput]),
			witness: { signatures: ['sig1'] },
		};
		const json = serializeSigningPackage(pkg);
		const parsed = deserializeSigningPackage(json);
		expect(parsed.version).toBe(pkg.version);
		expect(parsed.type).toBe(pkg.type);
		expect(parsed.inputs.length).toBe(1);
		expect(parsed.outputs.length).toBe(1);
		expect(parsed.witness?.signatures[0]).toBe('sig1');
	});

	test('deserialize fails on invalid version', () => {
		const pkg = { version: 'bad-version', type: 'swap', inputs: [], outputs: [] };
		expect(() => deserializeSigningPackage(JSON.stringify(pkg))).toThrow();
	});

	test('digest validation throws on mismatch', () => {
		// Compute real digests, then mutate one char for controlled failure
		const pkg = extractSwapSigningPackage(makeSwapPreview());
		const badDigests = { ...pkg.digests, current: pkg.digests!.current.slice(0, 63) + '0' };
		const badPkg = { ...pkg, digests: badDigests };
		expect(() =>
			deserializeSigningPackage(serializeSigningPackage(badPkg), { validateDigest: true }),
		).toThrow();
	});
	test('serialize is deterministic', () => {
		const pkg = extractSwapSigningPackage(makeSwapPreview());
		const a = serializeSigningPackage(pkg);
		const b = serializeSigningPackage(pkg);
		expect(a).toBe(b);
	});

	test('merge works with no existing witness', () => {
		const preview = makeSwapPreview();
		const pkg = extractSwapSigningPackage(preview);
		pkg.witness = { signatures: ['aa'] };
		const merged = mergeSignaturesToSwapPreview(pkg, preview);
		expect((merged.inputs[0].witness as P2PKWitness).signatures).toContain('aa');
	});

	test('signSigningPackage appends signatures (multi-party)', () => {
		const pkg = extractSwapSigningPackage(makeSwapPreview());
		const s1 = signSigningPackage(pkg, dummyPrivkey);
		const s2 = signSigningPackage(s1, dummyPrivkey);
		expect(s2.witness?.signatures.length).toBeGreaterThan(1);
	});

	test('transport roundtrip works', () => {
		const pkg = extractSwapSigningPackage(makeSwapPreview());
		const json = serializeSigningPackage(pkg);
		const parsed = deserializeSigningPackage(json);
		const signed = signSigningPackage(parsed, dummyPrivkey);
		expect(signed.witness?.signatures.length).toBeGreaterThan(0);
	});

	test('extractSwapSigningPackage produces valid package', () => {
		const preview = makeSwapPreview();
		const pkg = extractSwapSigningPackage(preview);
		expect(pkg.version).toBe('cashu-sigall-v1');
		expect(pkg.type).toBe('swap');
		expect(pkg.inputs.length).toBe(1);
		expect(pkg.outputs.length).toBe(2);
		expect(pkg.digests?.current.length).toBe(64);
	});

	test('extractMeltSigningPackage produces valid package', () => {
		const preview = makeMeltPreview();
		const pkg = extractMeltSigningPackage(preview);
		expect(pkg.version).toBe('cashu-sigall-v1');
		expect(pkg.type).toBe('melt');
		expect(pkg.inputs.length).toBe(1);
		expect(pkg.outputs.length).toBe(1);
		expect(pkg.digests?.current.length).toBe(64);
	});

	test('signSigningPackage appends signatures', () => {
		const preview = makeSwapPreview();
		const pkg = extractSwapSigningPackage(preview);
		const signed = signSigningPackage(pkg, dummyPrivkey);
		expect(signed.witness?.signatures.length).toBeGreaterThan(0);
	});

	test('mergeSignaturesToSwapPreview appends signatures', () => {
		const preview = makeSwapPreview();
		const pkg = extractSwapSigningPackage(preview);
		const signed = signSigningPackage(pkg, dummyPrivkey);
		const merged = mergeSignaturesToSwapPreview(signed, preview);
		expect(merged.inputs[0].witness).toBeDefined();
		expect((merged.inputs[0].witness as P2PKWitness).signatures?.length).toBeGreaterThan(0);
	});

	test('mergeSignaturesToMeltPreview appends signatures', () => {
		const preview = makeMeltPreview();
		const pkg = extractMeltSigningPackage(preview);
		const signed = signSigningPackage(pkg, dummyPrivkey);
		const merged = mergeSignaturesToMeltPreview(signed, preview);
		expect(merged.inputs[0].witness).toBeDefined();
		expect((merged.inputs[0].witness as P2PKWitness).signatures?.length).toBeGreaterThan(0);
	});

	test('signHexDigest produces a hex signature', () => {
		const digest = bytesToHex(sha256(new TextEncoder().encode('test')));
		const sig = signHexDigest(digest, dummyPrivkey);
		expect(typeof sig).toBe('string');
		expect(sig.length).toBeGreaterThan(0);
	});
});
