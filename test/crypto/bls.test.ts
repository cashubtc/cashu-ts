import { bytesToHex, hexToBytes, numberToBytesBE } from '@noble/curves/utils.js';
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { concatBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { describe, expect, test } from 'vitest';
import {
  BLS_FR_ORDER,
  BLS_HASH_TO_CURVE_DST,
  hashToCurveBls,
  blindMessageBls,
  unblindSignatureBls,
  createBlindSignatureBls,
  verifyUnblindedSignatureBls,
  batchVerifyUnblindedSignatureBls,
  deriveBatchWeights,
  pointFromHexG1,
  pointFromHexG2,
} from '../../src/crypto/bls';
import { CTSError } from '../../src/model/Errors';

// NUT-00 v3 round-trip vector (nuts/tests/00-tests.md "BLS12-381 (v3) round-trip"). The same hex
// values appear in the upstream Python reference (Nutshell PR #999: cashu/core/crypto/bls_dhke.py
// + tests/test_crypto.py::test_deterministic_bls_steps).
const NUTS_SECRET = 'test_message';
const NUTS_Y_HEX =
  '860d58e5aeda1376185436ed96412313424cc079e056d1dab595e6db4c2c9685fec7da052c8db68d88985b75a42388ad';
const NUTS_K_HEX =
  'aa4edef9c1ed7f729f520e47730a124fd70662a904ba1074728114d1031e1572c6c886f6b57ec72a6178288c47c335771638533957d540a9d2370f17cc7ed5863bc0b995b8825e0ee1ea1e1e4d00dbae81f14b0bf3611b78c952aacab827a053';
const NUTS_B_HEX =
  '8e88c5f6a93f653784a66b033a00e52128499e18b095c2a56f080d1c2a937ffc9ef4600804a48d087bbd1f662f6b068f';
const NUTS_C_BLIND_HEX =
  '8d52d7a6cbe5e99858d5c15c092d11a0c387c78917471211082a6e5afc2a79680dfa188fafe5d4a51c5398ce160e7a16';
const NUTS_C_HEX =
  'b7a4881059133fd91a8753600d9a5e524c65d6224f6fe2d5aef9e59f1507fdad90b3b4d48ee46da5c8dfaa0b88e28b69';

const NUTS_G2_HEX =
  '93e02b6052719f607dacd3a088274f65596bd0d09920b61ab5da61bbdc7f5049334cf11213945d57e5ac7d055d042b7e024aa2b2f08f0a91260805272dc51051c6e47ad4fa403b02b4510b647ae3d1770bac0326a805bbefd48056c8c121bdb8';

// NUT-00 v3 batch-verification vector (nuts/tests/00-tests.md "BLS12-381 (v3) batch verification").
// Two proofs signed under K = 2·G2 with secrets "batch_proof_1"/r=5 and "batch_proof_2"/r=7.
const NUTS_BATCH_C1_HEX =
  'acebf797506a7031cef3189904715cb22792528f1ea0e6ab25341401d245539438ed97122f00e38ee6185cc20b09ba11';
const NUTS_BATCH_C2_HEX =
  '9776497ad47a00f8a56233fb88f939b0572cf174a4c6d2446c0b1060434e305fae6845fd1f68b70376ba53ffe67f0414';
const NUTS_BATCH_CHALLENGE_HEX = '539b5df396e82adab0760459590d38122d2552bc74f6bd860e915ff3b95e550a';
// BLS_BATCH_DST is module-private inside `bls.ts`. Re-declared here so the batch test pins both the
// DST bytes and the transcript shape independently of any future internal refactor.
const BLS_BATCH_DST_BYTES = utf8ToBytes('Cashu_BLS_Batch_v1');

describe('BLS constants', () => {
  test('DST matches Nutshell', () => {
    expect(BLS_HASH_TO_CURVE_DST).toBe('CASHU_BLS12_381_G1_XMD:SHA-256_SSWU_RO_');
  });

  test('Fr order matches Nutshell curve_order', () => {
    expect(BLS_FR_ORDER).toBe(
      52435875175126190479447740508185965837690552500527637822603658699938581184513n,
    );
  });

  test("noble's G2 BASE matches Nutshell hardcoded _G2_HEX", () => {
    expect(bytesToHex(bls12_381.G2.Point.BASE.toBytes(true))).toBe(NUTS_G2_HEX);
  });

  test('K = 2·G2 matches NUT-00 v3 round-trip vector hex', () => {
    // Lock-in for nuts/tests/00-tests.md "BLS12-381 (v3) round-trip" K value.
    expect(bytesToHex(bls12_381.G2.Point.BASE.multiply(2n).toBytes(true))).toBe(NUTS_K_HEX);
  });
});

describe('point parsing rejects the identity', () => {
  // Compressed identity encodings per IETF: top bit set + infinity bit set, rest zero.
  // G1: 48 bytes / 96 hex chars; G2: 96 bytes / 192 hex chars.
  const G1_ZERO_HEX = 'c0' + '00'.repeat(47);
  const G2_ZERO_HEX = 'c0' + '00'.repeat(95);

  test('pointFromHexG1 throws CTSError on G1 identity', () => {
    expect(() => pointFromHexG1(G1_ZERO_HEX)).toThrow(CTSError);
  });

  test('pointFromHexG2 throws CTSError on G2 identity', () => {
    expect(() => pointFromHexG2(G2_ZERO_HEX)).toThrow(CTSError);
  });

  // NUT-00 Point Validation: encodings whose stripped field coordinate is >= p must be rejected.
  // Constructed by taking the field prime p, encoding it as 48-byte BE, and ORing the compression
  // bit. noble's permissive decoder would silently mod-reduce to x=0; our wrapper rejects.
  const FP_P_HEX =
    '1a0111ea397fe69a4b1ba7b6434bacd764774b84f38512bf6730d2a0f6b0f6241eabfffeb153ffffb9feffffffffaaab';
  const G1_NONCANONICAL_HEX = '9' + FP_P_HEX.slice(1); // top nibble = 1001 (set compression bit)
  const G2_NONCANONICAL_HEX = G1_NONCANONICAL_HEX + '00'.repeat(48); // c1=p, c0=0
  // c1 bytes: 0x80 || 47 zeros (compression flag, c1 coord = 0); c0 bytes: p
  const G2_NONCANONICAL_C0_HEX = '80' + '00'.repeat(47) + FP_P_HEX;

  test('pointFromHexG1 rejects coordinate >= p', () => {
    expect(() => pointFromHexG1(G1_NONCANONICAL_HEX)).toThrow(/non-canonical/);
  });

  test('pointFromHexG2 rejects c1 >= p', () => {
    expect(() => pointFromHexG2(G2_NONCANONICAL_HEX)).toThrow(/non-canonical/);
  });

  test('pointFromHexG2 rejects c0 >= p', () => {
    expect(() => pointFromHexG2(G2_NONCANONICAL_C0_HEX)).toThrow(/non-canonical/);
  });
});

describe('hashToCurveBls', () => {
  test('matches NUT-00 v3 Y for secret "test_message"', () => {
    // Direct lock-in for nuts/tests/00-tests.md "BLS12-381 (v3) round-trip" Y value. The B_/C_/C
    // round-trip below already exercises Y transitively, but pinning Y itself catches a DST or
    // hash-to-curve regression without needing the rest of the pipeline.
    const Y = hashToCurveBls(new TextEncoder().encode(NUTS_SECRET));
    expect(bytesToHex(Y.toBytes(true))).toBe(NUTS_Y_HEX);
  });

  test('matches Nutshell B_ when multiplied by r=3', () => {
    const Y = hashToCurveBls(new TextEncoder().encode(NUTS_SECRET));
    const B_ = Y.multiply(3n);
    expect(bytesToHex(B_.toBytes(true))).toBe(NUTS_B_HEX);
  });
});

describe('BLS deterministic round-trip (Nutshell test_deterministic_bls_steps)', () => {
  const secret = new TextEncoder().encode(NUTS_SECRET);

  test('blindMessageBls (r=3) reproduces B_', () => {
    const { B_, r } = blindMessageBls(secret, 3n);
    expect(r).toBe(3n);
    expect(bytesToHex(B_.toBytes(true))).toBe(NUTS_B_HEX);
  });

  test('createBlindSignatureBls (a=2) reproduces C_', () => {
    const { B_ } = blindMessageBls(secret, 3n);
    const aBytes = hexToBytes('0'.repeat(63) + '2'); // 32-byte BE encoding of 2
    const { C_, id } = createBlindSignatureBls(B_, aBytes, 'test');
    expect(id).toBe('test');
    expect(bytesToHex(C_.toBytes(true))).toBe(NUTS_C_BLIND_HEX);
  });

  test('unblindSignatureBls (r=3) reproduces C', () => {
    const { B_ } = blindMessageBls(secret, 3n);
    const aBytes = hexToBytes('0'.repeat(63) + '2');
    const { C_ } = createBlindSignatureBls(B_, aBytes, 'test');
    const C = unblindSignatureBls(C_, 3n);
    expect(bytesToHex(C.toBytes(true))).toBe(NUTS_C_HEX);
  });

  test('blindMessageBls rejects r=0', () => {
    expect(() => blindMessageBls(secret, 0n)).toThrow();
  });

  test('unblindSignatureBls rejects r=0', () => {
    const Y = hashToCurveBls(secret);
    expect(() => unblindSignatureBls(Y, 0n)).toThrow();
  });
});

describe('verifyUnblindedSignatureBls (single pairing)', () => {
  const secret = new TextEncoder().encode(NUTS_SECRET);
  const aBytes = hexToBytes('0'.repeat(63) + '2');
  const K2 = bls12_381.G2.Point.BASE.multiply(2n);

  test('accepts a valid (C, K2, secret) triple', () => {
    const { B_ } = blindMessageBls(secret, 3n);
    const { C_ } = createBlindSignatureBls(B_, aBytes, 'k');
    const C = unblindSignatureBls(C_, 3n);
    expect(verifyUnblindedSignatureBls(K2, C, secret)).toBe(true);
  });

  test('rejects when secret differs', () => {
    const { B_ } = blindMessageBls(secret, 3n);
    const { C_ } = createBlindSignatureBls(B_, aBytes, 'k');
    const C = unblindSignatureBls(C_, 3n);
    expect(verifyUnblindedSignatureBls(K2, C, new TextEncoder().encode('other'))).toBe(false);
  });

  test('rejects when K2 is wrong', () => {
    const { B_ } = blindMessageBls(secret, 3n);
    const { C_ } = createBlindSignatureBls(B_, aBytes, 'k');
    const C = unblindSignatureBls(C_, 3n);
    const wrongK2 = bls12_381.G2.Point.BASE.multiply(7n);
    expect(verifyUnblindedSignatureBls(wrongK2, C, secret)).toBe(false);
  });

  test('parses K2 from Nutshell hex', () => {
    const K2parsed = pointFromHexG2(bytesToHex(K2.toBytes(true)));
    expect(K2parsed.equals(K2)).toBe(true);
  });

  test('returns false (not throws) when C is the point at infinity', () => {
    expect(() => verifyUnblindedSignatureBls(K2, bls12_381.G1.Point.ZERO, secret)).not.toThrow();
    expect(verifyUnblindedSignatureBls(K2, bls12_381.G1.Point.ZERO, secret)).toBe(false);
  });

  test('returns false (not throws) when K2 is the point at infinity', () => {
    const { B_ } = blindMessageBls(secret, 3n);
    const { C_ } = createBlindSignatureBls(B_, aBytes, 'k');
    const C = unblindSignatureBls(C_, 3n);
    expect(() => verifyUnblindedSignatureBls(bls12_381.G2.Point.ZERO, C, secret)).not.toThrow();
    expect(verifyUnblindedSignatureBls(bls12_381.G2.Point.ZERO, C, secret)).toBe(false);
  });
});

describe('batchVerifyUnblindedSignatureBls', () => {
  function makeProof(secretStr: string, r: bigint, aScalar: bigint) {
    const secret = new TextEncoder().encode(secretStr);
    const aBytes = hexToBytes(aScalar.toString(16).padStart(64, '0'));
    const K2 = bls12_381.G2.Point.BASE.multiply(aScalar);
    const { B_ } = blindMessageBls(secret, r);
    const { C_ } = createBlindSignatureBls(B_, aBytes, 'k');
    const C = unblindSignatureBls(C_, r);
    return { K2, C, secret };
  }

  test('accepts a mixed-denomination batch under one mint key', () => {
    const items = [makeProof('s1', 3n, 5n), makeProof('s2', 4n, 5n), makeProof('s3', 7n, 5n)];
    expect(batchVerifyUnblindedSignatureBls(items)).toBe(true);
  });

  test('accepts a batch across multiple mint keys', () => {
    const items = [makeProof('s1', 3n, 5n), makeProof('s2', 4n, 11n), makeProof('s3', 7n, 5n)];
    expect(batchVerifyUnblindedSignatureBls(items)).toBe(true);
  });

  test('rejects when one proof is forged', () => {
    const items = [makeProof('s1', 3n, 5n), makeProof('s2', 4n, 5n)];
    // Swap C between items so secret/C no longer agree.
    const broken = [items[0], { ...items[1], C: items[0].C }];
    expect(batchVerifyUnblindedSignatureBls(broken)).toBe(false);
  });

  // Forgery attack: given a single aggregated signature C' = a·(Y1+Y2), an attacker picks any
  // C1 and sets C2 := C' - C1. The un-weighted batch check passes (Σ C = C' on the left,
  // Y1+Y2 on the right); the weighted check we actually run must reject it. This is the
  // protocol-critical property — without per-proof randomness, one signed B_ = (Y1+Y2)·r would
  // expand into two spendable proofs.
  test('rejects the C1 + C2 = C aggregation forgery (per-proof randomness)', () => {
    const aScalar = 5n;
    const aBytes = hexToBytes(aScalar.toString(16).padStart(64, '0'));
    const K2 = bls12_381.G2.Point.BASE.multiply(aScalar);
    const secret1 = new TextEncoder().encode('forgery-victim-1');
    const secret2 = new TextEncoder().encode('forgery-victim-2');
    const Y1 = hashToCurveBls(secret1);
    const Y2 = hashToCurveBls(secret2);

    // The mint signs the aggregate once: C' = a·(Y1+Y2). The attacker has C' but no individual
    // signature on Y1 or Y2.
    const Cprime = Y1.add(Y2).multiply(aScalar);

    // Attacker picks an arbitrary C1 (here: a·Y1 + a·Y2 + nonsense — any G1 point works) and
    // computes C2 = C' - C1.
    const C1 = bls12_381.G1.Point.BASE.multiply(123456789n);
    const C2 = Cprime.subtract(C1);

    const forged = [
      { K2, C: C1, secret: secret1 },
      { K2, C: C2, secret: secret2 },
    ];

    // Sanity: the un-weighted aggregation check that the attack exploits *would* pass.
    const Yagg = Y1.add(Y2);
    const Cagg = C1.add(C2);
    expect(
      bls12_381.fields.Fp12.eql(
        bls12_381.pairing(Cagg, bls12_381.G2.Point.BASE),
        bls12_381.pairing(Yagg, K2),
      ),
    ).toBe(true);

    // Per-proof randomness must reject it. Run many times to catch any accidental rᵢ-coincidence
    // (the only way the attack passes is r₁ == r₂, P ≈ 2⁻²⁵⁵).
    for (let i = 0; i < 8; i++) {
      expect(batchVerifyUnblindedSignatureBls(forged)).toBe(false);
    }
    // And per-proof verify (which has no batch shortcut to attack) must also reject.
    expect(
      bls12_381.fields.Fp12.eql(
        bls12_381.pairing(C1, bls12_381.G2.Point.BASE),
        bls12_381.pairing(Y1, K2),
      ),
    ).toBe(false);
  });

  test('empty batch is vacuously true', () => {
    expect(batchVerifyUnblindedSignatureBls([])).toBe(true);
  });

  test('returns false (not throws) when any item has C at infinity', () => {
    const items = [makeProof('s1', 3n, 5n), makeProof('s2', 4n, 5n)];
    const withZeroC = [items[0], { ...items[1], C: bls12_381.G1.Point.ZERO }];
    expect(() => batchVerifyUnblindedSignatureBls(withZeroC)).not.toThrow();
    expect(batchVerifyUnblindedSignatureBls(withZeroC)).toBe(false);
  });

  test('returns false (not throws) when any item has K2 at infinity', () => {
    const items = [makeProof('s1', 3n, 5n), makeProof('s2', 4n, 5n)];
    const withZeroK2 = [items[0], { ...items[1], K2: bls12_381.G2.Point.ZERO }];
    expect(() => batchVerifyUnblindedSignatureBls(withZeroK2)).not.toThrow();
    expect(batchVerifyUnblindedSignatureBls(withZeroK2)).toBe(false);
  });
});

describe('deriveBatchWeights (Fiat-Shamir transcript)', () => {
  function makeItem(secretStr: string, r: bigint, aScalar: bigint) {
    const secret = new TextEncoder().encode(secretStr);
    const aBytes = hexToBytes(aScalar.toString(16).padStart(64, '0'));
    const K2 = bls12_381.G2.Point.BASE.multiply(aScalar);
    const { B_ } = blindMessageBls(secret, r);
    const { C_ } = createBlindSignatureBls(B_, aBytes, 'k');
    const C = unblindSignatureBls(C_, r);
    return { K2, C, secret };
  }

  const itemsA = () => [makeItem('s1', 3n, 5n), makeItem('s2', 4n, 5n), makeItem('s3', 7n, 11n)];

  test('same inputs → identical weights (deterministic, no CSPRNG dependency)', () => {
    const ws1 = deriveBatchWeights(itemsA());
    const ws2 = deriveBatchWeights(itemsA());
    expect(ws1).toEqual(ws2);
    expect(ws1).toHaveLength(3);
  });

  test('every weight is in [1, BLS_FR_ORDER)', () => {
    const ws = deriveBatchWeights(itemsA());
    for (const r of ws) {
      expect(r).toBeGreaterThan(0n);
      expect(r).toBeLessThan(BLS_FR_ORDER);
    }
  });

  test('tampering with C changes the weights (transcript commits to C)', () => {
    const baseline = deriveBatchWeights(itemsA());
    const tampered = itemsA();
    tampered[1] = { ...tampered[1], C: tampered[0].C }; // mutate just the C of item 1
    const altered = deriveBatchWeights(tampered);
    expect(altered).not.toEqual(baseline);
  });

  test('tampering with K2 changes the weights (transcript commits to K2)', () => {
    const baseline = deriveBatchWeights(itemsA());
    const tampered = itemsA();
    tampered[1] = { ...tampered[1], K2: bls12_381.G2.Point.BASE.multiply(99n) };
    const altered = deriveBatchWeights(tampered);
    expect(altered).not.toEqual(baseline);
  });

  test('tampering with secret changes the weights (transcript commits to secret)', () => {
    const baseline = deriveBatchWeights(itemsA());
    const tampered = itemsA();
    tampered[1] = { ...tampered[1], secret: new TextEncoder().encode('s2-but-different') };
    const altered = deriveBatchWeights(tampered);
    expect(altered).not.toEqual(baseline);
  });

  test('item reordering changes weights (position is committed)', () => {
    const baseline = deriveBatchWeights(itemsA());
    const reordered = itemsA();
    [reordered[0], reordered[2]] = [reordered[2], reordered[0]];
    const altered = deriveBatchWeights(reordered);
    expect(altered).not.toEqual(baseline);
  });

  test('length-prefix prevents secret-boundary collision (s1||s2 vs differently split)', () => {
    // Two items whose concatenated secrets are byte-identical to a different split.
    // Without length-prefixing, an attacker could shift bytes between adjacent secrets and
    // produce the same transcript; the length prefix makes that impossible.
    const aBytes = hexToBytes('0'.repeat(63) + '5');
    const K2 = bls12_381.G2.Point.BASE.multiply(5n);
    const Cdummy = bls12_381.G1.Point.BASE; // same C for both shapes so only secret differs
    const A = [
      { K2, C: Cdummy, secret: new TextEncoder().encode('AAAA') },
      { K2, C: Cdummy, secret: new TextEncoder().encode('BBBB') },
    ];
    const B = [
      { K2, C: Cdummy, secret: new TextEncoder().encode('AAA') },
      { K2, C: Cdummy, secret: new TextEncoder().encode('ABBBB') },
    ];
    expect(deriveBatchWeights(A)).not.toEqual(deriveBatchWeights(B));
    void aBytes;
  });

  test('matches NUT-00 batch test vector byte-for-byte', () => {
    // Lock-in for nuts/tests/00-tests.md "BLS12-381 (v3) batch verification". Two proofs signed
    // under K = 2·G2 with secrets "batch_proof_1"/r=5 and "batch_proof_2"/r=7. The hex values pinned
    // below cover every published vector value: C_1, C_2 (the unblinded signatures), the Fiat-Shamir
    // challenge, and weight_1/weight_2. If hash-to-curve, the transcript shape, or the rejection-
    // sampling derivation changes, this test fails and signals a spec divergence.
    const a = 2n;
    const aBytes = hexToBytes('0'.repeat(63) + '2');
    const K = bls12_381.G2.Point.BASE.multiply(a);
    const items = (
      [
        ['batch_proof_1', 5n],
        ['batch_proof_2', 7n],
      ] as Array<[string, bigint]>
    ).map(([sec, r]) => {
      const secret = new TextEncoder().encode(sec);
      const { B_ } = blindMessageBls(secret, r);
      const { C_ } = createBlindSignatureBls(B_, aBytes, 'k');
      const C = unblindSignatureBls(C_, r);
      return { K2: K, C, secret };
    });

    // C_1, C_2 — unblinded signatures from the vector.
    expect(bytesToHex(items[0].C.toBytes(true))).toBe(NUTS_BATCH_C1_HEX);
    expect(bytesToHex(items[1].C.toBytes(true))).toBe(NUTS_BATCH_C2_HEX);

    // challenge — recompute the transcript locally per NUT-00 and assert the SHA-256 hex. This is
    // independent of `deriveBatchWeights` and locks the transcript shape (DST + per-item C || K ||
    // u32_BE(|secret|) || secret) byte-for-byte against the spec.
    const transcript = concatBytes(
      BLS_BATCH_DST_BYTES,
      ...items.flatMap((it) => [
        it.C.toBytes(true),
        it.K2.toBytes(true),
        numberToBytesBE(it.secret.length, 4),
        it.secret,
      ]),
    );
    expect(bytesToHex(sha256(transcript))).toBe(NUTS_BATCH_CHALLENGE_HEX);

    const weights = deriveBatchWeights(items).map((w) => w.toString(16).padStart(64, '0'));
    expect(weights).toEqual([
      '0e7ff8be2ccb756d4ef390991bdd77eb65e8db624a2729fa1657c3cf8d7d4b55',
      '6d026a181a6215b233e73b121d01908a1a1eb6911955bea5130bbf2f2966554d',
    ]);
    expect(batchVerifyUnblindedSignatureBls(items)).toBe(true);
  });

  test('batchVerify result is deterministic across runs', () => {
    // With Fiat-Shamir weights, same input → same boolean by construction (no CSPRNG flakiness
    // to hedge against). A couple of iterations is enough to lock the property without burning
    // pairing time under coverage instrumentation.
    const good = itemsA();
    const bad = itemsA();
    bad[0] = { ...bad[0], C: bad[1].C };
    for (let i = 0; i < 3; i++) {
      expect(batchVerifyUnblindedSignatureBls(good)).toBe(true);
      expect(batchVerifyUnblindedSignatureBls(bad)).toBe(false);
    }
  });
});
