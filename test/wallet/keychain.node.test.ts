import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { beforeAll, beforeEach, afterAll, afterEach, test, describe, expect, vi } from 'vitest';

import { Mint, KeyChain, Keyset, type MintKeyset, type MintKeys } from '../../src';
import { isValidHex, deriveKeysetId } from '../../src/utils';
import { DUMMY_TEST_KEYS, DUMMY_TEST_KEYSET, PUBKEYS } from '../consts';

const mintUrl = 'http://localhost:3338';
const mint = new Mint(mintUrl);
const unit = 'sat';

const dummyKeysResp: { keysets: MintKeys[] } = {
  keysets: [
    DUMMY_TEST_KEYS,
    {
      id: '009a1f293253e41e',
      unit: 'sat',
      active: true,
      input_fee_ppk: 2,
      final_expiry: undefined,
      keys: PUBKEYS,
    },
    {
      id: 'invalidbase64',
      unit: 'sat',
      active: true,
      input_fee_ppk: 1,
      keys: {
        1: '03pubkey1invalid',
        2: '03pubkey2invalid',
      },
    },
    {
      id: '00inactive',
      unit: 'sat',
      active: false,
      input_fee_ppk: 0,
      keys: {
        1: '03pubkey1inactive',
        2: '03pubkey2inactive',
      },
    },
  ],
};

const dummyKeysetResp: { keysets: MintKeyset[] } = {
  keysets: [
    DUMMY_TEST_KEYSET,
    {
      id: '009a1f293253e41e',
      unit: 'sat',
      active: true,
      input_fee_ppk: 2,
      final_expiry: undefined,
    },
    {
      id: 'invalidbase64',
      unit: 'sat',
      active: true,
      input_fee_ppk: 1,
    },
    {
      id: '00inactive',
      unit: 'sat',
      active: false,
      input_fee_ppk: 0,
    },
  ],
};

const server = setupServer();

beforeAll(() => {
  server.listen({ onUnhandledRequest: 'error' });
});

beforeEach(() => {
  server.use(
    http.get(mintUrl + '/v1/keys', () => {
      return HttpResponse.json(dummyKeysResp);
    }),
  );
  server.use(
    http.get(mintUrl + '/v1/keysets', () => {
      return HttpResponse.json(dummyKeysetResp);
    }),
  );
});

afterEach(() => {
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});

describe('KeyChain initialization', () => {
  test('should initialize with mint instance and load keys and keysets', async () => {
    const keyChain = new KeyChain(mint, unit);
    await keyChain.init();

    // Verify keysets loaded and filtered by unit
    const keysets = keyChain.getKeysets();
    expect(keysets).toHaveLength(4); // All from dummy, assuming same unit
    expect(keysets.map((k) => k.id)).toEqual(dummyKeysetResp.keysets.map((ks) => ks.id));

    // Verify keys assigned
    const keysForFirst = keyChain.getKeyset('00bd033559de27d0').toMintKeys();
    expect(keysForFirst).toEqual(dummyKeysResp.keysets[0]);

    // Verify active keyset (lowest fee, active, hex ID)
    const active = keyChain.getCheapestKeyset();
    expect(active.id).toBe('00bd033559de27d0'); // Fee 0, hex ID
    expect(active.fee).toBe(0);
    expect(active.hasHexId).toBe(true);
    expect(isValidHex(active.id)).toBe(true);

    // Verify final_expiry assigned
    expect(active.expiry).toBe(1754296607);
  });

  test('should initialize with mintUrl and load keys and keysets', async () => {
    const keyChain = new KeyChain('http://localhost:3338', unit);
    await keyChain.init();

    // Verify keysets loaded and filtered by unit
    const keysets = keyChain.getKeysets();
    expect(keysets).toHaveLength(4); // All from dummy, assuming same unit
    expect(keysets.map((k) => k.id)).toEqual(dummyKeysetResp.keysets.map((ks) => ks.id));

    // Verify keys assigned
    const keysForFirst = keyChain.getKeyset('00bd033559de27d0').toMintKeys();
    expect(keysForFirst).toEqual(dummyKeysResp.keysets[0]);

    // Verify active keyset (lowest fee, active, hex ID)
    const active = keyChain.getCheapestKeyset();
    expect(active.id).toBe('00bd033559de27d0'); // Fee 0, hex ID
    expect(active.fee).toBe(0);
    expect(active.hasHexId).toBe(true);
    expect(isValidHex(active.id)).toBe(true);

    // Verify final_expiry assigned
    expect(active.expiry).toBe(1754296607);
  });

  test('should skip loading if already initialized unless forceRefresh', async () => {
    const keyChain = new KeyChain(mint, unit);
    const spyGetKeySets = vi.spyOn(mint, 'getKeySets');
    const spyGetKeys = vi.spyOn(mint, 'getKeys');

    await keyChain.init(); // First load
    expect(spyGetKeySets).toHaveBeenCalledTimes(1);
    expect(spyGetKeys).toHaveBeenCalledTimes(1);

    await keyChain.init(); // Second, should skip
    expect(spyGetKeySets).toHaveBeenCalledTimes(1);
    expect(spyGetKeys).toHaveBeenCalledTimes(1);

    await keyChain.init(true); // Force refresh
    expect(spyGetKeySets).toHaveBeenCalledTimes(2);
    expect(spyGetKeys).toHaveBeenCalledTimes(2);
  });

  test('should throw if no active hex keyset found', async () => {
    // Only include inactive and non-hex keysets
    const limitedKeysetResp = { keysets: dummyKeysetResp.keysets.slice(2) }; // 'invalidbase64' and '00inactive'
    const limitedKeysResp = { keysets: dummyKeysResp.keysets.slice(2) };

    server.use(
      http.get(mintUrl + '/v1/keys', () => {
        return HttpResponse.json(limitedKeysResp);
      }),
      http.get(mintUrl + '/v1/keysets', () => {
        return HttpResponse.json(limitedKeysetResp);
      }),
    );

    const keyChain = new KeyChain(mint, unit);
    await keyChain.init();
    expect(() => keyChain.getCheapestKeyset()).toThrow('No active keyset found for unit: sat');
  });

  test('should remove keys if verification fails', async () => {
    // Create mismatched data by changing ID but keeping keys the same (derived ID won't match)
    const mismatchedKeysetResp = JSON.parse(JSON.stringify(dummyKeysetResp));
    const mismatchedKeysResp = JSON.parse(JSON.stringify(dummyKeysResp));

    // Change ID of first keyset and corresponding keys entry
    const newId = '00bd033559de27d1'; // Mismatched by changing last character
    mismatchedKeysetResp.keysets[0].id = newId;
    mismatchedKeysResp.keysets[0].id = newId;

    server.use(
      http.get(mintUrl + '/v1/keys', () => {
        return HttpResponse.json(mismatchedKeysResp);
      }),
      http.get(mintUrl + '/v1/keysets', () => {
        return HttpResponse.json(mismatchedKeysetResp);
      }),
    );

    const keyChain = new KeyChain(mint, unit);
    await keyChain.init();
    expect(keyChain.getKeyset('00bd033559de27d1').id).toEqual('00bd033559de27d1');
    expect(keyChain.getKeyset('00bd033559de27d1').keys).toEqual({});
  });

  test('should not throw on init with empty keysets; queries throw instead', async () => {
    server.use(
      http.get(mintUrl + '/v1/keysets', () => {
        return HttpResponse.json({ keysets: [] }); // Empty keysets
      }),
    );

    const keyChain = new KeyChain(mint, unit);
    await expect(keyChain.init()).resolves.toBeUndefined(); // init itself succeeds
    expect(() => keyChain.getCheapestKeyset()).toThrow('KeyChain not initialized');
    expect(() => keyChain.getKeysets()).toThrow('KeyChain not initialized');
  });

  test('should preload from cache and match original cache', async () => {
    const originalChain = new KeyChain(mint, unit);
    await originalChain.init();

    // New consolidated cache shape
    const originalCache = originalChain.cache;

    // Instantiate new KeyChain from consolidated cache (unit now explicit)
    const cachedChain = KeyChain.fromCache(mint, unit, originalCache);

    // Verify preloaded without calling init()
    const cachedActive = cachedChain.getCheapestKeyset();
    expect(cachedActive.id).toBe(originalChain.getCheapestKeyset().id);
    expect(cachedActive.fee).toBe(0);
    expect(cachedChain.getKeysets().length).toBe(originalChain.getKeysets().length);

    // Round-trip cache check (savedAt may differ between snapshots — compare structure)
    const newCache = cachedChain.cache;
    expect(newCache.keysets).toEqual(originalCache.keysets);
    expect(newCache.mintUrl).toEqual(originalCache.mintUrl);
  });

  test('loading a sat cache into a usd KeyChain still loads data; getKeysets throws for missing unit', async () => {
    const originalChain = new KeyChain(mint, unit); // 'sat'
    await originalChain.init();

    // Cache contains only sat keysets from dummy data
    const originalCache = originalChain.cache;

    // Load into a 'usd' KeyChain — no longer an error; queries filter by unit
    const usdChain = new KeyChain(mint, 'usd');
    usdChain.loadFromCache(originalCache);
    expect(() => usdChain.getKeysets()).toThrow(/No keysets found for unit: usd/);
    expect(() => usdChain.getCheapestKeyset()).toThrow(/No active keyset found for unit: usd/);
  });

  test('should preload from wire DTOs via mintToCacheDTO + fromCache', async () => {
    const originalChain = new KeyChain(mint, unit);
    await originalChain.init();

    // Decompose to wire DTOs and rebuild via static helpers
    const { keysets, keys } = KeyChain.cacheToMintDTO(originalChain.cache);
    const singleKeyset = keysets.filter((ks) => ks.id === keys[0].id);
    const singleKeys = [keys[0]];

    const cache = KeyChain.mintToCacheDTO(mintUrl, singleKeyset, singleKeys);
    const cachedChain = KeyChain.fromCache(mint, unit, cache);

    // Verify preloaded
    const cachedActive = cachedChain.getCheapestKeyset();
    expect(cachedActive.id).toBe(singleKeys[0].id);
    expect(cachedChain.getKeysets().length).toBe(1);
  });
});

describe('KeyChain getters', () => {
  let keyChain: KeyChain;

  beforeEach(async () => {
    keyChain = new KeyChain(mint, unit);
    await keyChain.init();
  });

  test('should get keyset by ID', () => {
    const keyset = keyChain.getKeyset('00bd033559de27d0');
    expect(keyset.id).toBe('00bd033559de27d0');
    expect(keyset.unit).toBe('sat');
    expect(keyset.isActive).toBe(true);
    expect(keyset.fee).toBe(0);
    expect(keyset.expiry).toBe(1754296607);
    expect(keyset.hasKeys).toBe(true);
    expect(keyset.hasHexId).toBe(true);
    expect(keyset.keys).toEqual(dummyKeysResp.keysets[0].keys);
  });

  test('should handle keyset without keys', () => {
    const keyset = keyChain.getKeyset('00inactive');
    expect(keyset.id).toBe('00inactive');
    expect(keyset.isActive).toBe(false);
    expect(keyset.hasKeys).toBe(false);
    expect(keyset.hasHexId).toBe(false);
    expect(keyset.toMintKeys()).toBe(null);
    expect(keyset.verify()).toBe(false);

    // Also test non-hex
    const nonHexKeyset = keyChain.getKeyset('invalidbase64');
    expect(nonHexKeyset.hasHexId).toBe(false);
    expect(nonHexKeyset.hasKeys).toBe(false);
    expect(nonHexKeyset.toMintKeys()).toBe(null);
    expect(nonHexKeyset.verify()).toBe(false);
  });

  test('should throw on invalid keyset ID', () => {
    expect(() => keyChain.getKeyset('invalid')).toThrow("Keyset 'invalid' not found");
  });

  test('should get active keyset correctly', () => {
    const active = keyChain.getCheapestKeyset();
    expect(active.id).toBe('00bd033559de27d0'); // Lowest fee 0
    expect(active.fee).toBe(0);
  });

  test('should get keyset list', () => {
    const list = keyChain.getKeysets();
    expect(list).toHaveLength(4);
    expect(list.map((k) => k.id).sort()).toEqual(dummyKeysetResp.keysets.map((ks) => ks.id).sort());
  });

  test('should get keyset IDs', () => {
    const list = keyChain.getAllKeysetIds();
    expect(list).toHaveLength(4);
    expect(list.sort()).toEqual(dummyKeysetResp.keysets.map((ks) => ks.id).sort());
  });

  test('getAllKeysetIds and getAllKeys span all units; getKeysets filters to wallet unit', async () => {
    const usdKeysetId = '009a1f293253e41f';
    // USD keyset has no keys entry — realistic for an inactive/old keyset
    const multiUnitKeysetResp = {
      keysets: [
        ...dummyKeysetResp.keysets,
        { id: usdKeysetId, unit: 'usd', active: false, input_fee_ppk: 0 },
      ],
    };
    server.use(http.get(mintUrl + '/v1/keysets', () => HttpResponse.json(multiUnitKeysetResp)));

    const multiChain = new KeyChain(mint, 'sat');
    await multiChain.init();

    // getAllKeysetIds — includes all units, including usd keyset with no keys
    const allIds = multiChain.getAllKeysetIds();
    expect(allIds).toHaveLength(5);
    expect(allIds).toContain(usdKeysetId);

    // getAllKeys — only returns keysets with verified keys; usd has none so sat count unchanged
    const allKeys = multiChain.getAllKeys();
    expect(allKeys.every((k) => k.unit === 'sat')).toBe(true);

    // getKeysets — sat only
    const satKeysets = multiChain.getKeysets();
    expect(satKeysets.every((k) => k.unit === 'sat')).toBe(true);
    expect(satKeysets.find((k) => k.id === usdKeysetId)).toBeUndefined();
  });

  test('should throw getters if not initialized', () => {
    const uninitChain = new KeyChain(mint, unit);
    expect(() => uninitChain.getKeyset('any')).toThrow("Keyset 'any' not found");
    expect(() => uninitChain.getCheapestKeyset()).toThrow('KeyChain not initialized');
    expect(() => uninitChain.getKeysets()).toThrow('KeyChain not initialized');
    expect(() => uninitChain.getAllKeys()).toThrow('KeyChain not initialized');
    expect(() => uninitChain.getAllKeysetIds()).toThrow('KeyChain not initialized');
  });
});

describe('Keyset', () => {
  test('should default fee to 0 if input_fee_ppk undefined', () => {
    const keyset = new Keyset('testid', 'sat', true, undefined, undefined);
    expect(keyset.fee).toBe(0);
  });
  test('version should be -1 for deprecated base64 IDs', () => {
    const keyset = new Keyset('yjzQhxghPdrr', 'sat', true, undefined, undefined);
    expect(keyset.version).toBe(-1);
  });
  test('version should be -1 for odd-length hex IDs', () => {
    const keyset = new Keyset('a', 'sat', true, undefined, undefined);
    expect(keyset.version).toBe(-1);
  });
  test('hasHexId should be false for odd-length hex IDs', () => {
    const keyset = new Keyset('a', 'sat', true, undefined, undefined);
    expect(keyset.hasHexId).toBe(false);
  });
  test('hasHexId and version resolve without throwing for a null id', () => {
    // A mint response with id: null must classify as legacy, not crash on the id checks.
    const keyset = new Keyset(null as unknown as string, 'sat', true, undefined, undefined);
    expect(keyset.hasHexId).toBe(false);
    expect(keyset.version).toBe(-1);
  });
  test('hasHexId and version resolve without throwing for an undefined id', () => {
    const keyset = new Keyset(undefined as unknown as string, 'sat', true, undefined, undefined);
    expect(keyset.hasHexId).toBe(false);
    expect(keyset.version).toBe(-1);
  });
  test('verifyKeysetId should return false if verifying keyset with no keys', () => {
    const badKeyset = { ...dummyKeysResp.keysets[0], keys: {} };
    const verify = Keyset.verifyKeysetId(badKeyset);
    expect(verify).toBeFalsy();
  });
  test('fromMintApi should load if keys / meta match', () => {
    const keyset = Keyset.fromMintApi(dummyKeysetResp.keysets[0], dummyKeysResp.keysets[0]);
    expect(keyset.id).toBe(dummyKeysetResp.keysets[0].id);
  });
  test('fromMintApi should throw if keys / meta mismatched unit', () => {
    const badKeys = { ...dummyKeysResp.keysets[0], unit: 'usd' };
    expect(() => Keyset.fromMintApi(dummyKeysetResp.keysets[0], badKeys)).toThrow(
      /Mismatched keyset units/,
    );
  });
  test('fromMintApi should throw if keys / meta mismatched ID', () => {
    const badKeys = { ...dummyKeysResp.keysets[0], id: '00bad' };
    expect(() => Keyset.fromMintApi(dummyKeysetResp.keysets[0], badKeys)).toThrow(
      /Mismatched keyset ids/,
    );
  });
  test('fromMintApi should throw if keys / meta mismatched final_expiry', () => {
    const badKeys = { ...dummyKeysResp.keysets[0], final_expiry: 123 };
    expect(() => Keyset.fromMintApi(dummyKeysetResp.keysets[0], badKeys)).toThrow(
      /Mismatched keyset expiry/,
    );
  });
});

// Build a genuinely-verifying keyset for PUBKEYS at a given fee.
// Fee and expiry are part of the v1+ id preimage, so distinct values give distinct ids.
function makeKeyset(
  fee: number,
  versionByte = 1,
  expiry?: number,
): { meta: MintKeyset; keys: MintKeys } {
  const id = deriveKeysetId(PUBKEYS, {
    versionByte,
    unit: 'sat',
    input_fee_ppk: fee,
    expiry,
  });
  const meta: MintKeyset = {
    id,
    unit: 'sat',
    active: true,
    input_fee_ppk: fee,
    final_expiry: expiry,
  };
  return { meta, keys: { ...meta, keys: PUBKEYS } };
}

async function initChainWith(keysets: MintKeys[]): Promise<KeyChain> {
  server.use(
    http.get(mintUrl + '/v1/keysets', () =>
      HttpResponse.json({ keysets: keysets.map((k) => ({ ...k, keys: undefined })) }),
    ),
    http.get(mintUrl + '/v1/keys', () => HttpResponse.json({ keysets })),
  );
  const chain = new KeyChain(mint, unit);
  await chain.init();
  return chain;
}

describe('KeyChain.getCheapestKeyset picks the lowest fee regardless of order', () => {
  test('returns cheapest when the cheap keyset is not first in insertion order', async () => {
    const expensive = makeKeyset(100);
    const cheap = makeKeyset(1);
    // Insert expensive first: an unsorted / no-op comparator would wrongly pick it.
    const chain = await initChainWith([expensive.keys, cheap.keys]);
    const active = chain.getCheapestKeyset();
    expect(active.id).toBe(cheap.meta.id);
    expect(active.fee).toBe(1);
  });

  test('returns cheapest when the cheap keyset is first in insertion order', async () => {
    const cheap = makeKeyset(1);
    const expensive = makeKeyset(100);
    // Insert cheap first: a fee-summing comparator would wrongly reverse and pick expensive.
    const chain = await initChainWith([cheap.keys, expensive.keys]);
    const active = chain.getCheapestKeyset();
    expect(active.id).toBe(cheap.meta.id);
    expect(active.fee).toBe(1);
  });
});

describe('KeyChain.getCheapestKeyset prefers the newest keyset version', () => {
  test('picks a newer, dearer keyset over an older, cheaper one', async () => {
    const oldCheap = makeKeyset(1, 0);
    const newDear = makeKeyset(100, 1);
    const chain = await initChainWith([oldCheap.keys, newDear.keys]);
    expect(chain.getCheapestKeyset().id).toBe(newDear.meta.id);
  });

  test('same version: fee beats expiry', async () => {
    const cheapExpiring = makeKeyset(1, 1, 1000);
    const dearForever = makeKeyset(100, 1);
    const chain = await initChainWith([dearForever.keys, cheapExpiring.keys]);
    expect(chain.getCheapestKeyset().id).toBe(cheapExpiring.meta.id);
  });

  test('same version and fee: prefers the keyset expiring last', async () => {
    const dyingSoon = makeKeyset(1, 1, 1000);
    const dyingLater = makeKeyset(1, 1, 2000);
    const chain = await initChainWith([dyingSoon.keys, dyingLater.keys]);
    expect(chain.getCheapestKeyset().id).toBe(dyingLater.meta.id);
  });

  test('same version and fee: prefers no expiry over any expiry', async () => {
    const expiring = makeKeyset(1, 1, 2000);
    const forever = makeKeyset(1, 1);
    const chain = await initChainWith([expiring.keys, forever.keys]);
    expect(chain.getCheapestKeyset().id).toBe(forever.meta.id);
  });

  test('same version and fee: no expiry wins regardless of insertion order', async () => {
    const forever = makeKeyset(1, 1);
    const expiring = makeKeyset(1, 1, 2000);
    const chain = await initChainWith([forever.keys, expiring.keys]);
    expect(chain.getCheapestKeyset().id).toBe(forever.meta.id);
  });
});
