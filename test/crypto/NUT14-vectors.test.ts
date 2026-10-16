import { bytesToHex } from '@noble/hashes/utils.js';
import { describe, expect, test } from 'vitest';

import { Amount } from '../../src';
import {
  buildP2PKSigAllMessageV1,
  hashP2PKSigAllMessageV1,
  isHTLCSpendAuthorised,
  schnorrVerifyDigest,
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

  // From tests/11-test.md (HTLC), which holds every SIG_ALL vector.
  test('SIG_ALL swap vector: message, digest, signature and spend', () => {
    const sigAllSecret = `["HTLC",{"nonce":"e72b0dbe91e3c17f0680b0a2ecf407f5e237d00d311313b33bcd77f957087e56","data":"${HASHLOCK}","tags":[["pubkeys","${PUB}"],["sigflag","SIG_ALL"]]}]`;
    const sigAllSig =
      'f1119822def46095e5f673826336e4c2138f0b7ef62fa0d4b3a59b9b43db6113a7e0ac02e96d59bdbbc7bbc8ebeecddcfd46c872fccc359a41392c758442801c';
    const proof = {
      ...mkProof(sigAllSecret, `{"preimage":"${PREIMAGE}","signatures":["${sigAllSig}"]}`),
      id: '01b8afe98cfccddc07e53fe5f081657f729c322266a1fda00937d27bba3cdf6a82',
      C: '026c32214e4c4d286ff26be59ee705de8c5155885155c57d1bc44033713f0f6d1a',
    };
    const outputs = [
      {
        blindedMessage: {
          amount: Amount.from(8),
          id: '01b8afe98cfccddc07e53fe5f081657f729c322266a1fda00937d27bba3cdf6a82',
          B_: '027c9a3f3dae60a2967dfc3aeea06535fff329cbc196842ecc12a5fb66a2eb9087',
        },
      },
      {
        blindedMessage: {
          amount: Amount.from(2),
          id: '01b8afe98cfccddc07e53fe5f081657f729c322266a1fda00937d27bba3cdf6a82',
          B_: '03cd583efc731edcab6935e0a817cec65851ace7ca842396422ff2c0e9db9c49bc',
        },
      },
    ];

    const msg = buildP2PKSigAllMessageV1([proof], outputs);
    expect(msg.length).toBe(397);
    const digest = hashP2PKSigAllMessageV1(msg);
    expect(bytesToHex(digest)).toBe(
      '955548adebe2142b84498625885e2d205208b9983ec7152b75dc72454bf8b4a0',
    );
    expect(schnorrVerifyDigest(sigAllSig, digest, PUB)).toBe(true);
    expect(isHTLCSpendAuthorised(proof, undefined, digest)).toBe(true);
  });
});
