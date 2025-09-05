import { type ProjPointType } from '@noble/curves/abstract/weierstrass';
import { type BlindSignature, type IntRange, type Keyset, type MintKeys, type Proof } from '../common/index';
export type KeysetPair = {
    keysetId: string;
    pubKeys: MintKeys;
    privKeys: MintKeys;
};
export type KeysetWithKeys = Keyset & {
    pubKeys: MintKeys;
};
export declare function createBlindSignature(B_: ProjPointType<bigint>, privateKey: Uint8Array, amount: number, id: string): BlindSignature;
export declare function getPubKeyFromPrivKey(privKey: Uint8Array): Uint8Array<ArrayBufferLike>;
export declare function createNewMintKeys(pow2height: IntRange<0, 65>, seed?: Uint8Array): KeysetPair;
export declare function verifyProof(proof: Proof, privKey: Uint8Array): boolean;
