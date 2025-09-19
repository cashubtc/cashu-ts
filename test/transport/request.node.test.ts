import { beforeAll, test, describe, expect, afterAll, afterEach } from 'vitest';
import { Wallet, HttpResponseError, NetworkError, MintOperationError } from '../../src';
import { HttpResponse, http } from 'msw';
import { setupServer } from 'msw/node';
import { setGlobalRequestOptions } from '../../src/transport';

// Setup mint cache for loadMint()
const mintUrl = 'https://localhost:3338';
const unit = 'sat';
const mintInfoResp = JSON.parse(
	'{"name":"Testnut mint","pubkey":"0296d0aa13b6a31cf0cd974249f28c7b7176d7274712c95a41c7d8066d3f29d679","version":"Nutshell/0.16.3","description":"Mint for testing Cashu wallets","description_long":"This mint usually runs the latest main branch of the nutshell repository. It uses a FakeWallet, all your Lightning invoices will always be marked paid so that you can test minting and melting ecash via Lightning.","contact":[{"method":"email","info":"contact@me.com"},{"method":"twitter","info":"@me"},{"method":"nostr","info":"npub1337"}],"motd":"This is a message of the day field. You should display this field to your users if the content changes!","icon_url":"https://image.nostr.build/46ee47763c345d2cfa3317f042d332003f498ee281fb42808d47a7d3b9585911.png","time":1731684933,"nuts":{"4":{"methods":[{"method":"bolt11","unit":"sat","description":true},{"method":"bolt11","unit":"usd","description":true},{"method":"bolt11","unit":"eur","description":true}],"disabled":false},"5":{"methods":[{"method":"bolt11","unit":"sat"},{"method":"bolt11","unit":"usd"},{"method":"bolt11","unit":"eur"}],"disabled":false},"7":{"supported":true},"8":{"supported":true},"9":{"supported":true},"10":{"supported":true},"11":{"supported":true},"12":{"supported":true},"14":{"supported":true},"17":{"supported":[{"method":"bolt11","unit":"sat","commands":["bolt11_melt_quote","proof_state","bolt11_mint_quote"]},{"method":"bolt11","unit":"usd","commands":["bolt11_melt_quote","proof_state","bolt11_mint_quote"]},{"method":"bolt11","unit":"eur","commands":["bolt11_melt_quote","proof_state","bolt11_mint_quote"]}]}}}',
);
const mintCache = {
	keysets: [
		{
			id: '00bd033559de27d0',
			unit: 'sat',
			active: true,
			input_fee_ppk: 0,
			final_expiry: undefined,
		},
	],
	keys: [
		{
			id: '00bd033559de27d0',
			unit: 'sat',
			keys: {
				'1': '02f970b6ee058705c0dddc4313721cffb7efd3d142d96ea8e01d31c2b2ff09f181',
				'2': '03361cd8bd1329fea797a6add1cf1990ffcf2270ceb9fc81eeee0e8e9c1bd0cdf5',
			},
		},
	],
	unit: unit,
	mintInfo: mintInfoResp,
};

const server = setupServer();

beforeAll(() => {
	server.listen({ onUnhandledRequest: 'error' });
});

afterEach(() => {
	server.resetHandlers();
});

afterAll(() => {
	server.close();
});

describe('requests', () => {
	test('request with body contains the correct headers', async () => {
		let headers: Headers;

		server.use(
			http.get(mintUrl + '/v1/melt/quote/bolt11/test', ({ request }) => {
				headers = request.headers;
				return HttpResponse.json({
					quote: 'test_melt_quote_id',
					amount: 2000,
					fee_reserve: 20,
					payment_preimage: null,
					state: 'UNPAID',
				});
			}),
		);
		const wallet = new Wallet(mintUrl, { ...mintCache });
		await wallet.loadMint();
		await wallet.checkMeltQuote('test');

		expect(headers!).toBeDefined();
		// expect(request!['content-type']).toContain('application/json');
		expect(headers!.get('accept')).toContain('application/json, text/plain, */*');
	});

	test('global custom headers can be set', async () => {
		let headers: Headers;
		server.use(
			http.get(mintUrl + '/v1/melt/quote/bolt11/test', ({ request }) => {
				headers = request.headers;
				return HttpResponse.json({
					quote: 'test_melt_quote_id',
					amount: 2000,
					fee_reserve: 20,
					payment_preimage: null,
					state: 'UNPAID',
				});
			}),
		);

		const wallet = new Wallet(mintUrl, { ...mintCache });
		await wallet.loadMint();
		setGlobalRequestOptions({ headers: { 'x-cashu': 'xyz-123-abc' } });

		await wallet.checkMeltQuote('test');

		expect(headers!).toBeDefined();
		expect(headers!.get('x-cashu')).toContain('xyz-123-abc');
	});

	test('handles HttpResponseError on non-200 response', async () => {
		server.use(
			http.get(mintUrl + '/v1/melt/quote/bolt11/test', () => {
				return new HttpResponse(JSON.stringify({ error: 'Not Found' }), { status: 404 });
			}),
		);

		const wallet = new Wallet(mintUrl, { ...mintCache });
		await wallet.loadMint();
		await expect(wallet.checkMeltQuote('test')).rejects.toThrowError(HttpResponseError);
	});
	test('handles NetworkError on network failure', async () => {
		server.use(
			http.get(mintUrl + '/v1/melt/quote/bolt11/test', () => {
				// This simulates a network failure at the fetch level
				return Response.error();
			}),
		);

		const wallet = new Wallet(mintUrl, { ...mintCache });
		await wallet.loadMint();
		await expect(wallet.checkMeltQuote('test')).rejects.toThrow(NetworkError);
	});

	test('handles MintOperationError on 400 response with code and detail', async () => {
		server.use(
			http.get(mintUrl + '/v1/melt/quote/bolt11/test', () => {
				return new HttpResponse(JSON.stringify({ code: 20003, detail: 'Minting is disabled' }), {
					status: 400,
				});
			}),
		);

		const wallet = new Wallet(mintUrl, { ...mintCache });
		await wallet.loadMint();
		const promise = wallet.checkMeltQuote('test');
		await expect(promise).rejects.toThrow(MintOperationError);
		// assert that the error message is set correctly by the code
		await expect(promise).rejects.toThrow('Minting is disabled');
	});
});
