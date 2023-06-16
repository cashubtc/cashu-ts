import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";
export const getChunks = (data: string, nonce = 0, chunkSize = 200): Array<string> => {
        const CHUNK_SIZE = 200
        const chunks = data.match(new RegExp('.{1,' + CHUNK_SIZE + '}', 'g'))??[];
        const constructedChunks  = chunks.map((c,i) => `!${bytesToHex(sha256(data)).substring(0,4)}:${nonce}:${i}:${chunks.length-1}:${c}`)
        const longest = Math.max(...constructedChunks.map(c=> c.length))
        for (let i = 0; i < constructedChunks.length; i++) {
            constructedChunks[i] = constructedChunks[i].padEnd(longest, "=")
        }
        return constructedChunks
}


export const assembleChunks = (chunks: Array<string>): string => {
    const tokenChunks = chunks.map(c => parseChunk(c))
    tokenChunks.sort((a,b)=> a.chunkIndex - b.chunkIndex)
    return tokenChunks.map(c=> c.data).join('')
}

const parseChunk = (chunk: string): Chunk => {
    const split = chunk.split(':')
    return {
        jobId: split[0],
        nonce: parseInt(split[1]),
        chunkIndex: parseInt(split[2]),
        totalChunks: parseInt(split[3]),
        data: split[4]
    }
}

type Chunk = {
    jobId: string
    nonce: number
    chunkIndex: number
    totalChunks: number
    data: string
}