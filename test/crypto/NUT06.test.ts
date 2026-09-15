import { schnorr } from '@noble/curves/secp256k1.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils.js';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { taggedHash } from '../../src/crypto/core';
import { getPubKeyFromPrivKey } from '../../src/crypto/curve_secp';
import { verifyMintInfoSignature } from '../../src/crypto/NUT06';
import type { GetInfoResponse } from '../../src/model/types';
import { canonicalizeJson } from '../../src/utils/canonicalJson';
import { MINT_IDENTITY_PRIVKEY, signMintInfo } from '../consts';

import specVector from './nut06-spec-vector.json';

// Odd-Y counterpart to MINT_IDENTITY_PRIVKEY: BIP-340 signs with the x-only key either way.
const ODD_PRIVKEY = '00'.repeat(31) + '06';
const INFO_TIME = 1731684933;

function infoFor(privkey: string): GetInfoResponse {
  return {
    name: 'Test mint',
    pubkey: bytesToHex(getPubKeyFromPrivKey(hexToBytes(privkey))),
    version: 'Testnut/1.0.0',
    contact: [],
    time: INFO_TIME,
    nuts: {
      '4': {
        methods: [
          { method: 'bolt11', unit: 'sat', method_name: null, min_amount: 1, max_amount: null },
        ],
        disabled: false,
      },
      '5': { methods: [], disabled: true },
    },
  };
}

function verifyAt(info: GetInfoResponse, requestNonce?: string) {
  return verifyMintInfoSignature(info, { now: INFO_TIME, requestNonce });
}

// Vectors from cashubtc/nuts tests/06-tests.md (PR #416): seed is the UTF-8 encoding of
// 'NUT-06 example mint seed', BIP-340 aux randomness is zero-filled, wallet time 1725304480.
const NOW = 1725304480;
const C = '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f';
const Z = '0'.repeat(64);
const PUBKEY = '0338596797cef0627f653cd6568387361b00314add55d9f1ea9c94f46ae421e3da';
const WITH_NONCE = {
  pubkey: PUBKEY,
  signature:
    'a2d6aefa3acbe4acf297225a4997153022be9439c8c83d7fc9e561f54baacade98a559ba28f444e2f9a543e4425d8d1c5fb0b20bfa647498509f244d9b4d9cff',
  request_nonce: C,
  time: NOW,
};
const WITHOUT_NONCE = {
  pubkey: PUBKEY,
  signature:
    '1d48ab4a18f5680f9cbc28481c1c9921615cd0fbb8a8f3a015ec47ddf4720b69f7e870d8195c65b30445ce35b0d3035819ccc3adbea741873cf1e44cb9a48998',
  time: NOW,
};
const UNTAGGED = {
  with_nonce:
    '6264f69d79bae5696b59080817e41612ac26f9539e1ae42900648d0b4ce48cb4cc1532eebd110a5a4c66cf130a11bc326c39c29ce969eeb32728e196c9605350',
  without_nonce:
    '446f52ec13fea5410092eb2d26c28cd9c56b141fa9feb3c60c3845766038905ba44480bc24b0e202278634d724c07560d9f8528ee64db016e48016cb03c409a0',
  full: 'd14914e8d51baa3860c47145dc35c0d6c187b2df565e833a2ccbde2a45c6b7e19d42a9fc4d4f5209adee2cf407bb5b168be75149679412ef23bcdc0e7d177955',
};
// The minimal spec responses omit members the TS type requires.
const wire = (o: object) => o as GetInfoResponse;
const specVerify = (o: object, requestNonce?: string) =>
  verifyMintInfoSignature(wire(o), { now: NOW, requestNonce });

describe('NUT-06 spec vectors', () => {
  const seed = utf8ToBytes('NUT-06 example mint seed');
  const dst = utf8ToBytes('Cashu_Mint_Identity_v1');
  const secret = hmac(sha256, seed, new Uint8Array([...dst, 0x00]));
  const messageHash = (o: object) => {
    const { signature, ...payload } = o as { signature: string };
    void signature;
    return taggedHash('Cashu_MintInfo_v1', utf8ToBytes(canonicalizeJson(payload)));
  };

  it('derives the identity key from the example seed', () => {
    expect(bytesToHex(secret)).toBe(
      '3842a716975d6611d7ae4b36e28068c963e6d8ddb2b70d031d46a79d1df24c3c',
    );
    expect(bytesToHex(getPubKeyFromPrivKey(secret))).toBe(PUBKEY);
  });

  it.each([
    ['with nonce', WITH_NONCE, '6d1b435163023cbbc5045d83d90718b4439be44b0b7648c87a920d40ee8aee6a'],
    [
      'without nonce',
      WITHOUT_NONCE,
      'f50b2ddcbb72c59c25a17019d310ab5e73d2506f508522fa521fbd336aa9159c',
    ],
    [
      'full example',
      specVector,
      '980585d03284414d98f1c21d32e9f6985a9fca94c69f6f56a7e3d40c89304b87',
    ],
  ])('reproduces the %s message hash and signature with zero aux randomness', (_n, o, hash) => {
    const digest = messageHash(o);
    expect(bytesToHex(digest)).toBe(hash);
    expect(bytesToHex(schnorr.sign(digest, secret, new Uint8Array(32)))).toBe(o.signature);
  });

  it('verifies the three signed responses', () => {
    expect(specVerify(WITH_NONCE, C)).toBe('valid');
    expect(specVerify(WITHOUT_NONCE)).toBe('valid');
    expect(specVerify(specVector, C)).toBe('valid');
  });

  it('rejects the untagged (plain SHA-256) signatures', () => {
    expect(specVerify({ ...WITH_NONCE, signature: UNTAGGED.with_nonce }, C)).toBe('invalid');
    expect(specVerify({ ...WITHOUT_NONCE, signature: UNTAGGED.without_nonce })).toBe('invalid');
    expect(specVerify({ ...specVector, signature: UNTAGGED.full }, C)).toBe('invalid');
  });

  describe('response verification cases, request nonce sent', () => {
    const { pubkey, signature, request_nonce, time } = WITH_NONCE;
    it.each<[string, object, string | undefined, number, string]>([
      ['none', WITH_NONCE, C, NOW, 'valid'],
      ['reordered members', { time, request_nonce, signature, pubkey }, C, NOW, 'valid'],
      ['request nonce Z, response C', WITH_NONCE, Z, NOW, 'invalid'],
      ['response nonce Z, request C', { ...WITH_NONCE, request_nonce: Z }, C, NOW, 'invalid'],
      ['both nonces Z', { ...WITH_NONCE, request_nonce: Z }, Z, NOW, 'invalid'],
      ['request_nonce removed', { pubkey, signature, time }, C, NOW, 'invalid'],
      ['uppercase nonce', { ...WITH_NONCE, request_nonce: C.toUpperCase() }, C, NOW, 'invalid'],
      ['nonce as number', { ...WITH_NONCE, request_nonce: 0 }, C, NOW, 'invalid'],
      ['pubkey removed', { signature, request_nonce, time }, C, NOW, 'invalid'],
      ['time removed', { pubkey, signature, request_nonce }, C, NOW, 'invalid'],
      ['time as string', { ...WITH_NONCE, time: String(time) }, C, NOW, 'invalid'],
      ['time + 1', { ...WITH_NONCE, time: time + 1 }, C, NOW, 'invalid'],
      ['name added', { ...WITH_NONCE, name: 'Another mint' }, C, NOW, 'invalid'],
      [
        'first signature byte flipped',
        { ...WITH_NONCE, signature: 'a3' + signature.slice(2) },
        C,
        NOW,
        'invalid',
      ],
      ['mint 3600s ahead', WITH_NONCE, C, NOW - 3600, 'valid'],
      ['mint 3600s behind', WITH_NONCE, C, NOW + 3600, 'valid'],
      ['mint 3601s ahead', WITH_NONCE, C, NOW - 3601, 'invalid'],
      ['mint 3601s behind', WITH_NONCE, C, NOW + 3601, 'invalid'],
    ])('%s', (_n, o, requestNonce, now, expected) => {
      expect(verifyMintInfoSignature(wire(o), { now, requestNonce })).toBe(expected);
    });

    it('reports unsigned, not invalid, when signature is removed: policy is the caller’s', () => {
      expect(specVerify({ pubkey, request_nonce, time }, C)).toBe('unsigned');
    });
  });

  describe('response verification cases, no request nonce sent', () => {
    it.each<[string, object, string | undefined, string]>([
      ['none', WITHOUT_NONCE, undefined, 'valid'],
      ['request nonce C sent', WITHOUT_NONCE, C, 'invalid'],
      [
        'signature from the nonce example',
        { ...WITHOUT_NONCE, signature: WITH_NONCE.signature },
        undefined,
        'invalid',
      ],
      ['request_nonce C added and sent', { ...WITHOUT_NONCE, request_nonce: C }, C, 'invalid'],
    ])('%s', (_n, o, requestNonce, expected) => {
      expect(specVerify(o, requestNonce)).toBe(expected);
    });
  });
});

describe('verifyMintInfoSignature', () => {
  afterEach(() => vi.useRealTimers());

  it('signs the response without its signature member only', () => {
    const { signature, ...payload } = infoFor(MINT_IDENTITY_PRIVKEY);
    expect(signature).toBeUndefined();
    expect(canonicalizeJson(payload)).toBe(
      '{"contact":[],"name":"Test mint","nuts":{"4":{"disabled":false,"methods":[{"max_amount":null,"method":"bolt11","method_name":null,"min_amount":1,"unit":"sat"}]},"5":{"disabled":true,"methods":[]}},"pubkey":"' +
        payload.pubkey +
        '","time":1731684933,"version":"Testnut/1.0.0"}',
    );
  });

  it('reports unsigned when the mint claims no signature', () => {
    expect(verifyAt(infoFor(MINT_IDENTITY_PRIVKEY))).toBe('unsigned');
  });

  it('verifies a signature from an even-Y and an odd-Y identity key', () => {
    for (const key of [MINT_IDENTITY_PRIVKEY, ODD_PRIVKEY]) {
      expect(verifyAt(signMintInfo(infoFor(key), key))).toBe('valid');
    }
    expect(infoFor(MINT_IDENTITY_PRIVKEY).pubkey.slice(0, 2)).toBe('02');
    expect(infoFor(ODD_PRIVKEY).pubkey.slice(0, 2)).toBe('03');
  });

  it('defaults the clock to Date.now()', () => {
    const signed = signMintInfo(infoFor(MINT_IDENTITY_PRIVKEY));
    vi.useFakeTimers();
    vi.setSystemTime(INFO_TIME * 1000);
    expect(verifyMintInfoSignature(signed)).toBe('valid');
    vi.setSystemTime((INFO_TIME + 3601) * 1000);
    expect(verifyMintInfoSignature(signed)).toBe('invalid');
  });

  it('rejects a response altered after signing, time included', () => {
    const signed = signMintInfo(infoFor(MINT_IDENTITY_PRIVKEY));
    expect(verifyAt({ ...signed, name: 'Evil mint' })).toBe('invalid');
    expect(verifyAt({ ...signed, time: INFO_TIME + 1 })).toBe('invalid');
    expect(verifyAt({ ...signed, nuts: { ...signed.nuts, '12': { supported: false } } })).toBe(
      'invalid',
    );
  });

  it('rejects a signature made by another key', () => {
    const signed = signMintInfo(infoFor(MINT_IDENTITY_PRIVKEY), ODD_PRIVKEY);
    expect(verifyAt({ ...signed, pubkey: infoFor(MINT_IDENTITY_PRIVKEY).pubkey })).toBe('invalid');
  });

  it('rejects a response it cannot canonicalize', () => {
    const info = infoFor(MINT_IDENTITY_PRIVKEY);
    info.contact.push(info as unknown as { method: string; info: string });
    expect(verifyAt({ ...info, signature: 'ab'.repeat(64) })).toBe('invalid');
  });

  it('rejects a malformed signature, pubkey, or time', () => {
    const signed = signMintInfo(infoFor(MINT_IDENTITY_PRIVKEY));
    expect(verifyAt({ ...signed, signature: 'not hex' })).toBe('invalid');
    expect(verifyAt({ ...signed, signature: 42 as unknown as string })).toBe('invalid');
    expect(verifyAt({ ...signed, pubkey: signed.pubkey.slice(2) })).toBe('invalid');
    expect(verifyAt({ ...signed, pubkey: signed.pubkey.toUpperCase() })).toBe('invalid');
    expect(verifyAt({ ...signed, pubkey: undefined as unknown as string })).toBe('invalid');
    expect(verifyAt({ ...signed, time: 1731684933.5 })).toBe('invalid');
    expect(verifyAt({ ...signed, time: undefined })).toBe('invalid');
  });
});
