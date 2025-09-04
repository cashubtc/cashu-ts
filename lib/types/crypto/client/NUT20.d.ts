import { SerializedBlindedMessage } from '../../model/types';
export declare function signMintQuote(privkey: string, quote: string, blindedMessages: SerializedBlindedMessage[]): string;
export declare function verifyMintQuoteSignature(pubkey: string, quote: string, blindedMessages: SerializedBlindedMessage[], signature: string): boolean;
