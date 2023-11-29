import { randomBytes } from '@noble/hashes/utils';
import { CashuMint } from './CashuMint.js';
import * as dhke from './DHKE.js';
import { BlindedMessage } from './model/BlindedMessage.js';
import {
	AmountPreference,
	BlindedMessageData,
	BlindedTransaction,
	MeltPayload,
	MeltQuoteResponse,
	MintKeys,
	MintKeyset,
	PayLnInvoiceResponse,
	PaymentPayload,
	PostMintPayload,
	Proof,
	ReceiveResponse,
	ReceiveTokenEntryResponse,
	RequestMintPayload,
	SendResponse,
	SerializedBlindedMessage,
	SerializedBlindedSignature,
	SplitPayload,
	TokenEntry
} from './model/types/index.js';
import {
	cleanToken,
	deriveKeysetId,
	getDecodedToken,
	getDefaultAmountPreference,
	splitAmount
} from './utils.js';

/**
 * Class that represents a Cashu wallet.
 * This class should act as the entry point for this library
 */
class CashuWallet {
	private _keys = {} as MintKeys;
	private _keysetId = '';

	mint: CashuMint;
	unit = 'sat';

	/**
	 * @param keys public keys from the mint
	 * @param mint Cashu mint instance is used to make api calls
	 */
	constructor(mint: CashuMint, keys?: MintKeys) {
		this.mint = mint;
		if (keys) {
			this._keys = keys;
			// this._keysetId = deriveKeysetId(this._keys);
			this._keysetId = keys.id;
		}
	}

	get keys(): MintKeys {
		return this._keys;
	}
	set keys(keys: MintKeys) {
		this._keys = keys;
		// this._keysetId = deriveKeysetId(this._keys);
		this._keysetId = keys.id;
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
		const requestMintPayload: RequestMintPayload = {
			unit: this.unit,
			amount: amount
		}
		return this.mint.mintQuote(requestMintPayload);
	}

	/**
	 * Requests a quote for a LN payment. Response returns amount and fees for a given LN invoice.
	 * @param invoice LN invoice that needs to get a fee estimate
	 * @returns estimated Fee
	 */
	async getMeltQuote(invoice: string): Promise<MeltQuoteResponse> {
		const meltQuote = await this.mint.meltQuote({ unit: this.unit, request: invoice });
		return meltQuote;
	}
	/**
	 * Executes a payment of an invoice on the Lightning network.
	 * The combined amount of Proofs has to match the payment amount including fees.
	 * @param invoice
	 * @param proofsToSend the exact amount to send including fees
	 * @param meltQuote melt quote for the invoice
	 */
	async payLnInvoice(
		invoice: string,
		proofsToSend: Array<Proof>,
		meltQuote?: MeltQuoteResponse
	): Promise<PayLnInvoiceResponse> {
		if (!meltQuote) {
			meltQuote = await this.mint.meltQuote({ unit: this.unit, request: invoice });
		}
		return await this.payMeltQuote(meltQuote, proofsToSend);

	}
	/**
	 * Pays an LN quote.
	 * @param meltQuote
	 * @param proofsToSend the exact amount to send including fees
	 * @returns
	 */
	async payMeltQuote(
		meltQuote: MeltQuoteResponse,
		proofsToSend: Array<Proof>
	): Promise<PayLnInvoiceResponse> {
		const { blindedMessages, secrets, rs } = this.createBlankOutputs(meltQuote.fee_reserve);
		const meltPayload: MeltPayload = {
			quote: meltQuote.quote,
			inputs: proofsToSend,
			outputs: [...blindedMessages]
		};
		const meltResponse = await this.mint.melt(meltPayload);

		return {
			isPaid: meltResponse.paid ?? false,
			preimage: meltResponse.proof,
			change: meltResponse?.change
				? dhke.constructProofs(meltResponse.change, rs, secrets, await this.getKeys(meltResponse.change))
				: []
		};
	}



	/**
	 * NOTE: This method is a helper. Should be moved. 
	 * 
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
	 * @param preference optional preference for splitting proofs into specific amounts
	 * @returns New token with newly created proofs, token entries that had errors
	 */
	async receive(encodedToken: string, preference?: Array<AmountPreference>): Promise<ReceiveResponse> {
		const { token } = cleanToken(getDecodedToken(encodedToken));
		const tokenEntries: Array<TokenEntry> = [];
		const tokenEntriesWithError: Array<TokenEntry> = [];
		for (const tokenEntry of token) {
			if (!tokenEntry?.proofs?.length) {
				continue;
			}
			try {
				const {
					proofsWithError,
					proofs,
				} = await this.receiveTokenEntry(tokenEntry, preference);
				if (proofsWithError?.length) {
					tokenEntriesWithError.push(tokenEntry);
					continue;
				}
				tokenEntries.push({ mint: tokenEntry.mint, proofs: [...proofs] });
			} catch (error) {
				console.error(error);
				tokenEntriesWithError.push(tokenEntry);
			}
		}
		return {
			token: { token: tokenEntries },
			tokensWithErrors: tokenEntriesWithError.length ? { token: tokenEntriesWithError } : undefined,
		};
	}

	/**
	 * Receive a single cashu token entry
	 * @param tokenEntry a single entry of a cashu token
	 * @param preference optional preference for splitting proofs into specific amounts.
	 * @returns New token entry with newly created proofs, proofs that had errors
	 */
	async receiveTokenEntry(tokenEntry: TokenEntry, preference?: Array<AmountPreference>): Promise<ReceiveTokenEntryResponse> {
		const proofsWithError: Array<Proof> = [];
		const proofs: Array<Proof> = [];
		try {
			const amount = tokenEntry.proofs.reduce((total, curr) => total + curr.amount, 0);
			if (!preference) {
				preference = getDefaultAmountPreference(amount)
			}
			const { payload, blindedMessages } = this.createSplitPayload(
				amount,
				tokenEntry.proofs,
				preference
			);
			const { signatures, error } = await CashuMint.split(tokenEntry.mint, payload);
			const newProofs = dhke.constructProofs(
				signatures,
				blindedMessages.rs,
				blindedMessages.secrets,
				await this.getKeys(signatures, tokenEntry.mint)
			);
			proofs.push(...newProofs);
		} catch (error) {
			console.error(error);
			proofsWithError.push(...tokenEntry.proofs);
		}
		return {
			proofs,
			proofsWithError: proofsWithError.length ? proofsWithError : undefined
		};
	}

	/**
	 * Splits and creates sendable tokens
	 * if no amount is specified, the amount is implied by the cumulative amount of all proofs
	 * if both amount and preference are set, but the preference cannot fulfill the amount, then we use the default split
	 * @param amount amount to send while performing the optimal split (least proofs possible). can be set to undefined if preference is set
	 * @param proofs proofs matching that amount
	 * @param preference optional preference for splitting proofs into specific amounts. overrides amount param
	 * @returns promise of the change- and send-proofs
	 */
	async send(
		amount: number,
		proofs: Array<Proof>,
		preference?: Array<AmountPreference>
	): Promise<SendResponse> {
		if (preference) {
			amount = preference?.reduce((acc, curr) => acc + curr.amount * curr.count, 0);
		}

		let amountAvailable = 0;
		const proofsToSend: Array<Proof> = [];
		const proofsToKeep: Array<Proof> = [];
		proofs.forEach((proof) => {
			if (amountAvailable >= amount) {
				proofsToKeep.push(proof);
				return
			}
			amountAvailable = amountAvailable + proof.amount;
			proofsToSend.push(proof);
		});

		if (amount > amountAvailable) {
			throw new Error('Not enough funds available');
		}
		if (amount < amountAvailable || preference) {
			const { amountKeep, amountSend } = this.splitReceive(amount, amountAvailable);
			const { payload, blindedMessages } = this.createSplitPayload(amountSend, proofsToSend, preference);
			const { signatures } = await this.mint.split(payload);
			const proofs = dhke.constructProofs(
				signatures,
				blindedMessages.rs,
				blindedMessages.secrets,
				await this.getKeys(signatures)
			);
			// sum up proofs until amount2 is reached
			const splitProofsToKeep: Array<Proof> = [];
			const splitProofsToSend: Array<Proof> = [];
			let amountKeepCounter = 0;
			proofs.forEach((proof) => {
				if (amountKeepCounter < amountKeep) {
					amountKeepCounter += proof.amount;
					splitProofsToKeep.push(proof);
					return;

				}
				splitProofsToSend.push(proof);
			});
			return {
				returnChange: [...splitProofsToKeep, ...proofsToKeep],
				send: splitProofsToSend
			};
		}
		return { returnChange: proofsToKeep, send: proofsToSend };
	}

	/**
	 * Request tokens from the mint
	 * @param amount amount to request
	 * @param hash hash to use to identify the request
	 * @returns proofs
	 */
	async requestTokens(
		amount: number,
		hash: string,
		AmountPreference?: Array<AmountPreference>
	): Promise<{ proofs: Array<Proof> }> {
		await this.initKeys();
		const { blindedMessages, secrets, rs } = this.createRandomBlindedMessages(
			amount,
			this.keysetId,
			AmountPreference
		);
		const postMintPayload: PostMintPayload = {
			outputs: blindedMessages,
			quote: hash
		};
		const { signatures } = await this.mint.mint(postMintPayload);
		return {
			proofs: dhke.constructProofs(signatures, rs, secrets, await this.getKeys(signatures))
		};
	}

	/**
	 * Initialize the wallet with the mints public keys
	 */
	private async initKeys() {
		if (!this.keysetId || !Object.keys(this.keys).length) {
			this.keys = await this.mint.getKeys();
			// this._keysetId = deriveKeysetId(this.keys);
			this._keysetId = this.keys.id;
		}
	}

	/**
	 * Get the mint's public keys for a given set of proofs
	 * @param arr array of proofs
	 * @param mint optional mint url
	 * @returns keys
	 */
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
				? await this.mint.getKeys(keysetId)
				: await this.mint.getKeys(keysetId, mint);

		return keys;
	}

	/**
	 * Creates a split payload
	 * @param amount1 amount to keep
	 * @param amount2 amount to send
	 * @param proofsToSend proofs to split
	 * @returns
	 */
	private createSplitPayload(
		amount: number,
		proofsToSend: Array<Proof>,
		preference?: Array<AmountPreference>
	): {
		payload: SplitPayload;
		blindedMessages: BlindedTransaction;
	} {
		const totalAmount = proofsToSend.reduce((total, curr) => total + curr.amount, 0);
		const keepBlindedMessages = this.createRandomBlindedMessages(totalAmount - amount, this.keysetId);
		const sendBlindedMessages = this.createRandomBlindedMessages(amount, this.keysetId, preference);

		// join keepBlindedMessages and sendBlindedMessages
		const blindedMessages: BlindedTransaction = {
			blindedMessages: [
				...keepBlindedMessages.blindedMessages,
				...sendBlindedMessages.blindedMessages
			],
			secrets: [...keepBlindedMessages.secrets, ...sendBlindedMessages.secrets],
			rs: [...keepBlindedMessages.rs, ...sendBlindedMessages.rs],
			amounts: [...keepBlindedMessages.amounts, ...sendBlindedMessages.amounts]
		};

		const payload = {
			inputs: proofsToSend,
			outputs: [...blindedMessages.blindedMessages]
		};
		return { payload, blindedMessages };
	}
	private splitReceive(
		amount: number,
		amountAvailable: number
	): { amountKeep: number; amountSend: number } {
		const amountKeep: number = amountAvailable - amount;
		const amountSend: number = amount;
		return { amountKeep, amountSend };
	}

	/**
	 * Creates blinded messages for a given amount
	 * @param amount amount to create blinded messages for
	 * @returns blinded messages, secrets, rs, and amounts
	 */
	private createRandomBlindedMessages(
		amount: number,
		keysetId: string,
		amountPreference?: Array<AmountPreference>
	): BlindedMessageData & { amounts: Array<number> } {
		const blindedMessages: Array<SerializedBlindedMessage> = [];
		const secrets: Array<Uint8Array> = [];
		const rs: Array<bigint> = [];
		const amounts = splitAmount(amount, amountPreference);
		for (let i = 0; i < amounts.length; i++) {
			const secret = randomBytes(32);
			secrets.push(secret);
			const { B_, r } = dhke.blindMessage(secret);
			rs.push(r);
			const blindedMessage = new BlindedMessage(amounts[i], B_, keysetId);
			blindedMessages.push(blindedMessage.getSerializedBlindedMessage());
		}
		return { blindedMessages, secrets, rs, amounts };
	}

	/**
	 * Creates NUT-08 blank outputs (fee returns) for a given fee reserve
	 * See: https://github.com/cashubtc/nuts/blob/main/08.md
	 * @param feeReserve amount to cover with blank outputs
	 * @returns blinded messages, secrets, and rs
	 */
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
			const blindedMessage = new BlindedMessage(0, B_, this.keysetId);
			blindedMessages.push(blindedMessage.getSerializedBlindedMessage());
		}

		return { blindedMessages, secrets, rs };
	}
}

export { CashuWallet };
