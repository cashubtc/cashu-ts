import { type CurvePoint, pointToHex } from '../crypto/core';

import { Amount, type AmountLike } from './Amount';
import { type SerializedBlindedMessage } from './types/index';

class BlindedMessage {
  private readonly amountValue: Amount;
  B_: CurvePoint;
  id: string;
  constructor(amount: AmountLike, B_: CurvePoint, id: string) {
    this.amountValue = Amount.from(amount);
    this.B_ = B_;
    this.id = id;
  }

  get amount(): Amount {
    return this.amountValue;
  }

  getSerializedBlindedMessage(): SerializedBlindedMessage {
    return { amount: this.amountValue, B_: pointToHex(this.B_), id: this.id };
  }
}
export { BlindedMessage };
