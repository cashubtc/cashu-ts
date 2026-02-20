import { SigAll, SigAllSigningPackage } from '../../src/model/SigAll';
import type { Proof, P2PKWitness, SerializedBlindedMessage } from '../../src/model/types';
import type { OutputDataLike } from '../../src/model/OutputData';
import { test, describe, expect } from 'vitest';
import { MeltQuoteState } from '../../src/model/types/NUT05';

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

const dummyPrivkey = '1'.repeat(64);

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

// Helper: encode an arbitrary object as a sigallA-prefixed string,
// bypassing serializePackage so we can craft invalid payloads.
function encodeRaw(obj: unknown): string {
	const json = JSON.stringify(obj);
	const b64 = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	return `sigallA${b64}`;
}

describe('SigAll — computeDigests', () => {
	test('produces hex strings of correct length', () => {
		const digests = SigAll.computeDigests([dummyProof], [dummyOutput], 'dummyquote');
		expect(typeof digests.legacy).toBe('string');
		expect(typeof digests.current).toBe('string');
		expect(digests.legacy.length).toBe(64);
		expect(digests.current.length).toBe(64);
	});

	test('legacy and current digests differ', () => {
		const digests = SigAll.computeDigests([dummyProof], [dummyOutput]);
		expect(digests.legacy).not.toBe(digests.current);
	});

	test('quoteId changes the digests', () => {
		const without = SigAll.computeDigests([dummyProof], [dummyOutput]);
		const with_ = SigAll.computeDigests([dummyProof], [dummyOutput], 'somequote');
		expect(without.current).not.toBe(with_.current);
	});
});

describe('SigAll — extractSwapPackage', () => {
	test('produces valid package shape', () => {
		const pkg = SigAll.extractSwapPackage(makeSwapPreview());
		expect(pkg.version).toBe('cashu-sigall-v1');
		expect(pkg.type).toBe('swap');
		expect(pkg.quote).toBeUndefined();
		expect(pkg.inputs.length).toBe(1);
		expect(pkg.outputs.length).toBe(2); // keepOutputs + sendOutputs
		expect(pkg.digests.current.length).toBe(64);
		expect(pkg.digests.legacy!.length).toBe(64);
	});

	test('sanitizes inputs — no secret field', () => {
		const pkg = SigAll.extractSwapPackage(makeSwapPreview());
		expect((pkg.inputs[0] as Record<string, unknown>).secret).toBeUndefined();
	});

	test('merges keepOutputs and sendOutputs in order', () => {
		const preview = makeSwapPreview();
		const pkg = SigAll.extractSwapPackage(preview);
		// 1 keepOutput + 1 sendOutput = 2 outputs
		expect(pkg.outputs.length).toBe(2);
	});

	test('works with empty keepOutputs', () => {
		const preview = { ...makeSwapPreview(), keepOutputs: [] };
		const pkg = SigAll.extractSwapPackage(preview);
		expect(pkg.outputs.length).toBe(1);
	});

	test('works with empty sendOutputs', () => {
		const preview = { ...makeSwapPreview(), sendOutputs: [] };
		const pkg = SigAll.extractSwapPackage(preview);
		expect(pkg.outputs.length).toBe(1);
	});
});

describe('SigAll — extractMeltPackage', () => {
	test('produces valid package shape', () => {
		const pkg = SigAll.extractMeltPackage(makeMeltPreview());
		expect(pkg.version).toBe('cashu-sigall-v1');
		expect(pkg.type).toBe('melt');
		expect(pkg.quote).toBe('dummyquote');
		expect(pkg.inputs.length).toBe(1);
		expect(pkg.outputs.length).toBe(1);
		expect(pkg.digests.current.length).toBe(64);
	});

	test('includes quote id', () => {
		const pkg = SigAll.extractMeltPackage(makeMeltPreview());
		expect(pkg.quote).toBe('dummyquote');
	});

	test('sanitizes inputs — no secret field', () => {
		const pkg = SigAll.extractMeltPackage(makeMeltPreview());
		expect((pkg.inputs[0] as Record<string, unknown>).secret).toBeUndefined();
	});
});

describe('SigAll — serializePackage / deserializePackage', () => {
	test('round-trip preserves all fields', () => {
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

	test('round-trip preserves melt quote', () => {
		const pkg = SigAll.extractMeltPackage(makeMeltPreview());
		const parsed = SigAll.deserializePackage(SigAll.serializePackage(pkg));
		expect(parsed.quote).toBe('dummyquote');
		expect(parsed.type).toBe('melt');
	});

	test('serialization is deterministic', () => {
		const pkg = SigAll.extractSwapPackage(makeSwapPreview());
		expect(SigAll.serializePackage(pkg)).toBe(SigAll.serializePackage(pkg));
	});

	test('throws if prefix is missing', () => {
		expect(() => SigAll.deserializePackage('notasigallstring')).toThrow(
			'must start with "sigallA"',
		);
	});

	test('throws on invalid base64', () => {
		expect(() => SigAll.deserializePackage('sigallA!!!invalid!!!')).toThrow(
			'Failed to parse signing package',
		);
	});

	test('throws on non-object JSON', () => {
		const encoded = 'sigallA' + btoa('"just a string"').replace(/=+$/, '');
		expect(() => SigAll.deserializePackage(encoded)).toThrow('must be a JSON object');
	});

	test('throws on invalid version', () => {
		expect(() =>
			SigAll.deserializePackage(
				encodeRaw({
					version: 'bad-version',
					type: 'swap',
					inputs: [],
					outputs: [],
					digests: { current: 'a'.repeat(64) },
				}),
			),
		).toThrow('Invalid signing package version');
	});

	test('throws on invalid type', () => {
		expect(() =>
			SigAll.deserializePackage(
				encodeRaw({
					version: 'cashu-sigall-v1',
					type: 'unknown',
					inputs: [],
					outputs: [],
					digests: { current: 'a'.repeat(64) },
				}),
			),
		).toThrow('Invalid signing package type');
	});

	test('throws if inputs is not an array', () => {
		expect(() =>
			SigAll.deserializePackage(
				encodeRaw({
					version: 'cashu-sigall-v1',
					type: 'swap',
					inputs: 'notanarray',
					outputs: [],
					digests: { current: 'a'.repeat(64) },
				}),
			),
		).toThrow('inputs must be an array');
	});

	test('throws on invalid input shape — missing id', () => {
		expect(() =>
			SigAll.deserializePackage(
				encodeRaw({
					version: 'cashu-sigall-v1',
					type: 'swap',
					inputs: [{ amount: 1, C: 'abc' }],
					outputs: [],
					digests: { current: 'a'.repeat(64) },
				}),
			),
		).toThrow('id must be string');
	});

	test('throws on invalid input shape — missing amount', () => {
		expect(() =>
			SigAll.deserializePackage(
				encodeRaw({
					version: 'cashu-sigall-v1',
					type: 'swap',
					inputs: [{ id: 'x', C: 'abc' }],
					outputs: [],
					digests: { current: 'a'.repeat(64) },
				}),
			),
		).toThrow('amount must be number');
	});

	test('throws on invalid input shape — missing C', () => {
		expect(() =>
			SigAll.deserializePackage(
				encodeRaw({
					version: 'cashu-sigall-v1',
					type: 'swap',
					inputs: [{ id: 'x', amount: 1 }],
					outputs: [],
					digests: { current: 'a'.repeat(64) },
				}),
			),
		).toThrow('C must be string');
	});

	test('throws if outputs is not an array', () => {
		expect(() =>
			SigAll.deserializePackage(
				encodeRaw({
					version: 'cashu-sigall-v1',
					type: 'swap',
					inputs: [],
					outputs: 'notanarray',
					digests: { current: 'a'.repeat(64) },
				}),
			),
		).toThrow('outputs must be an array');
	});

	test('throws on invalid output shape — missing amount', () => {
		expect(() =>
			SigAll.deserializePackage(
				encodeRaw({
					version: 'cashu-sigall-v1',
					type: 'swap',
					inputs: [],
					outputs: [{ blindedMessage: {} }],
					digests: { current: 'a'.repeat(64) },
				}),
			),
		).toThrow('amount must be number');
	});

	test('throws on invalid output shape — missing blindedMessage', () => {
		expect(() =>
			SigAll.deserializePackage(
				encodeRaw({
					version: 'cashu-sigall-v1',
					type: 'swap',
					inputs: [],
					outputs: [{ amount: 1 }],
					digests: { current: 'a'.repeat(64) },
				}),
			),
		).toThrow('blindedMessage invalid');
	});

	test('throws if digests.current is missing', () => {
		expect(() =>
			SigAll.deserializePackage(
				encodeRaw({
					version: 'cashu-sigall-v1',
					type: 'swap',
					inputs: [],
					outputs: [],
				}),
			),
		).toThrow('digests.current is required');
	});

	test('throws if digests.current is empty string', () => {
		expect(() =>
			SigAll.deserializePackage(
				encodeRaw({
					version: 'cashu-sigall-v1',
					type: 'swap',
					inputs: [],
					outputs: [],
					digests: { current: '' },
				}),
			),
		).toThrow('digests.current is required');
	});

	test('digest validation passes on correct digest', () => {
		// Use a proof with no secret — the build functions only use id/amount/C,
		// and deserializePackage reconstructs with secret: '', so they must match.
		const bareProof: Proof = { id: 'testid', amount: 42, secret: '', C: '02' + '1'.repeat(64) };
		const preview = {
			...makeSwapPreview(),
			inputs: [bareProof],
		};
		const pkg = SigAll.extractSwapPackage(preview);
		const encoded = SigAll.serializePackage(pkg);
		expect(() => SigAll.deserializePackage(encoded, { validateDigest: true })).not.toThrow();
	});

	test('digest validation throws on tampered current digest', () => {
		const pkg = SigAll.extractSwapPackage(makeSwapPreview());
		const tampered = {
			...pkg,
			digests: { ...pkg.digests, current: pkg.digests.current.slice(0, 63) + '0' },
		};
		expect(() =>
			SigAll.deserializePackage(SigAll.serializePackage(tampered), { validateDigest: true }),
		).toThrow('Digest validation failed');
	});
});

describe('SigAll — signPackage', () => {
	test('appends signatures to empty witness', () => {
		const pkg = SigAll.extractSwapPackage(makeSwapPreview());
		const signed = SigAll.signPackage(pkg, dummyPrivkey);
		expect(signed.witness?.signatures.length).toBeGreaterThan(0);
	});

	test('signs both legacy and current when legacy is present', () => {
		const pkg = SigAll.extractSwapPackage(makeSwapPreview());
		expect(pkg.digests.legacy).toBeDefined();
		const signed = SigAll.signPackage(pkg, dummyPrivkey);
		// legacy + current = 2 signatures
		expect(signed.witness?.signatures.length).toBe(2);
	});

	test('signs only current when legacy is absent', () => {
		const pkg = SigAll.extractSwapPackage(makeSwapPreview());
		const noLegacy: SigAllSigningPackage = {
			...pkg,
			digests: { current: pkg.digests.current },
		};
		const signed = SigAll.signPackage(noLegacy, dummyPrivkey);
		expect(signed.witness?.signatures.length).toBe(1);
	});

	test('accumulates signatures across multiple signers (multi-party)', () => {
		const pkg = SigAll.extractSwapPackage(makeSwapPreview());
		const s1 = SigAll.signPackage(pkg, dummyPrivkey);
		const s2 = SigAll.signPackage(s1, dummyPrivkey);
		expect(s2.witness!.signatures.length).toBeGreaterThan(s1.witness!.signatures.length);
	});

	test('preserves existing witness signatures', () => {
		const pkg = SigAll.extractSwapPackage(makeSwapPreview());
		const withWitness = { ...pkg, witness: { signatures: ['existing'] } };
		const signed = SigAll.signPackage(withWitness, dummyPrivkey);
		expect(signed.witness!.signatures).toContain('existing');
	});

	test('does not mutate original package', () => {
		const pkg = SigAll.extractSwapPackage(makeSwapPreview());
		SigAll.signPackage(pkg, dummyPrivkey);
		expect(pkg.witness).toBeUndefined();
	});
});

describe('SigAll — signDigest', () => {
	test('produces a hex string signature', () => {
		const digests = SigAll.computeDigests([dummyProof], [dummyOutput]);
		const sig = SigAll.signDigest(digests.current, dummyPrivkey);
		expect(typeof sig).toBe('string');
		expect(sig.length).toBeGreaterThan(0);
	});
});

describe('SigAll — mergeSwapPackage', () => {
	test('injects signatures into first proof witness', () => {
		const preview = makeSwapPreview();
		const pkg = SigAll.extractSwapPackage(preview);
		const signed = SigAll.signPackage(pkg, dummyPrivkey);
		const merged = SigAll.mergeSwapPackage(signed, preview);
		expect(merged.inputs[0].witness).toBeDefined();
		expect((merged.inputs[0].witness as P2PKWitness).signatures!.length).toBeGreaterThan(0);
	});

	test('only modifies first proof', () => {
		const secondProof: Proof = { ...dummyProof, id: 'second' };
		const preview = { ...makeSwapPreview(), inputs: [dummyProof, secondProof] };
		const pkg = SigAll.extractSwapPackage(preview);
		const signed = SigAll.signPackage(pkg, dummyPrivkey);
		const merged = SigAll.mergeSwapPackage(signed, preview);
		expect(merged.inputs[1].witness).toBeUndefined();
	});

	test('appends to existing proof witness signatures', () => {
		const existingWitness: P2PKWitness = { signatures: ['pre-existing'] };
		const proofWithWitness: Proof = { ...dummyProof, witness: existingWitness };
		const preview = { ...makeSwapPreview(), inputs: [proofWithWitness] };
		const pkg = SigAll.extractSwapPackage(preview);
		const signed = SigAll.signPackage(pkg, dummyPrivkey);
		const merged = SigAll.mergeSwapPackage(signed, preview);
		const sigs = (merged.inputs[0].witness as P2PKWitness).signatures;
		expect(sigs).toContain('pre-existing');
		expect(sigs!.length).toBeGreaterThan(1);
	});

	test('handles string-encoded existing witness', () => {
		const witnessStr = JSON.stringify({ signatures: ['str-encoded'] });
		const proofWithStringWitness: Proof = { ...dummyProof, witness: witnessStr };
		const preview = { ...makeSwapPreview(), inputs: [proofWithStringWitness] };
		const pkg = SigAll.extractSwapPackage(preview);
		const signed = SigAll.signPackage(pkg, dummyPrivkey);
		const merged = SigAll.mergeSwapPackage(signed, preview);
		const sigs = (merged.inputs[0].witness as P2PKWitness).signatures;
		expect(sigs).toContain('str-encoded');
	});

	test('handles malformed string witness gracefully', () => {
		const proofWithBadWitness: Proof = { ...dummyProof, witness: 'not-valid-json' };
		const preview = { ...makeSwapPreview(), inputs: [proofWithBadWitness] };
		const pkg = SigAll.extractSwapPackage(preview);
		const signed = SigAll.signPackage(pkg, dummyPrivkey);
		expect(() => SigAll.mergeSwapPackage(signed, preview)).not.toThrow();
	});

	test('throws if no signatures in package', () => {
		const preview = makeSwapPreview();
		const pkg = SigAll.extractSwapPackage(preview);
		expect(() => SigAll.mergeSwapPackage(pkg, preview)).toThrow('No signatures to merge');
	});
});

describe('SigAll — mergeMeltPackage', () => {
	test('injects signatures into first proof witness', () => {
		const preview = makeMeltPreview();
		const pkg = SigAll.extractMeltPackage(preview);
		const signed = SigAll.signPackage(pkg, dummyPrivkey);
		const merged = SigAll.mergeMeltPackage(signed, preview);
		expect(merged.inputs[0].witness).toBeDefined();
		expect((merged.inputs[0].witness as P2PKWitness).signatures!.length).toBeGreaterThan(0);
	});

	test('throws if no signatures in package', () => {
		const preview = makeMeltPreview();
		const pkg = SigAll.extractMeltPackage(preview);
		expect(() => SigAll.mergeMeltPackage(pkg, preview)).toThrow('No signatures to merge');
	});
});

describe('SigAll — full transport roundtrip', () => {
	test('swap: extract → serialize → deserialize → sign → merge', () => {
		const preview = makeSwapPreview();
		const pkg = SigAll.extractSwapPackage(preview);
		const encoded = SigAll.serializePackage(pkg);
		const decoded = SigAll.deserializePackage(encoded);
		const signed = SigAll.signPackage(decoded, dummyPrivkey);
		const merged = SigAll.mergeSwapPackage(signed, preview);
		expect((merged.inputs[0].witness as P2PKWitness).signatures!.length).toBeGreaterThan(0);
	});

	test('melt: extract → serialize → deserialize → sign → merge', () => {
		const preview = makeMeltPreview();
		const pkg = SigAll.extractMeltPackage(preview);
		const encoded = SigAll.serializePackage(pkg);
		const decoded = SigAll.deserializePackage(encoded);
		const signed = SigAll.signPackage(decoded, dummyPrivkey);
		const merged = SigAll.mergeMeltPackage(signed, preview);
		expect((merged.inputs[0].witness as P2PKWitness).signatures!.length).toBeGreaterThan(0);
	});
});
