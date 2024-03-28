import { WSConnection, injectWebSocketImpl } from '../src/WSConnection';

describe('testing WSConnection', () => {
	test('connecting...', async () => {
		injectWebSocketImpl(require('ws'));
		const ws = new WSConnection('https://echo.websocket.org/');
		await ws.connect();
		const sub = ws.subscribe();
		await new Promise((res) => {
			// @ts-ignore
			sub.onmessage((e) => {
				console.log(e);
				res(e);
			});
		});
	});
});
