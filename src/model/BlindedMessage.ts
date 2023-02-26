import { Point } from "@noble/secp256k1"
import { SerealizedBlindedMessage } from './types/index.js'

class BlindedMessage {
    amount: number
    B_: Point
    constructor(amount: number, B_: Point) {
        this.amount = amount
        this.B_ = B_
    }
    getSerealizedBlindedMessage(): SerealizedBlindedMessage {
        return { amount: this.amount, B_: this.B_.toHex(true) }
    }
}
export { BlindedMessage }
