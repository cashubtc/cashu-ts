import axios from "axios";
import { Proof } from "./model/Proof.js";
import { SerealizedBlindedSignature } from "./model/types/SerealizedBlinedSignature.js";

/**
 * Class represents Cashu Mint API.  
 */
class CashuMint {
    mintUrl: string
    constructor(mintHost: string, mintApiRoot?: string, mintPort?: string,) {
        if (mintPort) {
            this.mintUrl = `${mintHost}:${mintPort}`
        } else {
            this.mintUrl = mintHost
        }
        if (mintApiRoot) {
            if (mintApiRoot.charAt(0) === "/") {
                mintApiRoot = mintApiRoot.substring(1, mintApiRoot.length - 1)
            }
            this.mintUrl = `${this.mintUrl}/${mintApiRoot}`
        }
    }

    async requestMint(amount: number): Promise<{ pr: string, hash: string }> {
        const { data } = await axios.get<{ pr: string, hash: string }>(`${this.mintUrl}/mint`, {
            params: { amount }
        })
        return data
    }
    async mint(payloads: { outputs: Array<{ amount: number, B_: string }> }, paymentHash = "") {
        const { data } = await axios.post<{ promises: Array<SerealizedBlindedSignature> | { error: string } }>(`${this.mintUrl}/mint`, payloads,
            {
                params: { payment_hash: paymentHash }
            })
        return data
    }

    async getKeys(): Promise<{ [k: string]: string }> {
        const { data } = await axios.get<{ [k: string]: string }>(`${this.mintUrl}/keys`)
        return data
    }

    async getKeySets(): Promise<{ keysets: Array<string> }> {
        const { data } = await axios.get<{ keysets: Array<string> }>(`${this.mintUrl}/keysets`)
        return data
    }

    async split(splitPayload: {
        proofs: Array<Proof>,
        amount: number,
        outputs: Array<{ amount: number, B_: string }>
    }): Promise<{ fst: SerealizedBlindedSignature[], snd: SerealizedBlindedSignature[] }> {
        const { data } = await axios.post<{ fst: SerealizedBlindedSignature[], snd: SerealizedBlindedSignature[] }>(`${this.mintUrl}/split`, splitPayload)
        return data
    }
    async melt(meltPayload: { pr: string, proofs: Array<Proof> }): Promise<{ paid: boolean, preimage: string }> {
        const { data } = await axios.post<{ paid: boolean, preimage: string }>(`${this.mintUrl}/melt`, meltPayload)
        return data
    }
    async checkFees(checkfeesPayload: { pr: string }): Promise<{ fee: number }> {
        const { data } = await axios.post<{ fee: number }>(`${this.mintUrl}/checkfees`, checkfeesPayload)
        return data
    }
    async check(checkPayload: { proofs: Array<{ secret: string }> }): Promise<{ spendable: Array<boolean> }> {
        const { data } = await axios.post<{ spendable: Array<boolean> }>(`${this.mintUrl}/check`, checkPayload)
        return data
    }
}

export { CashuMint };
