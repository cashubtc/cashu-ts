import { describe, it, expect } from 'vitest';
import { MintInfo } from '../../src/model/MintInfo';

const baseMintInfo = {
	name: 'Test Mint',
	pubkey: '0000',
	version: 'test/0.1',
	nuts: {},
};

describe('MintInfo protected endpoint matching', () => {
	it('matches exact literal path', () => {
		const info = new MintInfo({
			...baseMintInfo,
			nuts: {
				22: {
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
			...baseMintInfo,
			nuts: {
				22: {
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
			...baseMintInfo,
			nuts: {
				22: {
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
			...baseMintInfo,
			nuts: {
				22: {
					protected_endpoints: [{ method: 'POST', path: '^/v1/melt/.*$' }],
				},
			},
		});
		expect(info.requiresBlindAuthToken('POST', '/v1/melt/')).toBe(true);
		expect(info.requiresBlindAuthToken('POST', '/v1/melt/quote/bolt11')).toBe(true);
		expect(info.requiresBlindAuthToken('POST', '/v1/melt')).toBe(false);
	});
});
