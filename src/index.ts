import { CashuMint } from './CashuMint.js';
import { CashuWallet } from './CashuWallet.js';
import { setGlobalRequestOptions } from './request.js';
import { generateNewMnemonic, deriveSeedFromMnemonic } from './secrets.js';
import { getEncodedToken, getDecodedToken, deriveKeysetId, decodeInvoice } from './utils.js';
import { decode} from '@gandlaf21/bolt11-decode';

export * from './model/types/index.js';

/**
 * @deprecated use decodeInvoice instead
 */
const getDecodedLnInvoice = decode;

export {
	CashuMint,
	CashuWallet,
	getDecodedToken,
	getEncodedToken,
	deriveKeysetId,
	getDecodedLnInvoice,
	generateNewMnemonic,
	deriveSeedFromMnemonic,
	decodeInvoice,
	setGlobalRequestOptions
};
