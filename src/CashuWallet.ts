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
	ReceiveTokenEntryResponse,
	SendResponse,
	SerializedBlindedMessage,
	SerializedBlindedSignature,
	SplitPayload,
	TokenEntry
} from './model/types/index.js';
import { cleanToken, deriveKeysetId, getDecodedToken, splitAmount } from './utils.js';

/**
 * Class that represents a Cashu wallet.
 * This class should act as the entry point for this library
 */
class CashuWallet {
	private _keys: MintKeys;
	private _keysetId = '';
	mint: CashuMint;

	/**
	 *
	 * @param keys public keys from the mint
	 * @param mint Cashu mint instance is used to make api calls
	 */
	constructor(mint: CashuMint, keys?: MintKeys) {
		this._keys = keys || {};
		this.mint = mint;
		if (keys) {
			this._keysetId = deriveKeysetId(this._keys);
		}
	}

	get keys(): MintKeys {
		return this._keys;
	}
	set keys(keys: MintKeys) {
		this._keys = keys;
		this._keysetId = deriveKeysetId(this._keys);
	}
	get keysetId(): string {
		return this._keysetId;
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
	/**
	 * Starts a minting process by requesting an invoice from the mint
	 * @param amount Amount requesting for mint.
	 * @returns the mint will create and return a Lightning invoice for the specified amount
	 */
	requestMint(amount: number) {
		return this.mint.requestMint(amount);
	}

	/**
	 * Executes a payment of an invoice on the Lightning network.
	 * The combined amount of Proofs has to match the payment amount including fees.
	 * @param invoice
	 * @param proofsToSend the exact amount to send including fees
	 * @param feeReserve? optionally set LN routing fee reserve. If not set, fee reserve will get fetched at mint
	 */
	async payLnInvoice(
		invoice: string,
		proofsToSend: Array<Proof>,
		feeReserve?: number
	): Promise<PayLnInvoiceResponse> {
		const paymentPayload = this.createPaymentPayload(invoice, proofsToSend);
		if (!feeReserve) {
			feeReserve = await this.getFee(invoice);
		}
		const { blindedMessages, secrets, rs } = this.createBlankOutputs(feeReserve);
		const payData = await this.mint.melt({ ...paymentPayload, outputs: blindedMessages });
		return {
			isPaid: payData.paid ?? false,
			preimage: payData.preimage,
			change: payData?.change
				? dhke.constructProofs(payData.change, rs, secrets, await this.getKeys(payData.change))
				: [],
			newKeys: await this.changedKeys(payData?.change)
		};
	}
	/**
	 * Estimate fees for a given LN invoice
	 * @param invoice LN invoice that needs to get a fee estimate
	 * @returns estimated Fee
	 */
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
	/**
	 * Use a cashu token to pay an ln invoice
	 * @param invoice Lightning invoice
	 * @param token cashu token
	 */
	payLnInvoiceWithToken(invoice: string, token: string): Promise<PayLnInvoiceResponse> {
		const decodedToken = getDecodedToken(token);
		const proofs = decodedToken.token
			.filter((x) => x.mint === this.mint.mintUrl)
			.flatMap((t) => t.proofs);
		return this.payLnInvoice(invoice, proofs);
	}
	/**
	 * Receive an encoded Cashu token
	 * @param encodedToken Cashu token
	 * @returns New token with newly created proofs, token entries that had errors, and newKeys if they have changed
	 */
	async receive(encodedToken: string): Promise<ReceiveResponse> {
		const { token } = cleanToken(getDecodedToken(encodedToken));
		const tokenEntries: Array<TokenEntry> = [];
		const tokenEntriesWithError: Array<TokenEntry> = [];
		let newKeys: MintKeys | undefined;
		for (const tokenEntry of token) {
			if (!tokenEntry?.proofs?.length) {
				continue;
			}
			try {
				const {
					proofsWithError,
					proofs,
					newKeys: newKeysFromReceive
				} = await this.receiveTokenEntry(tokenEntry);
				if (proofsWithError?.length) {
					tokenEntriesWithError.push(tokenEntry);
					continue;
				}
				tokenEntries.push({ mint: tokenEntry.mint, proofs: [...proofs] });
				if (!newKeys) {
					newKeys = newKeysFromReceive;
				}
			} catch (error) {
				console.error(error);
				tokenEntriesWithError.push(tokenEntry);
			}
		}
		return {
			token: { token: tokenEntries },
			tokensWithErrors: tokenEntriesWithError.length ? { token: tokenEntriesWithError } : undefined,
			newKeys
		};
	}

	/**
	 * Receive a single cashu token entry
	 * @param tokenEntry a single entry of a cashu token
	 * @returns New token entry with newly created proofs, proofs that had errors, and newKeys if they have changed
	 */
	async receiveTokenEntry(tokenEntry: TokenEntry): Promise<ReceiveTokenEntryResponse> {
		const proofsWithError: Array<Proof> = [];
		const proofs: Array<Proof> = [];
		let newKeys: MintKeys | undefined;
		try {
			const amount = tokenEntry.proofs.reduce((total, curr) => total + curr.amount, 0);
			const { payload, blindedMessages } = this.createSplitPayload(
				amount,
				tokenEntry.proofs
			);
			const { promises } = await CashuMint.split(tokenEntry.mint, payload);
			proofs.push(...dhke.constructProofs(
				promises,
				blindedMessages.rs,
				blindedMessages.secrets,
				await this.getKeys(promises, tokenEntry.mint)
			));
			newKeys =
				tokenEntry.mint === this.mint.mintUrl
					? await this.changedKeys([...(promises || [])])
					: undefined;
		} catch (error) {
			console.error(error);
			proofsWithError.push(...tokenEntry.proofs);
		}
		return {
			proofs,
			proofsWithError: proofsWithError.length ? proofsWithError : undefined,
			newKeys
		};
	}

	/**
	 * Splits and creates sendable tokens
	 * @param amount amount to send
	 * @param proofs proofs matching that amount
	 * @returns promise of the change- and send-proofs
	 */
	async send(amount: number, proofs: Array<Proof>): Promise<SendResponse> {
		let amountAvailable = 0;
		const proofsToSend: Array<Proof> = [];
		const proofsToKeep: Array<Proof> = [];
		proofs.forEach((proof) => {
			if (amountAvailable >= amount) {
				proofsToKeep.push(proof);
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
			const { payload, blindedMessages } = this.createSplitPayload(
				amount1,
				proofsToSend
			);
			const { promises } = await this.mint.split(payload);
			const proofs = dhke.constructProofs(
				promises,
				blindedMessages.rs,
				blindedMessages.secrets,
				await this.getKeys(promises)
			);
			// sum up proofs until amount2 is reached
			const splitProofsToKeep: Array<Proof> = [];
			const splitProofsToSend: Array<Proof> = [];
			let amount2Available = 0;
			proofs.forEach((proof) => {
				if (amount2Available >= amount2) {
					splitProofsToKeep.push(proof);
					return;
				}
				amount2Available = amount2Available + proof.amount;
				splitProofsToSend.push(proof);
			});
			return {
				returnChange: [...splitProofsToKeep, ...proofsToKeep],
				send: splitProofsToSend,
				newKeys: await this.changedKeys([...(promises || [])])
			};
		}
		return { returnChange: proofsToKeep, send: proofsToSend };
	}

	async requestTokens(
		amount: number,
		hash: string
	): Promise<{ proofs: Array<Proof>; newKeys?: MintKeys }> {
		const { blindedMessages, secrets, rs } = this.createRandomBlindedMessages(amount);
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
			this._keysetId = deriveKeysetId(this.keys);
		}
	}
	private async changedKeys(
		promises: Array<SerializedBlindedSignature | Proof> = []
	): Promise<MintKeys | undefined> {
		await this.initKeys();
		if (!promises?.length) {
			return undefined;
		}
		if (!promises.some((x) => x.id !== this.keysetId)) {
			return undefined;
		}
		const maybeNewKeys = await this.mint.getKeys();
		const keysetId = deriveKeysetId(maybeNewKeys);
		return keysetId === this.keysetId ? undefined : maybeNewKeys;
	}
	private async getKeys(arr: Array<SerializedBlindedSignature>, mint?: string): Promise<MintKeys> {
		await this.initKeys();
		if (!arr?.length || !arr[0]?.id) {
			return this.keys;
		}
		const keysetId = arr[0].id;
		if (this.keysetId === keysetId) {
			return this.keys;
		}

		const keys =
			!mint || mint === this.mint.mintUrl
				? await this.mint.getKeys(arr[0].id)
				: await CashuMint.getKeys(mint, arr[0].id);
		return keys;
	}

	private createSplitPayload(
		amount: number,
		proofsToSend: Array<Proof>
	): {
		payload: SplitPayload;
		blindedMessages: BlindedTransaction;
	} {
		const totalAmount = proofsToSend.reduce((total, curr) => total + curr.amount, 0);
		const amount1BlindedMessages = this.createRandomBlindedMessages(amount);
		const amount2BlindedMessages = this.createRandomBlindedMessages(totalAmount - amount);

		// join amount1BlindedMessages and amount2BlindedMessages
		const blindedMessages: BlindedTransaction = {
			blindedMessages: [
				...amount1BlindedMessages.blindedMessages,
				...amount2BlindedMessages.blindedMessages
			],
			secrets: [...amount1BlindedMessages.secrets, ...amount2BlindedMessages.secrets],
			rs: [...amount1BlindedMessages.rs, ...amount2BlindedMessages.rs],
			amounts: [...amount1BlindedMessages.amounts, ...amount2BlindedMessages.amounts]
		};

		const allSerializedBlindedMessages: Array<SerializedBlindedMessage> = [];
		// the order of this array apparently matters if it's the other way around,
		// the mint complains that the split is not as expected
		allSerializedBlindedMessages.push(...amount1BlindedMessages.blindedMessages);
		allSerializedBlindedMessages.push(...amount2BlindedMessages.blindedMessages);

		const payload = {
			proofs: proofsToSend,
			outputs: allSerializedBlindedMessages
		};
		return { payload, blindedMessages };
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

	private createRandomBlindedMessages(
		amount: number
	): BlindedMessageData & { amounts: Array<number> } {
		const blindedMessages: Array<SerializedBlindedMessage> = [];
		const secrets: Array<Uint8Array> = [];
		const rs: Array<bigint> = [];
		const amounts = splitAmount(amount);
		for (let i = 0; i < amounts.length; i++) {
			const secret = randomBytes(32);
			secrets.push(secret);
			const { B_, r } = dhke.blindMessage(secret);
			rs.push(r);
			const blindedMessage = new BlindedMessage(amounts[i], B_);
			blindedMessages.push(blindedMessage.getSerializedBlindedMessage());
		}
		return { blindedMessages, secrets, rs, amounts };
	}
	private createBlankOutputs(feeReserve: number): BlindedMessageData {
		const blindedMessages: Array<SerializedBlindedMessage> = [];
		const secrets: Array<Uint8Array> = [];
		const rs: Array<bigint> = [];
		const count = Math.ceil(Math.log2(feeReserve)) || 1;
		for (let i = 0; i < count; i++) {
			const secret = randomBytes(32);
			secrets.push(secret);
			const { B_, r } = dhke.blindMessage(secret);
			rs.push(r);
			const blindedMessage = new BlindedMessage(0, B_);
			blindedMessages.push(blindedMessage.getSerializedBlindedMessage());
		}

		return { blindedMessages, secrets, rs };
	}
}

export { CashuWallet };
