import { describe, expect, it } from 'vitest';
import { Mint } from '../../src';

type ReqArgs = {
	endpoint: string;
	method?: string;
	requestBody?: unknown;
	headers?: Record<string, string>;
};

const mintUrl = 'https://localhost:3338';

const makeRequest = <T>(payload: T) => {
	return async (options: ReqArgs): Promise<T> => {
		void options;
		return payload;
	};
};

describe('Mint legacy numeric normalization', () => {
	it('normalizes amount-like bigint fields in getInfo()', async () => {
		const mint = new Mint(mintUrl, {
			customRequest: makeRequest({
				name: 'mint',
				pubkey: '02abcd',
				version: 'test',
				contact: [],
				nuts: {
					'4': {
						disabled: false,
						methods: [
							{
								method: 'bolt11',
								unit: 'sat',
								min_amount: 123n,
								max_amount: 456n,
							},
						],
					},
					'5': {
						disabled: false,
						methods: [
							{
								method: 'bolt11',
								unit: 'sat',
								min_amount: 789n,
								max_amount: 999n,
							},
						],
					},
					'19': { ttl: 120n, cached_endpoints: [] },
					'22': { bat_max_mint: 5n, protected_endpoints: [] },
				},
			} as any),
		});

		const info = await mint.getInfo();

		expect(info.nuts['4'].methods[0].min_amount).toBe(123);
		expect(info.nuts['4'].methods[0].max_amount).toBe(456);
		expect(info.nuts['5'].methods[0].min_amount).toBe(789);
		expect(info.nuts['5'].methods[0].max_amount).toBe(999);
		expect(info.nuts['19']?.ttl).toBe(120n);
		expect(info.nuts['22']?.bat_max_mint).toBe(5n);
	});

	it('leaves getInfo metadata validation to downstream edges', async () => {
		const mint = new Mint(mintUrl, {
			customRequest: makeRequest({
				name: 'mint',
				pubkey: '02abcd',
				version: 'test',
				contact: [],
				nuts: {
					'4': { disabled: false, methods: [] },
					'5': { disabled: false, methods: [] },
					'19': { ttl: 9007199254740993n, cached_endpoints: [{ method: 'GET', path: '/v1/keys' }] },
				},
			} as any),
		});

		const info = await mint.getInfo();
		expect(info.nuts['19']?.ttl).toBe(9007199254740993n);
	});

	it('normalizes bigint fields in getKeySets()', async () => {
		const mint = new Mint(mintUrl, {
			customRequest: makeRequest({
				keysets: [
					{
						id: '00ks',
						unit: 'sat',
						active: true,
						input_fee_ppk: 250n,
						final_expiry: 1_754_296_607n,
					},
				],
			} as any),
		});

		const response = await mint.getKeySets();

		expect(response.keysets[0].input_fee_ppk).toBe(250);
		expect(response.keysets[0].final_expiry).toBe(1_754_296_607);
	});

	it('rejects out-of-range bigint keyset metadata in getKeySets()', async () => {
		const mint = new Mint(mintUrl, {
			customRequest: makeRequest({
				keysets: [
					{
						id: '00ks',
						unit: 'sat',
						active: true,
						input_fee_ppk: 9007199254740993n,
					},
				],
			} as any),
		});

		await expect(mint.getKeySets()).rejects.toThrow('keyset.input_fee_ppk');
	});

	it('normalizes bigint fields in getKeys()', async () => {
		const mint = new Mint(mintUrl, {
			customRequest: makeRequest({
				keysets: [
					{
						id: '00ks',
						unit: 'sat',
						input_fee_ppk: 250n,
						final_expiry: 1_754_296_607n,
						keys: { 1: '02abcd' },
					},
				],
			} as any),
		});

		const response = await mint.getKeys();

		expect(response.keysets[0].input_fee_ppk).toBe(250);
		expect(response.keysets[0].final_expiry).toBe(1_754_296_607);
	});

	it('rejects out-of-range bigint key metadata in getKeys()', async () => {
		const mint = new Mint(mintUrl, {
			customRequest: makeRequest({
				keysets: [
					{
						id: '00ks',
						unit: 'sat',
						input_fee_ppk: 9007199254740993n,
						keys: { 1: '02abcd' },
					},
				],
			} as any),
		});

		await expect(mint.getKeys()).rejects.toThrow('keys.input_fee_ppk');
	});
});
