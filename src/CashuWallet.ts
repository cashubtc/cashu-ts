import { CashuMint } from "./CashuMint";
import * as utils from "./utils";
import { Point, utils as ecUtils } from "@noble/secp256k1";
import * as dhke from "./DHKE";
import { encodeJsonToBase64, encodeUint8toBase64 } from "./base64";

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
    
    getEncodedProofs(proofs: Array<any>): string {
        return encodeJsonToBase64(proofs)
    }

    //step2 post /mint
    async requestTokens(amount: number, hash: string) {
        const payloads = {blinded_messages : []}
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
        return this._constructProofs(promises, rs, secrets)
    }

    private _constructProofs(promises, rs, secrets) {
        return promises.map((p, i) => {
            const C_: Point = Point.fromHex(p["C_"])
            const A: Point = Point.fromHex(this.keys[p.amount])
            const C: Point = dhke.unblindSignature(C_, rs[i], A)
            return {
                id: p.id,
                amount: p.amount,
                C: C.toHex(true),
                secret: encodeUint8toBase64(secrets[i])
            }
        })
    }
}

export { CashuWallet }