import { WSConnection, injectWebSocketImpl } from '../../src';
import type { Logger } from '../../src';
import { Client, Server, WebSocket } from 'mock-socket';
import { vi, test, describe, expect, afterAll } from 'vitest';

injectWebSocketImpl(WebSocket);

const fakeUrl = 'ws://localhost:3338/v1/ws';
const server = new Server(fakeUrl, { mock: false });

function createLogger() {
	const logger: Logger = {
		error: vi.fn(),
		warn: vi.fn(),
		info: vi.fn(),
		debug: vi.fn(),
		trace: vi.fn(),
		log: vi.fn(),
	};
	return logger;
}

afterAll(() => {
	injectWebSocketImpl(WebSocket);
});

async function waitForSubscription(
	conn: WSConnection,
	subId: string,
	timeoutMs = 200,
): Promise<void> {
	const startedAt = Date.now();

	while (!conn.activeSubscriptions.includes(subId)) {
		if (Date.now() - startedAt > timeoutMs) {
			throw new Error(`Timed out waiting for subscription ${subId}`);
		}
		await new Promise((res) => setTimeout(res, 0));
	}
}

describe('testing WSConnection', () => {
	test('connecting...', async () => {
		const connectionSpy = vi.fn();
		server.on('connection', connectionSpy);
		const conn = new WSConnection(fakeUrl);
		await conn.connect();
		expect(connectionSpy).toHaveBeenCalled();
	});
	test('requesting subscription', async () => {
		const message = (await new Promise(async (res) => {
			server.on('connection', (socket) => {
				socket.on('message', (m) => {
					res(m.toString());
				});
			});
			const conn = new WSConnection(fakeUrl);
			await conn.connect();

			const callback = vi.fn();
			const errorCallback = vi.fn();
			conn.createSubscription(
				{ kind: 'bolt11_mint_quote', filters: ['12345'] },
				callback,
				errorCallback,
			);
		})) as string;
		expect(JSON.parse(message)).toMatchObject({
			jsonrpc: '2.0',
			method: 'subscribe',
			params: { kind: 'bolt11_mint_quote', filters: ['12345'] },
		});
	});
	test('throws if socket not open on createSubscription', async () => {
		const conn = new WSConnection(fakeUrl); // No connect() called
		const callback = vi.fn();
		const errorCallback = vi.fn();
		expect(() => {
			conn.createSubscription(
				{ kind: 'bolt11_mint_quote', filters: ['123'] },
				callback,
				errorCallback,
			);
		}).toThrowError('Socket is not open');
		expect(errorCallback).not.toHaveBeenCalled(); // No soft callback invocation
	});
	test('unsubscribing', async () => {
		let wsSocket: Client;
		let subId: string;
		const conn = new WSConnection(fakeUrl);
		await new Promise<void>(async (res) => {
			server.on('connection', (socket) => {
				wsSocket = socket;
				res();
			});
			conn.connect();
		});
		const callback = vi.fn();
		const errorCallback = vi.fn();
		subId = conn.createSubscription(
			{ kind: 'bolt11_mint_quote', filters: ['123'] },
			callback,
			errorCallback,
		);
		await new Promise<void>((res) => {
			wsSocket.on('message', (m) => {
				const parsed = JSON.parse(m.toString());
				if (parsed.method === 'subscribe') {
					const message = `{"jsonrpc": "2.0", "result": {"status": "OK", "subId": "${parsed.params.subId}"}, "id": ${parsed.id}}`;
					wsSocket.send(message);
					res();
				}
			});
		});
		await waitForSubscription(conn, subId!);

		const message = await new Promise(async (res) => {
			wsSocket.on('message', (m) => {
				const parsed = JSON.parse(m.toString());
				if (parsed.method === 'unsubscribe') res(parsed);
			});
			conn.cancelSubscription(subId!, callback);
		});
		expect(message).toMatchObject({ jsonrpc: '2.0', method: 'unsubscribe' });
	});
	test('handing a notification', async () => {
		server.on('connection', (socket) => {
			socket.on('message', (m) => {
				try {
					const parsed = JSON.parse(m.toString());
					if (parsed.method === 'subscribe') {
						const message = `{"jsonrpc": "2.0", "result": {"status": "OK", "subId": "${parsed.params.subId}"}, "id": ${parsed.id}}`;
						socket.send(message);
						setTimeout(() => {
							const message = `{"jsonrpc": "2.0", "method": "subscribe", "params": {"subId": "${parsed.params.subId}", "payload": {"quote": "123", "request": "456", "paid": true, "expiry": 123}}}`;
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

		const payload = await new Promise((res) => {
			const callback = vi.fn((p: any) => {
				res(p);
			});
			const errorCallback = vi.fn();
			conn.createSubscription(
				{ kind: 'bolt11_mint_quote', filters: ['123'] },
				callback,
				errorCallback,
			);
		});
		expect(payload).toMatchObject({ quote: '123', request: '456', paid: true, expiry: 123 });
	});
});

describe('WSConnection – socket-not-open paths', () => {
	test('sendRequest unsubscribe returns silently when socket not open', () => {
		const conn = new WSConnection(fakeUrl);
		expect(() => conn.sendRequest('unsubscribe', { subId: 'test' })).not.toThrow();
	});

	test('sendRequest subscribe throws when socket not open', () => {
		const conn = new WSConnection(fakeUrl);
		expect(() => conn.sendRequest('subscribe', { kind: 'bolt11_mint_quote', filters: [] })).toThrow(
			'Socket not open',
		);
	});
});

describe('WSConnection – close and lifecycle', () => {
	test('setLogger replaces the active logger', () => {
		const logger = createLogger();
		const conn = new WSConnection(fakeUrl);

		conn.setLogger(logger);
		expect(() => conn.sendRequest('subscribe', { kind: 'bolt11_mint_quote', filters: [] })).toThrow(
			'Socket not open',
		);
		expect(logger.error).toHaveBeenCalledWith('Attempted sendRequest, but socket was not open');
	});

	test('connect rejects when WebSocket constructor throws', async () => {
		class ThrowingWebSocket {
			static readonly OPEN = 1;
			constructor() {
				throw new Error('ctor boom');
			}
		}

		injectWebSocketImpl(ThrowingWebSocket as unknown as typeof WebSocket);

		try {
			const conn = new WSConnection(fakeUrl);
			await expect(conn.connect()).rejects.toThrow('ctor boom');
		} finally {
			injectWebSocketImpl(WebSocket);
		}
	});

	test('connect rejects on timeout when socket never opens', async () => {
		class NeverOpenWebSocket {
			static readonly CONNECTING = 0;
			static readonly OPEN = 1;
			readyState = NeverOpenWebSocket.CONNECTING;
			onopen: (() => void) | null = null;
			onerror: ((ev: Event) => void) | null = null;
			onmessage: ((e: MessageEvent) => void) | null = null;
			onclose: ((e: CloseEvent) => void) | null = null;
			close() {
				this.readyState = 3;
			}
			send() {}
		}

		injectWebSocketImpl(NeverOpenWebSocket as unknown as typeof WebSocket);

		try {
			const conn = new WSConnection(fakeUrl);
			await expect(conn.connect(20)).rejects.toThrow('WebSocket connect timeout after 20ms');
		} finally {
			injectWebSocketImpl(WebSocket);
		}
	});

	test('connect rejects when socket errors before opening', async () => {
		class ErrorBeforeOpenWebSocket {
			static readonly CONNECTING = 0;
			static readonly OPEN = 1;
			readyState = ErrorBeforeOpenWebSocket.CONNECTING;
			onopen: (() => void) | null = null;
			onerror: ((ev: Event) => void) | null = null;
			onmessage: ((e: MessageEvent) => void) | null = null;
			onclose: ((e: CloseEvent) => void) | null = null;

			constructor() {
				setTimeout(() => this.onerror?.(new Event('error')), 0);
			}

			close() {
				this.readyState = 3;
			}

			send() {}
		}

		injectWebSocketImpl(ErrorBeforeOpenWebSocket as unknown as typeof WebSocket);

		try {
			const conn = new WSConnection(fakeUrl);
			await expect(conn.connect()).rejects.toThrow('Failed to open WebSocket');
		} finally {
			injectWebSocketImpl(WebSocket);
		}
	});

	test('connect rejects when socket closes before opening', async () => {
		class CloseBeforeOpenWebSocket {
			static readonly CONNECTING = 0;
			static readonly OPEN = 1;
			readyState = CloseBeforeOpenWebSocket.CONNECTING;
			onopen: (() => void) | null = null;
			onerror: ((ev: Event) => void) | null = null;
			onmessage: ((e: MessageEvent) => void) | null = null;
			onclose: ((e: CloseEvent) => void) | null = null;

			constructor() {
				setTimeout(
					() => this.onclose?.({ code: 4003, reason: 'rejected', wasClean: false } as CloseEvent),
					0,
				);
			}

			close() {
				this.readyState = 3;
			}

			send() {}
		}

		injectWebSocketImpl(CloseBeforeOpenWebSocket as unknown as typeof WebSocket);

		try {
			const conn = new WSConnection(fakeUrl);
			await expect(conn.connect()).rejects.toThrow(
				'WebSocket closed before open (code 4003, rejected)',
			);
		} finally {
			injectWebSocketImpl(WebSocket);
		}
	});

	test('close() clears connectionPromise so reconnect works', async () => {
		const conn = new WSConnection(fakeUrl);
		await conn.connect();
		conn.close();
		await expect(conn.connect()).resolves.toBeUndefined();
	});

	test('ensureConnection is a no-op when socket is already open', async () => {
		const conn = new WSConnection(fakeUrl);
		await conn.connect();
		const connectSpy = vi.spyOn(conn, 'connect');
		await conn.ensureConnection();
		expect(connectSpy).not.toHaveBeenCalled();
		connectSpy.mockRestore();
	});

	test('ensureConnection calls connect when socket is not open', async () => {
		const conn = new WSConnection(fakeUrl);
		const connectSpy = vi.spyOn(conn, 'connect');

		await conn.ensureConnection();

		expect(connectSpy).toHaveBeenCalledTimes(1);
		connectSpy.mockRestore();
		conn.close();
	});

	test('onClose callbacks fire when server closes socket', async () => {
		const url = 'ws://localhost:3339/v1/ws';
		const srv = new Server(url, { mock: false });
		const conn = new WSConnection(url);
		let serverSocket!: Client;

		await new Promise<void>((res) => {
			srv.on('connection', (socket) => {
				serverSocket = socket;
				res();
			});
			conn.connect();
		});

		const closeCb = vi.fn();
		conn.onClose(closeCb);

		await new Promise<void>((res) => {
			conn.onClose(() => res());
			serverSocket.close();
		});

		expect(closeCb).toHaveBeenCalled();
		srv.close();
	});

	test('abnormal close (non-1000 code) calls pending RPC errorCallbacks', async () => {
		const url = 'ws://localhost:3340/v1/ws';
		const srv = new Server(url, { mock: false });
		const conn = new WSConnection(url);
		let serverSocket!: Client;

		await new Promise<void>((res) => {
			srv.on('connection', (socket) => {
				serverSocket = socket;
				socket.on('message', () => {}); // absorb subscribe, leave RPC pending
				res();
			});
			conn.connect();
		});

		const errorCb = vi.fn();
		conn.createSubscription({ kind: 'bolt11_mint_quote', filters: [] }, vi.fn(), errorCb);

		await new Promise<void>((res) => {
			conn.onClose(() => setTimeout(res, 0));
			serverSocket.close({ code: 4001, reason: 'abnormal' });
		});

		expect(errorCb).toHaveBeenCalledWith(expect.any(Error));
		srv.close();
	});

	test('clean close (code 1000) clears pending RPCs without calling errorCallbacks', async () => {
		const url = 'ws://localhost:3341/v1/ws';
		const srv = new Server(url, { mock: false });
		const conn = new WSConnection(url);
		let serverSocket!: Client;

		await new Promise<void>((res) => {
			srv.on('connection', (socket) => {
				serverSocket = socket;
				socket.on('message', () => {}); // leave RPC pending
				res();
			});
			conn.connect();
		});

		const errorCb = vi.fn();
		conn.createSubscription({ kind: 'bolt11_mint_quote', filters: [] }, vi.fn(), errorCb);

		await new Promise<void>((res) => {
			conn.onClose(() => setTimeout(res, 0));
			serverSocket.close(); // default = code 1000, wasClean = true
		});

		expect(errorCb).not.toHaveBeenCalled();
		srv.close();
	});

	test('error after open is logged and connection remains closeable', async () => {
		const url = 'ws://localhost:3347/v1/ws';
		const srv = new Server(url, { mock: false });
		const logger = createLogger();
		const conn = new WSConnection(url, logger);
		let serverSocket!: Client;

		await new Promise<void>((res) => {
			srv.on('connection', (socket) => {
				serverSocket = socket;
				res();
			});
			conn.connect();
		});

		serverSocket.dispatchEvent(new Event('error'));

		expect(logger.error).toHaveBeenCalledWith('WebSocket error after open', {
			ev: expect.any(Event),
		});

		expect(() => conn.close()).not.toThrow();
		srv.close();
	});
});

describe('WSConnection – message handling', () => {
	test('RPC error response calls errorCallback with the error message', async () => {
		const url = 'ws://localhost:3342/v1/ws';
		const srv = new Server(url, { mock: false });

		srv.on('connection', (socket) => {
			socket.on('message', (m) => {
				const parsed = JSON.parse(m.toString());
				if (parsed.method === 'subscribe') {
					socket.send(
						JSON.stringify({
							jsonrpc: '2.0',
							error: { message: 'subscription rejected', code: -32000 },
							id: parsed.id,
						}),
					);
				}
			});
		});

		const conn = new WSConnection(url);
		await conn.connect();

		const errorCb = vi.fn();
		await new Promise<void>((res) => {
			conn.createSubscription({ kind: 'bolt11_mint_quote', filters: [] }, vi.fn(), (e) => {
				errorCb(e);
				res();
			});
		});

		expect(errorCb).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'subscription rejected' }),
		);
		srv.close();
	});

	test('notification without subId is silently ignored', async () => {
		const url = 'ws://localhost:3343/v1/ws';
		const srv = new Server(url, { mock: false });

		srv.on('connection', (socket) => {
			socket.on('message', (m) => {
				const parsed = JSON.parse(m.toString());
				if (parsed.method === 'subscribe') {
					socket.send(
						JSON.stringify({
							jsonrpc: '2.0',
							result: { status: 'OK', subId: parsed.params.subId },
							id: parsed.id,
						}),
					);
					setTimeout(() => {
						// notification missing subId
						socket.send(
							JSON.stringify({ jsonrpc: '2.0', method: 'subscribe', params: { payload: {} } }),
						);
					}, 50);
				}
			});
		});

		const conn = new WSConnection(url);
		await conn.connect();

		const callback = vi.fn();
		await new Promise<void>((res) => {
			conn.createSubscription({ kind: 'bolt11_mint_quote', filters: [] }, callback, vi.fn());
			setTimeout(res, 150);
		});

		expect(callback).not.toHaveBeenCalled();
		srv.close();
	});

	test('malformed JSON message is silently swallowed', async () => {
		const url = 'ws://localhost:3344/v1/ws';
		const srv = new Server(url, { mock: false });

		srv.on('connection', (socket) => {
			// send bad JSON immediately after connection
			setTimeout(() => socket.send('not {{ valid json'), 0);
		});

		const conn = new WSConnection(url);
		await conn.connect();
		await new Promise((res) => setTimeout(res, 50));
		// No unhandled error; connection still usable (close without throw)
		expect(() => conn.close()).not.toThrow();
		srv.close();
	});

	test('mint request with id field (method + id) is silently ignored', async () => {
		const url = 'ws://localhost:3345/v1/ws';
		const srv = new Server(url, { mock: false });

		srv.on('connection', (socket) => {
			socket.on('message', (m) => {
				const parsed = JSON.parse(m.toString());
				if (parsed.method === 'subscribe') {
					socket.send(
						JSON.stringify({
							jsonrpc: '2.0',
							result: { status: 'OK', subId: parsed.params.subId },
							id: parsed.id,
						}),
					);
					setTimeout(() => {
						// mint erroneously sends a request (has method + id = do nothing branch)
						socket.send(JSON.stringify({ jsonrpc: '2.0', method: 'ping', id: 999, params: {} }));
					}, 50);
				}
			});
		});

		const conn = new WSConnection(url);
		await conn.connect();

		const callback = vi.fn();
		await new Promise<void>((res) => {
			conn.createSubscription({ kind: 'bolt11_mint_quote', filters: [] }, callback, vi.fn());
			setTimeout(res, 150);
		});

		expect(callback).not.toHaveBeenCalled();
		srv.close();
	});

	test('subscription callback errors are logged and do not escape message handling', async () => {
		const url = 'ws://localhost:3348/v1/ws';
		const srv = new Server(url, { mock: false });
		const logger = createLogger();

		srv.on('connection', (socket) => {
			socket.on('message', (m) => {
				const parsed = JSON.parse(m.toString());
				if (parsed.method === 'subscribe') {
					socket.send(
						JSON.stringify({
							jsonrpc: '2.0',
							result: { status: 'OK', subId: parsed.params.subId },
							id: parsed.id,
						}),
					);
					setTimeout(() => {
						socket.send(
							JSON.stringify({
								jsonrpc: '2.0',
								method: 'subscribe',
								params: { subId: parsed.params.subId, payload: { paid: true } },
							}),
						);
					}, 0);
				}
			});
		});

		const conn = new WSConnection(url, logger);
		await conn.connect();

		await new Promise<void>((res) => {
			conn.createSubscription(
				{ kind: 'bolt11_mint_quote', filters: [] },
				() => {
					throw new Error('listener boom');
				},
				vi.fn(),
			);
			setTimeout(res, 100);
		});

		expect(logger.error).toHaveBeenCalledWith('Subscription handler threw', {
			e: expect.objectContaining({ message: 'listener boom' }),
		});
		srv.close();
	});
});

describe('WSConnection – listener management', () => {
	test('close drains queued messages', () => {
		const conn = new WSConnection(fakeUrl);
		const internals = conn as unknown as {
			messageQueue: { enqueue(message: string): boolean; size: number };
			stopMessageHandling: () => void;
		};

		internals.messageQueue.enqueue('one');
		internals.messageQueue.enqueue('two');

		conn.close();

		expect(internals.messageQueue.size).toBe(0);
	});

	test('activeSubscriptions returns all registered subIds', async () => {
		const conn = new WSConnection(fakeUrl);
		await conn.connect();

		conn.addSubListener('sub-a', vi.fn());
		conn.addSubListener('sub-b', vi.fn());

		expect(conn.activeSubscriptions).toEqual(expect.arrayContaining(['sub-a', 'sub-b']));
		expect(conn.activeSubscriptions).toHaveLength(2);
	});

	test('cancelSubscription with multiple callbacks removes only the specified one', async () => {
		const conn = new WSConnection(fakeUrl);
		await conn.connect();

		const cb1 = vi.fn();
		const cb2 = vi.fn();
		conn.addSubListener('multi-sub', cb1);
		conn.addSubListener('multi-sub', cb2);
		conn.close();

		conn.cancelSubscription('multi-sub', cb1);

		expect(conn.activeSubscriptions).toContain('multi-sub'); // cb2 still registered
	});

	test('cancelSubscription when socket is closed removes listener without throwing', async () => {
		const conn = new WSConnection(fakeUrl);
		await conn.connect();

		const cb = vi.fn();
		conn.addSubListener('close-sub', cb);
		conn.close();

		expect(() => conn.cancelSubscription('close-sub', cb)).not.toThrow();
		expect(conn.activeSubscriptions).not.toContain('close-sub');
	});

	test('cancelSubscription ignores unknown subscription ids', async () => {
		const conn = new WSConnection(fakeUrl);
		await conn.connect();

		expect(() => conn.cancelSubscription('missing-sub', vi.fn())).not.toThrow();
		expect(conn.activeSubscriptions).toEqual([]);
	});

	test('failPendingRpc calls all error callbacks even if one throws', async () => {
		const url = 'ws://localhost:3346/v1/ws';
		const srv = new Server(url, { mock: false });
		const conn = new WSConnection(url);
		let serverSocket!: Client;

		await new Promise<void>((res) => {
			srv.on('connection', (socket) => {
				serverSocket = socket;
				socket.on('message', () => {}); // keep RPCs pending
				res();
			});
			conn.connect();
		});

		const errorCb1 = vi.fn().mockImplementation(() => {
			throw new Error('cb1 threw');
		});
		const errorCb2 = vi.fn();

		conn.createSubscription({ kind: 'bolt11_mint_quote', filters: [] }, vi.fn(), errorCb1);
		conn.createSubscription({ kind: 'bolt11_mint_quote', filters: [] }, vi.fn(), errorCb2);

		await new Promise<void>((res) => {
			conn.onClose(() => setTimeout(res, 0));
			serverSocket.close({ code: 4001 });
		});

		expect(errorCb1).toHaveBeenCalled();
		expect(errorCb2).toHaveBeenCalled();
		srv.close();
	});

	test('cancelSubscription logs successful unsubscribe acknowledgements', async () => {
		const url = 'ws://localhost:3349/v1/ws';
		const srv = new Server(url, { mock: false });
		const logger = createLogger();
		const conn = new WSConnection(url, logger);

		srv.on('connection', (socket) => {
			socket.on('message', (m) => {
				const parsed = JSON.parse(m.toString());
				if (parsed.method === 'subscribe') {
					socket.send(
						JSON.stringify({
							jsonrpc: '2.0',
							result: { status: 'OK', subId: parsed.params.subId },
							id: parsed.id,
						}),
					);
					return;
				}

				if (parsed.method === 'unsubscribe') {
					socket.send(JSON.stringify({ jsonrpc: '2.0', result: { status: 'OK' }, id: parsed.id }));
				}
			});
		});

		await conn.connect();

		const callback = vi.fn();
		const subId = conn.createSubscription(
			{ kind: 'bolt11_mint_quote', filters: [] },
			callback,
			vi.fn(),
		);
		await waitForSubscription(conn, subId);

		await new Promise<void>((res) => {
			conn.cancelSubscription(subId, callback);
			setTimeout(res, 50);
		});

		expect(logger.info).toHaveBeenCalledWith('Unsubscribed {subId}', { subId });
		srv.close();
	});

	test('cancelSubscription forwards unsubscribe RPC errors to the provided error callback', async () => {
		const url = 'ws://localhost:3350/v1/ws';
		const srv = new Server(url, { mock: false });
		const conn = new WSConnection(url);

		srv.on('connection', (socket) => {
			socket.on('message', (m) => {
				const parsed = JSON.parse(m.toString());
				if (parsed.method === 'subscribe') {
					socket.send(
						JSON.stringify({
							jsonrpc: '2.0',
							result: { status: 'OK', subId: parsed.params.subId },
							id: parsed.id,
						}),
					);
					return;
				}

				if (parsed.method === 'unsubscribe') {
					socket.send(
						JSON.stringify({
							jsonrpc: '2.0',
							error: { message: 'unsubscribe rejected', code: -32001 },
							id: parsed.id,
						}),
					);
				}
			});
		});

		await conn.connect();

		const callback = vi.fn();
		const subId = conn.createSubscription(
			{ kind: 'bolt11_mint_quote', filters: [] },
			callback,
			vi.fn(),
		);
		await waitForSubscription(conn, subId);

		const errorCallback = vi.fn();
		await new Promise<void>((res) => {
			conn.cancelSubscription(subId, callback, (e) => {
				errorCallback(e);
				res();
			});
		});

		expect(errorCallback).toHaveBeenCalledWith(
			expect.objectContaining({ message: 'unsubscribe rejected' }),
		);
		srv.close();
	});

	test('cancelSubscription logs unsubscribe RPC errors when no error callback is provided', async () => {
		const url = 'ws://localhost:3351/v1/ws';
		const srv = new Server(url, { mock: false });
		const logger = createLogger();
		const conn = new WSConnection(url, logger);

		srv.on('connection', (socket) => {
			socket.on('message', (m) => {
				const parsed = JSON.parse(m.toString());
				if (parsed.method === 'subscribe') {
					socket.send(
						JSON.stringify({
							jsonrpc: '2.0',
							result: { status: 'OK', subId: parsed.params.subId },
							id: parsed.id,
						}),
					);
					return;
				}

				if (parsed.method === 'unsubscribe') {
					socket.send(
						JSON.stringify({
							jsonrpc: '2.0',
							error: { message: 'default unsubscribe failure', code: -32002 },
							id: parsed.id,
						}),
					);
				}
			});
		});

		await conn.connect();

		const callback = vi.fn();
		const subId = conn.createSubscription(
			{ kind: 'bolt11_mint_quote', filters: [] },
			callback,
			vi.fn(),
		);
		await waitForSubscription(conn, subId);

		await new Promise<void>((res) => {
			conn.cancelSubscription(subId, callback);
			setTimeout(res, 50);
		});

		expect(logger.error).toHaveBeenCalledWith('Unsubscribe failed', {
			e: expect.objectContaining({ message: 'default unsubscribe failure' }),
		});
		srv.close();
	});

	test('createSubscription removes pending RPC listener when send fails', async () => {
		class SendFailWebSocket {
			static readonly CONNECTING = 0;
			static readonly OPEN = 1;
			readyState = SendFailWebSocket.CONNECTING;
			onopen: (() => void) | null = null;
			onerror: ((ev: Event) => void) | null = null;
			onmessage: ((e: MessageEvent) => void) | null = null;
			onclose: ((e: CloseEvent) => void) | null = null;

			constructor() {
				setTimeout(() => {
					this.readyState = SendFailWebSocket.OPEN;
					this.onopen?.();
				}, 0);
			}

			send() {
				throw new Error('send boom');
			}

			close() {
				this.readyState = 3;
			}
		}

		injectWebSocketImpl(SendFailWebSocket as unknown as typeof WebSocket);

		try {
			const logger = createLogger();
			const conn = new WSConnection(fakeUrl, logger);
			await conn.connect();

			expect(() =>
				conn.createSubscription({ kind: 'bolt11_mint_quote', filters: [] }, vi.fn(), vi.fn()),
			).toThrow('send boom');
			expect(
				Object.keys((conn as unknown as { rpcListeners: Record<string, unknown> }).rpcListeners),
			).toHaveLength(0);
			expect(logger.error).toHaveBeenCalledWith('WebSocket send failed', {
				e: expect.objectContaining({ message: 'send boom' }),
			});
		} finally {
			injectWebSocketImpl(WebSocket);
		}
	});

	test('cancelSubscription removes pending RPC listener when unsubscribe send fails', async () => {
		class SendFailWebSocket {
			static readonly CONNECTING = 0;
			static readonly OPEN = 1;
			readyState = SendFailWebSocket.CONNECTING;
			onopen: (() => void) | null = null;
			onerror: ((ev: Event) => void) | null = null;
			onmessage: ((e: MessageEvent) => void) | null = null;
			onclose: ((e: CloseEvent) => void) | null = null;

			constructor() {
				setTimeout(() => {
					this.readyState = SendFailWebSocket.OPEN;
					this.onopen?.();
				}, 0);
			}

			send() {
				throw new Error('unsubscribe send boom');
			}

			close() {
				this.readyState = 3;
			}
		}

		injectWebSocketImpl(SendFailWebSocket as unknown as typeof WebSocket);

		try {
			const logger = createLogger();
			const conn = new WSConnection(fakeUrl, logger);
			await conn.connect();
			const callback = vi.fn();

			conn.addSubListener('sub-fail', callback);

			expect(() => conn.cancelSubscription('sub-fail', callback)).toThrow('unsubscribe send boom');
			expect(
				Object.keys((conn as unknown as { rpcListeners: Record<string, unknown> }).rpcListeners),
			).toHaveLength(0);
			expect(logger.error).toHaveBeenCalledWith('WebSocket send failed', {
				e: expect.objectContaining({ message: 'unsubscribe send boom' }),
			});
		} finally {
			injectWebSocketImpl(WebSocket);
		}
	});

	test('sendRpcMessage throws immediately when socket is not open', () => {
		const conn = new WSConnection(fakeUrl);
		const sendRpcMessage = (
			conn as unknown as {
				sendRpcMessage: (
					method: 'subscribe' | 'unsubscribe',
					params: Record<string, unknown>,
					id: number,
				) => void;
			}
		).sendRpcMessage.bind(conn);

		expect(() => sendRpcMessage('unsubscribe', { subId: 'missing' }, 1)).toThrow('Socket not open');
	});
});
