type SimpleValue = boolean | null | undefined;
export type ResultObject = {
    [key: string]: ResultValue;
};
export type ResultValue = SimpleValue | number | string | Uint8Array | ResultValue[] | ResultObject;
export type ValidDecodedType = Extract<ResultValue, ResultObject>;
export declare function encodeCBOR(value: unknown): Uint8Array;
export declare function decodeCBOR(data: Uint8Array): ResultValue;
export {};
