import { CashuMint } from "./CashuMint";
import * as utils from "./utils";
import { Point, utils as ecUtils } from "@noble/secp256k1";
import * as dhke from "./DHKE";
import { encodeJsonToBase64, encodeUint8toBase64 } from "./base64";
import { Proof } from "./model/Proof";

class CashuWallet {
    keys: string
    mint: CashuMint
    constructor(keys: string, mint: CashuMint) {
        this.keys = keys
        this.mint = mint
    }

    // step1 get /mint
    async requestMint(amount: number) {
        return await this.mint.requestMint(amount)
    }

    async recieve(encodedToken: string): Promise<Array<Proof>> {

        return
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

    getEncodedProofs(proofs: Array<any>): string {
        return encodeJsonToBase64(proofs)
    }

    //step2 post /mint
    async requestTokens(amount: number, hash: string): Promise<Array<Proof>> {
        const payloads = { blinded_messages: [] }
        const secrets: Array<Uint8Array> = []
        const rs: Array<bigint> = []
        const amounts: Array<number> = utils.splitAmount(amount)
        console.log(amounts)
        for (let i = 0; i < amounts.length; i++) {
            const secret: Uint8Array = ecUtils.randomBytes(32)
            secrets.push(secret)
            const { B_, r } = await dhke.blindMessage(secret)
            rs.push(r)
            payloads.blinded_messages.push({ amount: amounts[i], B_: B_.toHex(true) })
        }
        const payloadsJson = JSON.parse(JSON.stringify({ payloads }, utils.bigIntStringify))
        console.log(payloads)
        const promises = await this.mint.mint(payloadsJson.payloads, hash)

        if (promises.error) {
            throw new Error(promises.error)
        }
        return dhke.constructProofs(promises, rs, secrets, this.keys)
    }
}

export { CashuWallet }