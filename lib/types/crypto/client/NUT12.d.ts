import { type DLEQ } from '../common/index';
import { type ProjPointType } from '@noble/curves/abstract/weierstrass';
export declare const verifyDLEQProof: (dleq: DLEQ, B_: ProjPointType<bigint>, C_: ProjPointType<bigint>, A: ProjPointType<bigint>) => boolean;
export declare const verifyDLEQProof_reblind: (secret: Uint8Array, // secret
dleq: DLEQ, C: ProjPointType<bigint>, // unblinded e-cash signature point
A: ProjPointType<bigint>) => boolean;
