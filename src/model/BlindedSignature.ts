import { Point } from "@noble/secp256k1"
import { SerealizedBlindedSignature } from "./types/SerealizedBlinedSignature.js"

class BlindedSignature {
    id: string
    amount: number
    C_: Point

    constructor(id: string, amount: number, C_: Point) {
        this.id = id
        this.amount = amount
        this.C_ = C_
    }

    getSerealizedBlindedSignature(): SerealizedBlindedSignature{
        return {id: this.id, amount: this.amount, C_: this.C_.toHex(true)}
    }
}

export { BlindedSignature }