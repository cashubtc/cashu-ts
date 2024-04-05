import { listeners } from 'process';
import { MessageQueue } from './utils';

type Command = 'check_quote' | 'check_proof';

let _WS: typeof WebSocket;

if (typeof WebSocket !== 'undefined') {
	_WS = WebSocket;
}

export function injectWebSocketImpl(ws: any) {
	_WS = ws;
}

class Subscription {
	private connection: WSConnection;
	private subId: string;
	constructor(conn: WSConnection) {
		// HACK: There might be way better ways to create an random string, but I want to create something without dependecies frist
		this.subId = Math.random().toString(36).slice(-5);
		this.connection = conn;
		conn.sendCommand('check_proof', this.subId, { test: true });
	}
	onmessage(cb: () => any) {
		this.connection.addListener(this.subId, cb);
	}
	unsub() {}
}

export class WSConnection {
	public readonly url: URL;
	private ws: WebSocket | undefined;
	private listeners: { [reqId: string]: Array<any> } = {};
	private messageQueue: MessageQueue;
	private handlingInterval?: NodeJS.Timer;

	constructor(url: string) {
		this.url = new URL(url);
		this.messageQueue = new MessageQueue();
	}
	async connect() {
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

	sendCommand(cmd: Command, subId: string, params: any) {
		this.ws?.send(JSON.stringify(['REQ', subId, cmd, params]));
	}

	closeSubscription(subId: string) {
		this.ws?.send(JSON.stringify(['CLOSE', subId]));
	}

	addListener(subId: string, callback: () => any) {
		(this.listeners[subId] = this.listeners[subId] || []).push(callback);
	}

	removeListener(subId: string, callback: () => any) {
		(this.listeners[subId] = this.listeners[subId] || []).filter((fn) => fn !== callback);
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
			parsed = JSON.parse(message) as Array<string>;
		} catch (e) {
			console.log(e);
			return;
		}
		let subId: string;
		let data: any;
		switch (parsed.length) {
			case 2: {
				// Must be notice
				// TODO: Implement NOTICE
				return;
			}
			case 3: {
				subId = parsed[1];
				data = parsed[3];
				this.listeners[subId].forEach((cb) => cb(data));
				break;
			}
			default: {
				return;
			}
		}
	}

	subscribe(cmd: 'check_proof' | 'check_quote') {
		return new Subscription(this);
	}
}
