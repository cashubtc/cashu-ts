/**
 * This error is thrown when a HTTP response is not 2XX nor a protocol error.
 */
export declare class HttpResponseError extends Error {
    status: number;
    constructor(message: string, status: number);
}
/**
 * This error is thrown when a network request fails.
 */
export declare class NetworkError extends Error {
    constructor(message: string);
}
/**
 * This error is thrown when a [protocol
 * error](https://github.com/cashubtc/nuts/blob/main/00.md#errors) occurs. See error codes
 * [here](https://github.com/cashubtc/nuts/blob/main/error_codes.md).
 */
export declare class MintOperationError extends HttpResponseError {
    code: number;
    constructor(code: number, detail: string);
}
