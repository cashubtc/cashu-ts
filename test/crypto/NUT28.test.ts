import { schnorr, secp256k1 } from '@noble/curves/secp256k1.js';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, test } from 'vitest';

import { Amount } from '../../src';
import {
  pointFromHex,
  deriveP2BKSecretKey,
  deriveP2BKBlindedPubkeys,
  deriveP2BKSecretKeys,
  maybeDeriveP2BKPrivateKeys,
  signP2PKProof,
  verifyHTLCSpendingConditions,
  verifyP2PKSpendingConditions,
} from '../../src/crypto';
import { type Proof } from '../../src/model/types';
import { hexToNumber, numberToHexPadded64 } from '../../src/utils';

describe('blinded pubkeys & scalar arithmetic', () => {
  test('deriveP2BKSecretKey corresponds to pubkey addition: (p+r)·G == p·G + r·G', () => {
    const pHex = bytesToHex(secp256k1.utils.randomSecretKey());
    const rHex = bytesToHex(secp256k1.utils.randomSecretKey());
    const P = bytesToHex(secp256k1.getPublicKey(hexToBytes(pHex), true));
    const r = hexToNumber(rHex);
    const P_ = pointFromHex(P).add(secp256k1.Point.BASE.multiply(r)).toHex(true);
    const kHex = deriveP2BKSecretKey(pHex, rHex)!;
    const K = bytesToHex(secp256k1.getPublicKey(hexToBytes(kHex), true));
    expect(K).toBe(P_);
  });

  test('deriveP2BKSecretKey works with bigint inputs', () => {
    const p = hexToNumber(bytesToHex(secp256k1.utils.randomSecretKey()));
    const r = hexToNumber(bytesToHex(secp256k1.utils.randomSecretKey()));
    const pHex = numberToHexPadded64(p);
    const P = bytesToHex(secp256k1.getPublicKey(hexToBytes(pHex), true));
    const P_ = pointFromHex(P).add(secp256k1.Point.BASE.multiply(r)).toHex(true);
    const kHex = deriveP2BKSecretKey(p, r)!;
    const K = bytesToHex(secp256k1.getPublicKey(hexToBytes(kHex), true));
    expect(K).toBe(P_);
  });

  test('deriveP2BKSecretKey throws on invalid inputs', () => {
    const n = secp256k1.Point.CURVE().n;
    expect(() => deriveP2BKSecretKey(0n, 1n)).toThrow('Invalid private key');
    expect(() => deriveP2BKSecretKey(n, 1n)).toThrow('Invalid private key');
    expect(() => deriveP2BKSecretKey(1n, 0n)).toThrow('Invalid scalar r');
    expect(() => deriveP2BKSecretKey(1n, n)).toThrow('Invalid scalar r');
  });

  test('deriveP2BKSecretKey throws when k = 0', () => {
    const p = 1n;
    const r = secp256k1.Point.CURVE().n - 1n;
    expect(() => deriveP2BKSecretKey(p, r)).toThrow('Derived secret key is zero');
  });
});

describe('deriveP2BKSecretKey with expectedPub hints', () => {
  const n = secp256k1.Point.CURVE().n;

  // helper to make (p, r) where k1 != 0 and k2 != 0
  function makePr() {
    while (true) {
      const p = hexToNumber(bytesToHex(secp256k1.utils.randomSecretKey()));
      const r = hexToNumber(bytesToHex(secp256k1.utils.randomSecretKey()));
      if (p > 0n && p < n && r > 0n && r < n) {
        const k1 = (p + r) % n;
        const k2 = (n - p + r) % n;
        if (k1 !== 0n && k2 !== 0n) return { p, r, k1, k2 };
      }
    }
  }

  // convenience helpers
  const toHex = (x: bigint) => numberToHexPadded64(x);
  const compFromScalar = (x: bigint) => secp256k1.getPublicKey(hexToBytes(toHex(x)), true);

  test('picks k1 when expectedPub equals SECP1 (compressed) of k1', () => {
    const { p, r, k1 } = makePr();
    const pHex = toHex(p);
    const rHex = toHex(r);
    const Pprime = compFromScalar(k1); // P′ = k1·G
    const expectedPub = compFromScalar(p); // P = p·G
    const out = deriveP2BKSecretKey(pHex, rHex, Pprime, expectedPub);
    expect(out).toBe(toHex(k1));
  });

  test('selects k2 when expectedPub is the opposite-parity lift of P = p·G', () => {
    const { p, r, k1, k2 } = makePr();
    const pHex = toHex(p);
    const rHex = toHex(r);
    const Pprime = compFromScalar(k1); // valid blinded key: P′ = (p r)·G
    const Pself = compFromScalar(p); // P = p·G
    const expectedOpp = new Uint8Array(Pself); // flip 02<->03 to force opposite parity
    expectedOpp[0] ^= 0x01;
    const out = deriveP2BKSecretKey(pHex, rHex, Pprime, expectedOpp);
    expect(out).toBe(toHex(k2));
  });

  test('accepts Schnorr x-only (02||x) for expectedPub and selects k2 when parity mismatches', () => {
    const { p, r, k1, k2 } = makePr();
    const pHex = toHex(p);
    const rHex = toHex(r);
    const Pprime = compFromScalar(k1); // valid blinded key
    const Pself = compFromScalar(p); // compressed P = p·G
    // Build 02||x(p) from Schnorr API
    const xonly = schnorr.getPublicKey(hexToBytes(pHex)); // 32-byte x of even-Y lift
    const expectedFromX = new Uint8Array(33);
    expectedFromX[0] = 0x02;
    expectedFromX.set(xonly, 1);
    // Ensure opposite parity vs actual P, to force k2
    if ((expectedFromX[0] & 1) === (Pself[0] & 1)) expectedFromX[0] ^= 0x01;
    const out = deriveP2BKSecretKey(pHex, rHex, Pprime, expectedFromX);
    expect(out).toBe(toHex(k2));
  });

  test('returns null when blindPubkey is valid but does not correspond to this (p, r)', () => {
    const { p, r } = makePr();
    const pHex = toHex(p);
    const rHex = toHex(r);
    // Valid but unrelated point: q·G
    const q = hexToNumber(bytesToHex(secp256k1.utils.randomSecretKey()));
    const PprimeWrong = compFromScalar(q);
    const out = deriveP2BKSecretKey(pHex, rHex, PprimeWrong, compFromScalar(p));
    expect(out).toBeNull();
  });

  test('selects k1 when expectedPub matches the actual parity of P = p·G', () => {
    const { p, r, k1 } = makePr();
    const out = deriveP2BKSecretKey(
      toHex(p),
      toHex(r),
      compFromScalar(k1), // P′ = (p + r)·G
      compFromScalar(p), // expectedPub = P = p·G, same parity
    );
    expect(out).toBe(toHex(k1));
  });

  test('handles odd y-parity in SECP1 compressed for sk1 (no negation needed)', () => {
    // Fixed key known to produce odd y (03 prefix) for sk1
    const p = hexToNumber('0000000000000000000000000000000000000000000000000000000000000001');
    const r = hexToNumber('0000000000000000000000000000000000000000000000000000000000000005');
    const k1 = (p + r) % n;
    const k1Hex = toHex(k1);
    const compressed = bytesToHex(compFromScalar(k1)); // P′ candidate
    if (compressed.startsWith('03')) {
      const out = deriveP2BKSecretKey(
        toHex(p),
        toHex(r),
        hexToBytes(compressed), // P′
        compFromScalar(p), // P
      );
      expect(out).toBe(k1Hex);
    } else {
      throw new Error('Fixed values did not produce odd y, adjust p or r');
    }
  });

  test('when sk2 === 0n and P′ matches k1, returns k1', () => {
    // Choose r = p, then sk2 = (n - p + r) % n = 0
    const p = hexToNumber(bytesToHex(secp256k1.utils.randomSecretKey()));
    const r = p;
    const k1 = (p + r) % n; // k1 = 2p mod n
    if (k1 === 0n) return; // extremely rare, skip if it happens
    const out = deriveP2BKSecretKey(
      toHex(p),
      toHex(r),
      compFromScalar(k1), // P′ = k1·G
      compFromScalar(p), // P = p·G
    );
    expect(out).toBe(toHex(k1));
  });
});

describe('P2BK test vectors, public API only', () => {
  test('reconstructs spend key from E, P′, and Bob’s privkey', () => {
    const eHex = '1cedb9df0c6872188b560ace9e35fd55c2532d53e19ae65b46159073886482ca';
    const Ehex = '02a8cda4cf448bfce9a9e46e588c06ea1780fcb94e3bbdf3277f42995d403a8b0c'; // proof.p2pk_e
    const pubKeyBob = '02771fed6cb88aaac38b8b32104a942bf4b8f4696bc361171b3c7d06fa2ebddf06';
    const privKeyBob = 'ad37e8abd800be3e8272b14045873f4353327eedeb702b72ddcc5c5adff5129c';
    const allSlotsBlinded = [
      '03b7c03eb05a0a539cfc438e81bcf38b65b7bb8685e8790f9b853bfe3d77ad5315', // slot 0
      '0352fb6d93360b7c2538eedf3c861f32ea5883fceec9f3e573d9d84377420da838',
      '03667361ca925065dcafea0a705ba49e75bdd7975751fcc933e05953463c79fff1',
      '02aca3ed09382151250b38c85087ae0a1436a057b40f824a5569ba353d40347d08',
      '02cd397bd6e326677128f1b0e5f1d745ad89b933b1b8671e947592778c9fc2301d',
      '0394140369aae01dbaf74977ccbb09b3a9cf2252c274c791ac734a331716f1f7d4',
      '03480f28e8f8775d56a4254c7e0dfdd5a6ecd6318c757fcec9e84c1b48ada0666d',
      '02f8a7be813f7ba2253d09705cc68c703a9fd785a055bf8766057fc6695ec80efc',
      '03aa5446aaf07ca9730b233f5c404fd024ef92e3787cd1c34c81c0778fe23c59e9',
      '037f82d4e0a79b0624a58ef7181344b95afad8acf4275dad49bcd39c189b73ece2',
      '032371fc0eef6885062581a3852494e2eab8f384b7dd196281b85b77f94770fac5', // slot 10
    ];
    const allDerivedKeysSk2 = [
      '47051623754422cb04bc24c0cfe2c1ddc8db1fcc18f0aa4b477df4aca2adc20e',
      '9d1ffe00e1da5af5c882b1ea5ec8c18893e09349803c3c9e552823490af22458',
      '2770cf9f49f1f26eaef29d56a85483e8aabb2f3f1a6bec28ffa065a756bbfdb1',
      '3fb40b854bd11bff639eef1f0a98c91a1097a194a6d2a24da1b01bb3396434fc',
      'b20aebb812d38e7c9e7267039463fc46757c7f4f33b10d1bb440ea91481736fd',
      'fbb9e1275e948b592ae46d1a15d2beef73fcee23d4917e6626e77ced20b14031',
      '1667bb8f98715782e0e68e788554cf9a61cbb094d557710fc92fd1e08b1007e2',
      '044581a5616dfae8723650a1ca702164ff23c0a311db5a6eb5bc32da1d39d287',
      'a0130fb2ca958732d3451cf247726d8749af46a4e77a54b1e3a96ce3a76fcef2',
      '20f9299d129e8468bd55c37388adde124313d39621f9281012352edbdb138b35',
      'f0ab6866fe2da5054db05098b008b042fd0af7b42ca8547137e652137bd6dfb9',
    ];
    const P_0 = allSlotsBlinded[0]; // secret.data (slot 0)
    // Check sender side blinds ok
    const { blinded, Ehex: calcE } = deriveP2BKBlindedPubkeys(
      [
        pubKeyBob, // slot 0
        pubKeyBob,
        pubKeyBob,
        pubKeyBob,
        pubKeyBob,
        pubKeyBob,
        pubKeyBob,
        pubKeyBob,
        pubKeyBob,
        pubKeyBob,
        pubKeyBob, // slot 10
      ],
      hexToBytes(eHex), // fixed ephemeral secret
    );
    expect(calcE).toEqual(Ehex);
    expect(blinded[0]).toEqual(P_0);
    expect(blinded).toStrictEqual(allSlotsBlinded);
    // Check receiver side dervives secret keys ok
    const derived = deriveP2BKSecretKeys(
      Ehex,
      privKeyBob,
      allSlotsBlinded, // all slots
    );
    expect(derived).toHaveLength(11);
    // expected pub (p.G): 03771fed6cb88aaac38b8b32104a942bf4b8f4696bc361171b3c7d06fa2ebddf06
    // but Bob's pubkey is 02771fed6cb88aaac38b8b32104a942bf4b8f4696bc361171b3c7d06fa2ebddf06
    // so this is a negated Schnorr privkey set (sk2)
    expect(derived).toStrictEqual(allDerivedKeysSk2);
    // For every slot, the derived public key must equal the corresponding blinded pubkey (P′)
    expect(derived.length).toBe(allSlotsBlinded.length);
    for (let i = 0; i < derived.length; i++) {
      const Kpub_i = bytesToHex(secp256k1.getPublicKey(hexToBytes(derived[i]), true));
      expect(Kpub_i).toBe(allSlotsBlinded[i]);
    }
  });
});

describe('slot offset (NUT-28: the data tag occupies slot 0)', () => {
  // Fixed vector from 'P2BK test vectors, public API only' above: for an HTLC the hashlock
  // holds slot 0, so the first lock key must be blinded/unblinded with slot index 1.
  const eHex = '1cedb9df0c6872188b560ace9e35fd55c2532d53e19ae65b46159073886482ca';
  const Ehex = '02a8cda4cf448bfce9a9e46e588c06ea1780fcb94e3bbdf3277f42995d403a8b0c';
  const pubKeyBob = '02771fed6cb88aaac38b8b32104a942bf4b8f4696bc361171b3c7d06fa2ebddf06';
  const privKeyBob = 'ad37e8abd800be3e8272b14045873f4353327eedeb702b72ddcc5c5adff5129c';
  const slot1Blinded = '0352fb6d93360b7c2538eedf3c861f32ea5883fceec9f3e573d9d84377420da838';
  const slot1DerivedSk2 = '9d1ffe00e1da5af5c882b1ea5ec8c18893e09349803c3c9e552823490af22458';

  test('deriveP2BKBlindedPubkeys blinds the first key at slot 1 when data is not a pubkey', () => {
    const { blinded } = deriveP2BKBlindedPubkeys([pubKeyBob], hexToBytes(eHex), false);
    expect(blinded).toStrictEqual([slot1Blinded]);
  });

  test('deriveP2BKSecretKeys derives the slot 1 key when data is not a pubkey', () => {
    expect(deriveP2BKSecretKeys(Ehex, privKeyBob, slot1Blinded, false)).toStrictEqual([
      slot1DerivedSk2,
    ]);
  });
});

describe('NUT28 uncovered branches and guards', () => {
  const toHex = (x: bigint) => numberToHexPadded64(x);
  const randScalar = () => hexToNumber(bytesToHex(secp256k1.utils.randomSecretKey()));
  const compFromScalar = (x: bigint) => secp256k1.getPublicKey(hexToBytes(toHex(x)), true);

  // Fixed test vector reused for the receiver-side single/non-matching cases
  const Ehex = '02a8cda4cf448bfce9a9e46e588c06ea1780fcb94e3bbdf3277f42995d403a8b0c';
  const privKeyBob = 'ad37e8abd800be3e8272b14045873f4353327eedeb702b72ddcc5c5adff5129c';
  const slot0Blinded = '03b7c03eb05a0a539cfc438e81bcf38b65b7bb8685e8790f9b853bfe3d77ad5315';
  const slot0DerivedSk2 = '47051623754422cb04bc24c0cfe2c1ddc8db1fcc18f0aa4b477df4aca2adc20e';

  test('deriveP2BKBlindedPubkeys returns empty result for empty input', () => {
    expect(deriveP2BKBlindedPubkeys([])).toEqual({ blinded: [], Ehex: '' });
  });

  test('deriveP2BKSecretKeys accepts a single (non-array) blinded pubkey', () => {
    // slot 0 of the fixed vector, passed as a bare string not an array
    expect(deriveP2BKSecretKeys(Ehex, privKeyBob, slot0Blinded)).toEqual([slot0DerivedSk2]);
  });

  test('deriveP2BKSecretKeys omits keys for a non-matching blinded pubkey', () => {
    // Unrelated valid point: must not correspond to Bob's key, so nothing is derived
    const unrelated = bytesToHex(secp256k1.getPublicKey(secp256k1.utils.randomSecretKey(), true));
    expect(deriveP2BKSecretKeys(Ehex, privKeyBob, unrelated)).toEqual([]);
  });

  test('deriveP2BKSecretKey throws when naturalPub is not 33 bytes', () => {
    const validBlind = compFromScalar(randScalar());
    expect(() =>
      deriveP2BKSecretKey(toHex(randScalar()), toHex(randScalar()), validBlind, new Uint8Array(32)),
    ).toThrow('naturalPub must be 33 bytes');
  });

  test('deriveP2BKSecretKey throws when blindPubkey is not 33 bytes', () => {
    expect(() =>
      deriveP2BKSecretKey(toHex(randScalar()), toHex(randScalar()), new Uint8Array(32)),
    ).toThrow('blindPubkey must be 33 bytes');
  });

  test('deriveP2BKSecretKey returns null when the blinded pubkey unblinds to infinity', () => {
    // blindPubkey = r·G, so P = P′ - r·G = 0 (point at infinity)
    const r = randScalar();
    const out = deriveP2BKSecretKey(toHex(randScalar()), toHex(r), compFromScalar(r));
    expect(out).toBeNull();
  });

  test('deriveP2BKSecretKey throws when the selected derived key is zero (blinded path)', () => {
    // r = p makes skNeg = (n - p + r) mod n = 0; force skNeg selection via parity mismatch
    const p = randScalar();
    const r = p;
    const R = secp256k1.Point.BASE.multiply(p); // r·G
    const P = secp256k1.Point.BASE.multiply(randScalar()); // arbitrary unblinded point
    const blindPubkey = P.add(R).toBytes(true); // P′ = P + r·G
    const naturalPub = P.toBytes(true);
    naturalPub[0] ^= 0x01; // same x, opposite parity -> selects skNeg
    expect(() => deriveP2BKSecretKey(toHex(p), toHex(r), blindPubkey, naturalPub)).toThrow(
      'Derived secret key is zero',
    );
  });
});

describe('NUT-28 P2BK example proof (nuts tests/28-tests.md)', () => {
  // Verbatim from the NUT-28 test vectors: Bob's key P is blinded in data (slot 0)
  const privKeyBob = 'ad37e8abd800be3e8272b14045873f4353327eedeb702b72ddcc5c5adff5129c';
  const slot0Key = '47051623754422cb04bc24c0cfe2c1ddc8db1fcc18f0aa4b477df4aca2adc20e';
  const proof: Proof = {
    amount: Amount.from(64),
    C: '0381855ddcc434a9a90b3564f29ef78e7271f8544d0056763b418b00e88525c0ff',
    id: '009a1f293253e41e',
    secret:
      '["P2PK",{"nonce":"d4a17a88f5d0c09001f7b453c42c1f9d5a87363b1f6637a5a83fc31a6a3b7266","data":"03b7c03eb05a0a539cfc438e81bcf38b65b7bb8685e8790f9b853bfe3d77ad5315","tags":[]}]',
    dleq: {
      s: '6178978456c42eee8eefb50830fc3146be27b05619f04e3490dc596005f0cc78',
      e: '23f2190b18bfd043d3a526103e15f4a938d646a6bf93b017e2bb7c85e1540b32',
      r: 'd26a55aa39ca50957fdaf54036b01053b0de42048b96a6fb2a167e03f00d0a0f',
    },
    p2pk_e: '02a8cda4cf448bfce9a9e46e588c06ea1780fcb94e3bbdf3277f42995d403a8b0c',
  };

  test('derives the data spend key at slot 0', () => {
    expect(maybeDeriveP2BKPrivateKeys(privKeyBob, proof)).toStrictEqual([slot0Key]);
  });

  test('spends with the slot 0 key', () => {
    const signed = signP2PKProof(proof, slot0Key);
    const result = verifyP2PKSpendingConditions(signed);
    expect(result.success).toBe(true);
    expect(result.path).toBe('MAIN');
  });
});

describe('NUT-28 HTLC example proof (nuts tests/28-tests.md)', () => {
  // Verbatim from the NUT-28 test vectors: the hashlock holds slot 0 (unblinded),
  // Bob's key P is blinded at slot 1 (pubkeys) and again at slot 2 (refund).
  const privKeyBob = 'ad37e8abd800be3e8272b14045873f4353327eedeb702b72ddcc5c5adff5129c';
  const preimage = '0000000000000000000000000000000000000000000000000000000000000001'; // NUT-14 pair
  const slot1Key = '9d1ffe00e1da5af5c882b1ea5ec8c18893e09349803c3c9e552823490af22458';
  const slot2Key = '2770cf9f49f1f26eaef29d56a85483e8aabb2f3f1a6bec28ffa065a756bbfdb1';
  const dleq = {
    s: 'bd6ed079b954151898cadac38c3b8d3371c20d67e8c5f06af3cee4152ac317b4',
    e: '9ec5b6f2095a8dc7d052a00e0bb050ac95e633e702575630cfd43cb58592d2a1',
    r: 'e8349cf88e5a9f025f0072bf8a2db48d394bad9f7be3d8023f9ee90de1c1924d',
  };
  const proof: Proof = {
    amount: Amount.from(64),
    C: '0270aba098c920adafa1ce75acefb06d8cc541ef80270f70cc7b66375b789ed9be',
    id: '009a1f293253e41e',
    secret:
      '["HTLC",{"nonce":"8b1f18aa85a2787903cfdc776fde0b8555bdb126eea02b05cd84de06a4f4b551","data":"ec4916dd28fc4c10d78e287ca5d9cc51ee1ae73cbfde08c6b37324cbfaac8bc5","tags":[["pubkeys","0352fb6d93360b7c2538eedf3c861f32ea5883fceec9f3e573d9d84377420da838"],["locktime","1689418329"],["refund","03667361ca925065dcafea0a705ba49e75bdd7975751fcc933e05953463c79fff1"]]}]',
    dleq,
    p2pk_e: '02a8cda4cf448bfce9a9e46e588c06ea1780fcb94e3bbdf3277f42995d403a8b0c',
  };

  test('derives the pubkeys spend key at slot 1 and the refund key at slot 2', () => {
    expect(maybeDeriveP2BKPrivateKeys(privKeyBob, proof)).toStrictEqual([slot1Key, slot2Key]);
  });

  test('spends via the receiver pathway with the preimage and the slot 1 key', () => {
    const signed = signP2PKProof({ ...proof, witness: { preimage } }, slot1Key);
    const result = verifyHTLCSpendingConditions(signed);
    expect(result.success).toBe(true);
    expect(result.path).toBe('MAIN');
  });

  test('spends via the refund pathway with the slot 2 key after locktime', () => {
    const signed = signP2PKProof(proof, slot2Key);
    const result = verifyHTLCSpendingConditions(signed);
    expect(result.success).toBe(true);
    expect(result.path).toBe('REFUND');
  });
});
