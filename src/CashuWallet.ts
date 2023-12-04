import { randomBytes } from '@noble/hashes/utils';
import { CashuMint } from './CashuMint.js';
import * as dhke from './DHKE.js';
import { BlindedMessage } from './model/BlindedMessage.js';
import {
	AmountPreference,
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
import {
	bytesToNumber,
	cleanToken,
	deriveKeysetId,
	getDecodedToken,
	getDefaultAmountPreference,
	splitAmount
} from './utils.js';
import { deriveBlindingFactor, deriveSecret, deriveSeedFromMnemonic } from './secrets.js';
import { validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';

/**
 * Class that represents a Cashu wallet.
 * This class should act as the entry point for this library
 */
class CashuWallet {
	private _keys: MintKeys;
	private _keysetId = '';
	private _seed: Uint8Array | undefined;
	mint: CashuMint;

	/**
	 * @param keys public keys from the mint
	 * @param mint Cashu mint instance is used to make api calls
	 * @param mnemonicOrSeed mnemonic phrase or Seed to initial derivation key for this wallets deterministic secrets. When the mnemonic is provided, the seed will be derived from it. 
	 * This can lead to poor performance, in which case the seed should be directly provided
	 */
	constructor(mint: CashuMint, keys?: MintKeys, mnemonicOrSeed?: string | Uint8Array) {
		this._keys = keys || {};
		this.mint = mint;
		if (keys) {
			this._keysetId = deriveKeysetId(this._keys);
		}
		if (!mnemonicOrSeed) {
			return
		}
		if (mnemonicOrSeed instanceof Uint8Array) {
			this._seed = mnemonicOrSeed
			return
		}
		if (!validateMnemonic(mnemonicOrSeed, wordlist)) {
			throw new Error('Tried to instantiate with mnemonic, but mnemonic was invalid');
		}
		this._seed = deriveSeedFromMnemonic(mnemonicOrSeed);
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
	 * @param counter? optionally set counter to derive secret deterministically. CashuWallet class must be initialized with seed phrase to take effect
	 */
	async payLnInvoice(
		invoice: string,
		proofsToSend: Array<Proof>,
		feeReserve?: number,
		counter?: number
	): Promise<PayLnInvoiceResponse> {
		const paymentPayload = this.createPaymentPayload(invoice, proofsToSend);
		if (!feeReserve) {
			feeReserve = await this.getFee(invoice);
		}
		const { blindedMessages, secrets, rs } = this.createBlankOutputs(feeReserve, counter);
		const payData = await this.mint.melt({
			...paymentPayload,
			outputs: blindedMessages
		});
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
	 * @param counter? optionally set counter to derive secret deterministically. CashuWallet class must be initialized with seed phrase to take effect
	 */
	payLnInvoiceWithToken(
		invoice: string,
		token: string,
		counter?: number
	): Promise<PayLnInvoiceResponse> {
		const decodedToken = getDecodedToken(token);
		const proofs = decodedToken.token
			.filter((x) => x.mint === this.mint.mintUrl)
			.flatMap((t) => t.proofs);
		return this.payLnInvoice(invoice, proofs, undefined, counter);
	}
	/**
	 * Receive an encoded Cashu token
	 * @param encodedToken Cashu token
	 * @param preference optional preference for splitting proofs into specific amounts
	 * @param counter? optionally set counter to derive secret deterministically. CashuWallet class must be initialized with seed phrase to take effect
	 * @returns New token with newly created proofs, token entries that had errors, and newKeys if they have changed
	 */
	async receive(
		encodedToken: string,
		preference?: Array<AmountPreference>,
		counter?: number
	): Promise<ReceiveResponse> {
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
				} = await this.receiveTokenEntry(tokenEntry, preference, counter);
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
	 * @param preference optional preference for splitting proofs into specific amounts.
	 * @param counter? optionally set counter to derive secret deterministically. CashuWallet class must be initialized with seed phrase to take effect
	 * @returns New token entry with newly created proofs, proofs that had errors, and newKeys if they have changed
	 */
	async receiveTokenEntry(
		tokenEntry: TokenEntry,
		preference?: Array<AmountPreference>,
		counter?: number
	): Promise<ReceiveTokenEntryResponse> {
		const proofsWithError: Array<Proof> = [];
		const proofs: Array<Proof> = [];
		let newKeys: MintKeys | undefined;
		try {
			const amount = tokenEntry.proofs.reduce((total, curr) => total + curr.amount, 0);
			if (!preference) {
				preference = getDefaultAmountPreference(amount);
			}
			const { payload, blindedMessages } = this.createSplitPayload(
				amount,
				tokenEntry.proofs,
				preference,
				counter
			);
			const { promises, error } = await CashuMint.split(tokenEntry.mint, payload);
			const newProofs = dhke.constructProofs(
				promises,
				blindedMessages.rs,
				blindedMessages.secrets,
				await this.getKeys(promises, tokenEntry.mint)
			);
			proofs.push(...newProofs);
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
	 * if no amount is specified, the amount is implied by the cumulative amount of all proofs
	 * if both amount and preference are set, but the preference cannot fulfill the amount, then we use the default split
	 * @param amount amount to send while performing the optimal split (least proofs possible). can be set to undefined if preference is set
	 * @param proofs proofs matching that amount
	 * @param preference optional preference for splitting proofs into specific amounts. overrides amount param
	 * @param counter? optionally set counter to derive secret deterministically. CashuWallet class must be initialized with seed phrase to take effect
	 * @returns promise of the change- and send-proofs
	 */
	async send(
		amount: number,
		proofs: Array<Proof>,
		preference?: Array<AmountPreference>,
		counter?: number
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
				return;
			}
			amountAvailable = amountAvailable + proof.amount;
			proofsToSend.push(proof);
		});

		if (amount > amountAvailable) {
			throw new Error('Not enough funds available');
		}
		if (amount < amountAvailable || preference) {
			const { amountKeep, amountSend } = this.splitReceive(amount, amountAvailable);
			const { payload, blindedMessages } = this.createSplitPayload(
				amountSend,
				proofsToSend,
				preference,
				counter
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
				send: splitProofsToSend,
				newKeys: await this.changedKeys([...(promises || [])])
			};
		}
		return { returnChange: proofsToKeep, send: proofsToSend };
	}

	/**
	 * Request tokens from the mint
	 * @param amount amount to request
	 * @param id id to identify the mint request*
	 * @param preference optional preference for splitting proofs into specific amounts. overrides amount param
	 * @param counter? optionally set counter to derive secret deterministically. CashuWallet class must be initialized with seed phrase to take effect
	 * @returns proofs and newKeys if they have changed
	 */
	async requestTokens(
		amount: number,
		id: string,
		AmountPreference?: Array<AmountPreference>,
		counter?: number
	): Promise<{ proofs: Array<Proof>; newKeys?: MintKeys }> {
		const { blindedMessages, secrets, rs } = this.createRandomBlindedMessages(
			amount,
			AmountPreference,
			counter
		);
		const payloads = { outputs: blindedMessages };
		const { promises } = await this.mint.mint(payloads, id);
		return {
			proofs: dhke.constructProofs(promises, rs, secrets, await this.getKeys(promises)),
			newKeys: await this.changedKeys(promises)
		};
	}

	/**
	 * Regenerates
	 * @param start set starting point for count (first cycle for each keyset should usually be 0)
	 * @param count set number of blinded messages that should be generated
	 * @returns proofs (and newKeys, if they have changed)
	 */
	async restore(
		start: number,
		count: number,
		keysetId?: string
	): Promise<{ proofs: Array<Proof>; newKeys?: MintKeys }> {
		if (!this._seed) {
			throw new Error('CashuWallet must be initialized with mnemonic to use restore');
		}
		// create blank amounts for unknown restore amounts
		const amounts = Array(count).fill(0);
		const { blindedMessages, rs, secrets } = this.createBlindedMessages(amounts, start, keysetId);

		const { outputs, promises } = await this.mint.restore({ outputs: blindedMessages });

		// Collect and map the secrets and blinding factors with the blinded messages that were returned from the mint 
		const validRs = rs.filter((r, i) => outputs.map((o) => o.B_).includes(blindedMessages[i].B_));
		const validSecrets = secrets.filter((s, i) =>
			outputs.map((o) => o.B_).includes(blindedMessages[i].B_)
		);

		return {
			proofs: dhke.constructProofs(promises, validRs, validSecrets, await this.getKeys(promises)),
			newKeys: await this.changedKeys(promises)
		};
	}

	/**
	 * Initialize the wallet with the mints public keys
	 */
	private async initKeys() {
		if (!this.keysetId || !Object.keys(this.keys).length) {
			this.keys = await this.mint.getKeys();
			this._keysetId = deriveKeysetId(this.keys);
		}
	}

	/**
	 * Check if the keysetId has changed and return the new keys
	 * @param promises array of promises to check
	 * @returns new keys if they have changed
	 */
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
				? await this.mint.getKeys(arr[0].id)
				: await CashuMint.getKeys(mint, arr[0].id);
		return keys;
	}

	/**
	 * Creates a split payload
	 * @param amount amount to send
	 * @param proofsToSend proofs to split*
	 * @param preference optional preference for splitting proofs into specific amounts. overrides amount param
	 * @param counter? optionally set counter to derive secret deterministically. CashuWallet class must be initialized with seed phrase to take effect
	 * @returns
	 */
	private createSplitPayload(
		amount: number,
		proofsToSend: Array<Proof>,
		preference?: Array<AmountPreference>,
		counter?: number
	): {
		payload: SplitPayload;
		blindedMessages: BlindedTransaction;
	} {
		const totalAmount = proofsToSend.reduce((total, curr) => total + curr.amount, 0);
		const keepBlindedMessages = this.createRandomBlindedMessages(
			totalAmount - amount,
			undefined,
			counter
		);
		if (this._seed && counter) {
			counter = counter + keepBlindedMessages.secrets.length;
		}
		const sendBlindedMessages = this.createRandomBlindedMessages(amount, preference, counter);

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
			proofs: proofsToSend,
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
	 * @param amountPreference optional preference for splitting proofs into specific amounts. overrides amount param
	 * @param counter? optionally set counter to derive secret deterministically. CashuWallet class must be initialized with seed phrase to take effect
	 * @returns blinded messages, secrets, rs, and amounts
	 */
	private createRandomBlindedMessages(
		amount: number,
		amountPreference?: Array<AmountPreference>,
		counter?: number
	): BlindedMessageData & { amounts: Array<number> } {
		const amounts = splitAmount(amount, amountPreference);
		return this.createBlindedMessages(amounts, counter);
	}

	/**
	 * Creates blinded messages for a according to @param amounts
	 * @param amount array of amounts to create blinded messages for
	 * @param counter? optionally set counter to derive secret deterministically. CashuWallet class must be initialized with seed phrase to take effect
	 * @param keyksetId? override the keysetId derived from the current mintKeys with a custom one. This should be a keyset that was fetched from the `/keysets` endpoint
	 * @returns blinded messages, secrets, rs, and amounts
	 */
	private createBlindedMessages(
		amounts: Array<number>,
		counter?: number,
		keysetId?: string
	): BlindedMessageData & { amounts: Array<number> } {
		// if we atempt to create deterministic messages without a _seed, abort.
		if (counter != undefined && !this._seed) {
			throw new Error(
				'Cannot create deterministic messages without seed. Instantiate CashuWallet with a mnemonic, or omit counter param.'
			);
		}
		const blindedMessages: Array<SerializedBlindedMessage> = [];
		const secrets: Array<Uint8Array> = [];
		const rs: Array<bigint> = [];
		for (let i = 0; i < amounts.length; i++) {
			let deterministicR = undefined;
			let secret = undefined;
			if (this._seed && counter != undefined) {
				secret = deriveSecret(this._seed, keysetId ?? this.keysetId, counter + i);
				deterministicR = bytesToNumber(
					deriveBlindingFactor(this._seed, keysetId ?? this.keysetId, counter + i)
				);
			} else {
				secret = randomBytes(32);
			}
			secrets.push(secret);
			const { B_, r } = dhke.blindMessage(secret, deterministicR);
			rs.push(r);
			const blindedMessage = new BlindedMessage(amounts[i], B_);
			blindedMessages.push(blindedMessage.getSerializedBlindedMessage());
		}
		return { blindedMessages, secrets, rs, amounts };
	}

	/**
	 * Creates NUT-08 blank outputs (fee returns) for a given fee reserve
	 * See: https://github.com/cashubtc/nuts/blob/main/08.md
	 * @param feeReserve amount to cover with blank outputs
	 * @param counter? optionally set counter to derive secret deterministically. CashuWallet class must be initialized with seed phrase to take effect
	 * @returns blinded messages, secrets, and rs
	 */
	private createBlankOutputs(feeReserve: number, counter?: number): BlindedMessageData {
		let count = Math.ceil(Math.log2(feeReserve)) || 1;
		//Prevent count from being -Infinity
		if (count < 0) {
			count = 0;
		}
		const amounts = count ? Array(count).fill(1) : [];
		const { blindedMessages, rs, secrets } = this.createBlindedMessages(amounts, counter);
		return { blindedMessages, secrets, rs };
	}
}

export { CashuWallet };
