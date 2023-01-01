import { utils } from "@noble/secp256k1";

 function splitAmount(value: number): Array<number> {
    const chunks: Array<number> = []
    for (let i = 0; i < 32; i++) {
        const mask : number = 1 << i
        if ((value & mask) !== 0) chunks.push(Math.pow(2, i))
    }
    return chunks
}

 function bytesToNumber(bytes: Uint8Array): bigint {
    return hexToNumber(utils.bytesToHex(bytes));
}

 function hexToNumber(hex: string): bigint {
    return BigInt(`0x${hex}`);
}

//used for json serialization
function bigIntStringify(key, value) {
    return typeof value === 'bigint' ? value.toString() : value
}

export {
    hexToNumber, splitAmount, bytesToNumber, bigIntStringify
}