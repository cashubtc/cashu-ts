import { MessageQueue } from '../utils';
import { type JsonRpcMessage, type JsonRpcReqParams, type RpcSubId } from '../model/types';
import { getWebSocketImpl } from './ws';
import { type Logger, NULL_LOGGER } from '../logger';

// Internal interface for RPC listeners
interface RpcListener {
	callback: () => void;
	errorCallback: (e: Error) => void;
}

type OnOpenSuccess = () => void;
type OnOpenError = (err: Error) => void;

export class ConnectionManager {
	private static instance: ConnectionManager;
	private connectionMap: Map<string, WSConnection> = new Map();

	static getInstance() {
		if (!ConnectionManager.instance) {
			ConnectionManager.instance = new ConnectionManager();
		}
		return ConnectionManager.instance;
	}

	getConnection(url: string, logger?: Logger): WSConnection {
		const existing = this.connectionMap.get(url);
		if (existing) {
			if (logger) existing.setLogger(logger);
			return existing;
		}
		const newConn = new WSConnection(url, logger);
		this.connectionMap.set(url, newConn);
		return newConn;
	}
}

export class WSConnection {
	public readonly url: URL;
	private readonly _WS: typeof WebSocket;
	private ws: WebSocket | undefined;
	private connectionPromise: Promise<void> | undefined;
	private subListeners: { [subId: string]: Array<(payload: unknown) => void> } = {};
	private rpcListeners: { [rpcSubId: string]: RpcListener } = {};
	private messageQueue: MessageQueue;
	private handlingInterval?: ReturnType<typeof setInterval>;
	private rpcId = 0;
	private _logger: Logger;
	private onCloseCallbacks: Array<(e: CloseEvent) => void> = [];

	constructor(url: string, logger?: Logger) {
		this._WS = getWebSocketImpl();
		this.url = new URL(url);
		this.messageQueue = new MessageQueue();
		this._logger = logger ?? NULL_LOGGER;
	}

	setLogger(logger: Logger) {
		this._logger = logger;
	}

	connect(timeoutMs = 10_000): Promise<void> {
		if (this.connectionPromise) return this.connectionPromise;

		this.connectionPromise = new Promise((resolve: OnOpenSuccess, reject: OnOpenError) => {
			let opened = false;
			let settled = false;
			let timer: ReturnType<typeof setTimeout> | null = null;

			const settle = (fn: () => void) => {
				if (settled) return;
				settled = true;
				if (timer) clearTimeout(timer);
				fn();
			};

			const cleanupSocket = () => {
				if (!this.ws) return;
				try {
					this.ws.onopen = null;
					this.ws.onerror = null;
					this.ws.onmessage = null;
					this.ws.onclose = null;
				} catch {
					// silence
				}
				try {
					this.ws.close();
				} catch {
					// silence
				}
				this.ws = undefined;
				this.stopMessageHandling();
			};

			const fail = (e: unknown) => {
				this.connectionPromise = undefined;
				cleanupSocket();
				const err = e instanceof Error ? e : new Error(String(e));
				this.failPendingRpc(err);
				settle(() => reject(err));
			};

			try {
				this.ws = new this._WS(this.url.toString());
			} catch (e) {
				fail(e);
				return;
			}

			timer = setTimeout(() => {
				fail(new Error(`WebSocket connect timeout after ${timeoutMs}ms`));
			}, timeoutMs);

			this.ws.onopen = () => {
				opened = true;
				settle(resolve);
			};

			this.ws.onerror = (ev) => {
				if (!opened) {
					fail(new Error('Failed to open WebSocket'));
					return;
				}
				this._logger.error('WebSocket error after open', { ev });
				// do not call fail(), onclose will follow in most implementations
			};

			this.ws.onmessage = (e: MessageEvent) => {
				this.messageQueue.enqueue(e.data as string);
				if (!this.handlingInterval) {
					this.handlingInterval = setInterval(this.handleNextMessage.bind(this), 0);
				}
			};

			this.ws.onclose = (e: CloseEvent) => {
				this.connectionPromise = undefined;

				if (!opened) {
					const reason = e?.reason ? `, ${e.reason}` : '';
					fail(new Error(`WebSocket closed before open (code ${e?.code ?? 0}${reason})`));
					return;
				}

				this.stopMessageHandling();

				// If the socket closed unexpectedly, fail any in flight RPC acks.
				// Otherwise just clear them to avoid leaks, but don't spam errors.
				const reason = e?.reason ? `, ${e.reason}` : '';
				const code = e?.code ?? 0;
				const wasClean = typeof e.wasClean === 'boolean' ? e.wasClean : true;

				const abnormal = !wasClean || (code !== 1000 && code !== 1001);
				if (abnormal) {
					this.failPendingRpc(new Error(`WebSocket closed (code ${code}${reason})`));
				} else {
					this.rpcListeners = {};
				}

				this.onCloseCallbacks.forEach((cb) => cb(e));
			};
		});

		return this.connectionPromise;
	}

	sendRequest(method: 'subscribe', params: JsonRpcReqParams): void;
	sendRequest(method: 'unsubscribe', params: { subId: string }): void;
	sendRequest(method: 'subscribe' | 'unsubscribe', params: Partial<JsonRpcReqParams>): void {
		if (this.ws?.readyState !== this._WS.OPEN) {
			if (method === 'unsubscribe') {
				return;
			}
			this._logger.error('Attempted sendRequest, but socket was not open');
			throw new Error('Socket not open');
		}

		const id = this.rpcId;
		this.rpcId++;
		this.sendRpcMessage(method, params, id);
	}

	/**
	 * @deprecated Use cancelSubscription for JSONRPC compliance.
	 */
	closeSubscription(subId: string) {
		this.ws?.send(JSON.stringify(['CLOSE', subId]));
	}

	addSubListener<TPayload = unknown>(subId: string, callback: (payload: TPayload) => void) {
		(this.subListeners[subId] = this.subListeners[subId] || []).push(
			callback as (payload: unknown) => void,
		);
	}

	private stopMessageHandling() {
		if (this.handlingInterval) {
			clearInterval(this.handlingInterval);
			this.handlingInterval = undefined;
		}
		// Drain any queued messages so we don't process stale frames after teardown.
		while (this.messageQueue.size > 0) {
			this.messageQueue.dequeue();
		}
	}

	private failPendingRpc(err: Error) {
		const listeners = this.rpcListeners;
		this.rpcListeners = {};
		for (const key of Object.keys(listeners)) {
			try {
				listeners[key].errorCallback(err);
			} catch {
				// ignore user error callbacks throwing
			}
		}
	}

	private sendRpcMessage(
		method: 'subscribe' | 'unsubscribe',
		params: Partial<JsonRpcReqParams>,
		id: number,
	): void {
		if (this.ws?.readyState !== this._WS.OPEN) {
			throw new Error('Socket not open');
		}

		const message = JSON.stringify({ jsonrpc: '2.0', method, params, id });

		try {
			this.ws.send(message);
		} catch (e) {
			this._logger.error('WebSocket send failed', { e });
			// allow retry
			this.connectionPromise = undefined;

			// Ensure the failed socket is closed and queues are flushed.
			try {
				this.ws.close();
			} catch {
				// silence
			}
			this.ws = undefined;
			this.stopMessageHandling();

			const err = e instanceof Error ? e : new Error(String(e));
			this.failPendingRpc(err);
			throw err;
		}
	}

	private addRpcListener(
		callback: () => void,
		errorCallback: (e: Error) => void,
		id: Exclude<RpcSubId, null>,
	) {
		this.rpcListeners[id] = { callback, errorCallback };
	}

	private removeRpcListener(id: Exclude<RpcSubId, null>) {
		delete this.rpcListeners[id];
	}

	private removeListener<TPayload = unknown>(subId: string, callback: (payload: TPayload) => void) {
		if (!this.subListeners[subId]) {
			return;
		}
		if (this.subListeners[subId].length === 1) {
			delete this.subListeners[subId];
			return;
		}
		this.subListeners[subId] = this.subListeners[subId].filter(
			(fn) => fn !== (callback as (payload: unknown) => void),
		);
	}

	async ensureConnection(timeoutMs?: number) {
		if (this.ws?.readyState !== this._WS.OPEN) {
			await this.connect(timeoutMs);
		}
	}

	private handleNextMessage() {
		if (this.messageQueue.size === 0) {
			if (this.handlingInterval) {
				clearInterval(this.handlingInterval);
				this.handlingInterval = undefined;
			}
			return;
		}

		const message = this.messageQueue.dequeue() as string;

		try {
			const parsed = JSON.parse(message) as JsonRpcMessage;

			if ('result' in parsed && parsed.id != undefined) {
				if (this.rpcListeners[parsed.id]) {
					this.rpcListeners[parsed.id].callback();
					this.removeRpcListener(parsed.id);
				}
			} else if ('error' in parsed && parsed.id != undefined) {
				if (this.rpcListeners[parsed.id]) {
					this.rpcListeners[parsed.id].errorCallback(new Error(parsed.error.message));
					this.removeRpcListener(parsed.id);
				}
			} else if ('method' in parsed) {
				if ('id' in parsed) {
					// Do nothing as mints should not send requests
				} else {
					const subId = parsed.params?.subId;
					if (!subId) {
						return;
					}

					if (this.subListeners[subId]?.length > 0) {
						const notification = parsed;
						this.subListeners[subId].forEach((cb) => {
							try {
								cb(notification.params?.payload);
							} catch (e) {
								this._logger.error('Subscription handler threw', { e });
							}
						});
					}
				}
			}
		} catch (e) {
			this._logger.error('Error doing handleNextMessage', { e });
		}
	}

	createSubscription<TPayload = unknown>(
		params: Omit<JsonRpcReqParams, 'subId'>,
		callback: (payload: TPayload) => void,
		errorCallback: (e: Error) => void,
	): string {
		if (this.ws?.readyState !== this._WS.OPEN) {
			this._logger.error('Attempted createSubscription, but socket was not open');
			throw new Error('Socket is not open');
		}

		const subId = (Math.random() + 1).toString(36).substring(7);
		const rpcId = this.rpcId; // this is the id sendRequest will use next
		this.addRpcListener(
			() => {
				this.addSubListener(subId, callback);
			},
			errorCallback,
			rpcId as Exclude<RpcSubId, null>,
		);

		try {
			this.sendRequest('subscribe', { ...params, subId });
		} catch (e) {
			this.removeRpcListener(rpcId as Exclude<RpcSubId, null>);
			throw e;
		}

		return subId;
	}

	/**
	 * Cancels a subscription, sending an unsubscribe request and handling responses.
	 *
	 * @param subId The subscription ID to cancel.
	 * @param callback The original payload callback to remove.
	 * @param errorCallback Optional callback for unsubscribe errors (defaults to logging).
	 */
	cancelSubscription<TPayload = unknown>(
		subId: string,
		callback: (payload: TPayload) => void,
		errorCallback?: (e: Error) => void,
	) {
		this.removeListener(subId, callback);

		if (this.ws?.readyState !== this._WS.OPEN) {
			this._logger.info('Socket not open, removed listener locally {subId}', { subId });
			return;
		}

		const id = this.rpcId;
		this.rpcId++;

		this.addRpcListener(
			() => {
				this._logger.info('Unsubscribed {subId}', { subId });
			},
			errorCallback || ((e: Error) => this._logger.error('Unsubscribe failed', { e })),
			id as Exclude<RpcSubId, null>,
		);

		try {
			this.sendRpcMessage('unsubscribe', { subId }, id);
		} catch (e) {
			this.removeRpcListener(id as Exclude<RpcSubId, null>);
			throw e;
		}
	}

	get activeSubscriptions() {
		return Object.keys(this.subListeners);
	}

	close() {
		if (this.ws) {
			try {
				this.ws.close();
			} catch {
				// silence
			}
			this.ws = undefined;
		}
		this.connectionPromise = undefined;
		this.stopMessageHandling();
	}

	onClose(callback: (e: CloseEvent) => void) {
		this.onCloseCallbacks.push(callback);
	}
}
