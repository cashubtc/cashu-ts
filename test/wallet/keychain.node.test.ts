import { setupServer } from 'msw/node';
import { HttpResponse, http } from 'msw';
import { beforeAll, beforeEach, afterAll, afterEach, test, describe, expect, vi } from 'vitest';

import { Mint, KeyChain, Keyset, type MintKeyset, type MintKeys } from '../../src';
import { isValidHex } from '../../src/utils';
import { DUMMY_TEST_KEYS, DUMMY_TEST_KEYSET, PUBKEYS } from '../consts';

const mintUrl = 'http://localhost:3338';
const mint = new Mint(mintUrl);
const unit = 'sat';
const CTF_CONDITION_ID = 'aa'.repeat(32);
const CTF_OUTCOME_COLLECTION_ID = 'cc'.repeat(32);
const CTF_KEYSET_ID = '0170110f06b9bb85565a6746ca5715f877b99db14d87219f6e9030cb529f61e6ea';

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

  test('should not use a registered conditional keyset as the cheapest regular keyset', () => {
    const keyChain = new KeyChain(mint, unit);
    keyChain.registerConditionalKeyset(
      {
        id: CTF_KEYSET_ID,
        unit,
        active: true,
        input_fee_ppk: 0,
        final_expiry: 1754296607,
        conditional: {
          conditionId: CTF_CONDITION_ID,
          outcomeCollection: 'YES',
          outcomeCollectionId: CTF_OUTCOME_COLLECTION_ID,
        },
      },
      {
        ...DUMMY_TEST_KEYS,
        id: CTF_KEYSET_ID,
        conditional: {
          conditionId: CTF_CONDITION_ID,
          outcomeCollection: 'YES',
          outcomeCollectionId: CTF_OUTCOME_COLLECTION_ID,
        },
      },
    );

    expect(() => keyChain.getCheapestKeyset()).toThrow('No active keyset found for unit: sat');
  });

  test('should reject tampered keys for a discovered conditional keyset', async () => {
    server.use(
      http.get(mintUrl + '/v1/conditional_keysets', () =>
        HttpResponse.json({
          keysets: [
            {
              id: CTF_KEYSET_ID,
              unit,
              active: true,
              input_fee_ppk: 0,
              condition_id: CTF_CONDITION_ID,
              outcome_collection: 'YES',
              outcome_collection_id: CTF_OUTCOME_COLLECTION_ID,
              registered_at: 1_700_000_000,
            },
          ],
        }),
      ),
      http.get(mintUrl + '/v1/keys/' + CTF_KEYSET_ID, () =>
        HttpResponse.json({
          keysets: [
            {
              ...DUMMY_TEST_KEYS,
              id: CTF_KEYSET_ID,
              keys: {
                ...DUMMY_TEST_KEYS.keys,
                1: PUBKEYS['2'],
              },
            },
          ],
        }),
      ),
    );

    const keyChain = new KeyChain(mint, unit);
    await expect(keyChain.loadConditionalKeyset(CTF_KEYSET_ID)).rejects.toThrow(
      'Conditional keyset verification failed',
    );
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

  test('loads conditional keysets through the conditional registry', async () => {
    server.use(
      http.get(mintUrl + '/v1/conditional_keysets', () =>
        HttpResponse.json({
          keysets: [
            {
              id: CTF_KEYSET_ID,
              unit: 'sat',
              active: true,
              input_fee_ppk: 0,
              final_expiry: 1754296607,
              condition_id: CTF_CONDITION_ID,
              outcome_collection: 'YES',
              outcome_collection_id: CTF_OUTCOME_COLLECTION_ID,
              registered_at: 1_700_000_000,
            },
          ],
        }),
      ),
      http.get(mintUrl + '/v1/keys/' + CTF_KEYSET_ID, () =>
        HttpResponse.json({
          keysets: [{ ...DUMMY_TEST_KEYS, id: CTF_KEYSET_ID }],
        }),
      ),
    );

    const keyChain = new KeyChain(mint, unit);
    const conditional = await keyChain.loadConditionalKeyset(CTF_KEYSET_ID);

    expect(conditional.id).toBe(CTF_KEYSET_ID);
    expect(conditional.isConditional).toBe(true);
    expect(conditional.verify()).toBe(true);
    expect(keyChain.getConditionalKeyset(CTF_KEYSET_ID)).toBe(conditional);
    expect(keyChain.hasConditionalKeyset(CTF_KEYSET_ID)).toBe(true);
    expect(() => keyChain.getCheapestKeyset()).toThrow(/No active keyset found/);
  });

  test('rejects conditional keysets whose keys do not match their condition-derived id', async () => {
    server.use(
      http.get(mintUrl + '/v1/conditional_keysets', () =>
        HttpResponse.json({
          keysets: [
            {
              id: CTF_KEYSET_ID,
              unit: 'sat',
              active: true,
              input_fee_ppk: 0,
              final_expiry: 1754296607,
              condition_id: 'bb'.repeat(32),
              outcome_collection: 'YES',
              outcome_collection_id: CTF_OUTCOME_COLLECTION_ID,
            },
          ],
        }),
      ),
      http.get(mintUrl + '/v1/keys/' + CTF_KEYSET_ID, () =>
        HttpResponse.json({
          keysets: [{ ...DUMMY_TEST_KEYS, id: CTF_KEYSET_ID }],
        }),
      ),
    );

    const keyChain = new KeyChain(mint, unit);
    await expect(keyChain.loadConditionalKeyset(CTF_KEYSET_ID)).rejects.toThrow(
      /Conditional keyset verification failed/,
    );
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

  test('regular keyset selectors exclude registered conditional keysets', async () => {
    const keyChain = new KeyChain(mint, unit);
    await keyChain.init();
    keyChain.registerConditionalKeyset(
      {
        id: CTF_KEYSET_ID,
        unit: 'sat',
        active: true,
        input_fee_ppk: 0,
        final_expiry: 1754296607,
        conditional: {
          conditionId: CTF_CONDITION_ID,
          outcomeCollection: 'YES',
          outcomeCollectionId: CTF_OUTCOME_COLLECTION_ID,
          registeredAt: 1_700_000_000,
        },
      },
      { ...DUMMY_TEST_KEYS, id: CTF_KEYSET_ID },
    );

    expect(keyChain.getKeysets().map((keyset) => keyset.id)).not.toContain(CTF_KEYSET_ID);
    expect(keyChain.getCheapestKeyset().id).not.toBe(CTF_KEYSET_ID);
    expect(keyChain.getAllKeysetIds()).toContain(CTF_KEYSET_ID);
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
  test('verifyKeysetId should return false if verifying keyset with no keys', () => {
    const badKeyset = { ...dummyKeysResp.keysets[0], keys: {} };
    const verify = Keyset.verifyKeysetId(badKeyset);
    expect(verify).toBeFalsy();
  });
  test('fromMintApi should load if keys / meta match', () => {
    const keyset = Keyset.fromMintApi(dummyKeysetResp.keysets[0], dummyKeysResp.keysets[0]);
    expect(keyset.id).toBe(dummyKeysetResp.keysets[0].id);
  });
  test('conditional verify should pass valid condition metadata and reject tampering', () => {
    const conditionalMeta = {
      conditionId: CTF_CONDITION_ID,
      outcomeCollection: 'YES',
      outcomeCollectionId: CTF_OUTCOME_COLLECTION_ID,
      registeredAt: 1_700_000_000,
    };
    const keyset = Keyset.fromMintApi(
      {
        id: CTF_KEYSET_ID,
        unit: 'sat',
        active: true,
        input_fee_ppk: 0,
        final_expiry: 1754296607,
        conditional: conditionalMeta,
      },
      { ...DUMMY_TEST_KEYS, id: CTF_KEYSET_ID, conditional: conditionalMeta },
    );
    expect(keyset.isConditional).toBe(true);
    expect(keyset.verify()).toBe(true);
    expect(
      Keyset.verifyConditionalKeysetId(
        { ...DUMMY_TEST_KEYS, id: CTF_KEYSET_ID },
        { ...conditionalMeta, outcomeCollectionId: 'dd'.repeat(32) },
      ),
    ).toBe(false);
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
