import { bls12_381 } from '@noble/curves/bls12-381.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToNumberBE } from '@noble/curves/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { hexToBytes, bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, test, vi } from 'vitest';

import {
  hashToCurve,
  pointFromHex,
  blindMessage,
  unblindSignature,
  computeMessageDigest,
  createBlindSignature,
  constructUnblindedSignature,
  createRandomRawBlindedMessage,
  getKeysetIdInt,
  getValidSigners,
  hash_e,
  meetsSignerThreshold,
  schnorrSignDigest,
  schnorrSignMessage,
  schnorrVerifyDigest,
  schnorrVerifyMessage,
  pointFromBytes,
  findSigningKey,
} from '../../src/crypto';
import { verifyUnblindedSignature } from '../../src/crypto/NUT01';
import { decodeBase64ToUint8Legacy } from '../../src/utils';

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

  test('produces the same point regardless of host byte order', () => {
    const NativeUint32Array = globalThis.Uint32Array;
    // Simulates a big-endian host's typed-array backing store, so the counter encoding
    // must be pinned explicitly rather than following whatever the host happens to use.
    const BigEndianTypedArrays = new Proxy(NativeUint32Array, {
      construct(Target, args) {
        if (args.length !== 1 || args[0] !== 1) {
          return Reflect.construct(Target, args);
        }
        const buffer = new ArrayBuffer(4);
        const view = new DataView(buffer);
        return {
          buffer,
          get 0() {
            return view.getUint32(0, false);
          },
          set 0(value: number) {
            view.setUint32(0, value, false);
          },
        };
      },
    });

    vi.stubGlobal('Uint32Array', BigEndianTypedArrays);
    try {
      // This vector reaches counter 3 before finding a valid point.
      const secret = hexToBytes('0000000000000000000000000000000000000000000000000000000000000001');
      expect(hashToCurve(secret).toHex(true)).toBe(
        '022e7158e11c9506f1aa4248bf531298daa7febd6194f003edcd9b93ade6253acf',
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('test blinding message', () => {
  test('testing string 0000....01', async () => {
    const enc = new TextEncoder();
    const secretUInt8 = enc.encode(SECRET_MESSAGE);
    const { B_ } = blindMessage(
      secretUInt8,
      bytesToNumberBE(
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
    const r = bytesToNumberBE(
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

  test('a 12-character id is legacy base64 even when every character is a hex digit', () => {
    // Same rule as getDerivationKind: length decides, since the base64 alphabet overlaps hex.
    const MOD = BigInt(2 ** 31 - 1);
    const id = 'abcdef012345';
    const expected = bytesToNumberBE(decodeBase64ToUint8Legacy(id)) % MOD;
    expect(getKeysetIdInt(id)).toBe(expected);
    expect(getKeysetIdInt(id)).not.toBe(BigInt('0x' + id) % MOD);
  });

  test('a URL-safe spelling of a legacy id derives the same path', () => {
    expect(getKeysetIdInt('22aBcD-_eFgH')).toBe(getKeysetIdInt('22aBcD+/eFgH'));
  });

  test('rejects an id that is neither hex nor base64', () => {
    expect(() => getKeysetIdInt('not-a-keyset!')).toThrow(/Invalid keyset id/);
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

describe('computeMessageDigest', () => {
  test('rejects unpaired UTF-16 surrogates instead of hashing colliding strings', () => {
    // Both strings encode to the same U+FFFD replacement bytes under a lenient TextEncoder.
    expect(() => computeMessageDigest('\ud800')).toThrow();
    expect(() => computeMessageDigest('\ud801')).toThrow();
  });

  test('still digests well-formed strings, surrogate pairs included', () => {
    expect(() => computeMessageDigest('hello')).not.toThrow();
    expect(() => computeMessageDigest('\u{1F95C}')).not.toThrow(); // a valid surrogate pair
  });
});

describe('schnorrVerifyMessage', () => {
  test('fails closed rather than throwing when the message is ill-formed', () => {
    const privkey = '0000000000000000000000000000000000000000000000000000000000000001';
    const pubkey = bytesToHex(secp256k1.getPublicKey(hexToBytes(privkey), true));
    expect(schnorrVerifyMessage('00'.repeat(64), '\ud800', pubkey)).toBe(false);
    expect(() => schnorrVerifyMessage('00'.repeat(64), '\ud800', pubkey, true)).toThrow();
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

  test('a threshold below one is rejected instead of passing on no signatures', () => {
    expect(meetsSignerThreshold([], message, [compressed], 0)).toBe(false);
    expect(meetsSignerThreshold([], message, [compressed], -1)).toBe(false);
    expect(meetsSignerThreshold([signature], message, [compressed], 1.5)).toBe(false);
    expect(meetsSignerThreshold([signature], message, [compressed], 1)).toBe(true);
  });

  test('non-string pubkey entries fail closed without throwing', () => {
    const pubkeys = [42 as unknown as string, compressed];
    expect(getValidSigners([signature], message, pubkeys)).toEqual([compressed]);
  });
});

describe('findSigningKey', () => {
  const priv = (n: number) => n.toString(16).padStart(64, '0');
  const pub = (key: string) => bytesToHex(secp256k1.getPublicKey(hexToBytes(key), true));
  const flip = (pubkey: string) => (pubkey.startsWith('02') ? '03' : '02') + pubkey.slice(2);

  test('returns the candidate that derives the pubkey, case-insensitively', () => {
    expect(findSigningKey(pub(priv(2)), [priv(1), priv(2)])).toBe(priv(2));
    expect(findSigningKey(pub(priv(2)).toUpperCase(), priv(2))).toBe(priv(2));
  });

  test('an x-only import signs for the published parity through the negated scalar', () => {
    // A nostr key is published as 02||x whatever its y; the wallet may hold the scalar of the
    // other twin. The returned key must derive exactly the pubkey the quote names.
    for (const key of [priv(1), priv(2), priv(3), priv(0x1234)]) {
      const twin = flip(pub(key));
      const signing = findSigningKey(twin, key);
      expect(signing).not.toBe(key);
      expect(pub(signing)).toBe(twin);
    }
  });

  test('throws when no candidate matches on x', () => {
    expect(() => findSigningKey(pub(priv(9)), [priv(1), priv(2)])).toThrow(
      /No private key matches/,
    );
  });
});

describe('createBlindSignature', () => {
  // A valid compressed secp256k1 point (the generator).
  const VALID = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
  const a = hexToBytes('0'.repeat(63) + '2');

  test('signs a secp256k1 blinded message', () => {
    const B_ = pointFromHex(VALID);
    const sig = createBlindSignature(B_, a, 'keyset-id');
    expect(sig.id).toBe('keyset-id');
    expect(sig.C_.toHex(true)).toBe(B_.multiply(2n).toHex(true));
  });

  test('rejects a blinded message from another curve', () => {
    // The point type is structural, so a BLS12-381 G1 point satisfies it at compile time.
    const foreign = bls12_381.G1.Point.fromAffine({ x: 0n, y: 2n });
    expect(() => createBlindSignature(foreign, a, 'keyset-id')).toThrow(/secp256k1 point/);
  });
});
