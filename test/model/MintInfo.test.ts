import { describe, it, expect, vi } from 'vitest';

import { Amount } from '../../src/model/Amount';
import { MintInfo } from '../../src/model/MintInfo';
import { MAX_METHOD_LENGTH } from '../../src/utils/limits';
import { MINTINFORESP } from '../consts';

describe('MintInfo protected endpoint matching', () => {
  it('matches exact literal path', () => {
    const info = new MintInfo({
      ...MINTINFORESP,
      nuts: {
        22: {
          bat_max_mint: 100,
          protected_endpoints: [{ method: 'POST', path: '/v1/swap' }],
        },
      },
    });
    expect(info.requiresBlindAuthToken('POST', '/v1/swap')).toBe(true);
    expect(info.requiresBlindAuthToken('POST', '/v1/swap/')).toBe(false);
    expect(info.requiresBlindAuthToken('POST', '/v1/swapx')).toBe(false);
    expect(info.requiresBlindAuthToken('GET', '/v1/swap')).toBe(false);
  });

  it('matches exact anchored path ^...$', () => {
    const info = new MintInfo({
      ...MINTINFORESP,
      nuts: {
        22: {
          bat_max_mint: 100,
          protected_endpoints: [{ method: 'POST', path: '^/v1/mint/bolt11$' }],
        },
      },
    });
    expect(info.requiresBlindAuthToken('POST', '/v1/mint/bolt11')).toBe(true);
    expect(info.requiresBlindAuthToken('POST', '/v1/mint/bolt11/')).toBe(false);
    expect(info.requiresBlindAuthToken('POST', '/v1/mint/bolt11/extra')).toBe(false);
  });

  it('matches prefix pattern ^/path/.*', () => {
    const info = new MintInfo({
      ...MINTINFORESP,
      nuts: {
        22: {
          bat_max_mint: 100,
          protected_endpoints: [{ method: 'GET', path: '^/v1/mint/quote/bolt11/.*' }],
        },
      },
    });
    expect(info.requiresBlindAuthToken('GET', '/v1/mint/quote/bolt11/')).toBe(true);
    expect(info.requiresBlindAuthToken('GET', '/v1/mint/quote/bolt11/abc123')).toBe(true);
    expect(info.requiresBlindAuthToken('GET', '/v1/mint/quote/bolt11')).toBe(false);
    expect(info.requiresBlindAuthToken('POST', '/v1/mint/quote/bolt11/abc')).toBe(false);
  });

  it('matches prefix pattern ^/path/.*$', () => {
    const info = new MintInfo({
      ...MINTINFORESP,
      nuts: {
        22: {
          bat_max_mint: 100,
          protected_endpoints: [{ method: 'POST', path: '^/v1/melt/.*$' }],
        },
      },
    });
    expect(info.requiresBlindAuthToken('POST', '/v1/melt/')).toBe(true);
    expect(info.requiresBlindAuthToken('POST', '/v1/melt/quote/bolt11')).toBe(true);
    expect(info.requiresBlindAuthToken('POST', '/v1/melt')).toBe(false);
  });

  it('matches prefix pattern /path/*', () => {
    const info = new MintInfo({
      ...MINTINFORESP,
      nuts: {
        22: {
          bat_max_mint: 100,
          protected_endpoints: [{ method: 'GET', path: '/v1/mint/quote/bolt*' }],
        },
      },
    });
    expect(info.requiresBlindAuthToken('GET', '/v1/mint/quote/bolt11/')).toBe(true);
    expect(info.requiresBlindAuthToken('GET', '/v1/mint/quote/bolt11/abc123')).toBe(true);
    expect(info.requiresBlindAuthToken('GET', '/v1/mint/quote/bolt12')).toBe(true);
    expect(info.requiresBlindAuthToken('GET', '/v1/melt/quote')).toBe(false);
    expect(info.requiresBlindAuthToken('POST', '/v1/mint/quote/bolt11/abc')).toBe(false);
    expect(info.requiresBlindAuthToken('GET', '/v1/melt/quote/bolt12')).toBe(false);
  });

  it('returns false for a non-GET/POST request method (runtime guard)', () => {
    const info = new MintInfo({
      ...MINTINFORESP,
      nuts: {
        22: {
          bat_max_mint: 100,
          protected_endpoints: [{ method: 'POST', path: '/v1/swap' }],
        },
      },
    });
    expect(info.requiresBlindAuthToken('PUT' as any, '/v1/swap')).toBe(false);
  });

  it('skips malformed protected_endpoints entries and upcases the method', () => {
    const info = new MintInfo({
      ...MINTINFORESP,
      nuts: {
        22: {
          bat_max_mint: 100,
          protected_endpoints: [
            null, // not an object
            { method: 123, path: '/v1/a' }, // non-string method
            { method: 'GET', path: 42 }, // non-string path
            { method: 'DELETE', path: '/v1/b' }, // unsupported verb
            { method: 'post', path: '/v1/swap' }, // lowercase verb -> upcased
          ] as any,
        },
      },
    });
    expect(info.requiresBlindAuthToken('POST', '/v1/swap')).toBe(true);
    expect(info.requiresBlindAuthToken('GET', '/v1/a')).toBe(false);
    expect(info.requiresBlindAuthToken('POST', '/v1/a')).toBe(false);
    expect(info.requiresBlindAuthToken('GET', '/v1/b')).toBe(false);
  });

  it('maps NUT-19 ttl null to Infinity', () => {
    const info = new MintInfo({
      ...MINTINFORESP,
      nuts: {
        19: {
          ttl: null,
          cached_endpoints: [{ method: 'GET', path: '/v1/keys' }],
        },
      },
    });
    expect(info.isSupported(19)).toEqual({
      supported: true,
      params: {
        ttl: Infinity,
        cached_endpoints: [{ method: 'GET', path: '/v1/keys' }],
      },
    });
  });

  it('preserves AmountLike min/max amounts; normalizes metadata integers at construction', () => {
    const info = new MintInfo({
      ...MINTINFORESP,
      nuts: {
        4: {
          disabled: false,
          methods: [
            {
              method: 'bolt11',
              unit: 'sat',
              method_name: 'Lightning',
              min_amount: 1n,
              max_amount: 2n,
            },
          ],
        },
        5: {
          disabled: false,
          methods: [{ method: 'bolt11', unit: 'sat', min_amount: 3n, max_amount: 4n }],
        },
        19: {
          ttl: 30n,
          cached_endpoints: [{ method: 'GET', path: '/v1/keys' }],
        },
        22: {
          bat_max_mint: 5n,
          protected_endpoints: [{ method: 'POST', path: '/v1/swap' }],
        },
      },
    });

    // min/max amounts are AmountLike — wire bigint values pass through as-is
    expect(info.nuts['4'].methods[0].min_amount).toBe(1n);
    expect(info.nuts['4'].methods[0].max_amount).toBe(2n);
    expect(info.nuts['5'].methods[0].min_amount).toBe(3n);
    expect(info.nuts['5'].methods[0].max_amount).toBe(4n);
    // method_name (NUT-04/05) passes through; derived from `method` on mints that omit it
    expect(info.nuts['4'].methods[0].method_name).toBe('Lightning');
    expect(info.nuts['5'].methods[0].method_name).toBe('Bolt11');
    // metadata integers (ttl, bat_max_mint) are still normalized to safe numbers
    expect(info.nuts['19']?.ttl).toBe(30);
    expect(info.nuts['22']?.bat_max_mint).toBe(5);
    expect(info.isSupported(19)).toEqual({
      supported: true,
      params: {
        ttl: 30_000,
        cached_endpoints: [{ method: 'GET', path: '/v1/keys' }],
      },
    });
  });

  it('derives method_name from method per NUT-04/05 when null or omitted', () => {
    const info = new MintInfo({
      ...MINTINFORESP,
      nuts: {
        4: {
          disabled: false,
          methods: [
            // omitted -> derived
            { method: 'bolt11', unit: 'sat', min_amount: null, max_amount: null },
            // explicit null -> derived, hyphen split + title-case
            {
              method: 'apple-pay',
              unit: 'usd',
              method_name: null,
              min_amount: null,
              max_amount: null,
            },
            // explicit name -> passes through untouched
            {
              method: 'bolt12',
              unit: 'sat',
              method_name: 'Lightning Offers',
              min_amount: null,
              max_amount: null,
            },
          ],
        },
      },
    });

    const methods = info.nuts['4'].methods;
    expect(methods[0].method_name).toBe('Bolt11');
    expect(methods[1].method_name).toBe('Apple Pay');
    expect(methods[2].method_name).toBe('Lightning Offers');
  });

  it('leaves method_name null when method is malformed (non-string or delimiter-only)', () => {
    const info = new MintInfo({
      ...MINTINFORESP,
      nuts: {
        4: {
          disabled: false,
          methods: [
            // non-string method -> null (no bogus name)
            { method: 123, unit: 'sat', min_amount: null, max_amount: null },
            // delimiter-only method -> zero words -> null
            { method: '-_-', unit: 'sat', method_name: null, min_amount: null, max_amount: null },
          ],
        },
      },
    });

    const methods = info.nuts['4'].methods;
    expect(methods[0].method_name).toBeNull();
    expect(methods[1].method_name).toBeNull();
  });

  it('skips derivation for an over-long method (memory-exhaustion guard)', () => {
    // A hostile mint could send a multi-megabyte `method`; deriving from it would run unbounded
    // split/map/join. The length cap short-circuits before any string work.
    const hugeMethod = 'a-'.repeat(1_000_000); // 2M chars, well past MAX_METHOD_LENGTH
    const info = new MintInfo({
      ...MINTINFORESP,
      nuts: {
        4: {
          disabled: false,
          methods: [{ method: hugeMethod, unit: 'sat', min_amount: null, max_amount: null }],
        },
      },
    });

    expect(info.nuts['4'].methods[0].method_name).toBeNull();
  });

  it('derives method_name for a method of exactly MAX_METHOD_LENGTH chars', () => {
    const method = 'a'.repeat(MAX_METHOD_LENGTH);
    const info = new MintInfo({
      ...MINTINFORESP,
      nuts: {
        4: {
          disabled: false,
          methods: [{ method, unit: 'sat', min_amount: null, max_amount: null }],
        },
      },
    });
    expect(info.nuts['4'].methods[0].method_name).toBe('A' + 'a'.repeat(MAX_METHOD_LENGTH - 1));
  });

  it('supportedMethods lists usable methods and returns [] for disabled ops', () => {
    const info = new MintInfo({
      ...MINTINFORESP,
      nuts: {
        4: {
          disabled: false,
          methods: [
            { method: 'bolt11', unit: 'sat', min_amount: null, max_amount: null },
            { method: 'bolt12', unit: 'sat', min_amount: null, max_amount: null },
          ],
        },
        5: {
          disabled: true,
          methods: [{ method: 'bolt11', unit: 'sat', min_amount: null, max_amount: null }],
        },
      },
    });

    expect(info.supportedMethods('mint').map((m) => m.method)).toEqual(['bolt11', 'bolt12']);
    expect(info.supportedMethods('melt')).toEqual([]);
  });

  it('rejects out-of-range bigint info metadata at construction', () => {
    expect(
      () =>
        new MintInfo({
          ...MINTINFORESP,
          nuts: {
            19: {
              ttl: 9007199254740993n,
              cached_endpoints: [{ method: 'GET', path: '/v1/keys' }],
            },
          },
        }),
    ).toThrow('nuts.19.ttl');
  });
});

describe('MintInfo NUT-29 batch minting info', () => {
  function mockLogger() {
    return {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      log: vi.fn(),
    };
  }

  it('returns supported:false when nuts["29"] is absent', () => {
    const info = new MintInfo({
      ...MINTINFORESP,
      nuts: {
        ...MINTINFORESP.nuts,
      },
    });
    expect(info.isSupported(29)).toEqual({ supported: false });
  });

  it('returns supported:true with correct params when both max_batch_size and methods are present', () => {
    const info = new MintInfo({
      ...MINTINFORESP,
      nuts: {
        ...MINTINFORESP.nuts,
        29: { max_batch_size: 100, methods: ['bolt11', 'bolt12'] },
      },
    });
    expect(info.isSupported(29)).toEqual({
      supported: true,
      params: { max_batch_size: 100, methods: ['bolt11', 'bolt12'] },
    });
  });

  it('defaults max_batch_size to internal cap when omitted', () => {
    const info = new MintInfo({
      ...MINTINFORESP,
      nuts: {
        ...MINTINFORESP.nuts,
        29: { methods: ['bolt11'] },
      },
    });
    const result = info.isSupported(29);
    expect(result.supported).toBe(true);
    expect(result.params).toEqual({ methods: ['bolt11'], max_batch_size: 100 });
  });

  it('returns supported:true with params when methods is omitted', () => {
    const info = new MintInfo({
      ...MINTINFORESP,
      nuts: {
        ...MINTINFORESP.nuts,
        29: { max_batch_size: 50 },
      },
    });
    const result = info.isSupported(29);
    expect(result.supported).toBe(true);
    expect(result.params).toEqual({ max_batch_size: 50 });
  });

  it('normalizes non-integer max_batch_size to integer', () => {
    const info = new MintInfo({
      ...MINTINFORESP,
      nuts: {
        ...MINTINFORESP.nuts,
        29: { max_batch_size: '100' as any },
      },
    });
    const result = info.isSupported(29);
    expect(result.supported).toBe(true);
    expect(result.params?.max_batch_size).toBe(100);
  });

  it('does not throw when max_batch_size is a float — defaults to internal cap', () => {
    const logger = mockLogger();
    const info = new MintInfo(
      {
        ...MINTINFORESP,
        nuts: {
          ...MINTINFORESP.nuts,
          29: { max_batch_size: 2.5, methods: ['bolt11'] },
        },
      },
      logger,
    );
    const result = info.isSupported(29);
    expect(result.supported).toBe(true);
    expect(result.params?.max_batch_size).toBe(100);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('malformed'),
      expect.objectContaining({ value: 2.5 }),
    );
  });

  it('does not throw when max_batch_size is NaN — defaults to internal cap', () => {
    const logger = mockLogger();
    const info = new MintInfo(
      {
        ...MINTINFORESP,
        nuts: {
          ...MINTINFORESP.nuts,
          29: { max_batch_size: NaN },
        },
      },
      logger,
    );
    const result = info.isSupported(29);
    expect(result.supported).toBe(true);
    expect(result.params?.max_batch_size).toBe(100);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('malformed'),
      expect.objectContaining({ value: NaN }),
    );
  });

  it('does not throw when max_batch_size is negative — defaults to internal cap', () => {
    const logger = mockLogger();
    const info = new MintInfo(
      {
        ...MINTINFORESP,
        nuts: {
          ...MINTINFORESP.nuts,
          29: { max_batch_size: -1 },
        },
      },
      logger,
    );
    const result = info.isSupported(29);
    expect(result.supported).toBe(true);
    expect(result.params?.max_batch_size).toBe(100);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('malformed'),
      expect.objectContaining({ value: -1 }),
    );
  });

  it('clamps max_batch_size above 100 to 100', () => {
    const logger = mockLogger();
    const info = new MintInfo(
      {
        ...MINTINFORESP,
        nuts: {
          ...MINTINFORESP.nuts,
          29: { max_batch_size: 500 },
        },
      },
      logger,
    );
    const result = info.isSupported(29);
    expect(result.supported).toBe(true);
    expect(result.params?.max_batch_size).toBe(100);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('clamped'),
      expect.objectContaining({ advertised: 500, clampedTo: 100 }),
    );
  });

  it('does not clamp max_batch_size of exactly 100', () => {
    const logger = mockLogger();
    const info = new MintInfo(
      {
        ...MINTINFORESP,
        nuts: {
          ...MINTINFORESP.nuts,
          29: { max_batch_size: 100 },
        },
      },
      logger,
    );
    const result = info.isSupported(29);
    expect(result.supported).toBe(true);
    expect(result.params?.max_batch_size).toBe(100);
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe('MintInfo NUT-22 bat_max_mint normalization', () => {
  function mockLogger() {
    return {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
      log: vi.fn(),
    };
  }

  it('defaults bat_max_mint to internal cap when malformed (float)', () => {
    const logger = mockLogger();
    const info = new MintInfo(
      {
        ...MINTINFORESP,
        nuts: {
          ...MINTINFORESP.nuts,
          22: {
            bat_max_mint: 2.5,
            protected_endpoints: [{ method: 'POST', path: '/v1/swap' }],
          },
        },
      },
      logger,
    );
    expect(info.nuts['22']?.bat_max_mint).toBe(100);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('malformed'),
      expect.objectContaining({ value: 2.5 }),
    );
  });

  it('clamps bat_max_mint above 100 to 100', () => {
    const logger = mockLogger();
    const info = new MintInfo(
      {
        ...MINTINFORESP,
        nuts: {
          ...MINTINFORESP.nuts,
          22: {
            bat_max_mint: 500,
            protected_endpoints: [{ method: 'POST', path: '/v1/swap' }],
          },
        },
      },
      logger,
    );
    expect(info.nuts['22']?.bat_max_mint).toBe(100);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('clamped'),
      expect.objectContaining({ advertised: 500, clampedTo: 100 }),
    );
  });

  it('does not clamp bat_max_mint at or below 100', () => {
    const logger = mockLogger();
    const info = new MintInfo(
      {
        ...MINTINFORESP,
        nuts: {
          ...MINTINFORESP.nuts,
          22: {
            bat_max_mint: 50,
            protected_endpoints: [{ method: 'POST', path: '/v1/swap' }],
          },
        },
      },
      logger,
    );
    expect(info.nuts['22']?.bat_max_mint).toBe(50);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('does not clamp bat_max_mint of exactly 100', () => {
    const logger = mockLogger();
    const info = new MintInfo(
      {
        ...MINTINFORESP,
        nuts: {
          ...MINTINFORESP.nuts,
          22: {
            bat_max_mint: 100,
            protected_endpoints: [{ method: 'POST', path: '/v1/swap' }],
          },
        },
      },
      logger,
    );
    expect(info.nuts['22']?.bat_max_mint).toBe(100);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('skips normalization when nuts["22"] is absent', () => {
    const info = new MintInfo({
      ...MINTINFORESP,
      nuts: {
        ...MINTINFORESP.nuts,
      },
    });
    expect(info.nuts['22']).toBeUndefined();
  });

  it('skips NUT-29 normalization when nuts["29"] is absent', () => {
    const info = new MintInfo({
      ...MINTINFORESP,
      nuts: {
        ...MINTINFORESP.nuts,
      },
    });
    expect(info.nuts['29']).toBeUndefined();
    expect(info.isSupported(29)).toEqual({ supported: false });
  });
});

describe('MintInfo isSupported branches', () => {
  it('reports generic nuts as unsupported when absent', () => {
    const info = new MintInfo({ ...MINTINFORESP, nuts: {} });
    expect(info.isSupported(7)).toEqual({ supported: false });
    expect(info.isSupported(20)).toEqual({ supported: false });
  });

  it('reports mint/melt disabled with empty params when the nut is absent', () => {
    const info = new MintInfo({ ...MINTINFORESP, nuts: {} });
    expect(info.isSupported(4)).toEqual({ disabled: true, params: [] });
    expect(info.isSupported(5)).toEqual({ disabled: true, params: [] });
  });

  it('reports mint disabled when the method list is empty', () => {
    const info = new MintInfo({
      ...MINTINFORESP,
      nuts: { 4: { disabled: false, methods: [] } },
    });
    expect(info.isSupported(4)).toEqual({ disabled: true, params: [] });
  });

  it('keeps advertised methods in params when the mint disables the operation', () => {
    const method = {
      method: 'bolt11',
      unit: 'sat',
      method_name: 'Lightning',
      min_amount: null,
      max_amount: null,
    };
    const info = new MintInfo({
      ...MINTINFORESP,
      nuts: { 4: { disabled: true, methods: [method] } },
    });
    expect(info.isSupported(4)).toEqual({ disabled: true, params: [method] });
  });

  it('reports NUT-17 unsupported when absent or empty, supported with params otherwise', () => {
    const absent = new MintInfo({ ...MINTINFORESP, nuts: {} });
    expect(absent.isSupported(17)).toEqual({ supported: false });

    const empty = new MintInfo({ ...MINTINFORESP, nuts: { 17: { supported: [] } } });
    expect(empty.isSupported(17)).toEqual({ supported: false });

    const ws = { method: 'bolt11', unit: 'sat', commands: ['proof_state'] };
    const present = new MintInfo({ ...MINTINFORESP, nuts: { 17: { supported: [ws] } } });
    expect(present.isSupported(17)).toEqual({ supported: true, params: [ws] });
  });

  it('reports NUT-15 unsupported when absent or empty, supported with params otherwise', () => {
    const absent = new MintInfo({ ...MINTINFORESP, nuts: {} });
    expect(absent.isSupported(15)).toEqual({ supported: false });

    const empty = new MintInfo({ ...MINTINFORESP, nuts: { 15: { methods: [] } } });
    expect(empty.isSupported(15)).toEqual({ supported: false });

    const mpp = { method: 'bolt11', unit: 'sat' };
    const present = new MintInfo({ ...MINTINFORESP, nuts: { 15: { methods: [mpp] } } });
    expect(present.isSupported(15)).toEqual({ supported: true, params: [mpp] });
  });

  it('reports NUT-19 unsupported when cached_endpoints is empty or missing', () => {
    const empty = new MintInfo({
      ...MINTINFORESP,
      nuts: { 19: { ttl: 60, cached_endpoints: [] } },
    });
    expect(empty.isSupported(19)).toEqual({ supported: false });

    const missing = new MintInfo({
      ...MINTINFORESP,
      nuts: { 19: { ttl: 60 } as any },
    });
    expect(missing.isSupported(19)).toEqual({ supported: false });
  });
});

describe('MintInfo method/unit capability checks', () => {
  it('supportsNut04Description matches on unit when given, any unit otherwise', () => {
    const info = new MintInfo({
      ...MINTINFORESP,
      nuts: {
        4: {
          disabled: false,
          methods: [
            {
              method: 'bolt11',
              unit: 'usd',
              method_name: null,
              min_amount: null,
              max_amount: null,
              options: { description: true },
            },
          ],
        },
      },
    });
    expect(info.supportsNut04Description('bolt11')).toBe(true);
    expect(info.supportsNut04Description('bolt11', 'usd')).toBe(true);
    expect(info.supportsNut04Description('bolt11', 'sat')).toBe(false);
  });

  it('supportsNut04Description is falsy when NUT-4 info is absent', () => {
    const info = new MintInfo({ ...MINTINFORESP, nuts: {} });
    expect(info.supportsNut04Description('bolt11')).toBeFalsy();
  });

  it('supportsMintMeltMethod returns false when the operation is disabled', () => {
    const info = new MintInfo({
      ...MINTINFORESP,
      nuts: {
        5: {
          disabled: true,
          methods: [{ method: 'bolt11', unit: 'sat', min_amount: null, max_amount: null }],
        },
      },
    });
    expect(info.supportsMintMeltMethod('melt', 'bolt11', 'sat')).toBe(false);
  });

  it('getMintMeltMethod returns the matched settings, also after a JSON round-trip', () => {
    const info = new MintInfo({
      ...MINTINFORESP,
      nuts: {
        5: {
          disabled: false,
          methods: [{ method: 'bolt11', unit: 'sat', min_amount: 1, max_amount: 10_000 }],
        },
      },
    });

    const rehydrated = new MintInfo(JSON.parse(JSON.stringify(info.cache)));
    for (const i of [info, rehydrated]) {
      expect(i.getMintMeltMethod('melt', 'bolt11', 'sat')).toMatchObject({
        min_amount: 1,
        max_amount: 10_000,
      });
      expect(i.getMintMeltMethod('melt', 'bolt11', 'usd')).toBeUndefined();
    }
  });

  it('getMintMeltMethod returns undefined when the operation is disabled', () => {
    const info = new MintInfo({
      ...MINTINFORESP,
      nuts: {
        5: {
          disabled: true,
          methods: [{ method: 'bolt11', unit: 'sat', min_amount: null, max_amount: null }],
        },
      },
    });
    expect(info.getMintMeltMethod('melt', 'bolt11', 'sat')).toBeUndefined();
  });

  it('supportsAmountless defaults to bolt11/sat and requires an exact method/unit match', () => {
    const info = new MintInfo({
      ...MINTINFORESP,
      nuts: {
        5: {
          disabled: false,
          methods: [
            {
              method: 'bolt11',
              unit: 'sat',
              min_amount: null,
              max_amount: null,
              options: { amountless: true },
            },
          ],
        },
      },
    });
    expect(info.supportsAmountless()).toBe(true);
    expect(info.supportsAmountless('bolt11', 'usd')).toBe(false);
    expect(info.supportsAmountless('bolt12')).toBe(false);
  });

  it('supportsAmountless returns false when NUT-5 info is absent', () => {
    const info = new MintInfo({ ...MINTINFORESP, nuts: {} });
    expect(info.supportsAmountless()).toBe(false);
  });
});

describe('MintInfo snapshot accessors', () => {
  it('mutating a getMintMeltMethod result cannot pollute the cache', () => {
    const info = new MintInfo(MINTINFORESP);
    const method = info.getMintMeltMethod('mint', 'bolt11', 'sat')!;

    method.min_amount = 10n; // type-legal via AmountLike; must not reach the cache
    method.options!.description = false;

    expect(() => JSON.stringify(info.cache)).not.toThrow();
    expect(info.getMintMeltMethod('mint', 'bolt11', 'sat')).toMatchObject({
      min_amount: null,
      options: { description: true },
    });
  });

  it('preserves Amount instances (AmountLike) through the snapshot', () => {
    // AmountLike admits Amount; a snapshot must not strip its prototype into {value}
    const info = new MintInfo({
      ...MINTINFORESP,
      nuts: {
        4: {
          disabled: false,
          methods: [
            { method: 'bolt11', unit: 'sat', min_amount: Amount.from(100), max_amount: null },
          ],
        },
      },
    });

    const min = info.getMintMeltMethod('mint', 'bolt11', 'sat')!.min_amount;
    expect(min).toBeInstanceOf(Amount);
    expect(() => Amount.from(min!)).not.toThrow();
    expect(Amount.from(min!).toBigInt()).toBe(100n);
  });

  it('supportedMethods and isSupported(4).params return copies', () => {
    const info = new MintInfo(MINTINFORESP);

    info.supportedMethods('mint')[0].unit = 'zzz';
    info.isSupported(4).params[0].method = 'bogus';

    expect(info.supportsMintMeltMethod('mint', 'bolt11', 'sat')).toBe(true);
  });

  it('cache, nuts and contact return snapshots', () => {
    const info = new MintInfo(MINTINFORESP);

    (info.cache as any).nuts = {};
    (info.nuts as any)[4] = undefined;
    info.contact.length = 0;

    expect(info.isSupported(4).disabled).toBe(false);
    expect(info.cache.nuts?.[4]).toBeDefined();
    expect(info.contact).toHaveLength(3);
  });

  it('nut17 and nut29 params are copies', () => {
    const info = new MintInfo(MINTINFORESP);

    const ws = info.isSupported(17);
    if (ws.params) ws.params.length = 0;

    expect(info.isSupported(17).params).toHaveLength(6);
  });
});
