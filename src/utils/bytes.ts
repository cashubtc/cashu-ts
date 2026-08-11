import { numberToVarBytesBE } from '@noble/curves/utils.js';

/**
 * Minimal big-endian bytes of a non-negative integer, with zero as no bytes at all.
 *
 * @remarks
 * The empty encoding of zero is the difference from noble's `numberToVarBytesBE`, which emits
 * `0x00`. The length-framed preimages that use this (NUT-02 keyset ids, NUT-20 quote messages) need
 * the empty form.
 * @throws RangeError If `value` is negative.
 */
export function minimalBytesBE(value: bigint): Uint8Array {
  if (value < 0n) throw new RangeError('value must be non-negative');
  return value === 0n ? new Uint8Array(0) : numberToVarBytesBE(value);
}
