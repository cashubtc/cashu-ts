import { type Proof } from '../../model/types/index';
import { type BlindedMessage } from '../client/index';
export declare const verifyP2PKSig: (proof: Proof) => boolean;
export declare const verifyP2PKSigOutput: (output: BlindedMessage, publicKey: string) => boolean;
