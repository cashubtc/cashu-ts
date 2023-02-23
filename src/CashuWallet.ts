import { CashuMint } from "./CashuMint.js";
import { bigIntStringify, getDecodedProofs, splitAmount } from "./utils.js";
import { utils as ecUtils } from "@noble/secp256k1";
import * as dhke from "./DHKE.js";
import { encodeBase64ToJson } from "./base64.js";
import { Proof } from "./model/Proof.js";
import { BlindedMessage } from "./model/BlindedMessage.js";
import { decode } from "@gandlaf21/bolt11-decode";

/**
 * Class that represents a Cashu wallet.
 */
class CashuWallet {
    keys: object
    mint: CashuMint

    /**
     * 
     * @param keys public keys from the mint
     * @param mint Cashu mint instance is used to make api calls
     */
    constructor(keys: { [k: string]: string }, mint: CashuMint) {
        this.keys = keys
        this.mint = mint
    }

    /**
     * returns proofs that are already spent (use for keeping wallet state clean)
     * @param proofs 
     * @returns 
     */
    async checkProofsSpent(proofs: Array<Proof>): Promise<Proof[]> {
        const payload = {
            //send only the secret
            proofs: proofs.map((p) => { return { secret: p.secret } })
        }
        const { spendable } = await this.mint.check(payload)
        //return only the proofs that are NOT spendable
        return proofs.filter((p,i)=>!spendable[i])
    }

    async requestMint(amount: number) {
        return await this.mint.requestMint(amount)
    }

    /**
     * Executes a payment of an invoice on the Lightning network. 
     * The combined amount of Proofs has to match the payment amount including fees.
     * @param invoice 
     * @param proofsToSend the exact amount to send including fees
     * @returns 
     */
    async payLnInvoice(invoice: string, proofsToSend: Array<Proof>) {
        const paymentPayload: any = this.createPaymentPayload(invoice, proofsToSend)
        const payData = await this.mint.melt(paymentPayload)
        return { isPaid: payData.paid ?? false, preimage: payData.preimage }
    }

    async getFee(invoice: string): Promise<number> {
        const { fee }: { fee: number } = await this.mint.checkFees({ pr: invoice })
        return fee
    }

    static getDecodedLnInvoice(invoice: string) {
        return decode(invoice)
    }

    createPaymentPayload(invoice: string, proofs: Array<Proof>) {
        const payload = {
            pr: invoice,
            proofs: proofs
        }
        return payload
    }

    async payLnInvoiceWithToken(invoice: string, token: string) {
        return this.payLnInvoice(invoice, encodeBase64ToJson(token))
    }

    async receive(encodedToken: string): Promise<Array<Proof>> {
        const { proofs } = getDecodedProofs(encodedToken)
        const amount = proofs.reduce((total, curr) => total + curr.amount, 0)
        const { payload, amount1BlindedMessages, amount2BlindedMessages } = await this.createSplitPayload(0, amount, proofs)
        const { fst, snd } = await this.mint.split(payload)
        if(!fst || !snd) { return [] }
        const proofs1: Array<Proof> = dhke.constructProofs(fst, amount1BlindedMessages.rs, amount1BlindedMessages.secrets, this.keys)
        const proofs2: Array<Proof> = dhke.constructProofs(snd, amount2BlindedMessages.rs, amount2BlindedMessages.secrets, this.keys)
        const newProofs: Array<Proof> = [...proofs1,...proofs2]
        return newProofs
    }

    async send(amount: number, proofs: Array<Proof>): Promise<{ returnChange: Array<Proof>, send: Array<Proof> }> {
        let amountAvailable = 0
        const proofsToSend: Array<Proof> = []
        proofs.forEach(proof => {
            if (amountAvailable >= amount) {
                return
            }
            amountAvailable = amountAvailable + proof.amount
            proofsToSend.push(proof)
        });
        if (amount > amountAvailable) {
            throw new Error("Not enough funds available");
        }
        if (amount < amountAvailable) {
            const { amount1, amount2 } = this.splitReceive(amount, amountAvailable)
            const { payload, amount1BlindedMessages, amount2BlindedMessages } = await this.createSplitPayload(amount1, amount2, proofsToSend)
            const { fst, snd } = await this.mint.split(payload)
            const proofs1 = dhke.constructProofs(fst, amount1BlindedMessages.rs, amount1BlindedMessages.secrets, this.keys)
            const proofs2 = dhke.constructProofs(snd, amount2BlindedMessages.rs, amount2BlindedMessages.secrets, this.keys)
            return { returnChange: proofs1, send: proofs2 }
        }
        return { returnChange: [], send: proofsToSend }
    }

    async requestTokens(amount: number, hash: string): Promise<Array<Proof>> {
        const { blindedMessages, secrets, rs } = await this.createRandomBlindedMessages(amount)
        const payloads: { outputs: Array<{ amount: number, B_: string }> } = { outputs: blindedMessages }
        const payloadsJson = JSON.parse(JSON.stringify({ payloads }, bigIntStringify))
        const { promises } = await this.mint.mint(payloadsJson.payloads, hash)
        if (promises.error) {
            throw new Error(promises.error)
        }
        return dhke.constructProofs(promises, rs, secrets, this.keys)
    }


    //keep amount 1 send amount 2
    private async createSplitPayload(amount1: number, amount2: number, proofsToSend: Array<Proof>) {
        const amount1BlindedMessages = await this.createRandomBlindedMessages(amount1)
        const amount2BlindedMessages = await this.createRandomBlindedMessages(amount2)
        const allBlindedMessages = []
        // the order of this array aparently matters if it's the other way around,
        // the mint complains that the split is not as expected
        allBlindedMessages.push(...amount1BlindedMessages.blindedMessages)
        allBlindedMessages.push(...amount2BlindedMessages.blindedMessages)

        const payload = {
            proofs: proofsToSend,
            amount: amount2,
            outputs: allBlindedMessages
        }
        return { payload, amount1BlindedMessages, amount2BlindedMessages }
    }
    //keep amount 1 send amount 2
    private splitReceive(amount: number, amountAvailable: number) {
        const amount1: number = amountAvailable - amount
        const amount2: number = amount
        return { amount1, amount2 }
    }



    private async createRandomBlindedMessages(amount: number) {
        const blindedMessages: Array<{ amount: number, B_: string }> = []
        const secrets: Array<Uint8Array> = []
        const rs: Array<bigint> = []
        const amounts: Array<number> = splitAmount(amount)
        for (let i = 0; i < amounts.length; i++) {
            const secret: Uint8Array = ecUtils.randomBytes(32)
            secrets.push(secret)
            const { B_, r } = await dhke.blindMessage(secret)
            rs.push(r)
            const blindedMessage: BlindedMessage = new BlindedMessage(amounts[i], B_)
            blindedMessages.push(blindedMessage.getSerealizedBlindedMessage())
        }
        return { blindedMessages, secrets, rs, amounts }
    }
}

export { CashuWallet }