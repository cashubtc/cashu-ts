import { describe, it, expect } from 'vitest';
import { MintInfo } from '../../src/model/MintInfo';
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

	it('maps NUT-19 ttl null to Infinity', () => {
		const info = new MintInfo({
			...MINTINFORESP,
			nuts: {
				19: {
					ttl: null,
					cached_endpoints: [{ method: 'GET', path: '/v1/keys' }],
				},
			},
		} as any);
		expect(info.isSupported(19)).toEqual({
			supported: true,
			params: {
				ttl: Infinity,
				cached_endpoints: [{ method: 'GET', path: '/v1/keys' }],
			},
		});
	});

	it('normalizes bigint info numeric fields at construction', () => {
		const info = new MintInfo({
			...MINTINFORESP,
			nuts: {
				4: {
					disabled: false,
					methods: [{ method: 'bolt11', unit: 'sat', min_amount: 1n, max_amount: 2n }],
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
		} as any);

		expect(info.nuts['4'].methods[0].min_amount).toBe(1);
		expect(info.nuts['4'].methods[0].max_amount).toBe(2);
		expect(info.nuts['5'].methods[0].min_amount).toBe(3);
		expect(info.nuts['5'].methods[0].max_amount).toBe(4);
		expect(info.nuts['22']?.bat_max_mint).toBe(5n);
		expect(info.isSupported(19)).toEqual({
			supported: true,
			params: {
				ttl: 30_000,
				cached_endpoints: [{ method: 'GET', path: '/v1/keys' }],
			},
		});
	});

	it('rejects out-of-range bigint info metadata at construction', () => {
		const info = new MintInfo({
			...MINTINFORESP,
			nuts: {
				19: {
					ttl: 9007199254740993n,
					cached_endpoints: [{ method: 'GET', path: '/v1/keys' }],
				},
			},
		} as any);
		expect(() => info.isSupported(19)).toThrow('nuts.19.ttl');
	});
});
