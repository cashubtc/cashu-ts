import { Proof } from '../Proof.js'

export type MintKeys = { [k: number]: string }


export type MeltPayload = { pr: string, proofs: Array<Proof> }

export type MeltResponse = { paid: boolean, preimage: string }

export type SplitPayload = {
    proofs: Array<Proof>,
    amount: number,
    outputs: Array<SerealizedBlindedMessage>
}

export type SplitResponse = {
    fst: SerealizedBlindedSignature[],
    snd: SerealizedBlindedSignature[]
}

export type requestMintResponse = {
    pr: string,
    hash: string
}

export type CheckSpendableResponse = { spendable: Array<boolean> }

export type SerealizedBlindedMessage = {
    amount: number,
    B_: string
}

export type SerealizedBlindedSignature = {
    id: string
    amount: number
    C_: string
}

export type Token = {
    proofs: Array<Proof>,
    mints: Array<{ url: string, ids: Array<string> }>
}

export type BlindedTransaction = {
    blindedMessages: SerealizedBlindedMessage[]
    secrets: Uint8Array[]
    rs: bigint[]
    amounts: number[]
}