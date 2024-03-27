import { MessageQueue } from './utils';

let _WS: typeof WebSocket;

if (WebSocket) {
	_WS = WebSocket;
}

export function injectWebSocketImpl(ws: any) {
	_WS = ws;
}

export class WSConnection {
	public readonly url: URL;
	private ws: WebSocket | undefined;
	private listeners: { [reqId: string]: (e: any) => any } = {};
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
					this.handlingInterval = setInterval(this.handleNextMesage, 0);
				}
			};
		});
	}

	handleNextMesage() {
		if (this.messageQueue.size === 0) {
			clearInterval(this.handlingInterval);
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
				// TODO: Implement NOTICED
				return;
			}
			case 3: {
				subId = parsed[1];
				data = parsed[3];
				break;
			}
			default: {
				return;
			}
		}
		const len = parsed.length;
	}
}
