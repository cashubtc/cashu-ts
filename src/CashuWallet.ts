import { randomBytes } from "@noble/hashes/utils";
import { CashuMint } from "./CashuMint.js";
import * as dhke from "./DHKE.js";
import { BlindedMessage } from "./model/BlindedMessage.js";
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
  TokenEntry,
} from "./model/types/index.js";
import {
  cleanToken,
  deriveKeysetId,
  getDecodedToken,
  getDefaultAmountPreference,
  splitAmount,
} from "./utils.js";

/**
 * Class that represents a Cashu wallet.
 * This class should act as the entry point for this library
 */
class CashuWallet {
  private _keys: MintKeys;
  private _keysetId = "";
  mint: CashuMint;

  /**
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
  async checkProofsSpent<T extends { secret: string }>(
    proofs: Array<T>,
  ): Promise<Array<T>> {
    const payload = {
      //send only the secret
      proofs: proofs.map((p) => ({ secret: p.secret })),
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
    feeReserve?: number,
  ): Promise<PayLnInvoiceResponse> {
    const paymentPayload = this.createPaymentPayload(invoice, proofsToSend);
    if (!feeReserve) {
      feeReserve = await this.getFee(invoice);
    }
    const { blindedMessages, secrets, rs } = this.createBlankOutputs(
      feeReserve,
    );
    const payData = await this.mint.melt({
      ...paymentPayload,
      outputs: blindedMessages,
    });
    return {
      isPaid: payData.paid ?? false,
      preimage: payData.preimage,
      change: payData?.change
        ? dhke.constructProofs(
          payData.change,
          rs,
          secrets,
          await this.getKeys(payData.change),
        )
        : [],
      newKeys: await this.changedKeys(payData?.change),
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
      proofs: proofs,
    };
  }
  /**
   * Use a cashu token to pay an ln invoice
   * @param invoice Lightning invoice
   * @param token cashu token
   */
  payLnInvoiceWithToken(
    invoice: string,
    token: string,
  ): Promise<PayLnInvoiceResponse> {
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
          newKeys: newKeysFromReceive,
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
      tokensWithErrors: tokenEntriesWithError.length
        ? { token: tokenEntriesWithError }
        : undefined,
      newKeys,
    };
  }

  /**
   * Receive a single cashu token entry
   * @param tokenEntry a single entry of a cashu token
   * @returns New token entry with newly created proofs, proofs that had errors, and newKeys if they have changed
   */
  async receiveTokenEntry(
    tokenEntry: TokenEntry,
  ): Promise<ReceiveTokenEntryResponse> {
    const proofsWithError: Array<Proof> = [];
    const proofs: Array<Proof> = [];
    let newKeys: MintKeys | undefined;
    try {
      const amount = tokenEntry.proofs.reduce(
        (total, curr) => total + curr.amount,
        0,
      );
      const { payload, blindedMessages } = this
        .createSplitPayload(
          getDefaultAmountPreference(amount),
          tokenEntry.proofs,
        );
      const { promises, error } = await CashuMint.split(tokenEntry.mint, payload);
      const proofs = dhke.constructProofs(
        promises,
        blindedMessages.rs,
        blindedMessages.secrets,
        await this.getKeys(promises, tokenEntry.mint),
      );
      newKeys = tokenEntry.mint === this.mint.mintUrl
        ? await this.changedKeys([...(promises || [])])
        : undefined;
    } catch (error) {
      console.error(error);
      proofsWithError.push(...tokenEntry.proofs);
    }
    return {
      proofs,
      proofsWithError: proofsWithError.length ? proofsWithError : undefined,
      newKeys,
    };
  }

  /**
   * Splits and creates sendable tokens
   * if no amount is specified, the amount is implied by the cumulative amount of all proofs
   * if both amount and preference are set, but the preference cannot fulfill the amount, then we use the default split
   * @param amount amount to send while performing the optimal split (least proofs possible). can be set to undefined if preference is set
   * @param proofs proofs matching that amount
   * @param preference optional preference for splitting proofs into specific amounts
   * @returns promise of the change- and send-proofs
   */
  async send(
    amount: number | undefined,
    proofs: Array<Proof>,
    preference?: Array<AmountPreference>,
  ): Promise<SendResponse> {
    const proofAmount = proofs.reduce((acc, curr) => acc + curr.amount, 0);
    if (!amount) {
      amount = proofAmount;
    }
    if (!preference) {
      preference = getDefaultAmountPreference(amount)
    }

    const sendAmount = preference?.reduce(
      (acc, curr) => acc + (curr.amount * curr.count),
      0,
    );

    if (sendAmount > proofAmount) {
      throw new Error("Not enough proofs provided to fulfill desired split");
    }

    let accumulatedAmount = 0;
    const proofsToSend: Array<Proof> = [];
    const change: Array<Proof> = [];
    proofs.forEach((proof) => {
      if (accumulatedAmount >= sendAmount) {
        change.push(proof);
        return;
      }
      accumulatedAmount = accumulatedAmount + proof.amount;
      proofsToSend.push(proof);
    });

    const { payload, blindedMessages } = this.createSplitPayload(
      preference,
      proofsToSend,
    );
    const { promises, error } = await this.mint.split(payload);

    const newProofs = dhke.constructProofs(
      promises,
      blindedMessages.rs,
      blindedMessages.secrets,
      await this.getKeys(promises),
    );

	const {send, returns} = this.getSplitProofs(newProofs, amount)
    return {
      returnChange: [...returns, ...change],
      send,
      newKeys: await this.changedKeys([...(promises || [])]),
    };
  }

  private getSplitProofs(proofs: Array<Proof>, amount: number) {
	const send: Array<Proof> = []
	for (const proof of proofs) {
		if (send.reduce((acc, curr)=> acc+curr.amount,0)>=amount) {
			break
		}
		send.push(proof)
	}
	const returns = proofs.filter(p=>!send.includes(p)) 
	return {send, returns}
  }

  async requestTokens(
    amount: number,
    hash: string,
    AmountPreference?: Array<AmountPreference>,
  ): Promise<{ proofs: Array<Proof>; newKeys?: MintKeys }> {
    const { blindedMessages, secrets, rs } = this.createRandomBlindedMessages(
      amount,
      AmountPreference,
    );
    const payloads = { outputs: blindedMessages };
    const { promises } = await this.mint.mint(payloads, hash);
    return {
      proofs: dhke.constructProofs(
        promises,
        rs,
        secrets,
        await this.getKeys(promises),
      ),
      newKeys: await this.changedKeys(promises),
    };
  }

  private async initKeys() {
    if (!this.keysetId || !Object.keys(this.keys).length) {
      this.keys = await this.mint.getKeys();
      this._keysetId = deriveKeysetId(this.keys);
    }
  }
  private async changedKeys(
    promises: Array<SerializedBlindedSignature | Proof> = [],
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
  private async getKeys(
    arr: Array<SerializedBlindedSignature>,
    mint?: string,
  ): Promise<MintKeys> {
    await this.initKeys();
    if (!arr?.length || !arr[0]?.id) {
      return this.keys;
    }
    const keysetId = arr[0].id;
    if (this.keysetId === keysetId) {
      return this.keys;
    }

    const keys = !mint || mint === this.mint.mintUrl
      ? await this.mint.getKeys(arr[0].id)
      : await CashuMint.getKeys(mint, arr[0].id);
    return keys;
  }

  private createSplitPayload(
    preference: Array<AmountPreference>,
    proofsToSend: Array<Proof>,
  ): {
    payload: SplitPayload;
    blindedMessages: BlindedTransaction;
  } {
    const blindedMessages = this.createRandomBlindedMessages(
      proofsToSend.reduce((acc, curr) => acc + curr.amount, 0),
      preference,
    );
    // the order of this array apparently matters if it's the other way around,
    // the mint complains that the split is not as expected

    const payload = {
      proofs: proofsToSend,
      outputs: blindedMessages.blindedMessages,
    };
    return { payload, blindedMessages };
  }

  private createRandomBlindedMessages(
    amount: number,
    amountPreference?: Array<AmountPreference>,
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
