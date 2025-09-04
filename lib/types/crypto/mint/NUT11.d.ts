import { Proof } from '../../model/types/index';
import { BlindedMessage } from '../client/index';
export declare const verifyP2PKSig: (proof: Proof) => boolean;
export declare const verifyP2PKSigOutput: (output: BlindedMessage, publicKey: string) => boolean;
