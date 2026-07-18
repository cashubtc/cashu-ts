import { describe, expect, test } from 'vitest';

import { Amount } from '../../src';
import {
  buildP2PKSigAllMessageV1,
  computeMessageDigest,
  isHTLCSpendAuthorised,
  schnorrVerifyMessage,
} from '../../src/crypto';
import { type Proof } from '../../src/model/types';

// NUT-14 test vectors from cashubtc/nuts tests/14-test.md. Signing key is the
// well-known test key (privkey 0x...01); all hashlocks commit to the
// all-zeros-then-one preimage.
const PUB = '0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const PREIMAGE = '0000000000000000000000000000000000000000000000000000000000000001';
const HASHLOCK = 'ec4916dd28fc4c10d78e287ca5d9cc51ee1ae73cbfde08c6b37324cbfaac8bc5';

describe('NUT-14 spec vectors', () => {
  const sigInputsSecret = `["HTLC",{"nonce":"5d11913ee0f92fefdc82a6764fd2457a1585d418f0265b5575eb14cd3be76d94","data":"${HASHLOCK}","tags":[["pubkeys","${PUB}"],["sigflag","SIG_INPUTS"]]}]`;
  const sigInputsSig =
    '8d6da34f529edccdb6a5d2122f16293b01b38263e58733acca0ff6595515224f69b80c0933f96a729899249bc7c1a5f34efcb7cf4347f1135625449bae51f86b';

  const mkProof = (secret: string, witness: string): Proof => ({
    amount: Amount.from(8),
    id: '009a1f293253e41e',
    secret,
    C: '02698c4e2b5f9534cd0687d87513c759790cf829aa5739184a3e3735471fbda904',
    witness,
  });

  test('valid preimage and signature is spendable', () => {
    const proof = mkProof(
      sigInputsSecret,
      `{"preimage":"${PREIMAGE}","signatures":["${sigInputsSig}"]}`,
    );
    expect(isHTLCSpendAuthorised(proof)).toBe(true);
  });

  test('wrong preimage is not spendable, regardless of the signature', () => {
    const wrongPreimage = PREIMAGE.slice(0, 63) + '2';
    const proof = mkProof(
      sigInputsSecret,
      `{"preimage":"${wrongPreimage}","signatures":["${sigInputsSig}"]}`,
    );
    expect(isHTLCSpendAuthorised(proof)).toBe(false);
  });

  test('keyless hashlock is spendable with the preimage alone', () => {
    const keylessSecret = `["HTLC",{"nonce":"09ef07c284bcda9a413723b8bb5d1a4bbee0e9564ba91e0d5e2b2a1071ab5c53","data":"${HASHLOCK}"}]`;
    const proof = mkProof(keylessSecret, `{"preimage":"${PREIMAGE}"}`);
    expect(isHTLCSpendAuthorised(proof)).toBe(true);
  });

  test('SIG_ALL swap vector: message, digest, signature and spend', () => {
    const sigAllSecret = `["HTLC",{"nonce":"da62796403af76c80cd6ce9153ed3746","data":"${HASHLOCK}","tags":[["pubkeys","${PUB}"],["sigflag","SIG_ALL"]]}]`;
    const sigAllSig =
      '5df34ba9ea8097b5c89c475d24e2feb5dd816c7486ad1a4f2f3afeef808f82a469859bc9075ab1bc1735e47b87f600301172f4ed5ba3feca80e13771d6f6fe6f';
    const proof = mkProof(sigAllSecret, `{"preimage":"${PREIMAGE}","signatures":["${sigAllSig}"]}`);
    const outputs = [
      {
        blindedMessage: {
          amount: Amount.from(8),
          id: '009a1f293253e41e',
          B_: '035015e6d7ade60ba8426cefaf1832bbd27257636e44a76b922d78e79b47cb689d',
        },
      },
      {
        blindedMessage: {
          amount: Amount.from(2),
          id: '009a1f293253e41e',
          B_: '0288d7649652d0a83fc9c966c969fb217f15904431e61a44b14999fabc1b5d9ac6',
        },
      },
    ];

    const msg = buildP2PKSigAllMessageV1([proof], outputs);
    expect(msg.length).toBe(386);
    expect(computeMessageDigest(msg, true)).toBe(
      'cd1a10eadc41f679104b542aee828ba22390fff80ac29747504c51a118792a58',
    );
    expect(schnorrVerifyMessage(sigAllSig, msg, PUB)).toBe(true);
    expect(isHTLCSpendAuthorised(proof, undefined, msg)).toBe(true);
  });
});
