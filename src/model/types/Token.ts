import { Proof } from '../Proof.js';

export type Token = { proofs: Array<Proof>, mints: Array<{ url: string, ids: Array<string> }> }