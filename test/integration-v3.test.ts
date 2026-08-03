// Taproot v3 integration tests. Require a nutshell mint with a BLS (v3)
// keyset on port 3338: `DEV=1 make nutshell-bls-down nutshell-bls-up`.

import { test, describe, expect } from 'vitest';

import { Mint, isBlsKeyset } from '../src';

const mintUrl = 'http://127.0.0.1:3338';

describe('v3 keyset bring-up', () => {
  test('mint advertises an active BLS (v3) keyset and serves its keys', async () => {
    const mint = new Mint(mintUrl);
    const { keysets } = await mint.getKeySets();
    const v3 = keysets.filter((k) => isBlsKeyset(k.id) && k.active);
    expect(v3.length).toBeGreaterThan(0);
    expect(v3[0].id.startsWith('02')).toBe(true);

    const keysResponse = await mint.getKeys(v3[0].id);
    const keys = keysResponse.keysets.find((k) => k.id === v3[0].id);
    expect(keys).toBeDefined();
    const pubkeys = Object.values(keys!.keys);
    expect(pubkeys.length).toBeGreaterThan(0);
    // BLS12-381 G2 compressed pubkeys: 96 bytes, 192 hex chars
    pubkeys.forEach((pk) => expect(pk).toMatch(/^[0-9a-f]{192}$/));
  });
});
