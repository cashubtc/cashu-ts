import { WSConnection, injectWebSocketImpl } from '../src/WSConnection';
import { CashuMint, CashuWallet } from '../src/index';

describe('testing WSConnection', () => {
	test('connecting...', async () => {
		injectWebSocketImpl(require('ws'));
		const wallet = new CashuWallet(new CashuMint('ws://localhost:3338'));
		const quote = await wallet.getMintQuote(21);
		console.log(quote);
	});
});
