export class HttpResponseError extends Error {
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
}

export class NetworkError extends Error {
	status: number;
	constructor(message: string, status: number) {
		super(message);
		this.status = status;
	}
}

export class MintOperationError extends Error {
	code: number;
	detail: string;

	constructor(message: string, code: number, detail: string) {
		super(message);
		this.code = code;
		this.detail = detail;
	}
}

export class BlindedMessageAlreadySignedError extends MintOperationError {
	constructor(detail: string) {
		super('Blinded message of output already signed', 10002, detail);
	}
}

export class TokenVerificationError extends MintOperationError {
	constructor(detail: string) {
		super('Token could not be verified', 10003, detail);
	}
}

export class TokenAlreadySpentError extends MintOperationError {
	constructor(detail: string) {
		super('Token is already spent', 11001, detail);
	}
}

export class TransactionNotBalancedError extends MintOperationError {
	constructor(detail: string) {
		super('Transaction is not balanced (inputs != outputs)', 11002, detail);
	}
}

export class UnsupportedUnitError extends MintOperationError {
	constructor(detail: string) {
		super('Unit in request is not supported', 11005, detail);
	}
}

export class AmountOutOfLimitError extends MintOperationError {
	constructor(detail: string) {
		super('Amount outside of limit range', 11006, detail);
	}
}

export class KeysetUnknownError extends MintOperationError {
	constructor(detail: string) {
		super('Keyset is not known', 12001, detail);
	}
}

export class KeysetInactiveError extends MintOperationError {
	constructor(detail: string) {
		super('Keyset is inactive, cannot sign messages', 12002, detail);
	}
}

export class QuoteRequestNotPaidError extends MintOperationError {
	constructor(detail: string) {
		super('Quote request is not paid', 20001, detail);
	}
}

export class TokensAlreadyIssuedError extends MintOperationError {
	constructor(detail: string) {
		super('Tokens have already been issued for quote', 20002, detail);
	}
}

export class MintingDisabledError extends MintOperationError {
	constructor(detail: string) {
		super('Minting is disabled', 20003, detail);
	}
}

export class QuotePendingError extends MintOperationError {
	constructor(detail: string) {
		super('Quote is pending', 20005, detail);
	}
}

export class InvoiceAlreadyPaidError extends MintOperationError {
	constructor(detail: string) {
		super('Invoice already paid', 20006, detail);
	}
}

export class QuoteExpiredError extends MintOperationError {
	constructor(detail: string) {
		super('Quote is expired', 20007, detail);
	}
}

export function createMintOperationError(code: number, detail: string): MintOperationError {
	switch (code) {
		case 10002:
			return new BlindedMessageAlreadySignedError(detail);
		case 10003:
			return new TokenVerificationError(detail);
		case 11001:
			return new TokenAlreadySpentError(detail);
		case 11002:
			return new TransactionNotBalancedError(detail);
		case 11005:
			return new UnsupportedUnitError(detail);
		case 11006:
			return new AmountOutOfLimitError(detail);
		case 12001:
			return new KeysetUnknownError(detail);
		case 12002:
			return new KeysetInactiveError(detail);
		case 20001:
			return new QuoteRequestNotPaidError(detail);
		case 20002:
			return new TokensAlreadyIssuedError(detail);
		case 20003:
			return new MintingDisabledError(detail);
		case 20005:
			return new QuotePendingError(detail);
		case 20006:
			return new InvoiceAlreadyPaidError(detail);
		case 20007:
			return new QuoteExpiredError(detail);
		default:
			return new MintOperationError('Unknown mint operation error', code, detail);
	}
}
