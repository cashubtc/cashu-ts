import { setupServer, type SetupServerApi } from 'msw/node';
import { HttpResponse, http } from 'msw';
import { beforeAll, beforeEach, afterAll, afterEach } from 'vitest';
import { Mint, ConsoleLogger, injectWebSocketImpl } from '../../src';
import { WebSocket } from 'mock-socket';
import { DUMMY_TEST_KEYS, DUMMY_TEST_KEYSET } from '../consts';

injectWebSocketImpl(WebSocket);

export const mintInfoResp = JSON.parse(
	'{"name":"Testnut mint","pubkey":"0296d0aa13b6a31cf0cd974249f28c7b7176d7274712c95a41c7d8066d3f29d679","version":"Nutshell/0.16.3","description":"Mint for testing Cashu wallets","description_long":"This mint usually runs the latest main branch of the nutshell repository. It uses a FakeWallet, all your Lightning invoices will always be marked paid so that you can test minting and melting ecash via Lightning.","contact":[{"method":"email","info":"contact@me.com"},{"method":"twitter","info":"@me"},{"method":"nostr","info":"npub1337"}],"motd":"This is a message of the day field. You should display this field to your users if the content changes!","icon_url":"https://image.nostr.build/46ee47763c345d2cfa3317f042d332003f498ee281fb42808d47a7d3b9585911.png","time":1731684933,"nuts":{"4":{"methods":[{"method":"bolt11","unit":"sat","description":true},{"method":"bolt11","unit":"usd","description":true},{"method":"bolt11","unit":"eur","description":true}],"disabled":false},"5":{"methods":[{"method":"bolt11","unit":"sat"},{"method":"bolt11","unit":"usd"},{"method":"bolt11","unit":"eur"}],"disabled":false},"7":{"supported":true},"8":{"supported":true},"9":{"supported":true},"10":{"supported":true},"11":{"supported":true},"12":{"supported":true},"14":{"supported":true},"17":{"supported":[{"method":"bolt11","unit":"sat","commands":["bolt11_melt_quote","proof_state","bolt11_mint_quote"]},{"method":"bolt11","unit":"usd","commands":["bolt11_melt_quote","proof_state","bolt11_mint_quote"]},{"method":"bolt11","unit":"eur","commands":["bolt11_melt_quote","proof_state","bolt11_mint_quote"]}]}}}',
);

export const dummyKeysResp = {
	keysets: [DUMMY_TEST_KEYS],
};
export const dummyKeysetResp = {
	keysets: [DUMMY_TEST_KEYSET],
};
export const mintUrl = 'http://localhost:3338';
export const mint = new Mint(mintUrl);
export const unit = 'sat';
export const invoice =
	'lnbc20u1p3u27nppp5pm074ffk6m42lvae8c6847z7xuvhyknwgkk7pzdce47grf2ksqwsdpv2phhwetjv4jzqcneypqyc6t8dp6xu6twva2xjuzzda6qcqzpgxqyz5vqsp5sw6n7cztudpl5m5jv3z6dtqpt2zhd3q6dwgftey9qxv09w82rgjq9qyyssqhtfl8wv7scwp5flqvmgjjh20nf6utvv5daw5h43h69yqfwjch7wnra3cn94qkscgewa33wvfh7guz76rzsfg9pwlk8mqd27wavf2udsq3yeuju';
export const token3sat =
	'cashuBo2FtdWh0dHA6Ly9sb2NhbGhvc3Q6MzMzOGF1Y3NhdGF0gaJhaUgAvQM1Wd4n0GFwgqNhYQFhc3hAZTdjMWI3NmQxYjMxZTJiY2EyYjIyOWQxNjBiZGY2MDQ2ZjMzYmM0NTcwMjIyMzA0YjY1MTEwZDkyNmY3YWY4OWFjWCEDic2fT5iOOAp5idTUiKfJHFJ3-5MEfnoswe2OM5a4VP-jYWECYXN4QGRlNTVjMTVmYWVmZGVkN2Y5Yzk5OWMzZDRjNjJmODFiMGM2ZmUyMWE3NTJmZGVmZjZiMDg0Y2YyZGYyZjVjZjNhY1ghAt5AxZ2QODuIU8zzpLIIZKyDunWPzj2VnbuJNhAC6M5H';
export const logger = new ConsoleLogger('debug');

export function setupDefaultHandlers(server: SetupServerApi) {
	server.use(
		http.get(mintUrl + '/v1/info', () => {
			return HttpResponse.json(mintInfoResp);
		}),
	);
	server.use(
		http.get(mintUrl + '/v1/keys', () => {
			return HttpResponse.json(dummyKeysResp);
		}),
	);
	server.use(
		http.get(mintUrl + '/v1/keys/00bd033559de27d0', () => {
			return HttpResponse.json(dummyKeysResp);
		}),
	);
	server.use(
		http.get(mintUrl + '/v1/keysets', () => {
			return HttpResponse.json(dummyKeysetResp);
		}),
	);
}

/**
 * Call this to set up the standard msw server lifecycle for wallet tests. Returns the server
 * instance for use in tests that need `server.use(...)`.
 */
export function useTestServer() {
	const server = setupServer();

	beforeAll(() => {
		server.listen({ onUnhandledRequest: 'error' });
	});
	beforeEach(() => {
		setupDefaultHandlers(server);
	});
	afterEach(() => {
		server.resetHandlers();
	});
	afterAll(() => {
		server.close();
	});

	return server;
}
