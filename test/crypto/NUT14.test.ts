import { schnorr } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/curves/utils.js';
import { describe, expect, test, vi } from 'vitest';

import { Amount, type Logger, type Proof } from '../../src';
import {
  createHTLCHash,
  createHTLCsecret,
  getHTLCWitnessPreimage,
  getPubKeyFromPrivKey,
  isHTLCSpendAuthorised,
  parseHTLCSecret,
  signP2PKProof,
  signP2PKProofs,
  verifyHTLCHash,
  verifyHTLCSpendingConditions,
} from '../../src/crypto';

const PRIVKEY = schnorr.utils.randomSecretKey();
const PUBKEY = bytesToHex(getPubKeyFromPrivKey(PRIVKEY));
const PRIVKEY2 = schnorr.utils.randomSecretKey();
const PUBKEY2 = bytesToHex(getPubKeyFromPrivKey(PRIVKEY2));

// Spy logger so pathway-specific debug messages can be asserted.
const makeLogger = (): Logger => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  log: vi.fn(),
});

describe('NUT14 module core functions', () => {
  test('createHTLCsecret creates a valid secret', () => {
    const result = createHTLCsecret('deadbeef');
    expect(result).toContain('HTLC');
  });

  test('parseHTLCSecret throws for non-HTLC type', () => {
    const secretStr = `["BAD",{"nonce":"76f5bf3e36273bf1a09006ef32d4551c07a34e218c2fc84958425ad00abdfe06","data":"028c7651fc36f8c10287833a2ad78c996febf5213dc7aab798f744f86385e28d9a"}]`;
    expect(() => {
      parseHTLCSecret(secretStr);
    }).toThrow('HTLC');
  });

  test('createHTLCHash creates consistent hash and preimage', () => {
    const { hash, preimage } = createHTLCHash();
    expect(typeof hash).toBe('string');
    expect(typeof preimage).toBe('string');
    expect(hash.length).toBe(64);
    expect(preimage.length).toBe(64);
  });

  test('createHTLCHash can take explicit preimage and still produce correct hash', () => {
    const pre = '00'.repeat(32);
    const { hash } = createHTLCHash(pre);
    const { hash: again } = createHTLCHash(pre);
    expect(hash).toBe(again);
  });

  test('verifyHTLCHash returns true for matching preimage/hash pair', () => {
    const pre = '00'.repeat(32);
    const { hash } = createHTLCHash(pre);
    expect(verifyHTLCHash(pre, hash)).toBe(true);
  });

  test('verifyHTLCHash returns false for incorrect pair', () => {
    const pre = '00'.repeat(32);
    expect(verifyHTLCHash(pre, 'ff'.repeat(32))).toBe(false);
  });

  test('verifyHTLCHash returns false for a malformed preimage (no throw)', () => {
    // A non-hex or wrong-length preimage must return false, not throw.
    for (const bad of ['not-hex', 'zz', '', 'abc', 'g'.repeat(64)]) {
      expect(verifyHTLCHash(bad, 'ff'.repeat(32))).toBe(false);
    }
  });

  test('createHTLCHash rejects a non-hex preimage with a descriptive message', () => {
    expect(() => createHTLCHash('zz')).toThrow(
      'Preimage must be a 64 character hexadecimal string (32 bytes).',
    );
  });

  test('createHTLCHash rejects a too-short preimage', () => {
    expect(() => createHTLCHash('00'.repeat(31))).toThrow('64 character hexadecimal');
  });

  test('createHTLCHash rejects hex with an invalid leading character', () => {
    // 'z' + 64 hex chars (65 total): only the leading `^` anchor rejects this.
    expect(() => createHTLCHash('z' + '00'.repeat(32))).toThrow('64 character hexadecimal');
  });

  test('createHTLCHash rejects hex with trailing junk', () => {
    // 64 hex chars + 'zz' (66 total): only the trailing `$` anchor rejects this.
    expect(() => createHTLCHash('00'.repeat(32) + 'zz')).toThrow('64 character hexadecimal');
  });
});

describe('verifyHTLCSpendingConditions and isHTLCSpendAuthorised', () => {
  test('HTLC main spending pathway', async () => {
    const proof: Proof = {
      amount: Amount.from(2),
      id: '00bfa73302d12ffd',
      secret: `["HTLC",{"nonce":"d730dd70cd7ec6e687829857de8e70aab2b970712f4dbe288343eca20e63c28c","data":"ec4916dd28fc4c10d78e287ca5d9cc51ee1ae73cbfde08c6b37324cbfaac8bc5","tags":[["pubkeys","${PUBKEY}"]]}]`,
      C: '03ff6567e2e6c31db5cb7189dab2b5121930086791c93899e4eff3dda61cb57273',
      witness: '{"preimage":"0000000000000000000000000000000000000000000000000000000000000001"}',
    };
    const signedProof = signP2PKProof(proof, bytesToHex(PRIVKEY));
    expect(isHTLCSpendAuthorised(signedProof)).toBe(true);
  });
  test('HTLC main spending pathway, no preimage (fails)', async () => {
    const proof: Proof = {
      amount: Amount.from(2),
      id: '00bfa73302d12ffd',
      secret: `["HTLC",{"nonce":"d730dd70cd7ec6e687829857de8e70aab2b970712f4dbe288343eca20e63c28c","data":"ec4916dd28fc4c10d78e287ca5d9cc51ee1ae73cbfde08c6b37324cbfaac8bc5","tags":[["pubkeys","${PUBKEY}"]]}]`,
      C: '03ff6567e2e6c31db5cb7189dab2b5121930086791c93899e4eff3dda61cb57273',
      witness: undefined,
    };
    const signedProof = signP2PKProof(proof, bytesToHex(PRIVKEY));
    expect(isHTLCSpendAuthorised(signedProof)).toBe(false);
    expect(isHTLCSpendAuthorised(proof)).toBe(false); // no sig or preimage
  });
  test('HTLC main spending pathway, incorrect preimage (fails)', async () => {
    const proof: Proof = {
      amount: Amount.from(2),
      id: '00bfa73302d12ffd',
      secret: `["HTLC",{"nonce":"d730dd70cd7ec6e687829857de8e70aab2b970712f4dbe288343eca20e63c28c","data":"ec4916dd28fc4c10d78e287ca5d9cc51ee1ae73cbfde08c6b37324cbfaac8bc5","tags":[["pubkeys","${PUBKEY}"]]}]`,
      C: '03ff6567e2e6c31db5cb7189dab2b5121930086791c93899e4eff3dda61cb57273',
      witness: '{"preimage":"1000000000000000000000000000000000000000000000000000000000000001"}',
    };
    const signedProof = signP2PKProof(proof, bytesToHex(PRIVKEY));
    expect(isHTLCSpendAuthorised(signedProof)).toBe(false);
  });
});

describe('HTLC hashlock-only receiver pathway (no pubkeys)', () => {
  // NUT-14: with no `pubkeys` tag, possession of the preimage alone spends the
  // proof. The receiver pathway is ALWAYS available, with no signature needed.
  const HASH = 'ec4916dd28fc4c10d78e287ca5d9cc51ee1ae73cbfde08c6b37324cbfaac8bc5';
  const PREIMAGE = '0000000000000000000000000000000000000000000000000000000000000001';

  const proofFor = (secret: string, preimage?: string): Proof => ({
    amount: Amount.from(2),
    id: '00bfa73302d12ffd',
    secret,
    C: '03ff6567e2e6c31db5cb7189dab2b5121930086791c93899e4eff3dda61cb57273',
    witness: preimage ? JSON.stringify({ preimage }) : undefined,
  });

  test('correct preimage authorises with no signature', () => {
    expect(isHTLCSpendAuthorised(proofFor(createHTLCsecret(HASH, []), PREIMAGE))).toBe(true);
  });

  test('successful spend yields an internally consistent result', () => {
    // With no main pubkeys the receiver path requires zero signatures, so the
    // result must not claim a signer was required (requiredSigners <= received).
    const logger = makeLogger();
    const result = verifyHTLCSpendingConditions(
      proofFor(createHTLCsecret(HASH, []), PREIMAGE),
      logger,
    );
    expect(result.success).toBe(true);
    expect(result.path).toBe('MAIN'); // hashlock (receiver) pathway stamps MAIN
    expect(result.main.pubkeys).toEqual([]);
    expect(result.main.requiredSigners).toBe(0);
    expect(result.main.receivedSigners.length).toBeGreaterThanOrEqual(result.main.requiredSigners);
    expect(logger.debug).toHaveBeenCalledWith(
      'Spending condition satisfied via hashlock (receiver) pathway',
      expect.anything(),
    );
  });

  test('wrong preimage fails with a FAILED verdict', () => {
    const wrong = '1000000000000000000000000000000000000000000000000000000000000001';
    const proof = proofFor(createHTLCsecret(HASH, []), wrong);
    expect(isHTLCSpendAuthorised(proof)).toBe(false);
    const logger = makeLogger();
    const result = verifyHTLCSpendingConditions(proof, logger);
    expect(result.success).toBe(false);
    expect(result.path).toBe('FAILED');
    expect(logger.debug).toHaveBeenCalledWith(
      'Hashlock spend failed, wrong preimage for hash',
      expect.anything(),
    );
  });

  test('no preimage fails with a FAILED verdict', () => {
    const proof = proofFor(createHTLCsecret(HASH, []));
    expect(isHTLCSpendAuthorised(proof)).toBe(false);
    const logger = makeLogger();
    const result = verifyHTLCSpendingConditions(proof, logger);
    expect(result.success).toBe(false);
    expect(result.path).toBe('FAILED');
    // The no-preimage branch must be taken, not the wrong-preimage branch.
    expect(logger.debug).toHaveBeenCalledWith(
      'Hashlock spend failed, no preimage found',
      expect.anything(),
    );
  });

  test('malformed preimage fails without throwing', () => {
    // A keyless HTLC reaches the preimage check with no signature, so a malformed
    // preimage must return false rather than throw.
    for (const bad of ['not-hex', 'zz', 'abc', 'g'.repeat(64)]) {
      expect(isHTLCSpendAuthorised(proofFor(createHTLCsecret(HASH, []), bad))).toBe(false);
    }
  });

  test('receiver pathway remains available after locktime with refund keys present', () => {
    // Expired locktime + refund key: the sender refund path opens, but the
    // receiver can still claim with the preimage (no refund signature needed).
    const secret = createHTLCsecret(HASH, [
      ['locktime', '1'],
      ['refund', PUBKEY],
    ]);
    expect(isHTLCSpendAuthorised(proofFor(secret, PREIMAGE))).toBe(true);
  });

  test('expired with no refund keys is anyone-can-spend, no preimage needed', () => {
    // Keyless HTLC, locktime in the past, no refund tag: the P2PK pathway already
    // unlocks it, so the spend succeeds as-is — the hashlock check is skipped.
    const secret = createHTLCsecret(HASH, [['locktime', '1']]);
    const result = verifyHTLCSpendingConditions(proofFor(secret)); // no preimage
    expect(result.success).toBe(true);
    expect(result.path).toBe('UNLOCKED');
  });
});

describe('getHTLCWitnessPreimage', () => {
  test('returns undefined when witness is undefined', () => {
    expect(getHTLCWitnessPreimage(undefined)).toBeUndefined();
  });

  test('returns preimage from object witness', () => {
    const w = { preimage: 'abcd' };
    expect(getHTLCWitnessPreimage(w)).toBe('abcd');
  });

  test('returns preimage from stringified witness', () => {
    const w = JSON.stringify({ preimage: 'zzzz' });
    expect(getHTLCWitnessPreimage(w)).toBe('zzzz');
  });

  test('returns undefined when preimage missing or empty', () => {
    expect(getHTLCWitnessPreimage({})).toBeUndefined();
    expect(getHTLCWitnessPreimage(JSON.stringify({}))).toBeUndefined();
  });

  test('returns undefined for an empty-string preimage', () => {
    // An empty preimage is not a valid witness: must be undefined, not ''.
    expect(getHTLCWitnessPreimage({ preimage: '' })).toBeUndefined();
    expect(getHTLCWitnessPreimage(JSON.stringify({ preimage: '' }))).toBeUndefined();
  });

  test('returns undefined and logs error when JSON parse fails', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(getHTLCWitnessPreimage('{invalid')).toBeUndefined();
    expect(spy).toHaveBeenCalledWith('Failed to parse HTLC witness string:', expect.anything());
    spy.mockRestore();
  });
});

describe('HTLC refund (sender) pathway', () => {
  const HASH = 'ec4916dd28fc4c10d78e287ca5d9cc51ee1ae73cbfde08c6b37324cbfaac8bc5';

  const keyedRefundProof = (): Proof => ({
    amount: Amount.from(2),
    id: '00bfa73302d12ffd',
    // Keyed HTLC, locktime in the past, one refund key.
    secret: createHTLCsecret(HASH, [
      ['pubkeys', PUBKEY],
      ['locktime', '1'],
      ['refund', PUBKEY2],
    ]),
    C: '03ff6567e2e6c31db5cb7189dab2b5121930086791c93899e4eff3dda61cb57273',
    witness: undefined,
  });

  test('refund signature spends after locktime without a preimage', () => {
    // Past locktime + valid refund signature: the sender reclaims via the P2PK
    // REFUND path, which passes straight through the HTLC verdict.
    const [signed] = signP2PKProofs([keyedRefundProof()], [bytesToHex(PRIVKEY2)]);
    const result = verifyHTLCSpendingConditions(signed);
    expect(result.success).toBe(true);
    expect(result.path).toBe('REFUND');
  });

  test('unsigned refund proof does not spend', () => {
    // No refund signature and no preimage: nothing authorises the spend.
    expect(isHTLCSpendAuthorised(keyedRefundProof())).toBe(false);
  });
});
