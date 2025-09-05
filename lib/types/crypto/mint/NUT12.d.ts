import { type DLEQ } from '../common/index';
import { type ProjPointType } from '@noble/curves/abstract/weierstrass';
/**
 * !!! WARNING !!! Not recommended for production use, due to non-constant time operations See:
 * https://github.com/cashubtc/cashu-crypto-ts/pull/2 for more details See:
 * https://en.wikipedia.org/wiki/Timing_attack for information about timing attacks.
 */
export declare const createDLEQProof: (B_: ProjPointType<bigint>, a: Uint8Array) => DLEQ;
