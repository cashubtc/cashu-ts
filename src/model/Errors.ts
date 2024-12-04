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
		let message: string;
		switch (code) {
			case 10002:
				message = 'Blinded message of output already signed';
				break;
			case 10003:
				message = 'Token could not be verified';
				break;
			case 11001:
				message = 'Token is already spent';
				break;
			case 11002:
				message = 'Transaction is not balanced (inputs != outputs)';
				break;
			case 11005:
				message = 'Unit in request is not supported';
				break;
			case 11006:
				message = 'Amount outside of limit range';
				break;
			case 12001:
				message = 'Keyset is not known';
				break;
			case 12002:
				message = 'Keyset is inactive, cannot sign messages';
				break;
			case 20001:
				message = 'Quote request is not paid';
				break;
			case 20002:
				message = 'Tokens have already been issued for quote';
				break;
			case 20003:
				message = 'Minting is disabled';
				break;
			case 20005:
				message = 'Quote is pending';
				break;
			case 20006:
				message = 'Invoice already paid';
				break;
			case 20007:
				message = 'Quote is expired';
				break;
			default:
				message = 'Unknown mint operation error';
		}
		super(message);
		this.code = code;
		this.detail = detail;
		this.name = 'MintOperationError';
		Object.setPrototypeOf(this, MintOperationError.prototype);
	}
}
