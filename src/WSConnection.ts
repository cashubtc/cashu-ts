import { MessageQueue } from './utils';
import { JsonRpcErrorObject, JsonRpcMessage, JsonRpcReqParams, RpcSubId } from './model/types';

let _WS: typeof WebSocket;

if (typeof WebSocket !== 'undefined') {
	_WS = WebSocket;
}

export function injectWebSocketImpl(ws: any) {
	_WS = ws;
}

export class WSConnection {
	public readonly url: URL;
	private ws: WebSocket | undefined;
	private subListeners: { [subId: string]: Array<any> } = {};
	private rpcListeners: { [rpsSubId: string]: any } = {};
	private messageQueue: MessageQueue;
	private handlingInterval?: NodeJS.Timer;
	private rpcId = 0;

	constructor(url: string) {
		this.url = new URL(url);
		this.messageQueue = new MessageQueue();
	}

	connect() {
		return new Promise((res, rej) => {
			try {
				this.ws = new _WS(this.url);
			} catch (err) {
				rej(err);
				return;
			}
			this.ws.onopen = res;
			this.ws.onerror = rej;
			this.ws.onmessage = (e) => {
				this.messageQueue.enqueue(e.data);
				if (!this.handlingInterval) {
					this.handlingInterval = setInterval(this.handleNextMesage.bind(this), 0);
				}
			};
		});
	}

	sendRequest(params: JsonRpcReqParams) {
		const id = this.rpcId;
		this.rpcId++;
		const message = JSON.stringify({ jsonrpc: '2.0', method: 'sub', params, id });
		console.log(message);
		this.ws?.send(message);
	}

	closeSubscription(subId: string) {
		this.ws?.send(JSON.stringify(['CLOSE', subId]));
	}

	addSubListener(subId: string, callback: () => any) {
		(this.subListeners[subId] = this.subListeners[subId] || []).push(callback);
	}

	addRpcListener(
		callback: () => any,
		errorCallback: (e: JsonRpcErrorObject) => any,
		id: Exclude<RpcSubId, null>
	) {
		this.rpcListeners[id] = { callback, errorCallback };
	}

	removeRpcListener(id: Exclude<RpcSubId, null>) {
		delete this.rpcListeners[id];
	}

	removeListener(subId: string, callback: () => any) {
		(this.subListeners[subId] = this.subListeners[subId] || []).filter((fn) => fn !== callback);
	}

	async ensureConenction() {
		if (this.ws?.readyState !== 1) {
			await this.connect();
		}
	}

	handleNextMesage() {
		if (this.messageQueue.size === 0) {
			clearInterval(this.handlingInterval);
			this.handlingInterval = undefined;
			return;
		}
		const message = this.messageQueue.dequeue() as string;
		let parsed;
		try {
			parsed = JSON.parse(message) as JsonRpcMessage;
			console.log(parsed);
			if ('result' in parsed && parsed.id != undefined) {
				if (this.rpcListeners[parsed.id]) {
					this.rpcListeners[parsed.id].callback();
					this.removeRpcListener(parsed.id);
				}
			} else if ('error' in parsed && parsed.id != undefined) {
				if (this.rpcListeners[parsed.id]) {
					this.rpcListeners[parsed.id].errorCallback(parsed.error);
					this.removeRpcListener(parsed.id);
				}
			} else if ('method' in parsed) {
				if ('id' in parsed) {
					// This is a request
					// Do nothing as mints should not send requests
				} else {
					const subId = parsed.params.subId;
					if (!subId) {
						return;
					}
					if (this.subListeners[subId].length > 0) {
						this.subListeners[subId].forEach((cb) => cb());
					}
					// This is a notification
				}
			}
		} catch (e) {
			console.log(e);
			return;
		}
	}

	createSubscription(
		params: JsonRpcReqParams,
		callback: () => any,
		errorCallback: (e: Error) => any
	) {
		if (this.ws?.readyState !== 1) {
			return errorCallback(new Error('Socket is not open'));
		}
		const subId = (Math.random() + 1).toString(36).substring(7);
		this.addRpcListener(
			() => {
				this.addSubListener(subId, callback);
			},
			(e: JsonRpcErrorObject) => {
				errorCallback(new Error(e.message));
			},
			this.rpcId
		);
		this.rpcId++;
		this.sendRequest(params);
	}
}
