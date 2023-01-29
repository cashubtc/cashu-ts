import axios from "axios";

/**
 * Class represents Cashu Mint API.  
 */
class CashuMint {
    mintUrl: string
    constructor(mintHost: string, mintApiRoot?: string, mintPort?: string,) {
        if (mintPort) {
            this.mintUrl = `${mintHost}:${mintPort}`
        }
        else {
            this.mintUrl = mintHost
        }
        if (mintApiRoot) {
            if (mintApiRoot.charAt(0) === '/') {
                mintApiRoot = mintApiRoot.substring(1, mintApiRoot.length - 1)
            }
            this.mintUrl = `${this.mintUrl}/${mintApiRoot}`
        }
    }

    async requestMint(amount: number) {
        const { data } = await axios.get(`${this.mintUrl}/mint`, {
            params: {
                amount
            }
        })
        return data
    }
    async mint(payloads: string, paymentHash = '') {
        const { data } = await axios.post(`${this.mintUrl}/mint`, payloads,
            {
                params: {
                    payment_hash: paymentHash
                }
            })
        return data
    }

    async getKeys() {
        const { data } = await axios.get(`${this.mintUrl}/keys`)
        return data
    }

    async getKeySets() {
        const { data } = await axios.get(`${this.mintUrl}/keysets`)
        return data
    }

    async split(splitPayload: object) {
        const { data } = await axios.post(`${this.mintUrl}/split`, splitPayload)
        return data
    }
    async melt(meltPayload: object) {
        const { data } = await axios.post(`${this.mintUrl}/melt`, meltPayload)
        return data
    }
    async checkFees(checkfeesPayload: object) {
        const { data } = await axios.post(`${this.mintUrl}/checkfees`, checkfeesPayload)
        return data
    }
    async check(checkPayload: object) {
        const { data } = await axios.post(`${this.mintUrl}/check`, checkPayload)
        return data
    }
}

export { CashuMint }