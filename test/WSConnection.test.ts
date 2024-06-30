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

			const callback = jest.fn();
			const errorCallback = jest.fn();
			const subId = conn.createSubscription(
				{ kind: 'bolt11_mint_quote', filters: ['123'] },
				callback,
				errorCallback
			);
			//TODO: Add assertion for subListenerLength once SubscriptionManager is modularised
			conn.cancelSubscription(subId, callback);
		});
		expect(message).toMatchObject({ jsonrpc: '2.0', method: 'unsubscribe' });
		server.stop();
	});
	test('handing a notification', async () => {
		const fakeUrl = 'ws://localhost:3338/v1/ws';
		const server = new Server(fakeUrl, { mock: false });
		server.on('connection', (socket) => {
			socket.on('message', (m) => {
				console.log(m);
				try {
					const parsed = JSON.parse(m.toString());
					if (parsed.method === 'subscribe') {
						const message = `{"jsonrpc": "2.0", "result": {"status": "OK", "subId": "${parsed.params.subId}", "id": ${parsed.id}}}`;
						console.log(message);
						socket.send(message);
						setTimeout(() => {
							const message = `{"jsonrpc": "2.0", "method": "subscribe", "params": {"subId": "${parsed.params.subId}", "payload": {"quote": "123", "request": "456", "paid": true, "expiry": 123}}}`;
							console.log(message);
							socket.send(message);
						}, 500);
					}
				} catch {
					console.log('Server parsing failed...');
				}
			});
		});
		const conn = new WSConnection(fakeUrl);
		await conn.connect();

		await new Promise((res) => {
			const callback = jest.fn((p) => {
				console.log('Payload received! ', p);
				res(p);
			});
			const errorCallback = jest.fn();
			const subId = conn.createSubscription(
				{ kind: 'bolt11_mint_quote', filters: ['123'] },
				callback,
				errorCallback
			);
		});
	});
});
