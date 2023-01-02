import { Buffer } from "buffer";

function encodeUint8toBase64(uint8array: Uint8Array): string {
    return  Buffer.from(uint8array).toString("base64")    
}

function encodeBase64toUint8(base64String: string): Uint8Array {
    return  Buffer.from(base64String,"base64")   
}

function encodeJsonToBase64(jsonObj: any): string {
    const jsonString: string = JSON.stringify(jsonObj)
    return  Buffer.from(jsonString).toString('base64')
}

function encodeBase64ToJson(base64String: string): any {
    const jsonString = Buffer.from(base64String,'base64').toString()
    const jsonObj: any = JSON.parse(jsonString)
    return  jsonObj
}


export {
    encodeUint8toBase64,
    encodeBase64toUint8,
    encodeJsonToBase64,
    encodeBase64ToJson
}