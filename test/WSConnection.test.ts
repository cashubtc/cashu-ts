import { WSConnection, injectWebSocketImpl } from '../src/WSConnection';
import { CashuMint, CashuWallet } from '../src/index';

describe('testing WSConnection', () => {
	test('connecting...', async () => {
		injectWebSocketImpl(require('ws'));
		const wallet = new CashuWallet(new CashuMint('http://localhost:3338'));
		await new Promise((res, rej) => {
			const unsub = wallet.onQuotePaid(
				'XCV',
				(pa) => {
					console.log(pa);
					res(pa);
				},
				(e: Error) => {
					rej(e);
				}
			);
		});
		console.log('Ended');
	});
});
