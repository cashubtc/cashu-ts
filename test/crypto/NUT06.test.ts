import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { describe, expect, it } from 'vitest';

import { getPubKeyFromPrivKey } from '../../src/crypto/curve_secp';
import { verifyMintInfoSignature } from '../../src/crypto/NUT06';
import type { GetInfoResponse } from '../../src/model/types';
import { canonicalizeJson } from '../../src/utils/canonicalJson';
import { MINT_IDENTITY_PRIVKEY, signMintInfo } from '../consts';

// Odd-Y counterpart to MINT_IDENTITY_PRIVKEY: BIP-340 signs with the x-only key either way.
const ODD_PRIVKEY = '00'.repeat(31) + '06';

function infoFor(privkey: string): GetInfoResponse {
  return {
    name: 'Test mint',
    pubkey: bytesToHex(getPubKeyFromPrivKey(hexToBytes(privkey))),
    version: 'Testnut/1.0.0',
    contact: [],
    time: 1731684933,
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

describe('verifyMintInfoSignature', () => {
  it('signs the response without its signature and time members', () => {
    const { signature, time, ...payload } = infoFor(MINT_IDENTITY_PRIVKEY);
    expect(signature).toBeUndefined();
    expect(time).toBe(1731684933);
    expect(canonicalizeJson(payload)).toBe(
      '{"contact":[],"name":"Test mint","nuts":{"4":{"disabled":false,"methods":[{"max_amount":null,"method":"bolt11","method_name":null,"min_amount":1,"unit":"sat"}]},"5":{"disabled":true,"methods":[]}},"pubkey":"' +
        payload.pubkey +
        '","version":"Testnut/1.0.0"}',
    );
  });

  it('reports unsigned when the mint claims no signature', () => {
    expect(verifyMintInfoSignature(infoFor(MINT_IDENTITY_PRIVKEY))).toBe('unsigned');
  });

  it('verifies a signature from an even-Y and an odd-Y identity key', () => {
    for (const key of [MINT_IDENTITY_PRIVKEY, ODD_PRIVKEY]) {
      expect(verifyMintInfoSignature(signMintInfo(infoFor(key), key))).toBe('valid');
    }
    expect(infoFor(MINT_IDENTITY_PRIVKEY).pubkey.slice(0, 2)).toBe('02');
    expect(infoFor(ODD_PRIVKEY).pubkey.slice(0, 2)).toBe('03');
  });

  it('still verifies when only time has moved on', () => {
    const signed = signMintInfo(infoFor(MINT_IDENTITY_PRIVKEY));
    expect(verifyMintInfoSignature({ ...signed, time: 1731684999 })).toBe('valid');
  });

  it('rejects a response altered after signing', () => {
    const signed = signMintInfo(infoFor(MINT_IDENTITY_PRIVKEY));
    expect(verifyMintInfoSignature({ ...signed, name: 'Evil mint' })).toBe('invalid');
    expect(
      verifyMintInfoSignature({ ...signed, nuts: { ...signed.nuts, '12': { supported: false } } }),
    ).toBe('invalid');
  });

  it('rejects a signature made by another key', () => {
    const signed = signMintInfo(infoFor(MINT_IDENTITY_PRIVKEY), ODD_PRIVKEY);
    expect(
      verifyMintInfoSignature({ ...signed, pubkey: infoFor(MINT_IDENTITY_PRIVKEY).pubkey }),
    ).toBe('invalid');
  });

  it('rejects a response it cannot canonicalize', () => {
    const info = infoFor(MINT_IDENTITY_PRIVKEY);
    info.contact.push(info as unknown as { method: string; info: string });
    expect(verifyMintInfoSignature({ ...info, signature: 'ab'.repeat(64) })).toBe('invalid');
  });

  it('rejects a malformed signature or pubkey', () => {
    const signed = signMintInfo(infoFor(MINT_IDENTITY_PRIVKEY));
    expect(verifyMintInfoSignature({ ...signed, signature: 'not hex' })).toBe('invalid');
    expect(verifyMintInfoSignature({ ...signed, signature: 42 as unknown as string })).toBe(
      'invalid',
    );
    expect(verifyMintInfoSignature({ ...signed, pubkey: signed.pubkey.slice(2) })).toBe('invalid');
    expect(verifyMintInfoSignature({ ...signed, pubkey: undefined as unknown as string })).toBe(
      'invalid',
    );
  });
});
