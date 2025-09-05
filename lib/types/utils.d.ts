import { PaymentRequest } from './model/PaymentRequest';
import { type Keys, type MintKeys, type Proof, type Token } from './model/types/index';
/**
 * Splits the amount into denominations of the provided @param keyset.
 *
 * @param value Amount to split.
 * @param keyset Keys to look up split amounts.
 * @param split? Optional custom split amounts.
 * @param order? Optional order for split amounts (default: "asc")
 * @returns Array of split amounts.
 * @throws Error if @param split amount is greater than @param value amount.
 */
export declare function splitAmount(value: number, keyset: Keys, split?: number[], order?: 'desc' | 'asc'): number[];
/**
 * Creates a list of amounts to keep based on the proofs we have and the proofs we want to reach.
 *
 * @param proofsWeHave Complete set of proofs stored (from current mint)
 * @param amountToKeep Amount to keep.
 * @param keys Keys of current keyset.
 * @param targetCount The target number of proofs to reach.
 * @returns An array of amounts to keep.
 */
export declare function getKeepAmounts(proofsWeHave: Proof[], amountToKeep: number, keys: Keys, targetCount: number): number[];
/**
 * Returns the amounts in the keyset sorted by the order specified.
 *
 * @param keyset To search in.
 * @param order Order to sort the amounts in.
 * @returns The amounts in the keyset sorted by the order specified.
 */
export declare function getKeysetAmounts(keyset: Keys, order?: 'asc' | 'desc'): number[];
/**
 * Checks if the provided amount is in the keyset.
 *
 * @param amount Amount to check.
 * @param keyset To search in.
 * @returns True if the amount is in the keyset, false otherwise.
 */
export declare function hasCorrespondingKey(amount: number, keyset: Keys): boolean;
/**
 * Converts a bytes array to a number.
 *
 * @param bytes To convert to number.
 * @returns Number.
 */
export declare function bytesToNumber(bytes: Uint8Array): bigint;
/**
 * Converts a hex string to a number.
 *
 * @param hex To convert to number.
 * @returns Number.
 */
export declare function hexToNumber(hex: string): bigint;
/**
 * Converts a number to a hex string of 64 characters.
 *
 * @param number (bigint) to conver to hex.
 * @returns Hex string start-padded to 64 characters.
 */
export declare function numberToHexPadded64(number: bigint): string;
/**
 * Checks wether a proof or a list of proofs contains a non-hex id.
 *
 * @param p Proof or list of proofs.
 * @returns Boolean.
 */
export declare function hasNonHexId(p: Proof | Proof[]): boolean;
export declare function bigIntStringify<T>(_key: unknown, value: T): string | T;
/**
 * Helper function to encode a v3 cashu token.
 *
 * @param token To encode.
 * @returns Encoded token.
 */
export declare function getEncodedTokenV3(token: Token, removeDleq?: boolean): string;
/**
 * Helper function to encode a cashu token (defaults to v4 if keyset id allows it)
 *
 * @param token
 * @param [opts]
 */
export declare function getEncodedToken(token: Token, opts?: {
    version?: 3 | 4;
    removeDleq?: boolean;
}): string;
export declare function getEncodedTokenV4(token: Token, removeDleq?: boolean): string;
/**
 * Helper function to decode cashu tokens into object.
 *
 * @param token An encoded cashu token (cashuAey...)
 * @returns Cashu token object.
 */
export declare function getDecodedToken(token: string): Token;
/**
 * Helper function to decode different versions of cashu tokens into an object.
 *
 * @param token An encoded cashu token (cashuAey...)
 * @returns Cashu Token object.
 */
export declare function handleTokens(token: string): Token;
/**
 * Recomputes the ID for the provided keyset and verifies it matches the ID provided by the Mint.
 *
 * @param keys The keyset to be verified.
 * @returns True if the verification succeeded, false otherwise.
 */
export declare function verifyKeysetId(keys: MintKeys): boolean;
/**
 * Returns the keyset id of a set of keys.
 *
 * @param keys Keys object to derive keyset id from.
 * @returns
 */
export declare function deriveKeysetId(keys: Keys): string;
export declare function mergeUInt8Arrays(a1: Uint8Array, a2: Uint8Array): Uint8Array;
export declare function sortProofsById(proofs: Proof[]): Proof[];
export declare function isObj(v: unknown): v is object;
export declare function checkResponse(data: {
    error?: string;
    detail?: string;
}): void;
export declare function joinUrls(...parts: string[]): string;
export declare function sanitizeUrl(url: string): string;
export declare function sumProofs(proofs: Proof[]): number;
export declare function decodePaymentRequest(paymentRequest: string): PaymentRequest;
export declare class MessageNode {
    private _value;
    private _next;
    get value(): string;
    set value(message: string);
    get next(): MessageNode | null;
    set next(node: MessageNode | null);
    constructor(message: string);
}
export declare class MessageQueue {
    private _first;
    private _last;
    get first(): MessageNode | null;
    set first(messageNode: MessageNode | null);
    get last(): MessageNode | null;
    set last(messageNode: MessageNode | null);
    private _size;
    get size(): number;
    set size(v: number);
    constructor();
    enqueue(message: string): boolean;
    dequeue(): string | null;
}
/**
 * Removes all traces of DLEQs from a list of proofs.
 *
 * @param proofs The list of proofs that dleq should be stripped from.
 */
export declare function stripDleq(proofs: Proof[]): Array<Omit<Proof, 'dleq'>>;
/**
 * Checks that the proof has a valid DLEQ proof according to keyset `keys`
 *
 * @param proof The proof subject to verification.
 * @param keyset The Mint's keyset to be used for verification.
 * @returns True if verification succeeded, false otherwise.
 * @throws Error if @param proof does not match any key in @param keyset.
 */
export declare function hasValidDleq(proof: Proof, keyset: MintKeys): boolean;
/**
 * Helper function to encode a cashu auth token authA.
 *
 * @param proof
 */
export declare function getEncodedAuthToken(proof: Proof): string;
export declare function getEncodedTokenBinary(token: Token): Uint8Array;
export declare function getDecodedTokenBinary(bytes: Uint8Array): Token;
