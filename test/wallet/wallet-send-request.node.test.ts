import { describe, expect, test, vi } from 'vitest';

import {
  Amount,
  OutputData,
  PaymentRequest,
  Wallet,
  attachHTLCPreimage,
  bytesToHex,
  createBlindSignature,
  createDLEQProof,
  createHTLCHash,
  createNewMintKeys,
  getPubKeyFromPrivKey,
  hexToBytes,
  isP2PKSpendAuthorised,
  pointFromHex,
  serializeMintKeys,
  verifyHTLCSpendingConditions,
  verifyReceivedProofs,
  type SerializedBlindedMessage,
} from '../../src';

import { mintInfoResp, mintUrl, unit } from './_setup';

const mintKeys = createNewMintKeys(2, new Uint8Array(32).fill(5), { versionByte: 0 });
const keys = serializeMintKeys(mintKeys.pubKeys);
const id = mintKeys.keysetId;
const payerKey = '1'.padStart(64, '0');
const payerPubkey = bytesToHex(getPubKeyFromPrivKey(hexToBytes(payerKey)));
const request = new PaymentRequest({ amount: 1, unit });

function signOutput(output: SerializedBlindedMessage) {
  const mintKey = mintKeys.privKeys[output.amount.toString()];
  const B_ = pointFromHex(output.B_);
  const { e, s } = createDLEQProof(B_, mintKey);
  return {
    id: output.id,
    amount: output.amount,
    C_: createBlindSignature(B_, mintKey, output.id).C_.toHex(true),
    dleq: { e: bytesToHex(e), s: bytesToHex(s) },
  };
}

const signedProof = (output: OutputData) =>
  output.toProof(signOutput(output.blindedMessage), { id, keys });

function makeWallet() {
  const wallet = new Wallet(mintUrl, { unit, secretsPolicy: 'random' });
  wallet.loadMintFromCache(mintInfoResp, {
    mintUrl,
    savedAt: Date.now(),
    keysets: [{ id, unit, active: true, input_fee_ppk: 0, keys }],
  });
  const swap = vi.spyOn(wallet.mint, 'swap').mockImplementation(async ({ outputs }) => ({
    signatures: outputs.map(signOutput),
  }));
  return { wallet, swap };
}

describe('sendToRequest with legacy inputs', () => {
  test.each(['P2PK', 'HTLC'] as const)('swaps selected %s inputs before sending', async (kind) => {
    const { wallet, swap } = makeWallet();
    const { hash, preimage } = createHTLCHash();
    let input = signedProof(
      OutputData.createSingleP2PKData({ kind, data: kind === 'P2PK' ? payerPubkey : hash }, 1, id),
    );
    if (kind === 'HTLC') input = attachHTLCPreimage([input], preimage)[0];

    const { send, keep } = await wallet.ops.sendToRequest(request, [input]).privkey(payerKey).run();

    expect(swap).toHaveBeenCalledOnce();
    const spent = swap.mock.calls[0][0].inputs[0];
    expect(
      kind === 'P2PK' ? isP2PKSpendAuthorised(spent) : verifyHTLCSpendingConditions(spent).success,
    ).toBe(true);
    expect(keep).toEqual([]);
    expect(send).toHaveLength(1);
    expect(send[0].secret).not.toBe(input.secret);
    expect(wallet.isPaymentRequestSatisfied(request, send)).toBe(true);
    const verified = await verifyReceivedProofs(send, () => ({ id, keys }), { require: true });
    expect(verified.invalid).toEqual([]);
    expect(verified.valid).toEqual(send);
  });

  test('forwards selected bearer proofs without a swap', async () => {
    const { wallet, swap } = makeWallet();
    const input = signedProof(OutputData.createRandomData(1, { id, keys })[0]);

    const { send } = await wallet.ops.sendToRequest(request, [input]).run();

    expect(send).toEqual([input]);
    expect(swap).not.toHaveBeenCalled();
    expect(wallet.isPaymentRequestSatisfied(request, send)).toBe(true);
  });

  test('does not swap because an unselected input is locked', async () => {
    const { wallet, swap } = makeWallet();
    const input = signedProof(OutputData.createRandomData(1, { id, keys })[0]);
    const locked = signedProof(
      OutputData.createSingleP2PKData({ kind: 'P2PK', data: payerPubkey }, Amount.from(2), id),
    );

    const { send, keep } = await wallet.ops.sendToRequest(request, [input, locked]).run();

    expect(send).toEqual([input]);
    expect(keep).toEqual([locked]);
    expect(swap).not.toHaveBeenCalled();
  });
});
