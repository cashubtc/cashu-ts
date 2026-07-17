import { test, describe, expect } from 'vitest';

import {
  SigAll,
  type SigAllSigningPackage,
  MeltQuoteState,
  Amount,
  CTSError,
  type OutputDataLike,
  type Proof,
  type P2PKWitness,
  type SerializedBlindedMessage,
  type MeltPreview,
  type SwapPreview,
} from '../../src';

const dummyProof: Proof = {
  id: 'testid',
  amount: Amount.from(32),
  secret: 'dummysecret',
  C: '02' + '1'.repeat(64),
};

// B_ must be hex: the v1 message builder decodes it to raw bytes.
const dummyBlindedMessage: SerializedBlindedMessage = {
  amount: Amount.from(32),
  id: 'bm1',
  B_: '02' + '2'.repeat(64),
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
    amount: Amount.from(32),
    fees: Amount.from(0),
    keysetIdts: [],
    method: 'swap',
    keysetId: 'dummy-keyset-id',
  } as SwapPreview;
}

function makeMeltPreview() {
  return {
    inputs: [dummyProof],
    outputData: [dummyOutput],
    quote: {
      quote: 'dummyquote',
      amount: Amount.from(32),
      unit: 'sat',
      state: MeltQuoteState.PENDING,
      expiry: Date.now() + 10000,
    },
    amount: Amount.from(32),
    fees: 0,
    keysetIdts: [],
    method: 'melt',
    keysetId: 'dummy-keyset-id',
  } as MeltPreview;
}

// Helper: encode an arbitrary object as a sigallA-prefixed string,
// bypassing serializePackage so we can craft invalid payloads.
function encodeRaw(obj: unknown): string {
  const json = JSON.stringify(obj);
  const b64 = btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `sigallA${b64}`;
}

function decodeRawJson(input: string): string {
  const base64url = input.slice('sigallA'.length);
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  return atob(padded);
}

describe('SigAll — computeDigests', () => {
  test('produces hex strings of correct length', () => {
    const digests = SigAll.computeDigests([dummyProof], [dummyBlindedMessage], 'dummyquote');
    expect(typeof digests.legacy).toBe('string');
    expect(typeof digests.current).toBe('string');
    expect(typeof digests.v1).toBe('string');
    expect(digests.legacy.length).toBe(64);
    expect(digests.current.length).toBe(64);
    expect(digests.v1.length).toBe(64);
  });

  test('legacy, current and v1 digests all differ', () => {
    const digests = SigAll.computeDigests([dummyProof], [dummyBlindedMessage]);
    expect(digests.legacy).not.toBe(digests.current);
    expect(digests.v1).not.toBe(digests.current);
    expect(digests.v1).not.toBe(digests.legacy);
  });

  test('quoteId changes the digests', () => {
    const without = SigAll.computeDigests([dummyProof], [dummyBlindedMessage]);
    const with_ = SigAll.computeDigests([dummyProof], [dummyBlindedMessage], 'somequote');
    expect(without.current).not.toBe(with_.current);
    expect(without.v1).not.toBe(with_.v1);
  });
});

describe('SigAll — extractSwapPackage', () => {
  test('produces valid package shape', () => {
    const pkg = SigAll.extractSwapPackage(makeSwapPreview());
    expect(pkg.version).toBe('sigallA');
    expect(pkg.type).toBe('swap');
    expect(pkg.quote).toBeUndefined();
    expect(pkg.inputs.length).toBe(1);
    expect(pkg.outputs.length).toBe(2); // keepOutputs + sendOutputs
    expect(pkg.digests.current.length).toBe(64);
    expect(pkg.digests.legacy!.length).toBe(64);
    expect(pkg.digests.v1!.length).toBe(64);
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
    expect(pkg.version).toBe('sigallA');
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
});

describe('SigAll — serializePackage / deserializePackage', () => {
  test('round-trip preserves all fields', () => {
    const pkg: SigAllSigningPackage = {
      version: 'sigallA',
      type: 'swap',
      inputs: [{ secret: 'testsecret', C: '02' + '1'.repeat(64) }],
      outputs: [dummyBlindedMessage],
      digests: SigAll.computeDigests([dummyProof], [dummyBlindedMessage]),
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

  test('round-trip preserves large (unsafe integer) output amounts', () => {
    const largeAmount = Amount.from(9007199254740993n); // > MAX_SAFE_INTEGER
    const largeBm: SerializedBlindedMessage = {
      amount: largeAmount,
      id: 'bm-large',
      B_: '02' + '2'.repeat(64),
    };
    const pkg: SigAllSigningPackage = {
      version: 'sigallA',
      type: 'swap',
      inputs: [{ secret: 'testsecret', C: '02' + '1'.repeat(64) }],
      outputs: [largeBm],
      digests: SigAll.computeDigests([dummyProof], [largeBm]),
    };
    const parsed = SigAll.deserializePackage(SigAll.serializePackage(pkg));
    expect(parsed.outputs[0].amount.equals(largeAmount)).toBeTruthy();
  });

  test('deserializePackage accepts numeric output amounts', () => {
    const parsed = SigAll.deserializePackage(
      encodeRaw({
        version: 'sigallA',
        type: 'swap',
        inputs: [{ secret: 'testsecret', C: '02' + '1'.repeat(64) }],
        outputs: [{ amount: 32, id: 'bm1', B_: '02' + '2'.repeat(64) }],
        digests: SigAll.computeDigests(
          [dummyProof],
          [{ amount: Amount.from(32), id: 'bm1', B_: '02' + '2'.repeat(64) }],
        ),
      }),
    );

    expect(parsed.outputs[0].amount.equals(Amount.from(32))).toBeTruthy();
  });

  test('serializePackage emits unquoted integer amounts', () => {
    const largeAmount = Amount.from(9007199254740993n);
    const largeBm: SerializedBlindedMessage = {
      amount: largeAmount,
      id: 'bm-large',
      B_: '02' + '2'.repeat(64),
    };
    const pkg: SigAllSigningPackage = {
      version: 'sigallA',
      type: 'swap',
      inputs: [{ secret: 'testsecret', C: '02' + '1'.repeat(64) }],
      outputs: [largeBm],
      digests: SigAll.computeDigests([dummyProof], [largeBm]),
    };

    const json = decodeRawJson(SigAll.serializePackage(pkg));
    expect(json).toContain('"amount":9007199254740993');
    expect(json).not.toContain('"amount":"9007199254740993"');
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

  test('throws on invalid JSON', () => {
    const encoded = 'sigallA' + btoa('{not valid json}').replace(/=+$/, '');
    expect(() => SigAll.deserializePackage(encoded)).toThrow('Failed to parse signing package');
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
          version: 'sigallA',
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
          version: 'sigallA',
          type: 'swap',
          inputs: 'notanarray',
          outputs: [],
          digests: { current: 'a'.repeat(64) },
        }),
      ),
    ).toThrow('inputs must be an array');
  });

  test('throws on invalid input shape — missing secret', () => {
    expect(() =>
      SigAll.deserializePackage(
        encodeRaw({
          version: 'sigallA',
          type: 'swap',
          inputs: [{ C: 'abc' }],
          outputs: [],
          digests: { current: 'a'.repeat(64) },
        }),
      ),
    ).toThrow('secret must be string');
  });

  test('throws on invalid input shape — missing C', () => {
    expect(() =>
      SigAll.deserializePackage(
        encodeRaw({
          version: 'sigallA',
          type: 'swap',
          inputs: [{ secret: 'x' }],
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
          version: 'sigallA',
          type: 'swap',
          inputs: [],
          outputs: 'notanarray',
          digests: { current: 'a'.repeat(64) },
        }),
      ),
    ).toThrow('outputs must be an array');
  });

  test('throws on invalid output entry', () => {
    expect(() =>
      SigAll.deserializePackage(
        encodeRaw({
          version: 'sigallA',
          type: 'swap',
          inputs: [],
          outputs: [null],
          digests: { current: 'a'.repeat(64) },
        }),
      ),
    ).toThrow('Invalid output at index 0');
  });

  test('throws on invalid output shape — missing amount', () => {
    expect(() =>
      SigAll.deserializePackage(
        encodeRaw({
          version: 'sigallA',
          type: 'swap',
          inputs: [],
          outputs: [{ B_: 'x', id: 'id1' }],
          digests: { current: 'a'.repeat(64) },
        }),
      ),
    ).toThrow('amount must be a number or bigint');
  });

  test('throws on invalid output shape — missing B_', () => {
    expect(() =>
      SigAll.deserializePackage(
        encodeRaw({
          version: 'sigallA',
          type: 'swap',
          inputs: [],
          outputs: [{ amount: 1, id: 'id1' }],
          digests: { current: 'a'.repeat(64) },
        }),
      ),
    ).toThrow('B_ invalid');
  });

  test('throws on invalid output shape — missing id', () => {
    expect(() =>
      SigAll.deserializePackage(
        encodeRaw({
          version: 'sigallA',
          type: 'swap',
          inputs: [],
          outputs: [{ amount: 1, B_: 'x' }],
          digests: { current: 'a'.repeat(64) },
        }),
      ),
    ).toThrow('id invalid');
  });

  test('throws if digests.current is missing', () => {
    expect(() =>
      SigAll.deserializePackage(
        encodeRaw({
          version: 'sigallA',
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
          version: 'sigallA',
          type: 'swap',
          inputs: [],
          outputs: [],
          digests: { current: '' },
        }),
      ),
    ).toThrow('digests.current is required');
  });

  test('digest validation passes on correct digest', () => {
    const pkg = SigAll.extractSwapPackage(makeSwapPreview());
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

  test('signs every digest present (legacy + current + v1)', () => {
    const pkg = SigAll.extractSwapPackage(makeSwapPreview());
    expect(pkg.digests.legacy).toBeDefined();
    expect(pkg.digests.v1).toBeDefined();
    const signed = SigAll.signPackage(pkg, dummyPrivkey);
    expect(signed.witness?.signatures.length).toBe(3);
  });

  test('signs only current when legacy and v1 are absent (older peer package)', () => {
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
    const digests = SigAll.computeDigests([dummyProof], [dummyBlindedMessage]);
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

describe('SigAll — serializePackage omits falsy optional fields', () => {
  test('empty/falsy quote, digests and witness are not emitted', () => {
    // serializePackage only adds a key when its value is truthy; falsy optionals
    // (eg an empty quote) must stay out of the transport JSON.
    const pkg = {
      version: 'sigallA',
      type: 'swap',
      quote: '',
      inputs: [{ secret: 'testsecret', C: '02' + '1'.repeat(64) }],
      outputs: [dummyBlindedMessage],
      digests: null,
      witness: null,
    } as unknown as SigAllSigningPackage;

    const json = decodeRawJson(SigAll.serializePackage(pkg));
    expect(json).not.toContain('"quote"');
    expect(json).not.toContain('"digests"');
    expect(json).not.toContain('"witness"');
  });
});

describe('SigAll — deserializePackage error causes', () => {
  test('JSON parse failure attaches the underlying error as cause', () => {
    const encoded = 'sigallA' + btoa('{not valid json}').replace(/=+$/, '');
    let err: unknown;
    try {
      SigAll.deserializePackage(encoded);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CTSError);
    expect((err as { cause?: unknown }).cause).toBeInstanceOf(Error);
  });
});

describe('SigAll — deserializePackage input/output shape guards', () => {
  test('rejects a null input entry', () => {
    expect(() =>
      SigAll.deserializePackage(
        encodeRaw({
          version: 'sigallA',
          type: 'swap',
          inputs: [null],
          outputs: [],
          digests: { current: 'a'.repeat(64) },
        }),
      ),
    ).toThrow('Invalid input at index 0');
  });

  test('rejects a non-object (primitive) input entry', () => {
    expect(() =>
      SigAll.deserializePackage(
        encodeRaw({
          version: 'sigallA',
          type: 'swap',
          inputs: [5],
          outputs: [],
          digests: { current: 'a'.repeat(64) },
        }),
      ),
    ).toThrow('Invalid input at index 0');
  });

  test('rejects a non-object (primitive) output entry', () => {
    expect(() =>
      SigAll.deserializePackage(
        encodeRaw({
          version: 'sigallA',
          type: 'swap',
          inputs: [],
          outputs: [5],
          digests: { current: 'a'.repeat(64) },
        }),
      ),
    ).toThrow('Invalid output at index 0');
  });

  test('rejects a non-string B_ on an output', () => {
    expect(() =>
      SigAll.deserializePackage(
        encodeRaw({
          version: 'sigallA',
          type: 'swap',
          inputs: [],
          outputs: [{ amount: 1, B_: 123, id: 'id1' }],
          digests: { current: 'a'.repeat(64) },
        }),
      ),
    ).toThrow('B_ invalid');
  });

  test('rejects a non-string id on an output', () => {
    expect(() =>
      SigAll.deserializePackage(
        encodeRaw({
          version: 'sigallA',
          type: 'swap',
          inputs: [],
          outputs: [{ amount: 1, B_: 'x', id: 123 }],
          digests: { current: 'a'.repeat(64) },
        }),
      ),
    ).toThrow('id invalid');
  });

  test('rejects a non-string digests.current', () => {
    expect(() =>
      SigAll.deserializePackage(
        encodeRaw({
          version: 'sigallA',
          type: 'swap',
          inputs: [],
          outputs: [],
          digests: { current: 123 },
        }),
      ),
    ).toThrow('digests.current is required');
  });
});

describe('SigAll — deserializePackage legacy digest validation', () => {
  test('throws when only the legacy digest is tampered', () => {
    // current digest stays valid so validation must fall through to the legacy check.
    const pkg = SigAll.extractSwapPackage(makeSwapPreview());
    const tampered = {
      ...pkg,
      digests: { current: pkg.digests.current, legacy: pkg.digests.legacy!.slice(0, 63) + '0' },
    };
    expect(() =>
      SigAll.deserializePackage(SigAll.serializePackage(tampered), { validateDigest: true }),
    ).toThrow('legacy digest mismatch');
  });
});

describe('SigAll — signPackage requires a current digest', () => {
  test('throws when digests is absent', () => {
    const pkg = SigAll.extractSwapPackage(makeSwapPreview());
    const noDigests = { ...pkg, digests: undefined } as unknown as SigAllSigningPackage;
    expect(() => SigAll.signPackage(noDigests, dummyPrivkey)).toThrow(
      'digests.current is required to sign package',
    );
  });
});

describe('SigAll — extractSwapPackage output-list fallbacks', () => {
  test('treats missing keepOutputs as no keep outputs', () => {
    const preview = { ...makeSwapPreview(), keepOutputs: undefined } as unknown as SwapPreview;
    const pkg = SigAll.extractSwapPackage(preview);
    expect(pkg.outputs.length).toBe(1); // sendOutputs only
  });

  test('treats missing sendOutputs as no send outputs', () => {
    const preview = { ...makeSwapPreview(), sendOutputs: undefined } as unknown as SwapPreview;
    const pkg = SigAll.extractSwapPackage(preview);
    expect(pkg.outputs.length).toBe(1); // keepOutputs only
  });
});

describe('SigAll — mergeSignatures edge cases', () => {
  test('returns proofs unchanged when there are no inputs', () => {
    const signed = SigAll.signPackage(SigAll.extractSwapPackage(makeSwapPreview()), dummyPrivkey);
    const preview = { ...makeSwapPreview(), inputs: [] };
    let merged: SwapPreview | undefined;
    expect(() => {
      merged = SigAll.mergeSwapPackage(signed, preview);
    }).not.toThrow();
    expect(merged!.inputs.length).toBe(0);
  });

  test('does not inject spurious signatures when the first proof has no witness', () => {
    const preview = makeSwapPreview();
    const signed = SigAll.signPackage(SigAll.extractSwapPackage(preview), dummyPrivkey);
    const merged = SigAll.mergeSwapPackage(signed, preview);
    const sigs = (merged.inputs[0].witness as P2PKWitness).signatures!;
    // Exactly the package signatures, nothing prepended.
    expect(sigs.length).toBe(signed.witness!.signatures.length);
    expect(sigs).not.toContain('Stryker was here');
  });

  test('preserves non-signature witness fields (eg HTLC preimage) on the first proof', () => {
    const proofWithPreimage: Proof = {
      ...dummyProof,
      witness: { preimage: 'deadbeef', signatures: ['x'] },
    };
    const preview = { ...makeSwapPreview(), inputs: [proofWithPreimage] };
    const signed = SigAll.signPackage(SigAll.extractSwapPackage(preview), dummyPrivkey);
    const merged = SigAll.mergeSwapPackage(signed, preview);
    expect((merged.inputs[0].witness as { preimage?: string }).preimage).toBe('deadbeef');
  });
});
