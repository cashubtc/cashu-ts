import { SigAll, SigAllSigningPackage } from '../../src/model/SigAll';
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
		const digests = SigAll.computeDigests([dummyProof], [dummyOutput], 'dummyquote');
		expect(typeof digests.legacy).toBe('string');
		expect(typeof digests.current).toBe('string');
		expect(digests.legacy.length).toBe(64);
		expect(digests.current.length).toBe(64);
	});

	test('serialize/deserialize round-trip', () => {
		const pkg: SigAllSigningPackage = {
			version: 'cashu-sigall-v1',
			type: 'swap',
			inputs: [{ id: 'testid', amount: 42, C: '02' + '1'.repeat(64) }],
			outputs: [{ amount: 42, blindedMessage: dummyBlindedMessage }],
			digests: SigAll.computeDigests([dummyProof], [dummyOutput]),
			witness: { signatures: ['sig1'] },
		};

		const encoded = SigAll.serializePackage(pkg);
		// console.log('[serialize output]', encoded);

		const parsed = SigAll.deserializePackage(encoded);
		// console.log('[deserialize output]', JSON.stringify(parsed, null, 2));

		expect(encoded.startsWith('sigallA')).toBe(true);
		expect(parsed.version).toBe(pkg.version);
		expect(parsed.type).toBe(pkg.type);
		expect(parsed.inputs.length).toBe(1);
		expect(parsed.outputs.length).toBe(1);
		expect(parsed.witness?.signatures[0]).toBe('sig1');
	});

	test('deserialize fails on invalid version', () => {
		const badPkg = { version: 'bad-version', type: 'swap', inputs: [], outputs: [] };
		const encoded =
			'sigallA' +
			btoa(JSON.stringify(badPkg)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
		expect(() => SigAll.deserializePackage(encoded)).toThrow();
	});

	test('digest validation throws on mismatch', () => {
		// Compute real digests, then mutate one char for controlled failure
		const pkg = SigAll.extractSwapPackage(makeSwapPreview());
		const badDigests = { ...pkg.digests, current: pkg.digests!.current.slice(0, 63) + '0' };
		const badPkg = { ...pkg, digests: badDigests };
		const encoded = SigAll.serializePackage(badPkg);
		expect(() => SigAll.deserializePackage(encoded, { validateDigest: true })).toThrow();
	});
	test('serialize is deterministic', () => {
		const pkg = SigAll.extractSwapPackage(makeSwapPreview());
		const a = SigAll.serializePackage(pkg);
		const b = SigAll.serializePackage(pkg);
		expect(a).toBe(b);
	});

	test('merge works with no existing witness', () => {
		const preview = makeSwapPreview();
		const pkg = SigAll.extractSwapPackage(preview);
		pkg.witness = { signatures: ['aa'] };
		const merged = SigAll.mergeSwapPackage(pkg, preview);
		expect((merged.inputs[0].witness as P2PKWitness).signatures).toContain('aa');
	});

	test('signSigningPackage appends signatures (multi-party)', () => {
		const pkg = SigAll.extractSwapPackage(makeSwapPreview());
		const s1 = SigAll.signPackage(pkg, dummyPrivkey);
		const s2 = SigAll.signPackage(s1, dummyPrivkey);
		expect(s2.witness?.signatures.length).toBeGreaterThan(1);
	});

	test('transport roundtrip works', () => {
		const pkg = SigAll.extractSwapPackage(makeSwapPreview());
		const json = SigAll.serializePackage(pkg);
		const parsed = SigAll.deserializePackage(json);
		const signed = SigAll.signPackage(parsed, dummyPrivkey);
		expect(signed.witness?.signatures.length).toBeGreaterThan(0);
	});

	test('extractSwapSigningPackage produces valid package', () => {
		const preview = makeSwapPreview();
		const pkg = SigAll.extractSwapPackage(preview);
		expect(pkg.version).toBe('cashu-sigall-v1');
		expect(pkg.type).toBe('swap');
		expect(pkg.inputs.length).toBe(1);
		expect(pkg.outputs.length).toBe(2);
		expect(pkg.digests?.current.length).toBe(64);
	});

	test('extractMeltSigningPackage produces valid package', () => {
		const preview = makeMeltPreview();
		const pkg = SigAll.extractMeltPackage(preview);
		expect(pkg.version).toBe('cashu-sigall-v1');
		expect(pkg.type).toBe('melt');
		expect(pkg.inputs.length).toBe(1);
		expect(pkg.outputs.length).toBe(1);
		expect(pkg.digests?.current.length).toBe(64);
	});

	test('signSigningPackage appends signatures', () => {
		const preview = makeSwapPreview();
		const pkg = SigAll.extractSwapPackage(preview);
		const signed = SigAll.signPackage(pkg, dummyPrivkey);
		expect(signed.witness?.signatures.length).toBeGreaterThan(0);
	});

	test('mergeSignaturesToSwapPreview appends signatures', () => {
		const preview = makeSwapPreview();
		const pkg = SigAll.extractSwapPackage(preview);
		const signed = SigAll.signPackage(pkg, dummyPrivkey);
		const merged = SigAll.mergeSwapPackage(signed, preview);
		expect(merged.inputs[0].witness).toBeDefined();
		expect((merged.inputs[0].witness as P2PKWitness).signatures?.length).toBeGreaterThan(0);
	});

	test('mergeSignaturesToMeltPreview appends signatures', () => {
		const preview = makeMeltPreview();
		const pkg = SigAll.extractMeltPackage(preview);
		const signed = SigAll.signPackage(pkg, dummyPrivkey);
		const merged = SigAll.mergeMeltPackage(signed, preview);
		expect(merged.inputs[0].witness).toBeDefined();
		expect((merged.inputs[0].witness as P2PKWitness).signatures?.length).toBeGreaterThan(0);
	});

	test('signHexDigest produces a hex signature', () => {
		const digest = bytesToHex(sha256(new TextEncoder().encode('test')));
		const sig = SigAll.signDigest(digest, dummyPrivkey);
		expect(typeof sig).toBe('string');
		expect(sig.length).toBeGreaterThan(0);
	});
});
