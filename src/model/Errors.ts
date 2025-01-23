export class HttpResponseError extends Error {
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.status = status;
		this.name = 'HttpResponseError';
		Object.setPrototypeOf(this, HttpResponseError.prototype);
	}
}

export class NetworkError extends Error {
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.status = status;
		this.name = 'NetworkError';
		Object.setPrototypeOf(this, NetworkError.prototype);
	}
}
export class MintOperationError extends Error {
	code: number;
	detail: string;

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
			20005: 'Quote is pending',
			20006: 'Invoice already paid',
			20007: 'Quote is expired'
		};
		super(messages[code] || detail || 'Unknown mint operation error');
		this.code = code;
		this.detail = detail;
		this.name = 'MintOperationError';
		Object.setPrototypeOf(this, MintOperationError.prototype);
	}
}
