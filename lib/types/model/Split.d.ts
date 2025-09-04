import { BlindedMessage } from './BlindedMessage';
import { Proof } from './types/index';
declare class Split {
    proofs: Proof[];
    amount: number;
    outputs: BlindedMessage[];
    constructor(proofs: Proof[], amount: number, outputs: BlindedMessage[]);
    getSerializedSplit(): {
        proofs: Proof[];
        amount: number;
        outputs: {
            amount: number;
            B_: string;
        }[];
    };
}
export { Split };
