import { SerializedBlindedMessage, SwapPayload } from '.';
import { BlindedSignature } from '../../BlindedSignature';

export type SwapTransaction = {
	payload: SwapPayload;
	blindingData: Array<BlindingDataWithoutSignature>;
	keepVector: Array<boolean>;
};

export type BlindingData = {
	blindedMessage: SerializedBlindedMessage;
	signature: BlindedSignature;
	blindingFactor: bigint;
	secret: Uint8Array;
};

export type BlindingDataWithoutSignature = Omit<BlindingData, 'signature'>;
