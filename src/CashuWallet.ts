import { decode } from '@gandlaf21/bolt11-decode';
import { utils as ecUtils } from '@noble/secp256k1';
import { encodeBase64ToJson } from './base64.js';
import { CashuMint } from './CashuMint.js';
import * as dhke from './DHKE.js';
import { BlindedMessage } from './model/BlindedMessage.js';

import {
	BlindedTransaction,
	MintKeys,
	Proof,
	PayLnInvoiceResponse,
	RequestMintResponse,
	SerializedBlindedMessage,
	SerializedBlindedSignature,
	SplitPayload,
	Token
} from './model/types/index.js';
import { deriveKeysetId, getDecodedToken, splitAmount } from './utils.js';

/**
 * Class that represents a Cashu wallet.
 */
class CashuWallet {
	private keys: MintKeys = {};
	private keysMap: Map<string, MintKeys>;
	private keysetId = '';
	mint: CashuMint;

	/**
	 *
	 * @param keys public keys from the mint
	 * @param mint Cashu mint instance is used to make api calls
	 */
	constructor(mint: CashuMint) {
		this.mint = mint;
		this.keysMap = new Map();
	}

	/**
	 * returns proofs that are already spent (use for keeping wallet state clean)
	 * @param proofs
	 * @returns
	 */
	async checkProofsSpent(proofs: Array<Proof>): Promise<Array<Proof>> {
		const payload = {
			//send only the secret
			proofs: proofs.map((p) => ({ secret: p.secret }))
		};
		const { spendable } = await this.mint.check(payload);
		return proofs.filter((_, i) => !spendable[i]);
	}

	requestMint(amount: number): Promise<RequestMintResponse> {
		return this.mint.requestMint(amount);
	}

	/**
	 * Executes a payment of an invoice on the Lightning network.
	 * The combined amount of Proofs has to match the payment amount including fees.
	 * @param invoice
	 * @param proofsToSend the exact amount to send including fees
	 * @returns
	 */
	async payLnInvoice(invoice: string, proofsToSend: Array<Proof>): Promise<PayLnInvoiceResponse> {
		const paymentPayload = this.createPaymentPayload(invoice, proofsToSend);
		const { blindedMessages, secrets, rs } = await this.createBlankOutputs();
		const payData = await this.mint.melt({ ...paymentPayload, outputs: blindedMessages });
		return {
			isPaid: payData.paid ?? false,
			preimage: payData.preimage,
			change: payData?.change
				? dhke.constructProofs(payData.change, rs, secrets, await this.getKeys(payData?.change))
				: [],
			newKeys: await this.changedKeys(payData?.change)
		};
	}

	async getFee(invoice: string): Promise<number> {
		const { fee } = await this.mint.checkFees({ pr: invoice });
		return fee;
	}

	static getDecodedLnInvoice(invoice: string): {
		paymentRequest: string;
		sections: Array<unknown>;
		readonly expiry: unknown;
		readonly route_hints: Array<unknown>;
	} {
		return decode(invoice);
	}

	createPaymentPayload(
		invoice: string,
		proofs: Array<Proof>
	): { pr: string; proofs: Array<Proof> } {
		const payload = {
			pr: invoice,
			proofs: proofs
		};
		return payload;
	}

	payLnInvoiceWithToken(
		invoice: string,
		token: string
	): Promise<{
		isPaid: boolean;
		preimage: string | null;
		change: Array<Proof>;
		newKeys?: MintKeys | undefined;
	}> {
		return this.payLnInvoice(invoice, encodeBase64ToJson(token));
	}

	async receive(encodedToken: string): Promise<{
		proofs: Array<Proof>;
		tokensWithErrors: Token | undefined;
		newKeys?: MintKeys;
	}> {
		const { token: tokens } = getDecodedToken(encodedToken);
		const proofs: Array<Proof> = [];
		const tokensWithErrors: Array<{ mint: string; proofs: Array<Proof> }> = [];
		const mintKeys = new Map<string, MintKeys>([[this.mint.mintUrl, await this.getKeys()]]);
		let newKeys: MintKeys | undefined;
		for (const token of tokens) {
			if (!token?.proofs || !token?.mint) {
				continue;
			}
			try {
				const keys = mintKeys.get(token.mint) || (await new CashuMint(token.mint).getKeys());
				const amount = token.proofs.reduce((total, curr) => total + curr.amount, 0);
				const { payload, amount1BlindedMessages, amount2BlindedMessages } =
					await this.createSplitPayload(0, amount, token.proofs);
				const { fst, snd } = await CashuMint.split(token.mint, payload);
				const proofs1 = dhke.constructProofs(
					fst,
					amount1BlindedMessages.rs,
					amount1BlindedMessages.secrets,
					token.mint === this.mint.mintUrl ? await this.getKeys(fst) : keys
				);
				const proofs2 = dhke.constructProofs(
					snd,
					amount2BlindedMessages.rs,
					amount2BlindedMessages.secrets,
					token.mint === this.mint.mintUrl ? await this.getKeys(snd) : keys
				);
				if (token.mint === this.mint.mintUrl) {
					newKeys = await this.changedKeys([...fst, ...snd]);
				}
				proofs.push(...proofs1, ...proofs2);
				if (!mintKeys.has(token.mint)) {
					mintKeys.set(token.mint, keys);
				}
			} catch (error) {
				console.error(error);
				tokensWithErrors.push(token);
			}
		}
		return {
			proofs,
			tokensWithErrors: tokensWithErrors.length ? { token: tokensWithErrors } : undefined,
			newKeys
		};
	}

	async send(
		amount: number,
		proofs: Array<Proof>
	): Promise<{ returnChange: Array<Proof>; send: Array<Proof>; newKeys?: MintKeys }> {
		let amountAvailable = 0;
		const proofsToSend: Array<Proof> = [];
		const change: Array<Proof> = [];
		proofs.forEach((proof) => {
			if (amountAvailable >= amount) {
				change.push(proof);
				return;
			}
			amountAvailable = amountAvailable + proof.amount;
			proofsToSend.push(proof);
		});
		if (amount > amountAvailable) {
			throw new Error('Not enough funds available');
		}
		if (amount < amountAvailable) {
			const { amount1, amount2 } = this.splitReceive(amount, amountAvailable);
			const { payload, amount1BlindedMessages, amount2BlindedMessages } =
				await this.createSplitPayload(amount1, amount2, proofsToSend);
			const { fst, snd } = await this.mint.split(payload);
			const proofs1 = dhke.constructProofs(
				fst,
				amount1BlindedMessages.rs,
				amount1BlindedMessages.secrets,
				await this.getKeys(fst)
			);
			const proofs2 = dhke.constructProofs(
				snd,
				amount2BlindedMessages.rs,
				amount2BlindedMessages.secrets,
				await this.getKeys(snd)
			);
			const promises = [...proofs1, ...change];
			return {
				returnChange: promises,
				send: proofs2,
				newKeys: await this.changedKeys(promises)
			};
		}
		return {
			returnChange: change,
			send: proofsToSend
		};
	}

	async requestTokens(
		amount: number,
		hash: string
	): Promise<{ proofs: Array<Proof>; newKeys?: MintKeys }> {
		const { blindedMessages, secrets, rs } = await this.createRandomBlindedMessages(amount);
		const payloads = { outputs: blindedMessages };
		const { promises } = await this.mint.mint(payloads, hash);
		return {
			proofs: dhke.constructProofs(promises, rs, secrets, await this.getKeys(promises)),
			newKeys: await this.changedKeys(promises)
		};
	}
	private async initKeys() {
		if (!this.keysetId || !Object.keys(this.keys).length) {
			this.keys = await this.mint.getKeys();
			this.keysetId = await deriveKeysetId(this.keys);
			this.keysMap.set(this.keysetId, this.keys);
		}
	}
	private async haveKeysChanged(
		...promises: Array<SerializedBlindedSignature | Proof>
	): Promise<boolean> {
		await this.initKeys();
		return promises.some((x) => x.id !== this.keysetId);
	}
	private async changedKeys(
		promises: Array<SerializedBlindedSignature | Proof> = []
	): Promise<MintKeys | undefined> {
		await this.initKeys();
		if (!promises?.length) {
			return undefined;
		}
		return (await this.haveKeysChanged(...promises)) ? this.getKeys(promises) : undefined;
	}
	private async getKeys(arr: Array<SerializedBlindedSignature | Proof> = []): Promise<MintKeys> {
		await this.initKeys();
		if (!arr?.length || !arr[0]?.id) {
			return this.keys;
		}
		const keysetId = arr[0].id;
		if (this.keysetId === keysetId) {
			return this.keys;
		}
		let newKeys = this.keysMap.get(keysetId);
		if (newKeys) {
			return newKeys;
		}
		newKeys = await this.mint.getKeys(keysetId);
		this.keysMap.set(keysetId, newKeys);
		return newKeys;
	}

	//keep amount 1 send amount 2
	private async createSplitPayload(
		amount1: number,
		amount2: number,
		proofsToSend: Array<Proof>
	): Promise<{
		payload: SplitPayload;
		amount1BlindedMessages: BlindedTransaction;
		amount2BlindedMessages: BlindedTransaction;
	}> {
		const amount1BlindedMessages = await this.createRandomBlindedMessages(amount1);
		const amount2BlindedMessages = await this.createRandomBlindedMessages(amount2);
		const allBlindedMessages: Array<SerializedBlindedMessage> = [];
		// the order of this array aparently matters if it's the other way around,
		// the mint complains that the split is not as expected
		allBlindedMessages.push(...amount1BlindedMessages.blindedMessages);
		allBlindedMessages.push(...amount2BlindedMessages.blindedMessages);

		const payload = {
			proofs: proofsToSend,
			amount: amount2,
			outputs: allBlindedMessages
		};
		return { payload, amount1BlindedMessages, amount2BlindedMessages };
	}
	//keep amount 1 send amount 2
	private splitReceive(
		amount: number,
		amountAvailable: number
	): { amount1: number; amount2: number } {
		const amount1: number = amountAvailable - amount;
		const amount2: number = amount;
		return { amount1, amount2 };
	}

	private async createRandomBlindedMessages(amount: number): Promise<{
		blindedMessages: Array<SerializedBlindedMessage>;
		secrets: Array<Uint8Array>;
		rs: Array<bigint>;
		amounts: Array<number>;
	}> {
		const blindedMessages: Array<SerializedBlindedMessage> = [];
		const secrets: Array<Uint8Array> = [];
		const rs: Array<bigint> = [];
		const amounts = splitAmount(amount);
		for (let i = 0; i < amounts.length; i++) {
			const secret: Uint8Array = ecUtils.randomBytes(32);
			secrets.push(secret);
			const { B_, r } = await dhke.blindMessage(secret);
			rs.push(r);
			const blindedMessage = new BlindedMessage(amounts[i], B_);
			blindedMessages.push(blindedMessage.getSerializedBlindedMessage());
		}
		return { blindedMessages, secrets, rs, amounts };
	}
	private async createBlankOutputs(): Promise<{
		blindedMessages: Array<SerializedBlindedMessage>;
		secrets: Array<Uint8Array>;
		rs: Array<bigint>;
	}> {
		const blindedMessages: Array<SerializedBlindedMessage> = [];
		const secrets: Array<Uint8Array> = [];
		const rs: Array<bigint> = [];
		for (let i = 0; i < 4; i++) {
			const secret: Uint8Array = ecUtils.randomBytes(32);
			secrets.push(secret);
			const { B_, r } = await dhke.blindMessage(secret);
			rs.push(r);
			const blindedMessage = new BlindedMessage(0, B_);
			blindedMessages.push(blindedMessage.getSerializedBlindedMessage());
		}

		return { blindedMessages, secrets, rs };
	}
}

export { CashuWallet };
