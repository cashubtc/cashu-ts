import { CashuMint } from "./CashuMint";
import * as utils from "./utils";
import { utils as ecUtils } from "@noble/secp256k1";
import * as dhke from "./DHKE";
import { encodeBase64ToJson, encodeJsonToBase64 } from "./base64";
import { Proof } from "./model/Proof";
import { BlindedMessage } from "./model/BlindedMessage";

class CashuWallet {
    keys: string
    mint: CashuMint
    constructor(keys: string, mint: CashuMint) {
        this.keys = keys
        this.mint = mint
    }

    async requestMint(amount: number) {
        return await this.mint.requestMint(amount)
    }

    recieve(encodedToken: string): Array<Proof> {
        const jsonToken: Array<Proof> = encodeBase64ToJson(encodedToken)
        //todo remint tokens
        return jsonToken
    }

    send(amount: number, proofs: Array<Proof>): string {
        let amountAvailable: number
        const proofsToSend: Array<Proof> = []
        proofs.forEach(proof => {
            amountAvailable += proof.amount
            proofsToSend.push(proof)
            if (amountAvailable >= amount) {
                return
            }
        });
        if (amount > amountAvailable) {
            throw new Error("Not enough funds available");
        }
        if (amount < amountAvailable) {
            // todo re-split amounts
        }
        return this.getEncodedProofs(proofsToSend)
    }

    getEncodedProofs(proofs: Array<Proof>): string {
        return encodeJsonToBase64(proofs)
    }

    async requestTokens(amount: number, hash: string): Promise<Array<Proof>> {
        const payloads: {blinded_messages: Array<{amount: number, B_: string}>} = { blinded_messages: [] }
        const secrets: Array<Uint8Array> = []
        const rs: Array<bigint> = []
        const amounts: Array<number> = utils.splitAmount(amount)
        for (let i = 0; i < amounts.length; i++) {
            const secret: Uint8Array = ecUtils.randomBytes(32)
            secrets.push(secret)
            const { B_, r } = await dhke.blindMessage(secret)
            rs.push(r)
            const blindedMessage: BlindedMessage = new BlindedMessage(amounts[i],B_)
            payloads.blinded_messages.push(blindedMessage.getSerealizedBlindedMessage())
        }
        const payloadsJson = JSON.parse(JSON.stringify({ payloads }, utils.bigIntStringify))
        const promises = await this.mint.mint(payloadsJson.payloads, hash)
        if (promises.error) {
            throw new Error(promises.error)
        }
        return dhke.constructProofs(promises, rs, secrets, this.keys)
    }
}

export { CashuWallet }