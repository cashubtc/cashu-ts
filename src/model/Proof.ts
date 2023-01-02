class Proof {
    id: string
    amount: number
    secret: string
    C: string
    constructor(id: string, amount: number, secret: string, C: string) {
        this.id = id
        this.amount = amount
        this.secret = secret
        this.C = C
    }
}

export { Proof }