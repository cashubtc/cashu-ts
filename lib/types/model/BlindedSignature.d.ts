import { type ProjPointType } from '@noble/curves/abstract/weierstrass';
import { type SerializedBlindedSignature } from './types/index';
import { type DLEQ } from '../crypto/common/index';
declare class BlindedSignature {
    id: string;
    amount: number;
    C_: ProjPointType<bigint>;
    dleq?: DLEQ;
    constructor(id: string, amount: number, C_: ProjPointType<bigint>, dleq?: DLEQ);
    getSerializedBlindedSignature(): SerializedBlindedSignature;
}
export { BlindedSignature };
