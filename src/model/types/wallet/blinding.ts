import { SwapPayload } from '.';
import { BlindingData } from '../../BlindingData';

export type SwapTransaction = {
	payload: SwapPayload;
	blindingData: Array<BlindingData>;
	keepVector: Array<boolean>;
};
