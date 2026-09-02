import { bls12_381 } from '@noble/curves/bls12-381.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, test } from 'vitest';

import {
  asBlsG1Point,
  asSecpPoint,
  hashToCurve,
  pointFromHex,
  pointFromHexAuto,
  pointToHex,
  blindMessage,
  unblindSignature,
  createBlindSignature,
  constructUnblindedSignature,
  createRandomRawBlindedMessage,
  getKeysetIdInt,
  getValidSigners,
  hash_e,
  isBlsKeyset,
  meetsSignerThreshold,
  pointFromBytes,
  schnorrSignDigest,
  schnorrSignMessage,
  schnorrVerifyDigest,
  sha256 as sha256Export,
  taggedHash,
} from '../../src/crypto';
import { verifyUnblindedSignature } from '../../src/crypto/NUT01';
import { Bytes } from '../../src/utils';

const SECRET_MESSAGE = 'test_message';

describe('test crypto scheme', () => {
  test('Test crypto scheme', async () => {
    const mintPrivKey = secp256k1.utils.randomSecretKey();
    const mintPubKey = secp256k1.getPublicKey(mintPrivKey, true);

    //Wallet(Bob)
    const blindMessage = createRandomRawBlindedMessage();

    //Mint
    const blindSignature = createBlindSignature(blindMessage.B_, mintPrivKey, '');

    //Wallet
    const proof = constructUnblindedSignature(
      blindSignature,
      blindMessage.r,
      blindMessage.secret,
      pointFromHex(bytesToHex(mintPubKey)),
    );

    //Mint
    const isValid = verifyUnblindedSignature(proof, mintPrivKey);
    expect(isValid).toBeTruthy();
  });
});

describe('testing hash to curve', () => {
  test('testing string 0000....00', async () => {
    const secret = hexToBytes('0000000000000000000000000000000000000000000000000000000000000000');
    const Y = hashToCurve(secret);
    const hexY = Y.toHex(true);
    expect(hexY).toBe('024cce997d3b518f739663b757deaec95bcd9473c30a14ac2fd04023a739d1a725');
  });

  test('testing string 0000....01', async () => {
    const secret = hexToBytes('0000000000000000000000000000000000000000000000000000000000000001');
    const Y = hashToCurve(secret);
    const hexY = Y.toHex(true);
    expect(hexY).toBe('022e7158e11c9506f1aa4248bf531298daa7febd6194f003edcd9b93ade6253acf');
  });
});

describe('test blinding message', () => {
  test('testing string 0000....01', async () => {
    const enc = new TextEncoder();
    const secretUInt8 = enc.encode(SECRET_MESSAGE);
    const { B_ } = blindMessage(
      secretUInt8,
      Bytes.toBigInt(
        hexToBytes('0000000000000000000000000000000000000000000000000000000000000001'),
      ),
    );
    expect(B_.toHex(true)).toBe(
      '025cc16fe33b953e2ace39653efb3e7a7049711ae1d8a2f7a9108753f1cdea742b',
    );
  });

  test('throws when r is zero', () => {
    const secretUInt8 = new TextEncoder().encode(SECRET_MESSAGE);
    expect(() => blindMessage(secretUInt8, 0n)).toThrow('Blinding factor r must be non-zero');
  });

  test('generates random r when none provided', () => {
    const secretUInt8 = new TextEncoder().encode(SECRET_MESSAGE);
    const { r } = blindMessage(secretUInt8);
    expect(r).toBeTypeOf('bigint');
    expect(r).not.toBe(0n);
  });
});

describe('test unblinding signature', () => {
  test('testing string 0000....01', async () => {
    const C_ = pointFromHex('02a9acc1e48c25eeeb9289b5031cc57da9fe72f3fe2861d264bdc074209b107ba2');
    const r = Bytes.toBigInt(
      hexToBytes('0000000000000000000000000000000000000000000000000000000000000001'),
    );
    const A = pointFromHex('020000000000000000000000000000000000000000000000000000000000000001');
    const C = unblindSignature(C_, r, A);
    expect(C.toHex(true)).toBe(
      '03c724d7e6a5443b39ac8acf11f40420adc4f99a02e7cc1b57703d9391f6d129cd',
    );
  });
});

describe('point helpers and hash_e', () => {
  test('pointFromBytes round-trips a compressed pubkey', () => {
    const sk = secp256k1.utils.randomSecretKey();
    const hex = bytesToHex(secp256k1.getPublicKey(sk, true)); // compressed
    const bytes = hexToBytes(hex);
    const pt = pointFromBytes(bytes);
    expect(pt.toHex(true)).toBe(hex);
  });

  test('hash_e == sha256(concat(uncompressed points))', () => {
    const sk1 = secp256k1.utils.randomSecretKey();
    const sk2 = secp256k1.utils.randomSecretKey();
    const P1 = pointFromHex(bytesToHex(secp256k1.getPublicKey(sk1, true)));
    const P2 = pointFromHex(bytesToHex(secp256k1.getPublicKey(sk2, true)));

    const e = hash_e([P1, P2]);

    const concatUncompressed = P1.toHex(false) + P2.toHex(false);
    const expected = sha256(new TextEncoder().encode(concatUncompressed));
    expect(bytesToHex(e)).toBe(bytesToHex(expected));
  });
});

describe('CurvePoint helpers', () => {
  test('asSecpPoint tags a secp point with kind:secp', () => {
    const sk = secp256k1.utils.randomSecretKey();
    const pt = pointFromHex(bytesToHex(secp256k1.getPublicKey(sk, true)));
    const cp = asSecpPoint(pt);
    expect(cp.kind).toBe('secp');
    expect(cp.pt).toBe(pt);
  });

  test('asBlsG1Point tags a G1 point with kind:blsG1', () => {
    const G1 = bls12_381.G1.Point.BASE;
    const cp = asBlsG1Point(G1);
    expect(cp.kind).toBe('blsG1');
    expect(cp.pt).toBe(G1);
  });

  test('pointToHex round-trips through pointFromHexAuto for both curves', () => {
    const sk = secp256k1.utils.randomSecretKey();
    const secpHex = bytesToHex(secp256k1.getPublicKey(sk, true));
    const secpRound = pointToHex(pointFromHexAuto(secpHex));
    expect(secpRound).toBe(secpHex);

    const blsHex = bytesToHex(bls12_381.G1.Point.BASE.toBytes(true));
    const blsRound = pointToHex(pointFromHexAuto(blsHex));
    expect(blsRound).toBe(blsHex);
  });

  test('pointFromHexAuto throws on unexpected hex length', () => {
    expect(() => pointFromHexAuto('00'.repeat(40))).toThrow(/unexpected hex length/);
  });
});

describe('isBlsKeyset', () => {
  test('v3 (`02…`) full-form (66 char) is BLS', () => {
    expect(isBlsKeyset('02ce4c47836fd0e64f37a08254777b7fd0dedb95fc1ddd0acadf5600674c743c5d')).toBe(
      true,
    );
  });
  test('v3 (`02…`) short-form (16 char) is BLS — tokens carry this form', () => {
    expect(isBlsKeyset('02ce4c47836fd0e6')).toBe(true);
  });
  test('v1 (`00…`) and v2 (`01…`) hex keysets are not BLS', () => {
    expect(isBlsKeyset('00bd033559de27d0')).toBe(false);
    expect(isBlsKeyset('01ce4c47836fd0e64f37a08254777b7fd0dedb95fc1ddd0acadf5600674c743c5d')).toBe(
      false,
    );
  });
  test('strict: unknown version bytes (`03…`, `0a…`, `ff…`) return false', () => {
    // Fails closed on unknown versions. Must be widened deliberately alongside
    // `getDerivationKind` when a new BLS-based version lands.
    expect(isBlsKeyset('03abcdef01234567')).toBe(false);
    expect(isBlsKeyset('0abcdef012345678')).toBe(false); // v=0x0a
    expect(isBlsKeyset('1eabcdef01234567')).toBe(false); // v=0x1e
    expect(isBlsKeyset('ffabcdef01234567')).toBe(false); // v=0xff
    expect(
      isBlsKeyset('0a' + 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789'),
    ).toBe(false); // 66-char with letter version
  });
  test('legacy base64 ids return false regardless of shape or length', () => {
    expect(isBlsKeyset('AQID')).toBe(false);
    expect(isBlsKeyset('22aBcD+/eFgH')).toBe(false);
    expect(isBlsKeyset('99aaaaaaaaaa=')).toBe(false);
    // All-hex 12-char base64 — length disambiguates (modern hex ids are 16 or 66 only).
    expect(isBlsKeyset('22aabbccddee')).toBe(false);
    expect(isBlsKeyset('aabbccddeeff')).toBe(false);
  });
  test('non-canonical lengths (not 16 or 66) return false', () => {
    expect(isBlsKeyset('02')).toBe(false); // 2
    expect(isBlsKeyset('02abcdef')).toBe(false); // 8
    expect(isBlsKeyset('02abcdef0123456')).toBe(false); // 15 (length-16 boundary)
    expect(isBlsKeyset('02abcdef012345678')).toBe(false); // 17
  });
  test('empty / short / non-hex input returns false', () => {
    expect(isBlsKeyset('')).toBe(false);
    expect(isBlsKeyset('0')).toBe(false);
    expect(isBlsKeyset('zz')).toBe(false);
  });
});

describe('getKeysetIdInt', () => {
  test('hex keyset id is reduced mod (2^31-1)', () => {
    const MOD = BigInt(2 ** 31 - 1);
    const hexId = '01abcdef';
    const expected = BigInt('0x' + hexId) % MOD;
    expect(getKeysetIdInt(hexId)).toBe(expected);
  });

  test('legacy base64 keyset id path', () => {
    // 'AQID' base64 => bytes [0x01, 0x02, 0x03] => 0x010203
    const MOD = BigInt(2 ** 31 - 1);
    const b64Id = 'AQID';
    const expected = BigInt(0x010203) % MOD;
    expect(getKeysetIdInt(b64Id)).toBe(expected);
  });
});

describe('schnorrVerifyDigest', () => {
  const privkey = '0000000000000000000000000000000000000000000000000000000000000001';
  const pubkey = bytesToHex(secp256k1.getPublicKey(hexToBytes(privkey), true));
  const digest = sha256(new TextEncoder().encode('msg'));
  const signature = schnorrSignDigest(digest, privkey);

  test('accepts a hex-string digest', () => {
    expect(schnorrVerifyDigest(signature, bytesToHex(digest), pubkey)).toBe(true);
  });

  test('swallows malformed input by default and throws when asked', () => {
    expect(schnorrVerifyDigest('not-hex', digest, pubkey)).toBe(false);
    expect(() => schnorrVerifyDigest('not-hex', digest, pubkey, true)).toThrow();
  });

  test('rejects a 33-byte pubkey with a non-02/03 prefix', () => {
    expect(schnorrVerifyDigest(signature, digest, 'ff' + pubkey.slice(2))).toBe(false);
  });
});

describe('getValidSigners / meetsSignerThreshold', () => {
  const privkey = '0000000000000000000000000000000000000000000000000000000000000001';
  const compressed = bytesToHex(secp256k1.getPublicKey(hexToBytes(privkey), true)); // 02-prefixed
  const xOnly = compressed.slice(2);
  const message = 'authorize-spend';
  const signature = schnorrSignMessage(message, privkey);

  test('one key listed under multiple encodings counts as a single signer', () => {
    const signers = getValidSigners([signature], message, [
      xOnly,
      compressed,
      '03' + xOnly,
      compressed.toUpperCase(),
    ]);
    expect(signers).toEqual([xOnly]);
  });

  test('one signature cannot meet a 2-of-2 threshold across 02/03 encodings', () => {
    expect(meetsSignerThreshold([signature], message, [compressed, '03' + xOnly], 2)).toBe(false);
  });

  test('non-string pubkey entries fail closed without throwing', () => {
    const pubkeys = [42 as unknown as string, compressed];
    expect(getValidSigners([signature], message, pubkeys)).toEqual([compressed]);
  });
});

describe('hash exports', () => {
  test('sha256 hashes raw bytes', () => {
    expect(bytesToHex(sha256Export(new Uint8Array(0)))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    const msg = new TextEncoder().encode('cashu');
    expect(bytesToHex(sha256Export(msg))).toBe(bytesToHex(sha256(msg)));
  });

  test('taggedHash matches the BIP340 construction', () => {
    const tag = 'Cashu_NutrootLeaf';
    const msg = hexToBytes(
      '00010200010104002102f9308a019258c31049344f85f89d5229b531c845836f99b08601f113bce036f9',
    );
    const tagHash = sha256(new TextEncoder().encode(tag));
    expect(bytesToHex(taggedHash(tag, msg))).toBe(
      bytesToHex(sha256(new Uint8Array([...tagHash, ...tagHash, ...msg]))),
    );
  });

  test('taggedHash concatenates multiple messages', () => {
    const a = hexToBytes('aa'.repeat(32));
    const b = hexToBytes('bb'.repeat(32));
    expect(bytesToHex(taggedHash('t', a, b))).toBe(
      bytesToHex(taggedHash('t', hexToBytes('aa'.repeat(32) + 'bb'.repeat(32)))),
    );
  });
});
