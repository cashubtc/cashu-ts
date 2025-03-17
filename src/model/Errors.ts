/** This error is thrown when a HTTP response is not 2XX or 400. */
export class HttpResponseError extends Error {
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.status = status;
		this.name = 'HttpResponseError';
		Object.setPrototypeOf(this, HttpResponseError.prototype);
	}
}

/** This error is thrown when a network request fails. */
export class NetworkError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'NetworkError';
		Object.setPrototypeOf(this, NetworkError.prototype);
	}
}

/** This error is thrown when a mint operation returns a 400. */
export class MintOperationError extends Error {
	code: number;

	constructor(code: number, detail: string) {
		const messages: Record<number, string> = {
			10002: 'Blinded message of output already signed',
			10003: 'Token could not be verified',
			11001: 'Token is already spent',
			11002: 'Transaction is not balanced (inputs != outputs)',
			11005: 'Unit in request is not supported',
			11006: 'Amount outside of limit range',
			12001: 'Keyset is not known',
			12002: 'Keyset is inactive, cannot sign messages',
			20001: 'Quote request is not paid',
			20002: 'Tokens have already been issued for quote',
			20003: 'Minting is disabled',
			20004: 'Lightning payment failed',
			20005: 'Quote is pending',
			20006: 'Invoice already paid',
			20007: 'Quote is expired',
			20008: 'Signature for mint request invalid',
			20009: 'Pubkey required for mint quote',
			30001: 'Endpoint requires clear auth',
			30002: 'Clear authentication failed',
			31001: 'Endpoint requires blind auth',
			31002: 'Blind authentication failed',
			31003: 'Maximum BAT mint amount exceeded',
			31004: 'BAT mint rate limit exceeded'
		};
		// Use detail if returned by the mint, otherwise use fallback messages
		super(detail || messages[code] || 'Unknown mint operation error');
		this.code = code;
		this.name = 'MintOperationError';
		Object.setPrototypeOf(this, MintOperationError.prototype);
	}
}
