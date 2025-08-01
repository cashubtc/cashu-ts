let _WS: typeof WebSocket | undefined;

if (typeof WebSocket !== 'undefined') {
	_WS = WebSocket;
}

export function injectWebSocketImpl(ws: typeof WebSocket) {
	_WS = ws;
}

export function getWebSocketImpl() {
	if (_WS === undefined) {
		throw new Error('WebSocket implementation not initialized');
	}
	return _WS;
}
