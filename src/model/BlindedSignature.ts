import { bytesToHex } from '@noble/hashes/utils.js';

import { type CurvePoint, pointToHex, type DLEQ } from '../crypto';
import { numberToHexPadded64 } from '../utils';

import { Amount, type AmountLike } from './Amount';
import { type SerializedBlindedSignature } from './types/index';

class BlindedSignature {
  id: string;
  amount: Amount;
  C_: CurvePoint;
  dleq?: DLEQ;

  constructor(id: string, amount: AmountLike, C_: CurvePoint, dleq?: DLEQ) {
    this.id = id;
    this.amount = Amount.from(amount);
    this.C_ = C_;
    this.dleq = dleq;
  }

  getSerializedBlindedSignature(): SerializedBlindedSignature {
    return {
      id: this.id,
      amount: this.amount,
      C_: pointToHex(this.C_),
      ...(this.dleq && {
        dleq: {
          s: bytesToHex(this.dleq.s),
          e: bytesToHex(this.dleq.e),
          r: numberToHexPadded64(this.dleq.r ?? BigInt(0)),
        },
      }),
    };
  }
}

export { BlindedSignature };
