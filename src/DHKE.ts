import { utils, Point } from "@noble/secp256k1";
import { encodeUint8toBase64 } from "./base64.js";
import { Proof } from "./model/Proof.js";
import { SerealizedBlindedSignature } from "./model/types/SerealizedBlinedSignature.js";
import { bytesToNumber } from "./utils.js";

async function hashToCurve(secret: Uint8Array): Promise<Point> {
    let point: Point
    while (!point) {
        const hash: Uint8Array = await utils.sha256(secret)
        const hashHex: string = utils.bytesToHex(hash)
        const pointX: string = '02' + hashHex
        try {
            point = Point.fromHex(pointX)
        } catch (error) {
            secret = await utils.sha256(secret)
        }
    }
    return point
}


async function blindMessage(secret: Uint8Array, r?: bigint): Promise<{ B_: Point, r: bigint }> {
    const secretMessageBase64 = encodeUint8toBase64(secret)
    const secretMessage = new TextEncoder().encode(secretMessageBase64)
    const Y: Point = await hashToCurve(secretMessage)
    if (!r) {
        r = bytesToNumber(utils.randomPrivateKey())
    }
    const rG: Point = Point.BASE.multiply(r)
    const B_: Point = Y.add(rG)
    return { B_, r }
}

function unblindSignature(C_: Point, r: bigint, A: Point): Point {
    const C: Point = C_.subtract(A.multiply(r))
    return C
}

function constructProofs(promises: Array<SerealizedBlindedSignature>, rs: Array<bigint>, secrets: Array<Uint8Array>, keys: any): Array<Proof> {
    return promises.map((p: SerealizedBlindedSignature, i: number) => {
        const C_: Point = Point.fromHex(p.C_)
        const A: Point = Point.fromHex(keys[p.amount])
        const C: Point = unblindSignature(C_, rs[i], A)
        const proof = new Proof(p.id, p.amount, encodeUint8toBase64(secrets[i]), C.toHex(true))
        return proof
    })
}

export {
    hashToCurve,
    blindMessage,
    unblindSignature,
    constructProofs
}