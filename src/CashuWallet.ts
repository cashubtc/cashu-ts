import { randomBytes } from '@noble/hashes/utils';
import { CashuMint } from './CashuMint.js';
import * as dhke from './DHKE.js';
import { BlindedMessage } from './model/BlindedMessage.js';
import {
	BlindedMessageData,
	BlindedTransaction,
	MintKeys,
	PayLnInvoiceResponse,
	PaymentPayload,
	Proof,
	ReceiveResponse,
	SendResponse,
	SerializedBlindedMessage,
	SplitPayload
} from './model/types/index.js';
import { getDecodedToken, splitAmount } from './utils.js';

/**
 * Class that represents a Cashu wallet.
 */
class CashuWallet {
	keys: MintKeys;
	mint: CashuMint;

	/**
	 *
	 * @param keys public keys from the mint
	 * @param mint Cashu mint instance is used to make api calls
	 */
	constructor(keys: MintKeys, mint: CashuMint) {
		this.keys = keys;
		this.mint = mint;
	}

	/**
	 * returns proofs that are already spent (use for keeping wallet state clean)
	 * @param proofs (only the 'secret' field is required)
	 * @returns
	 */
	async checkProofsSpent<T extends { secret: string }>(proofs: Array<T>): Promise<Array<T>> {
		const payload = {
			//send only the secret
			proofs: proofs.map((p) => ({ secret: p.secret }))
		};
		const { spendable } = await this.mint.check(payload);
		return proofs.filter((_, i) => !spendable[i]);
	}

	requestMint(amount: number) {
		return this.mint.requestMint(amount);
	}

	/**
	 * Executes a payment of an invoice on the Lightning network.
	 * The combined amount of Proofs has to match the payment amount including fees.
	 * @param invoice
	 * @param proofsToSend the exact amount to send including fees
	 * @param feeReserve? optionally set LN routing fee reserve. If not set, fee reserve will get fetched at mint
	 * @returns
	 */
	async payLnInvoice(invoice: string, proofsToSend: Array<Proof>, feeReserve?: number) : Promise<PayLnInvoiceResponse> {
		const paymentPayload = this.createPaymentPayload(invoice, proofsToSend);
		if (!feeReserve) {
			feeReserve = await this.getFee(invoice);
		}
		const { blindedMessages, secrets, rs } = await this.createBlankOutputs(feeReserve);
		const payData = await this.mint.melt({ ...paymentPayload, outputs: blindedMessages });
		return {
			isPaid: payData.paid ?? false,
			preimage: payData.preimage,
			change: payData?.change ? dhke.constructProofs(payData.change, rs, secrets, this.keys) : []
		};
	}

	async getFee(invoice: string): Promise<number> {
		const { fee } = await this.mint.checkFees({ pr: invoice });
		return fee;
	}

	createPaymentPayload(invoice: string, proofs: Array<Proof>): PaymentPayload {
		return {
			pr: invoice,
			proofs: proofs
		};
	}

	payLnInvoiceWithToken(invoice: string, token: string): Promise<PayLnInvoiceResponse> {
		const decodedToken = getDecodedToken(token);
		const proofs = decodedToken.token
			.filter((x) => x.mint === this.mint.mintUrl)
			.flatMap((t) => t.proofs);
		return this.payLnInvoice(invoice, proofs);
	}

	async receive(encodedToken: string): Promise<ReceiveResponse> {
		const { token: tokens } = getDecodedToken(encodedToken);
		const proofs: Array<Proof> = [];
		const tokensWithErrors: Array<{ mint: string; proofs: Array<Proof> }> = [];
		const mintKeys = new Map<string, MintKeys>([[this.mint.mintUrl, this.keys]]);
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
					keys
				);
				const proofs2 = dhke.constructProofs(
					snd,
					amount2BlindedMessages.rs,
					amount2BlindedMessages.secrets,
					keys
				);
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
			proofs: proofs,
			tokensWithErrors: tokensWithErrors.length ? { token: tokensWithErrors } : undefined
		};
	}

	async send(amount: number, proofs: Array<Proof>): Promise<SendResponse> {
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
				this.keys
			);
			const proofs2 = dhke.constructProofs(
				snd,
				amount2BlindedMessages.rs,
				amount2BlindedMessages.secrets,
				this.keys
			);
			return { returnChange: [...proofs1, ...change], send: proofs2 };
		}
		return { returnChange: change, send: proofsToSend };
	}

	async requestTokens(amount: number, hash: string): Promise<Array<Proof>> {
		const { blindedMessages, secrets, rs } = await this.createRandomBlindedMessages(amount);
		const payloads = { outputs: blindedMessages };
		const { promises } = await this.mint.mint(payloads, hash);
		return dhke.constructProofs(promises, rs, secrets, this.keys);
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

	private async createRandomBlindedMessages(
		amount: number
	): Promise<BlindedMessageData & { amounts: Array<number> }> {
		const blindedMessages: Array<SerializedBlindedMessage> = [];
		const secrets: Array<Uint8Array> = [];
		const rs: Array<bigint> = [];
		const amounts = splitAmount(amount);
		for (let i = 0; i < amounts.length; i++) {
			const secret = randomBytes(32);
			secrets.push(secret);
			const { B_, r } = await dhke.blindMessage(secret);
			rs.push(r);
			const blindedMessage = new BlindedMessage(amounts[i], B_);
			blindedMessages.push(blindedMessage.getSerializedBlindedMessage());
		}
		return { blindedMessages, secrets, rs, amounts };
	}
	private async createBlankOutputs(feeReserve: number) : Promise<BlindedMessageData> {
		const blindedMessages: Array<SerializedBlindedMessage> = [];
		const secrets: Array<Uint8Array> = [];
		const rs: Array<bigint> = [];
		const count = Math.ceil(Math.log2(feeReserve));
		for (let i = 0; i < count; i++) {
			const secret = randomBytes(32);
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
