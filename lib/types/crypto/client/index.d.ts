import { type ProjPointType } from '@noble/curves/abstract/weierstrass';
import { type BlindSignature, type Proof, type SerializedBlindedMessage, type SerializedProof, type Witness } from '../common/index.js';
import { type PrivKey } from '@noble/curves/abstract/utils';
export type BlindedMessage = {
    B_: ProjPointType<bigint>;
    r: bigint;
    secret: Uint8Array;
    witness?: Witness;
};
export declare function createRandomBlindedMessage(privateKey?: PrivKey): BlindedMessage;
export declare function blindMessage(secret: Uint8Array, r?: bigint, privateKey?: PrivKey): BlindedMessage;
export declare function unblindSignature(C_: ProjPointType<bigint>, r: bigint, A: ProjPointType<bigint>): ProjPointType<bigint>;
export declare function constructProofFromPromise(promise: BlindSignature, r: bigint, secret: Uint8Array, key: ProjPointType<bigint>): Proof;
export declare const serializeProof: (proof: Proof) => SerializedProof;
export declare const deserializeProof: (proof: SerializedProof) => Proof;
export declare const serializeBlindedMessage: (bm: BlindedMessage, amount: number) => SerializedBlindedMessage;
