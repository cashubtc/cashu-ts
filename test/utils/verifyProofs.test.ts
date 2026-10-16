import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import { describe, expect, test } from 'vitest';

import { Amount, type Proof } from '../../src';
import {
  blindMessage,
  constructUnblindedSignature,
  createBlindSignature,
  createDLEQProof,
  getPubKeyFromPrivKey,
  pointFromBytes,
} from '../../src/crypto';
import { CallerAbortError, CTSError } from '../../src/model/Errors';
import {
  hasValidDleq,
  hexToNumber,
  numberToHexPadded64,
  verifyMintSignatures,
  verifyReceivedProofs,
} from '../../src/utils';

const privkey = hexToBytes('1'.padStart(64, '0'));
const pubkey = pointFromBytes(getPubKeyFromPrivKey(privkey));
const secret = new TextEncoder().encode('fakeSecret');
const r = hexToNumber('123456'.padStart(64, '0'));
const blinded = blindMessage(secret, r);
const dleq = createDLEQProof(blinded.B_, privkey);
const unblinded = constructUnblindedSignature(
  createBlindSignature(blinded.B_, privkey, '00'),
  r,
  secret,
  pubkey,
);
const good: Proof = {
  id: '00',
  amount: Amount.from(1),
  C: unblinded.C.toHex(true),
  secret: new TextDecoder().decode(unblinded.secret),
  dleq: { r: numberToHexPadded64(r), e: bytesToHex(dleq.e), s: bytesToHex(dleq.s) },
};
const { dleq: _omit, ...noDleq } = good;
void _omit;
const keyset = { id: '00', unit: 'sat', keys: { [1]: pubkey.toHex(true) } };
const lookup = () => keyset;

async function split<T extends Proof>(
  proofs: T[],
  opts?: Parameters<typeof verifyMintSignatures>[2],
) {
  const r = await verifyMintSignatures(proofs, lookup, opts);
  expect(r.valid.length + r.invalid.length).toBe(proofs.length);
  return r;
}

describe('verifyMintSignatures (v4)', () => {
  test('agrees with hasValidDleq on valid, tampered and missing DLEQs', async () => {
    const tampered = { ...good, dleq: { ...good.dleq!, e: '00'.repeat(32) } };
    const { valid, invalid } = await split([good, tampered, noDleq as Proof]);
    expect(valid).toEqual([good, noDleq]);
    expect(invalid.map((i) => i.proof)).toEqual([tampered]);
    expect(invalid[0].error.message).toMatch(/invalid DLEQ.*keyset 00, amount 1/);
    expect(hasValidDleq(tampered, keyset)).toBe(false);
  });

  test('require: true matches hasValidDleq default on a missing DLEQ', async () => {
    const { invalid } = await split([noDleq as Proof], { require: true });
    expect(invalid[0].error.message).toMatch(/invalid or missing DLEQ/);
    expect(hasValidDleq(noDleq as Proof, keyset)).toBe(false);
  });

  test('a DLEQ with no r is invalid, not absent', async () => {
    const { r: _r, ...partial } = good.dleq!;
    void _r;
    const { invalid } = await split([{ ...good, dleq: partial }]);
    expect(invalid).toHaveLength(1);
  });

  test('reports lookup, keyless, denomination and amount failures without throwing', async () => {
    const badAmount = { ...good, amount: 'x' } as unknown as Proof;
    const wrongDenom = { ...good, amount: Amount.from(2) };
    const r1 = await verifyMintSignatures([good, badAmount, wrongDenom], lookup);
    expect(r1.valid).toEqual([good]);
    expect(r1.invalid.map((i) => i.error.message)).toEqual([
      expect.stringMatching(/Invalid amount x/),
      expect.stringMatching(/Undefined key for amount 2 in keyset 00/),
    ]);
    const keyless = await verifyMintSignatures([good], () => ({ id: '00', keys: {} }));
    expect(keyless.invalid[0].error.message).toBe('No keys loaded for keyset 00');
    const thrown = await verifyMintSignatures([good], () => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw 'offline';
    });
    expect(thrown.invalid[0].error).toBeInstanceOf(CTSError);
    expect(thrown.invalid[0].error.message).toBe('offline');
    const thrownError = await verifyMintSignatures([good], () => {
      throw new Error('not here');
    });
    expect(thrownError.invalid[0].error.message).toBe('not here');
  });

  test('a well-formed but wrong DLEQ is invalid', async () => {
    const wrong = { ...good, dleq: { ...good.dleq!, e: '11'.repeat(32) } };
    const { invalid } = await split([wrong]);
    expect(invalid.map((i) => i.proof)).toEqual([wrong]);
  });

  test('a malformed DLEQ payload is invalid, never an unhandled throw', async () => {
    const { invalid } = await split([{ ...good, dleq: { ...good.dleq!, s: 'zz' } }]);
    expect(invalid).toHaveLength(1);
  });

  test('chunks with progress, and verifyReceivedProofs gives the same result', async () => {
    const seen: number[] = [];
    const many = Array.from({ length: 70 }, () => good);
    const r = await split(many, { chunkSize: 32, onProgress: (d) => seen.push(d) });
    expect(r.valid).toHaveLength(70);
    expect(seen[seen.length - 1]).toBe(70);
    expect(seen.every((d, i) => i === 0 || d >= seen[i - 1])).toBe(true);
    const received = await verifyReceivedProofs(many, lookup);
    expect(received.valid).toHaveLength(70);
  });

  test.each([NaN, 0, -1, 1.5])('rejects chunkSize %s', async (chunkSize) => {
    await expect(verifyMintSignatures([good], lookup, { chunkSize })).rejects.toThrow('chunkSize');
  });

  test.each([NaN, Infinity, -1])('rejects budgetMs %s', async (budgetMs) => {
    await expect(verifyMintSignatures([good], lookup, { budgetMs })).rejects.toThrow('budgetMs');
  });

  test('rejects over the batch cap and on an aborted signal', async () => {
    await expect(
      verifyMintSignatures(
        Array.from({ length: 10_001 }, () => good),
        lookup,
      ),
    ).rejects.toThrow(/too many proofs/);
    const ac = new AbortController();
    ac.abort();
    await expect(
      verifyMintSignatures([good], lookup, { signal: ac.signal }),
    ).rejects.toBeInstanceOf(CallerAbortError);
  });

  test('empty input is an empty report', async () => {
    expect(await verifyMintSignatures([], lookup)).toEqual({ valid: [], invalid: [] });
  });
});
