import nock from 'nock';
import { CashuMint } from '../src/CashuMint.js';
import { CashuWallet } from '../src/CashuWallet.js';
import { setGlobalRequestOptions } from '../src/request.js';
import { MeltQuoteResponse } from '../src/model/types/index.js';
import { HttpResponseError, NetworkError, MintOperationError } from '../src/model/Errors';

let request: Record<string, string> | undefined;
const mintUrl = 'https://localhost:3338';
const unit = 'sats';

beforeAll(() => {
	nock.disableNetConnect();
});

beforeEach(() => {
	nock.cleanAll();
	request = undefined;
});

describe('requests', () => {
	test('request with body contains the correct headers', async () => {
		const mint = new CashuMint(mintUrl);
		nock(mintUrl)
			.get('/v1/melt/quote/bolt11/test')
			.reply(200, function () {
				request = this.req.headers;
				console.log(this.req.headers);
				return {
					quote: 'test_melt_quote_id',
					amount: 2000,
					fee_reserve: 20,
					payment_preimage: null,
					state: 'UNPAID'
				} as MeltQuoteResponse;
			});

		const wallet = new CashuWallet(mint, { unit });
		await wallet.checkMeltQuote('test');

		expect(request).toBeDefined();
		// expect(request!['content-type']).toContain('application/json');
		expect(request!['accept']).toContain('application/json, text/plain, */*');
	});

	test('global custom headers can be set', async () => {
		const mint = new CashuMint(mintUrl);
		nock(mintUrl)
			.get('/v1/melt/quote/bolt11/test')
			.reply(200, function () {
				request = this.req.headers;
				return {
					quote: 'test_melt_quote_id',
					amount: 2000,
					fee_reserve: 20,
					payment_preimage: null,
					state: 'UNPAID'
				} as MeltQuoteResponse;
			});

		const wallet = new CashuWallet(mint, { unit });
		setGlobalRequestOptions({ headers: { 'x-cashu': 'xyz-123-abc' } });

		await wallet.checkMeltQuote('test');

		expect(request).toBeDefined();
		expect(request!['x-cashu']).toContain('xyz-123-abc');
	});

	test('handles HttpResponseError on non-200 response', async () => {
		const mint = new CashuMint(mintUrl);
		nock(mintUrl)
			.get('/v1/melt/quote/bolt11/test')
			.reply(404, function () {
				request = this.req.headers;
				return { error: 'Not Found' };
			});

		const wallet = new CashuWallet(mint, { unit });
		await expect(wallet.checkMeltQuote('test')).rejects.toThrowError(HttpResponseError);
	});

	test('handles NetworkError on network failure', async () => {
		const mint = new CashuMint(mintUrl);
		nock(mintUrl).get('/v1/melt/quote/bolt11/test').replyWithError('Network error');

		const wallet = new CashuWallet(mint, { unit });
		await expect(wallet.checkMeltQuote('test')).rejects.toThrow(NetworkError);
	});

	test('handles MintOperationError on 400 response with code and detail', async () => {
		const mint = new CashuMint(mintUrl);
		nock(mintUrl)
			.get('/v1/melt/quote/bolt11/test')
			.reply(400, { code: 4, detail: 'Invalid operation' });

		const wallet = new CashuWallet(mint, { unit });
		await expect(wallet.checkMeltQuote('test')).rejects.toThrow(MintOperationError);
	});
});
