import { Proof } from '../Proof.js';

export type MintKeys = { [k: number]: string };

export type MeltPayload = {
	pr: string;
	proofs: Array<Proof>;
	outputs: SerializedBlindedMessage[];
};

export type MeltResponse = {
	paid: boolean;
	preimage: string;
	change?: SerializedBlindedSignature[];
} & ApiError;

export type SplitPayload = {
	proofs: Array<Proof>;
	amount: number;
	outputs: Array<SerializedBlindedMessage>;
};

export type SplitResponse = {
	fst: SerializedBlindedSignature[];
	snd: SerializedBlindedSignature[];
} & ApiError;
export type ApiError = {
	error?: string;
	code?: number;
	detail?: string;
};

export type RequestMintResponse = {
	pr: string;
	hash: string;
} & ApiError;

export type CheckSpendablePayload = {
	proofs: Array<{ secret: string }>;
};
export type CheckSpendableResponse = { spendable: Array<boolean> } & ApiError;

export type SerializedBlindedMessage = {
	amount: number;
	B_: string;
};

export type SerializedBlindedSignature = {
	id: string;
	amount: number;
	C_: string;
};

export type Token = {
	token: Array<{ mint: string; proofs: Array<Proof> }>;
	memo?: string;
};

export type TokenV2 = {
	proofs: Array<Proof>;
	mints: Array<{ url: string; ids: Array<string> }>;
};

export type BlindedTransaction = {
	blindedMessages: SerializedBlindedMessage[];
	secrets: Uint8Array[];
	rs: bigint[];
	amounts: number[];
};
export type GetInfoResponse = {
	name: string;
	pubkey: string;
	version: string;
	description: string;
	description_long: string;
	contact: Array<Array<string>>;
	nuts: Array<string>;
	motd: string;
};
