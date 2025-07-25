import { MessageQueue } from './utils';
import { JsonRpcMessage, JsonRpcNotification, JsonRpcReqParams, RpcSubId } from './model/types';
import { OnOpenError, OnOpenSuccess } from './model/types/wallet/websocket';
import { getWebSocketImpl } from './ws';
import { type Logger, NULL_LOGGER } from './logger';

// Internal interface for RPC listeners
interface RpcListener {
	callback: () => void;
	errorCallback: (e: Error) => void;
}

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
		if (this.connectionMap.has(url)) {
			return this.connectionMap.get(url) as WSConnection;
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
	private handlingInterval?: number;
	private rpcId = 0;
	private _logger: Logger;
	private onCloseCallbacks: Array<(e: CloseEvent) => void> = [];

	constructor(url: string, logger?: Logger) {
		this._WS = getWebSocketImpl();
		this.url = new URL(url);
		this.messageQueue = new MessageQueue();
		this._logger = logger ?? NULL_LOGGER;
	}

	connect() {
		if (!this.connectionPromise) {
			this.connectionPromise = new Promise((res: OnOpenSuccess, rej: OnOpenError) => {
				try {
					this.ws = new this._WS(this.url.toString());
					this.onCloseCallbacks = [];
				} catch (err) {
					rej(err);
					return;
				}
				this.ws.onopen = () => {
					res();
				};
				this.ws.onerror = () => {
					rej(new Error('Failed to open WebSocket'));
				};
				this.ws.onmessage = (e: MessageEvent) => {
					this.messageQueue.enqueue(e.data);
					if (!this.handlingInterval) {
						this.handlingInterval = setInterval(
							this.handleNextMessage.bind(this),
							0
						) as unknown as number;
					}
				};
				this.ws.onclose = (e: CloseEvent) => {
					this.connectionPromise = undefined;
					this.onCloseCallbacks.forEach((cb) => cb(e));
				};
			});
		}
		return this.connectionPromise;
	}

	sendRequest(method: 'subscribe', params: JsonRpcReqParams): void;
	sendRequest(method: 'unsubscribe', params: { subId: string }): void;
	sendRequest(method: 'subscribe' | 'unsubscribe', params: Partial<JsonRpcReqParams>) {
		if (this.ws?.readyState !== 1) {
			if (method === 'unsubscribe') {
				return;
			}
			this._logger.error('Attempted sendRequest, but socket was not open');
			throw new Error('Socket not open');
		}
		const id = this.rpcId;
		this.rpcId++;
		const message = JSON.stringify({ jsonrpc: '2.0', method, params, id });
		this.ws?.send(message);
	}

	/** @deprecated Use cancelSubscription for JSONRPC compliance. */
	closeSubscription(subId: string) {
		this.ws?.send(JSON.stringify(['CLOSE', subId]));
	}

	addSubListener<TPayload = unknown>(subId: string, callback: (payload: TPayload) => void) {
		(this.subListeners[subId] = this.subListeners[subId] || []).push(
			callback as (payload: unknown) => void
		);
	}

	private addRpcListener(
		callback: () => void,
		errorCallback: (e: Error) => void,
		id: Exclude<RpcSubId, null>
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
			(fn) => fn !== (callback as (payload: unknown) => void)
		);
	}

	async ensureConnection() {
		if (this.ws?.readyState !== 1) {
			await this.connect();
		}
	}

	private handleNextMessage() {
		if (this.messageQueue.size === 0) {
			clearInterval(this.handlingInterval);
			this.handlingInterval = undefined;
			return;
		}
		const message = this.messageQueue.dequeue() as string;
		let parsed;
		try {
			parsed = JSON.parse(message) as JsonRpcMessage;
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
						const notification = parsed as JsonRpcNotification;
						this.subListeners[subId].forEach((cb) => cb(notification.params?.payload));
					}
				}
			}
		} catch (e) {
			this._logger.error('Error doing handleNextMessage', { e });
			return;
		}
	}

	createSubscription<TPayload = unknown>(
		params: Omit<JsonRpcReqParams, 'subId'>,
		callback: (payload: TPayload) => void,
		errorCallback: (e: Error) => void
	): string {
		if (this.ws?.readyState !== 1) {
			this._logger.error('Attempted createSubscription, but socket was not open');
			throw new Error('Socket is not open');
		}
		const subId = (Math.random() + 1).toString(36).substring(7);
		this.addRpcListener(
			() => {
				this.addSubListener(subId, callback);
			},
			errorCallback,
			this.rpcId
		);
		this.sendRequest('subscribe', { ...params, subId });
		this.rpcId++;
		return subId;
	}

	/**
	 * Cancels a subscription, sending an unsubscribe request and handling responses.
	 * @param subId The subscription ID to cancel.
	 * @param callback The original payload callback to remove.
	 * @param errorCallback Optional callback for unsubscribe errors (defaults to logging).
	 */
	cancelSubscription<TPayload = unknown>(
		subId: string,
		callback: (payload: TPayload) => void,
		errorCallback?: (e: Error) => void
	) {
		this.removeListener(subId, callback);
		this.addRpcListener(
			() => {
				this._logger.info('Unsubscribed {subId}', { subId });
			},
			errorCallback || ((e: Error) => this._logger.error('Unsubscribe failed', { e })),
			this.rpcId
		);
		this.sendRequest('unsubscribe', { subId });
	}

	get activeSubscriptions() {
		return Object.keys(this.subListeners);
	}

	close() {
		if (this.ws) {
			this.ws?.close();
		}
	}

	onClose(callback: (e: CloseEvent) => void) {
		this.onCloseCallbacks.push(callback);
	}
}
