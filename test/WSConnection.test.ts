import { WSConnection, injectWebSocketImpl } from '../src/WSConnection';
import { Server, WebSocket } from 'mock-socket';

injectWebSocketImpl(WebSocket);

describe('testing WSConnection', () => {
	test('connecting...', async () => {
		const fakeUrl = 'ws://localhost:3338/v1/ws';
		const server = new Server(fakeUrl, { mock: false });
		const connectionSpy = jest.fn();
		server.on('connection', connectionSpy);
		const conn = new WSConnection(fakeUrl);
		await conn.connect();
		expect(connectionSpy).toHaveBeenCalled();
		server.stop();
	});
	test('requesting subscription', async () => {
		const fakeUrl = 'ws://localhost:3338/v1/ws';
		const server = new Server(fakeUrl, { mock: false });
		const message = (await new Promise(async (res) => {
			server.on('connection', (socket) => {
				socket.on('message', (m) => {
					res(m.toString());
				});
			});
			const conn = new WSConnection(fakeUrl);
			await conn.connect();

			const callback = jest.fn();
			const errorCallback = jest.fn();
			conn.createSubscription(
				{ kind: 'bolt11_mint_quote', filters: ['12345'] },
				callback,
				errorCallback
			);
		})) as string;
		expect(JSON.parse(message)).toMatchObject({
			jsonrpc: '2.0',
			method: 'subscribe',
			params: { kind: 'bolt11_mint_quote', filters: ['12345'] }
		});
		server.stop();
	});
	test('unsubscribing', async () => {
		const fakeUrl = 'ws://localhost:3338/v1/ws';
		const server = new Server(fakeUrl, { mock: false });
		const message = await new Promise(async (res) => {
			server.on('connection', (socket) => {
				socket.on('message', (m) => {
					const parsed = JSON.parse(m.toString());
					if (parsed.method === 'unsubscribe') res(parsed);
				});
			});
			const conn = new WSConnection(fakeUrl);
			await conn.connect();

			conn.sendRequest('subscribe', {
				subId: '12345',
				kind: 'bolt11_mint_quote',
				filters: ['12345']
			});
			const callback = jest.fn();
			const errorCallback = jest.fn();
			conn.createSubscription(
				{ kind: 'bolt11_mint_quote', filters: ['123'] },
				callback,
				errorCallback
			);
		});
	});
});
