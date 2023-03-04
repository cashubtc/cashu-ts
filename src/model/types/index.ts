import { Proof } from '../Proof.js';

export type MintKeys = { [k: number]: string };

export type MeltPayload = {
	pr: string;
	proofs: Array<Proof>;
};

export type MeltResponse = {
	paid: boolean;
	preimage: string;
};

export type SplitPayload = {
	proofs: Array<Proof>;
	amount: number;
	outputs: Array<SerializedBlindedMessage>;
};

export type SplitResponse = {
	fst: SerializedBlindedSignature[];
	snd: SerializedBlindedSignature[];
};

export type requestMintResponse = {
	pr: string;
	hash: string;
};

export type CheckSpendablePayload = {
	proofs: Array<{ secret: string }>;
};
export type CheckSpendableResponse = { spendable: Array<boolean> };

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
	proofs: Array<Proof>;
	mints: Array<{ url: string; ids: Array<string> }>;
};

export type BlindedTransaction = {
	blindedMessages: SerializedBlindedMessage[];
	secrets: Uint8Array[];
	rs: bigint[];
	amounts: number[];
};
