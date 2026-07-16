import { bytesToHex, hexToBytes } from '@noble/curves/utils.js';
import { test, describe, expect } from 'vitest';

import { Amount, type MintKeys, type Keys, type Proof, type Token, Keyset } from '../../src';
import {
  blindMessage,
  constructUnblindedSignature,
  createDLEQProof,
  pointFromBytes,
  createBlindSignature,
  getPubKeyFromPrivKey,
  getG2PubKeyFromPrivKey,
} from '../../src/crypto';
import { CTSError } from '../../src/model/Errors';
import * as utils from '../../src/utils';
import {
  bigIntStringify,
  getKeysetAmounts,
  hasValidDleq,
  hexToNumber,
  invoiceHasAmountInHRP,
  numberToHexPadded64,
  serializeProofs,
  deserializeProofs,
  normalizeProofAmounts,
  sortProofsById,
  normalizeUrl,
} from '../../src/utils';
import {
  NUT02_V1_VECTOR1_KEYS,
  NUT02_V1_VECTOR2_KEYS,
  NUT02_V2_VECTOR1_KEYS,
  NUT02_V2_VECTOR2_KEYS,
  NUT02_V2_VECTOR3_KEYS,
  NUT02_V3_VECTOR1_KEYS,
  NUT02_V3_VECTOR2_KEYS,
  PUBKEYS,
} from '../consts';

const keys: Keys = {};
for (let i = 1; i <= 2048; i *= 2) {
  keys[i] = 'deadbeef';
}

const keys_base10: Keys = {};
for (let i = 1; i <= 10000; i *= 10) {
  keys_base10[i] = 'deadbeef';
}

const keys_base16: Keys = {};
for (let i = 1; i <= 0x10000; i *= 16) {
  keys_base16[i] = 'deadbeef';
}

describe('test split amounts ', () => {
  test('testing amount 2561', async () => {
    const chunks = utils.splitAmount(2561, keys);
    expect(chunks.map((a) => a.toNumber())).toStrictEqual([2048, 512, 1]);
  });
  test('testing amount 0', async () => {
    const chunks = utils.splitAmount(0, keys);
    expect(chunks.map((a) => a.toNumber())).toStrictEqual([]);
  });

  test('accepts AmountLike value and split entries', async () => {
    const chunks = utils.splitAmount(Amount.from(10), keys, ['1', 1n, Amount.from(2), 2, 2, 2n]);
    expect(chunks.map((a) => a.toNumber())).toStrictEqual([1, 1, 2, 2, 2, 2]);
  });
});

describe('test split custom amounts ', () => {
  const fiveToOne = [1, 1, 1, 1, 1];
  test('testing amount 5', async () => {
    const chunks = utils.splitAmount(5, keys, fiveToOne);
    expect(chunks.map((a) => a.toNumber())).toStrictEqual([1, 1, 1, 1, 1]);
  });
  const tenToOneAndTwo = [1, 1, 2, 2, 2, 2];
  test('testing amount 10', async () => {
    const chunks = utils.splitAmount(10, keys, tenToOneAndTwo);
    expect(chunks.map((a) => a.toNumber())).toStrictEqual([1, 1, 2, 2, 2, 2]);
  });
  test('testing amount 12', async () => {
    const chunks = utils.splitAmount(12, keys, tenToOneAndTwo);
    expect(chunks.map((a) => a.toNumber())).toStrictEqual([1, 1, 2, 2, 2, 2, 2]);
  });
  const fiveTwelve = [512];
  test('testing amount 518', async () => {
    const chunks = utils.splitAmount(518, keys, fiveTwelve, 'desc');
    expect(chunks.map((a) => a.toNumber())).toStrictEqual([512, 4, 2]);
  });
  const tooMuch = [512, 512];
  test('testing amount 512 but split too much', async () => {
    expect(() => utils.splitAmount(512, keys, tooMuch)).toThrow();
  });
  const illegal = [3, 3];
  test('testing non pow2', async () => {
    expect(() => utils.splitAmount(6, keys, illegal)).toThrow();
  });
  const empty: number[] = [];
  test('testing empty', async () => {
    const chunks = utils.splitAmount(5, keys, empty, 'desc');
    expect(chunks.map((a) => a.toNumber())).toStrictEqual([4, 1]);
  });
  const undef = undefined;
  test('testing undefined', async () => {
    const chunks = utils.splitAmount(5, keys, undef);
    expect(chunks.map((a) => a.toNumber())).toStrictEqual([4, 1]);
  });
});

describe('test split different key amount', () => {
  test('testing amount 68251', async () => {
    const chunks = utils.splitAmount(68251, keys_base10, undefined, 'desc');
    expect(chunks.map((a) => a.toNumber())).toStrictEqual([
      10000, 10000, 10000, 10000, 10000, 10000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 1000, 100,
      100, 10, 10, 10, 10, 10, 1,
    ]);
  });
  test('testing amount 1917', async () => {
    const chunks = utils.splitAmount(1917, keys_base16);
    expect(chunks.map((a) => a.toNumber())).toStrictEqual([
      256, 256, 256, 256, 256, 256, 256, 16, 16, 16, 16, 16, 16, 16, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1,
      1, 1, 1,
    ]);
  });
});

describe('test splitAmount zero handling', () => {
  test('value=0 and split of zeros passes through unchanged', () => {
    const chunks = utils.splitAmount(0, keys, [0, 0, 0]);
    expect(chunks.map((a) => a.toNumber())).toStrictEqual([0, 0, 0]);
  });

  test('value=0 with nonzero split throws', () => {
    expect(() => utils.splitAmount(0, keys, [2])).toThrow(/Split is greater than total amount/);
  });

  test('positive value ignores zeros in split', () => {
    const chunks = utils.splitAmount(5, keys, [0, 1, 4, 0]);
    // zeros are ignored, result is same as [1,4]
    expect(chunks.map((a) => a.toNumber())).toStrictEqual([1, 4]);
  });

  test('all zeros with positive value falls back to normal fill', () => {
    const chunks = utils.splitAmount(5, keys, [0, 0]);
    // should behave same as no custom split: [4,1]
    expect(chunks.map((a) => a.toNumber())).toStrictEqual([4, 1]);
  });
});

describe('test bigint stringify', () => {
  test('JSON.stringify replacer converts bigint values to strings', () => {
    const payload = {
      amount: 123n,
      nested: {
        total: 456n,
        label: 'ok',
      },
      list: [1n, 'two', 3],
    };

    const encoded = JSON.stringify(payload, bigIntStringify);

    expect(encoded).toBe(
      '{"amount":"123","nested":{"total":"456","label":"ok"},"list":["1","two",3]}',
    );
  });
});

test('exact custom split preserves order', () => {
  const chunks = utils.splitAmount(32, keys, [8, 4, 8, 2, 8, 2]);
  expect(chunks.map((a) => a.toNumber())).toStrictEqual([8, 4, 8, 2, 8, 2]);
});

describe('test decode token', () => {
  test('testing v3 Token', async () => {
    const obj = {
      proofs: [
        {
          C: '02195081e622f98bfc19a05ebe2341d955c0d12588c5948c858d07adec007bc1e4',
          amount: Amount.from(1),
          id: '009a1f293253e41e',
          secret: '97zfmmaGf5k8Mg0gajpnbmpervTtEeE8wwKri7rWpUs=',
        },
      ],
      mint: 'http://localhost:3338',
      unit: 'sat',
    };
    const uriPrefixes = ['web+cashu://', 'cashu://', 'cashu:'];
    uriPrefixes.forEach((prefix) => {
      const token =
        prefix +
        'cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHA6Ly9sb2NhbGhvc3Q6MzMzOCIsInByb29mcyI6W3siaWQiOiIwMDlhMWYyOTMyNTNlNDFlIiwiYW1vdW50IjoxLCJzZWNyZXQiOiI5N3pmbW1hR2Y1azhNZzBnYWpwbmJtcGVydlR0RWVFOHd3S3JpN3JXcFVzPSIsIkMiOiIwMjE5NTA4MWU2MjJmOThiZmMxOWEwNWViZTIzNDFkOTU1YzBkMTI1ODhjNTk0OGM4NThkMDdhZGVjMDA3YmMxZTQifV19XX0';

      const result = utils.getDecodedToken(token, ['009a1f293253e41e']);
      expect(result).toStrictEqual(obj);
    });
  });
  test('testing v3 Token no prefix', async () => {
    const obj = {
      proofs: [
        {
          C: '02195081e622f98bfc19a05ebe2341d955c0d12588c5948c858d07adec007bc1e4',
          amount: Amount.from(1),
          id: '009a1f293253e41e',
          secret: '97zfmmaGf5k8Mg0gajpnbmpervTtEeE8wwKri7rWpUs=',
        },
      ],
      mint: 'http://localhost:3338',
      unit: 'sat',
    };

    const token =
      'AeyJ0b2tlbiI6W3sibWludCI6Imh0dHA6Ly9sb2NhbGhvc3Q6MzMzOCIsInByb29mcyI6W3siaWQiOiIwMDlhMWYyOTMyNTNlNDFlIiwiYW1vdW50IjoxLCJzZWNyZXQiOiI5N3pmbW1hR2Y1azhNZzBnYWpwbmJtcGVydlR0RWVFOHd3S3JpN3JXcFVzPSIsIkMiOiIwMjE5NTA4MWU2MjJmOThiZmMxOWEwNWViZTIzNDFkOTU1YzBkMTI1ODhjNTk0OGM4NThkMDdhZGVjMDA3YmMxZTQifV19XX0';
    const result = utils.getDecodedToken(token, ['009a1f293253e41e']);
    expect(result).toStrictEqual(obj);
  });
  test('v3 Token with a legacy base64 keyset id throws on decode', () => {
    // Pre-2024 fixture: proofs carry the base64 keyset id 'I2yN+iRYfkzT'.
    const token =
      'cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHA6Ly9sb2NhbGhvc3Q6MzMzOCIsInByb29mcyI6W3siaWQiOiJJMnlOK2lSWWZrelQiLCJhbW91bnQiOjEsInNlY3JldCI6Ijk3emZtbWFHZjVrOE1nMGdhanBuYm1wZXJ2VHRFZUU4d3dLcmk3cldwVXM9IiwiQyI6IjAyMTk1MDgxZTYyMmY5OGJmYzE5YTA1ZWJlMjM0MWQ5NTVjMGQxMjU4OGM1OTQ4Yzg1OGQwN2FkZWMwMDdiYzFlNCJ9XX1dfQ';
    expect(() => utils.getDecodedToken(token, ['009a1f293253e41e'])).toThrow(
      /legacy base64 keyset IDs/,
    );
  });
  test('testing v4 Token', () => {
    const v3Token = {
      memo: 'Thank you',
      unit: 'sat',
      mint: 'http://localhost:3338',
      proofs: [
        {
          secret: '9a6dbb847bd232ba76db0df197216b29d3b8cc14553cd27827fc1cc942fedb4e',
          C: '038618543ffb6b8695df4ad4babcde92a34a96bdcd97dcee0d7ccf98d472126792',
          id: '00ad268c4d1f5826',
          amount: Amount.from(1),
        },
      ],
    };

    const token =
      'cashuBpGF0gaJhaUgArSaMTR9YJmFwgaNhYQFhc3hAOWE2ZGJiODQ3YmQyMzJiYTc2ZGIwZGYxOTcyMTZiMjlkM2I4Y2MxNDU1M2NkMjc4MjdmYzFjYzk0MmZlZGI0ZWFjWCEDhhhUP_trhpXfStS6vN6So0qWvc2X3O4NfM-Y1HISZ5JhZGlUaGFuayB5b3VhbXVodHRwOi8vbG9jYWxob3N0OjMzMzhhdWNzYXQ=';

    const result = utils.getDecodedToken(token, ['009a1f293253e41e']);
    expect(result).toStrictEqual(v3Token);
  });
  test('testing v4 Token with multi keyset', () => {
    const v3Token = {
      unit: 'sat',
      mint: 'http://localhost:3338',
      proofs: [
        {
          secret: 'acc12435e7b8484c3cf1850149218af90f716a52bf4a5ed347e48ecc13f77388',
          C: '0244538319de485d55bed3b29a642bee5879375ab9e7a620e11e48ba482421f3cf',
          id: '00ffd48b8f5ecf80',
          amount: Amount.from(1),
        },
        {
          secret: '1323d3d4707a58ad2e23ada4e9f1f49f5a5b4ac7b708eb0d61f738f48307e8ee',
          C: '023456aa110d84b4ac747aebd82c3b005aca50bf457ebd5737a4414fac3ae7d94d',
          id: '00ad268c4d1f5826',
          amount: Amount.from(2),
        },
        {
          secret: '56bcbcbb7cc6406b3fa5d57d2174f4eff8b4402b176926d3a57d3c3dcbb59d57',
          C: '0273129c5719e599379a974a626363c333c56cafc0e6d01abe46d5808280789c63',
          id: '00ad268c4d1f5826',
          amount: Amount.from(1),
        },
      ],
    };

    const token =
      'cashuBo2F0gqJhaUgA_9SLj17PgGFwgaNhYQFhc3hAYWNjMTI0MzVlN2I4NDg0YzNjZjE4NTAxNDkyMThhZjkwZjcxNmE1MmJmNGE1ZWQzNDdlNDhlY2MxM2Y3NzM4OGFjWCECRFODGd5IXVW-07KaZCvuWHk3WrnnpiDhHki6SCQh88-iYWlIAK0mjE0fWCZhcIKjYWECYXN4QDEzMjNkM2Q0NzA3YTU4YWQyZTIzYWRhNGU5ZjFmNDlmNWE1YjRhYzdiNzA4ZWIwZDYxZjczOGY0ODMwN2U4ZWVhY1ghAjRWqhENhLSsdHrr2Cw7AFrKUL9Ffr1XN6RBT6w659lNo2FhAWFzeEA1NmJjYmNiYjdjYzY0MDZiM2ZhNWQ1N2QyMTc0ZjRlZmY4YjQ0MDJiMTc2OTI2ZDNhNTdkM2MzZGNiYjU5ZDU3YWNYIQJzEpxXGeWZN5qXSmJjY8MzxWyvwObQGr5G1YCCgHicY2FtdWh0dHA6Ly9sb2NhbGhvc3Q6MzMzOGF1Y3NhdA==';

    const result = utils.getDecodedToken(token, ['009a1f293253e41e']);
    expect(result).toStrictEqual(v3Token);
  });
  test('testing NUT-28 example V4 token (nuts tests/28-tests.md)', () => {
    // Pins the V4 wire format of the P2BK fields: `pe` (33-byte bstr) and `d` {e,s,r}
    const token =
      'cashuBo2FtdWh0dHA6Ly9sb2NhbGhvc3Q6MzMzOGF1Y3NhdGF0gaJhaUgAmh8pMlPkHmFwgqVhYRhAYXN4q1siUDJQSyIseyJub25jZSI6ImQ0YTE3YTg4ZjVkMGMwOTAwMWY3YjQ1M2M0MmMxZjlkNWE4NzM2M2IxZjY2MzdhNWE4M2ZjMzFhNmEzYjcyNjYiLCJkYXRhIjoiMDNiN2MwM2ViMDVhMGE1MzljZmM0MzhlODFiY2YzOGI2NWI3YmI4Njg1ZTg3OTBmOWI4NTNiZmUzZDc3YWQ1MzE1IiwidGFncyI6W119XWFjWCEDgYVd3MQ0qakLNWTynveOcnH4VE0AVnY7QYsA6IUlwP9hZKNhZVggI_IZCxi_0EPTpSYQPhX0qTjWRqa_k7AX4rt8heFUCzJhc1ggYXiXhFbELu6O77UIMPwxRr4nsFYZ8E40kNxZYAXwzHhhclgg0mpVqjnKUJV_2vVANrAQU7DeQgSLlqb7KhZ-A_ANCg9icGVYIQKozaTPRIv86ankbliMBuoXgPy5Tju98yd_QpldQDqLDKVhYRhAYXN5AWNbIkhUTEMiLHsibm9uY2UiOiI4YjFmMThhYTg1YTI3ODc5MDNjZmRjNzc2ZmRlMGI4NTU1YmRiMTI2ZWVhMDJiMDVjZDg0ZGUwNmE0ZjRiNTUxIiwiZGF0YSI6ImVjNDkxNmRkMjhmYzRjMTBkNzhlMjg3Y2E1ZDljYzUxZWUxYWU3M2NiZmRlMDhjNmIzNzMyNGNiZmFhYzhiYzUiLCJ0YWdzIjpbWyJwdWJrZXlzIiwiMDM1MmZiNmQ5MzM2MGI3YzI1MzhlZWRmM2M4NjFmMzJlYTU4ODNmY2VlYzlmM2U1NzNkOWQ4NDM3NzQyMGRhODM4Il0sWyJsb2NrdGltZSIsIjE2ODk0MTgzMjkiXSxbInJlZnVuZCIsIjAzNjY3MzYxY2E5MjUwNjVkY2FmZWEwYTcwNWJhNDllNzViZGQ3OTc1NzUxZmNjOTMzZTA1OTUzNDYzYzc5ZmZmMSJdXX1dYWNYIQJwq6CYySCtr6HOdazvsG2MxUHvgCcPcMx7ZjdbeJ7ZvmFko2FlWCCexbbyCVqNx9BSoA4LsFCsleYz5wJXVjDP1Dy1hZLSoWFzWCC9btB5uVQVGJjK2sOMO40zccINZ-jF8GrzzuQVKsMXtGFyWCDoNJz4jlqfAl8Acr-KLbSNOUutn3vj2AI_nukN4cGSTWJwZVghAqjNpM9Ei_zpqeRuWIwG6heA_LlOO73zJ39CmV1AOosM';
    const expected = {
      unit: 'sat',
      mint: 'http://localhost:3338',
      proofs: [
        {
          secret:
            '["P2PK",{"nonce":"d4a17a88f5d0c09001f7b453c42c1f9d5a87363b1f6637a5a83fc31a6a3b7266","data":"03b7c03eb05a0a539cfc438e81bcf38b65b7bb8685e8790f9b853bfe3d77ad5315","tags":[]}]',
          C: '0381855ddcc434a9a90b3564f29ef78e7271f8544d0056763b418b00e88525c0ff',
          id: '009a1f293253e41e',
          amount: Amount.from(64),
          dleq: {
            r: 'd26a55aa39ca50957fdaf54036b01053b0de42048b96a6fb2a167e03f00d0a0f',
            s: '6178978456c42eee8eefb50830fc3146be27b05619f04e3490dc596005f0cc78',
            e: '23f2190b18bfd043d3a526103e15f4a938d646a6bf93b017e2bb7c85e1540b32',
          },
          p2pk_e: '02a8cda4cf448bfce9a9e46e588c06ea1780fcb94e3bbdf3277f42995d403a8b0c',
        },
        {
          secret:
            '["HTLC",{"nonce":"8b1f18aa85a2787903cfdc776fde0b8555bdb126eea02b05cd84de06a4f4b551","data":"ec4916dd28fc4c10d78e287ca5d9cc51ee1ae73cbfde08c6b37324cbfaac8bc5","tags":[["pubkeys","0352fb6d93360b7c2538eedf3c861f32ea5883fceec9f3e573d9d84377420da838"],["locktime","1689418329"],["refund","03667361ca925065dcafea0a705ba49e75bdd7975751fcc933e05953463c79fff1"]]}]',
          C: '0270aba098c920adafa1ce75acefb06d8cc541ef80270f70cc7b66375b789ed9be',
          id: '009a1f293253e41e',
          amount: Amount.from(64),
          dleq: {
            r: 'e8349cf88e5a9f025f0072bf8a2db48d394bad9f7be3d8023f9ee90de1c1924d',
            s: 'bd6ed079b954151898cadac38c3b8d3371c20d67e8c5f06af3cee4152ac317b4',
            e: '9ec5b6f2095a8dc7d052a00e0bb050ac95e633e702575630cfd43cb58592d2a1',
          },
          p2pk_e: '02a8cda4cf448bfce9a9e46e588c06ea1780fcb94e3bbdf3277f42995d403a8b0c',
        },
      ],
    };
    const result = utils.getDecodedToken(token, ['009a1f293253e41e']);
    expect(result).toStrictEqual(expected);
    // and the P2BK fields must survive re-encoding byte-for-byte
    expect(utils.getEncodedToken(result)).toBe(token);
  });
});

describe('test getTokenMetadata', () => {
  test('testing v3 Token', async () => {
    const token =
      'cashuAeyJ0b2tlbiI6W3sibWludCI6Imh0dHBzOi8vdGVzdG51dC5jYXNodS5zcGFjZSIsInByb29mcyI6W3sic2VjcmV0IjoiNGU1ODVjMTk1OTJhMGExMDAwN2I0NTE4MjJlMjJmODEyOWVjMjc1M2RhMGJlM2YyMmRlYzI2YTkyYjEzMDJkYiIsIkMiOiIwMjdmMzkwZjcxNjBhMDE3MWUwMTEzYTQzMTE1NjQ0NDdiMjk0MjgzM2FlOWRmZjBiZWI0OWNiMzE0Njc3YmE2YTQiLCJhbW91bnQiOjQsImlkIjoiMDA1MGY3NjNiMzZhN2I4YyIsImRsZXEiOnsiciI6IjdiN2U4NjgwMTJmMGQ0NjI0MDZiZTc5MGY3MTNkOGE0Mjc2MmM0YTllZmJiZTIxMzRkZjFjZjlmYzU4MWRmOTgiLCJzIjoiMzI0NzVmZTczYmE5ODM5ZGRhMjczZmIzN2U0ZGVhZTM5ODdhYTA4NmU2ODE1MGE4YjgxODc2MThjZjE0NmIwYiIsImUiOiJiNWU1MDExYmFlYjRjMTNkNWM0NDg3NDVhZTNiNGRjNGJmNTE3YjUxZTRlYjAzZTlmNzQyMDRlMmM2OTNjZWJlIn19LHsic2VjcmV0IjoiMTZhMGNjMjIxNGFkY2Y4MGIxOWY2MGU5NzJiN2FkMWQ5ZWZhN2ExZWVkODRkZTExMWRmNmIwZDk4MmYyMTdmYiIsIkMiOiIwMzk1N2E3ZTlhYjc1ZjIxNTJiYTllYjVmMWI2ZjNjZDEyZGJiMmIzMTAwZDRmYWJjM2ZkNDU3Zjk1YjExZGNiY2UiLCJhbW91bnQiOjIsImlkIjoiMDA1MGY3NjNiMzZhN2I4YyIsImRsZXEiOnsiciI6IjQ2ZDc0NzkxZDU2NzYwYjM5MzE3NTU1ZjEyODNlMmY0YWQxY2ZhNGEzNmE2N2MwNGU2Y2RlNTEwZjIyZWQxZWUiLCJzIjoiODFjYjIzZDA3OTkzNDFiYzk0ZjFmODcyMzViYzYzZjZiM2EyN2M4YjZmMTNhOWRjZjVmOTdhMTg0ODUyMTVjMCIsImUiOiJiZmYyZThhZWUzMmFjMTViMjFiMzhlOTkxMzk0ZjIzZTg0YzU2ODQ1YjFmNzQ3MTBkNjc0MWM2NzExN2M3ZDExIn19LHsic2VjcmV0IjoiYTUzMjc0Yjk0NzYwNjdhN2FlMGM3ZDFmYmE3YzNmNTNhN2I0YjM2MTBmMDNhZjczNmM2ZTFmYzUzNjFlYzZhYyIsIkMiOiIwMjZmNzk4MDQ4OTljNGM4MzA0NzVmYWIyYmIwMzA3MzRmNTY5ZDc4NGNmN2EwMmFkZjc0NGUxZmE2OTVhYjNkMmQiLCJhbW91bnQiOjIsImlkIjoiMDA1MGY3NjNiMzZhN2I4YyIsImRsZXEiOnsiciI6ImIxMzQ3YjU4NGI0ODUxNzc2MTQ3NWMzYTU4ZmNhNDdmODBjMzY4ZmNiYmUwNmFiZGZkYzgyNTgyMzViNDFlMjEiLCJzIjoiZWZlNzMwMjk4ZmFlMDc2NDQwM2VmYmZjMDA0ZDVlN2Q4Y2FiYjZkNjI1NzAwNjFhYWJhY2MwYzFlMTc5NmRhZSIsImUiOiIzZDdlMDBmZmFlNmExMTU4NzViNDdmYTRkNWQ0MTMzOGYyMTA1ZTUzYzM1NGM5NmZlOTQ0OWQxZDkyODVkMDA5In19LHsic2VjcmV0IjoiYWI1MmJhNmE3NWI2NjU5ODU5OTI3YTMzNzA4MzI0MWM0YWRjNzllNzZkNGZkYjJmYjNhMDdjYjI1NjRiNjQ2MiIsIkMiOiIwM2QwMWE4MWQ1NzM0MDNlMjgwMzQ5NjM1OGIyYWJlZmMyZjQ1OTJlNTFkM2Y0MWY5MDdlMmQ2YzQ3OTJhNjUxOGYiLCJhbW91bnQiOjEsImlkIjoiMDA1MGY3NjNiMzZhN2I4YyIsImRsZXEiOnsiciI6IjE2ZmEwMTZkNzI3ZmQ3YWM0Y2MzOTBjMThmMzM2MTFkOTQxOGViYThmZTU1N2UxNjhmNjcxZGU5OWFlMzRiOTkiLCJzIjoiNzdmOTE3Mzc4YzViMGVkNGM5OWQ1MmZkYWIyNWY3Y2IyMDFjYjMzZWYzZmI3NjQwODNjNjU1MmNkYWVjZTM5ZSIsImUiOiI1YjBhMjE5YjgzZjBhNTkzNWRiZDQ4MTg3ZDdkZTM4YjA2ZjIyMDkzZTI5Mzk0ZTkxOWFlYjlkNGU2NTc5MTAzIn19LHsic2VjcmV0IjoiZjY0MjU5MzU1YTFmMmQ1ZDg5MmM2NGY1YmVhZmFlODYxZGExNjM5OThhY2IyN2Y3Nzg3NjFhYzdlMjI2ZGNmMyIsIkMiOiIwMzQyZDM0OTlkNDczNTRlOGMyNzBmM2Q5NWIzN2Q4OGNkMmNiYmMyMzhhMTNkM2ZmMDJhZDBmMzQwZDU5ZTRmZGQiLCJhbW91bnQiOjEsImlkIjoiMDA1MGY3NjNiMzZhN2I4YyIsImRsZXEiOnsiciI6ImIyY2RlYmUwMmQ1MGZjYjlhODJjZDI5NTYxMjNhNGZmODY4ZjIwNjk2ZmVhN2MzZGY1OTZiMjEwMGQyOTY4YTAiLCJzIjoiOWE2M2Y3ZDA1YThkOWVmMThkM2Q1MmI4MTRlMjI3MTZhZmY0ZTJmNjk2ZjI4NzI3ZTMxZTg2NzIxMDE1ZjFiZSIsImUiOiJjZmQzZWY3ZDI5N2RkMjFhNGQ5YTc2ZDYzOTQ3ZmQ0N2ViNjFjYWUzMzFmOGI4NzY1ZGYzYjZlNDZkNGQzMGExIn19XX1dLCJ1bml0Ijoic2F0In0';
    const metadata = utils.getTokenMetadata(token);
    expect(metadata).toStrictEqual({
      unit: 'sat',
      mint: 'https://testnut.cashu.space',
      amount: Amount.from(10),
      incompleteProofs: [
        {
          C: '027f390f7160a0171e0113a4311564447b2942833ae9dff0beb49cb314677ba6a4',
          amount: Amount.from(4),
          dleq: {
            e: 'b5e5011baeb4c13d5c448745ae3b4dc4bf517b51e4eb03e9f74204e2c693cebe',
            r: '7b7e868012f0d462406be790f713d8a42762c4a9efbbe2134df1cf9fc581df98',
            s: '32475fe73ba9839dda273fb37e4deae3987aa086e68150a8b8187618cf146b0b',
          },
          secret: '4e585c19592a0a10007b451822e22f8129ec2753da0be3f22dec26a92b1302db',
        },
        {
          C: '03957a7e9ab75f2152ba9eb5f1b6f3cd12dbb2b3100d4fabc3fd457f95b11dcbce',
          amount: Amount.from(2),
          dleq: {
            e: 'bff2e8aee32ac15b21b38e991394f23e84c56845b1f74710d6741c67117c7d11',
            r: '46d74791d56760b39317555f1283e2f4ad1cfa4a36a67c04e6cde510f22ed1ee',
            s: '81cb23d0799341bc94f1f87235bc63f6b3a27c8b6f13a9dcf5f97a18485215c0',
          },
          secret: '16a0cc2214adcf80b19f60e972b7ad1d9efa7a1eed84de111df6b0d982f217fb',
        },
        {
          C: '026f79804899c4c830475fab2bb030734f569d784cf7a02adf744e1fa695ab3d2d',
          amount: Amount.from(2),
          dleq: {
            e: '3d7e00ffae6a115875b47fa4d5d41338f2105e53c354c96fe9449d1d9285d009',
            r: 'b1347b584b48517761475c3a58fca47f80c368fcbbe06abdfdc8258235b41e21',
            s: 'efe730298fae0764403efbfc004d5e7d8cabb6d62570061aabacc0c1e1796dae',
          },
          secret: 'a53274b9476067a7ae0c7d1fba7c3f53a7b4b3610f03af736c6e1fc5361ec6ac',
        },
        {
          C: '03d01a81d573403e2803496358b2abefc2f4592e51d3f41f907e2d6c4792a6518f',
          amount: Amount.from(1),
          dleq: {
            e: '5b0a219b83f0a5935dbd48187d7de38b06f22093e29394e919aeb9d4e6579103',
            r: '16fa016d727fd7ac4cc390c18f33611d9418eba8fe557e168f671de99ae34b99',
            s: '77f917378c5b0ed4c99d52fdab25f7cb201cb33ef3fb764083c6552cdaece39e',
          },
          secret: 'ab52ba6a75b6659859927a337083241c4adc79e76d4fdb2fb3a07cb2564b6462',
        },
        {
          C: '0342d3499d47354e8c270f3d95b37d88cd2cbbc238a13d3ff02ad0f340d59e4fdd',
          amount: Amount.from(1),
          dleq: {
            e: 'cfd3ef7d297dd21a4d9a76d63947fd47eb61cae331f8b8765df3b6e46d4d30a1',
            r: 'b2cdebe02d50fcb9a82cd2956123a4ff868f20696fea7c3df596b2100d2968a0',
            s: '9a63f7d05a8d9ef18d3d52b814e22716aff4e2f696f28727e31e86721015f1be',
          },
          secret: 'f64259355a1f2d5d892c64f5beafae861da163998acb27f778761ac7e226dcf3',
        },
      ],
    });
  });
  test('testing v4 Token', async () => {
    const token =
      'cashuBo2FteBtodHRwczovL3Rlc3RudXQuY2FzaHUuc3BhY2VhdWNzYXRhdIGiYWlIAFD3Y7Nqe4xhcIWkYWEEYXN4QDRlNTg1YzE5NTkyYTBhMTAwMDdiNDUxODIyZTIyZjgxMjllYzI3NTNkYTBiZTNmMjJkZWMyNmE5MmIxMzAyZGJhY1ghAn85D3FgoBceAROkMRVkRHspQoM66d_wvrScsxRne6akYWSjYWVYILXlARuutME9XESHRa47TcS_UXtR5OsD6fdCBOLGk86-YXNYIDJHX-c7qYOd2ic_s35N6uOYeqCG5oFQqLgYdhjPFGsLYXJYIHt-hoAS8NRiQGvnkPcT2KQnYsSp77viE03xz5_Fgd-YpGFhAmFzeEAxNmEwY2MyMjE0YWRjZjgwYjE5ZjYwZTk3MmI3YWQxZDllZmE3YTFlZWQ4NGRlMTExZGY2YjBkOTgyZjIxN2ZiYWNYIQOVen6at18hUrqetfG2880S27KzEA1Pq8P9RX-VsR3LzmFko2FlWCC_8uiu4yrBWyGzjpkTlPI-hMVoRbH3RxDWdBxnEXx9EWFzWCCByyPQeZNBvJTx-HI1vGP2s6J8i28Tqdz1-XoYSFIVwGFyWCBG10eR1Wdgs5MXVV8Sg-L0rRz6SjamfATmzeUQ8i7R7qRhYQJhc3hAYTUzMjc0Yjk0NzYwNjdhN2FlMGM3ZDFmYmE3YzNmNTNhN2I0YjM2MTBmMDNhZjczNmM2ZTFmYzUzNjFlYzZhY2FjWCECb3mASJnEyDBHX6srsDBzT1adeEz3oCrfdE4fppWrPS1hZKNhZVggPX4A_65qEVh1tH-k1dQTOPIQXlPDVMlv6USdHZKF0Alhc1gg7-cwKY-uB2RAPvv8AE1efYyrttYlcAYaq6zAweF5ba5hclggsTR7WEtIUXdhR1w6WPykf4DDaPy74Gq9_cglgjW0HiGkYWEBYXN4QGFiNTJiYTZhNzViNjY1OTg1OTkyN2EzMzcwODMyNDFjNGFkYzc5ZTc2ZDRmZGIyZmIzYTA3Y2IyNTY0YjY0NjJhY1ghA9AagdVzQD4oA0ljWLKr78L0WS5R0_QfkH4tbEeSplGPYWSjYWVYIFsKIZuD8KWTXb1IGH1944sG8iCT4pOU6RmuudTmV5EDYXNYIHf5FzeMWw7UyZ1S_asl98sgHLM-8_t2QIPGVSza7OOeYXJYIBb6AW1yf9esTMOQwY8zYR2UGOuo_lV-Fo9nHema40uZpGFhAWFzeEBmNjQyNTkzNTVhMWYyZDVkODkyYzY0ZjViZWFmYWU4NjFkYTE2Mzk5OGFjYjI3Zjc3ODc2MWFjN2UyMjZkY2YzYWNYIQNC00mdRzVOjCcPPZWzfYjNLLvCOKE9P_Aq0PNA1Z5P3WFko2FlWCDP0-99KX3SGk2adtY5R_1H62HK4zH4uHZd87bkbU0woWFzWCCaY_fQWo2e8Y09UrgU4icWr_Ti9pbyhyfjHoZyEBXxvmFyWCCyzevgLVD8uags0pVhI6T_ho8gaW_qfD31lrIQDSlooA';
    const metadata = utils.getTokenMetadata(token);
    expect(metadata).toStrictEqual({
      unit: 'sat',
      mint: 'https://testnut.cashu.space',
      amount: Amount.from(10),
      incompleteProofs: [
        {
          C: '027f390f7160a0171e0113a4311564447b2942833ae9dff0beb49cb314677ba6a4',
          amount: Amount.from(4),
          dleq: {
            e: 'b5e5011baeb4c13d5c448745ae3b4dc4bf517b51e4eb03e9f74204e2c693cebe',
            r: '7b7e868012f0d462406be790f713d8a42762c4a9efbbe2134df1cf9fc581df98',
            s: '32475fe73ba9839dda273fb37e4deae3987aa086e68150a8b8187618cf146b0b',
          },
          secret: '4e585c19592a0a10007b451822e22f8129ec2753da0be3f22dec26a92b1302db',
        },
        {
          C: '03957a7e9ab75f2152ba9eb5f1b6f3cd12dbb2b3100d4fabc3fd457f95b11dcbce',
          amount: Amount.from(2),
          dleq: {
            e: 'bff2e8aee32ac15b21b38e991394f23e84c56845b1f74710d6741c67117c7d11',
            r: '46d74791d56760b39317555f1283e2f4ad1cfa4a36a67c04e6cde510f22ed1ee',
            s: '81cb23d0799341bc94f1f87235bc63f6b3a27c8b6f13a9dcf5f97a18485215c0',
          },
          secret: '16a0cc2214adcf80b19f60e972b7ad1d9efa7a1eed84de111df6b0d982f217fb',
        },
        {
          C: '026f79804899c4c830475fab2bb030734f569d784cf7a02adf744e1fa695ab3d2d',
          amount: Amount.from(2),
          dleq: {
            e: '3d7e00ffae6a115875b47fa4d5d41338f2105e53c354c96fe9449d1d9285d009',
            r: 'b1347b584b48517761475c3a58fca47f80c368fcbbe06abdfdc8258235b41e21',
            s: 'efe730298fae0764403efbfc004d5e7d8cabb6d62570061aabacc0c1e1796dae',
          },
          secret: 'a53274b9476067a7ae0c7d1fba7c3f53a7b4b3610f03af736c6e1fc5361ec6ac',
        },
        {
          C: '03d01a81d573403e2803496358b2abefc2f4592e51d3f41f907e2d6c4792a6518f',
          amount: Amount.from(1),
          dleq: {
            e: '5b0a219b83f0a5935dbd48187d7de38b06f22093e29394e919aeb9d4e6579103',
            r: '16fa016d727fd7ac4cc390c18f33611d9418eba8fe557e168f671de99ae34b99',
            s: '77f917378c5b0ed4c99d52fdab25f7cb201cb33ef3fb764083c6552cdaece39e',
          },
          secret: 'ab52ba6a75b6659859927a337083241c4adc79e76d4fdb2fb3a07cb2564b6462',
        },
        {
          C: '0342d3499d47354e8c270f3d95b37d88cd2cbbc238a13d3ff02ad0f340d59e4fdd',
          amount: Amount.from(1),
          dleq: {
            e: 'cfd3ef7d297dd21a4d9a76d63947fd47eb61cae331f8b8765df3b6e46d4d30a1',
            r: 'b2cdebe02d50fcb9a82cd2956123a4ff868f20696fea7c3df596b2100d2968a0',
            s: '9a63f7d05a8d9ef18d3d52b814e22716aff4e2f696f28727e31e86721015f1be',
          },
          secret: 'f64259355a1f2d5d892c64f5beafae861da163998acb27f778761ac7e226dcf3',
        },
      ],
    });
  });
});

describe('test keyset derivation', () => {
  test('derive v0', () => {
    const keys = PUBKEYS;
    const keysetId = utils.deriveKeysetId(keys, { versionByte: 0 });
    expect(keysetId).toBe('009a1f293253e41e');
  });
  test('derives NUT-02 version 1 vector 1', () => {
    const keysetId = utils.deriveKeysetId(NUT02_V1_VECTOR1_KEYS.keys, { versionByte: 0 });
    expect(keysetId).toBe(NUT02_V1_VECTOR1_KEYS.id);
  });
  test('derives NUT-02 version 1 vector 2', () => {
    const keysetId = utils.deriveKeysetId(NUT02_V1_VECTOR2_KEYS.keys, { versionByte: 0 });
    expect(keysetId).toBe(NUT02_V1_VECTOR2_KEYS.id);
  });
  test('derives NUT-02 version 2 vector 1', () => {
    const keysetId = utils.deriveKeysetId(NUT02_V2_VECTOR1_KEYS.keys, {
      expiry: 2059210353,
      input_fee_ppk: 100,
      unit: 'sat',
    });
    expect(keysetId).toBe(NUT02_V2_VECTOR1_KEYS.id);
  });
  test('derives NUT-02 version 2 vector 2', () => {
    const keysetId = utils.deriveKeysetId(NUT02_V2_VECTOR2_KEYS.keys, {
      expiry: NUT02_V2_VECTOR2_KEYS.final_expiry,
      input_fee_ppk: NUT02_V2_VECTOR2_KEYS.input_fee_ppk,
      unit: NUT02_V2_VECTOR2_KEYS.unit,
    });
    expect(keysetId).toBe(NUT02_V2_VECTOR2_KEYS.id);
  });
  test('derives NUT-02 version 2 vector 3', () => {
    const keysetId = utils.deriveKeysetId(NUT02_V2_VECTOR3_KEYS.keys, {
      input_fee_ppk: NUT02_V2_VECTOR3_KEYS.input_fee_ppk,
      unit: NUT02_V2_VECTOR3_KEYS.unit,
    });
    expect(keysetId).toBe(NUT02_V2_VECTOR3_KEYS.id);
  });
  test('verifies NUT-02 version 2 vector DTOs', () => {
    expect(Keyset.verifyKeysetId(NUT02_V2_VECTOR1_KEYS)).toBe(true);
    expect(Keyset.verifyKeysetId(NUT02_V2_VECTOR2_KEYS)).toBe(true);
    expect(Keyset.verifyKeysetId(NUT02_V2_VECTOR3_KEYS)).toBe(true);
  });
  // v3 keyset id derivation — matches Nutshell `derive_keyset_id_v3` (G2 pubkeys, prefix 02).
  // Vectors mirror nuts/tests/02-tests.md "Version 3"; keys are K_i = i·G2.
  test('derives NUT-02 version 3 vector 1', () => {
    const keysetId = utils.deriveKeysetId(NUT02_V3_VECTOR1_KEYS.keys, {
      versionByte: 2,
      unit: NUT02_V3_VECTOR1_KEYS.unit,
    });
    expect(keysetId).toBe(NUT02_V3_VECTOR1_KEYS.id);
  });
  test('derives NUT-02 version 3 vector 2', () => {
    const keysetId = utils.deriveKeysetId(NUT02_V3_VECTOR2_KEYS.keys, {
      versionByte: 2,
      unit: NUT02_V3_VECTOR2_KEYS.unit,
      input_fee_ppk: NUT02_V3_VECTOR2_KEYS.input_fee_ppk,
      expiry: NUT02_V3_VECTOR2_KEYS.final_expiry,
    });
    expect(keysetId).toBe(NUT02_V3_VECTOR2_KEYS.id);
  });

  test('NUT-02 V3 derivation is case-insensitive in unit and pubkey hex', () => {
    const upperUnitId = utils.deriveKeysetId(NUT02_V3_VECTOR2_KEYS.keys, {
      versionByte: 2,
      unit: NUT02_V3_VECTOR2_KEYS.unit.toUpperCase(),
      input_fee_ppk: NUT02_V3_VECTOR2_KEYS.input_fee_ppk,
      expiry: NUT02_V3_VECTOR2_KEYS.final_expiry,
    });
    expect(upperUnitId).toBe(NUT02_V3_VECTOR2_KEYS.id);

    const upperKeys = Object.fromEntries(
      Object.entries(NUT02_V3_VECTOR2_KEYS.keys).map(([k, v]) => [k, v.toUpperCase()]),
    );
    const upperKeysId = utils.deriveKeysetId(upperKeys, {
      versionByte: 2,
      unit: NUT02_V3_VECTOR2_KEYS.unit,
      input_fee_ppk: NUT02_V3_VECTOR2_KEYS.input_fee_ppk,
      expiry: NUT02_V3_VECTOR2_KEYS.final_expiry,
    });
    expect(upperKeysId).toBe(NUT02_V3_VECTOR2_KEYS.id);
  });

  // Mirror of the V3 case-insensitivity test on the V2 (secp256k1) path. The two share the same
  // preimage code path; this lock-in catches a future regression that lowercases for v3 only.
  test('NUT-02 V2 derivation is case-insensitive in unit and pubkey hex', () => {
    const upperUnitId = utils.deriveKeysetId(NUT02_V2_VECTOR1_KEYS.keys, {
      versionByte: 1,
      unit: NUT02_V2_VECTOR1_KEYS.unit.toUpperCase(),
      input_fee_ppk: NUT02_V2_VECTOR1_KEYS.input_fee_ppk,
      expiry: NUT02_V2_VECTOR1_KEYS.final_expiry,
    });
    expect(upperUnitId).toBe(NUT02_V2_VECTOR1_KEYS.id);

    const upperKeys = Object.fromEntries(
      Object.entries(NUT02_V2_VECTOR1_KEYS.keys).map(([k, v]) => [k, v.toUpperCase()]),
    );
    const upperKeysId = utils.deriveKeysetId(upperKeys, {
      versionByte: 1,
      unit: NUT02_V2_VECTOR1_KEYS.unit,
      input_fee_ppk: NUT02_V2_VECTOR1_KEYS.input_fee_ppk,
      expiry: NUT02_V2_VECTOR1_KEYS.final_expiry,
    });
    expect(upperKeysId).toBe(NUT02_V2_VECTOR1_KEYS.id);
  });
});

describe('test v4 encoding', () => {
  test('standard token', async () => {
    const encodedV4 =
      'cashuBpGF0gaJhaUgArSaMTR9YJmFwgaNhYQFhc3hAOWE2ZGJiODQ3YmQyMzJiYTc2ZGIwZGYxOTcyMTZiMjlkM2I4Y2MxNDU1M2NkMjc4MjdmYzFjYzk0MmZlZGI0ZWFjWCEDhhhUP_trhpXfStS6vN6So0qWvc2X3O4NfM-Y1HISZ5JhZGlUaGFuayB5b3VhbXVodHRwOi8vbG9jYWxob3N0OjMzMzhhdWNzYXQ=';
    const v3Token = {
      memo: 'Thank you',
      mint: 'http://localhost:3338',
      proofs: [
        {
          secret: '9a6dbb847bd232ba76db0df197216b29d3b8cc14553cd27827fc1cc942fedb4e',
          C: '038618543ffb6b8695df4ad4babcde92a34a96bdcd97dcee0d7ccf98d472126792',
          id: '00ad268c4d1f5826',
          amount: Amount.from(1),
        },
      ],
      unit: 'sat',
    };
    const encoded = utils.getEncodedToken(v3Token);
    const decodedEncodedToken = utils.getDecodedToken(encoded, ['009a1f293253e41e']);
    const decodedExpectedToken = utils.getDecodedToken(encodedV4, ['009a1f293253e41e']);
    expect(decodedEncodedToken).toEqual(v3Token);
    expect(decodedExpectedToken).toEqual(decodedEncodedToken);
  });
  test('multi Id token', async () => {
    const encodedV4 =
      'cashuBo2F0gqJhaUgA_9SLj17PgGFwgaNhYQFhc3hAYWNjMTI0MzVlN2I4NDg0YzNjZjE4NTAxNDkyMThhZjkwZjcxNmE1MmJmNGE1ZWQzNDdlNDhlY2MxM2Y3NzM4OGFjWCECRFODGd5IXVW-07KaZCvuWHk3WrnnpiDhHki6SCQh88-iYWlIAK0mjE0fWCZhcIKjYWECYXN4QDEzMjNkM2Q0NzA3YTU4YWQyZTIzYWRhNGU5ZjFmNDlmNWE1YjRhYzdiNzA4ZWIwZDYxZjczOGY0ODMwN2U4ZWVhY1ghAjRWqhENhLSsdHrr2Cw7AFrKUL9Ffr1XN6RBT6w659lNo2FhAWFzeEA1NmJjYmNiYjdjYzY0MDZiM2ZhNWQ1N2QyMTc0ZjRlZmY4YjQ0MDJiMTc2OTI2ZDNhNTdkM2MzZGNiYjU5ZDU3YWNYIQJzEpxXGeWZN5qXSmJjY8MzxWyvwObQGr5G1YCCgHicY2FtdWh0dHA6Ly9sb2NhbGhvc3Q6MzMzOGF1Y3NhdA';
    const v3Token = {
      mint: 'http://localhost:3338',
      proofs: [
        {
          secret: 'acc12435e7b8484c3cf1850149218af90f716a52bf4a5ed347e48ecc13f77388',
          C: '0244538319de485d55bed3b29a642bee5879375ab9e7a620e11e48ba482421f3cf',
          id: '00ffd48b8f5ecf80',
          amount: Amount.from(1),
        },
        {
          secret: '1323d3d4707a58ad2e23ada4e9f1f49f5a5b4ac7b708eb0d61f738f48307e8ee',
          C: '023456aa110d84b4ac747aebd82c3b005aca50bf457ebd5737a4414fac3ae7d94d',
          id: '00ad268c4d1f5826',
          amount: Amount.from(2),
        },
        {
          secret: '56bcbcbb7cc6406b3fa5d57d2174f4eff8b4402b176926d3a57d3c3dcbb59d57',
          C: '0273129c5719e599379a974a626363c333c56cafc0e6d01abe46d5808280789c63',
          id: '00ad268c4d1f5826',
          amount: Amount.from(1),
        },
      ],
      unit: 'sat',
    };

    const encoded = utils.getEncodedToken(v3Token);
    const decodedEncodedToken = utils.getDecodedToken(encoded, ['009a1f293253e41e']);
    const decodedExpectedToken = utils.getDecodedToken(encodedV4, ['009a1f293253e41e']);
    expect(decodedEncodedToken).toEqual(v3Token);
    expect(decodedExpectedToken).toEqual(decodedEncodedToken);
  });
  test('bigint amount > MAX_SAFE_INTEGER roundtrips through v4 encoding', () => {
    const largeAmount = Amount.from(2n ** 53n + 1n); // 9007199254740993 — first integer above MAX_SAFE_INTEGER
    const token = {
      mint: 'http://localhost:3338',
      proofs: [
        {
          secret: '9a6dbb847bd232ba76db0df197216b29d3b8cc14553cd27827fc1cc942fedb4e',
          C: '038618543ffb6b8695df4ad4babcde92a34a96bdcd97dcee0d7ccf98d472126792',
          id: '00ad268c4d1f5826',
          amount: largeAmount,
        },
      ],
      unit: 'sat',
    };
    const encoded = utils.getEncodedToken(token);
    const decoded = utils.getDecodedToken(encoded, ['009a1f293253e41e']);
    expect(decoded.proofs[0].amount.equals(largeAmount)).toBe(true);
  });
  test('getEncodedToken accepts JSON-parsed tokens and rehydrates proof amounts', () => {
    const token = {
      mint: 'http://localhost:3338',
      proofs: [
        {
          secret: '9a6dbb847bd232ba76db0df197216b29d3b8cc14553cd27827fc1cc942fedb4e',
          C: '038618543ffb6b8695df4ad4babcde92a34a96bdcd97dcee0d7ccf98d472126792',
          id: '00ad268c4d1f5826',
          amount: Amount.from(2n ** 53n + 1n),
        },
      ],
      unit: 'sat',
    };
    const parsedToken = JSON.parse(JSON.stringify(token)) as Token;

    const encoded = utils.getEncodedToken(parsedToken);
    const decoded = utils.getDecodedToken(encoded, ['009a1f293253e41e']);

    expect(decoded.proofs[0].amount.equals(token.proofs[0].amount)).toBe(true);
  });
  test('getEncodedToken does not mutate input token proof IDs', () => {
    const token = {
      mint: 'https://testnut.cashu.space',
      proofs: [
        {
          id: '01884a74bb2fc5ee6e5f958f89f9e4e6cf79241fbc9fd1012d6811b054a78beffe',
          amount: Amount.from(1),
          secret: '9a6dbb847bd232ba76db0df197216b29d3b8cc14553cd27827fc1cc942fedb4e',
          C: '02698c4e2b5f9534cd0687d87513c759790cf829aa5739184a3e3735471fbda904',
        },
      ],
      unit: 'sat',
    };
    const originalId = token.proofs[0].id;
    utils.getEncodedToken(token);
    expect(token.proofs[0].id).toBe(originalId);
  });
  test('removing DLEQ', async () => {
    const proofs = [
      {
        amount: Amount.from(1),
        C: '03ff2e729416437f9ea8d022c501ff5b309d607f98c9ab53d51cd24185b4d3e42b',
        id: '00b4cd27d8861a44',
        secret: '10216467bb33f6f079ae92349ba54fa34df99ba24572645b8b813688c74b582d',
        witness: undefined,
        dleq: {
          s: '26f44e265699d95ae2171db58257aeffe03d325e0f69da4bc95b9749358380fc',
          e: '8269767ac3f6ac368ad9ea8c05b13724ea8a58469677925aa948435685107b0d',
          r: '40ce4dbe14a1f65ae74328b5f81d83cdb3977595d78ddf01665d9aca6d450233',
        },
      },
      {
        amount: Amount.from(4),
        C: '02b457f8e1e151cd71dd3246b56d0f479ac63786e71916b46d16369cb6f78024b9',
        id: '00b4cd27d8861a44',
        secret: '1b1bc7a099a63c808c17f8ca4ede03f30d3c243ca34ec4d10a1327b7cfb3ead7',
        witness: undefined,
        dleq: {
          s: '2c23b772ce14f2d67415313e343a2a1f282edff8d5dd09f181a383b6cb6c2f7a',
          e: 'c2312f2c61ba392c24434c9c9097f397cc856841bde5786db64a2ee2e1172770',
          r: '08178fda3f9b80a5653dec563a27f79b4e697a2fcaa99d746d2b3a8d2f8d85f2',
        },
      },
      {
        amount: Amount.from(16),
        C: '03570cdf33bc832a60660b3e7d8ddb74d0dd3158e0fde5b0f607555bb7e8e9fb0f',
        id: '00b4cd27d8861a44',
        secret: '8425354533436ca7c29b34daae3aef85ab08925c810d1db4f005259d79d7f9f6',
        witness: undefined,
        dleq: {
          s: 'bd3b4dd0eddddbb52eb3372a216c13b385561a8a549c66559ece8220959ccde6',
          e: '2f03a5bdcfecfaabdf81875be3d78c14725bc960c780eac7b03c2b3c04eecdc3',
          r: '52056ba2a2410d0aa4164ac618a9ed83e3170f818fbaa140d91a95dcbd2feb2e',
        },
      },
    ];
    const encoded = utils.getEncodedToken(
      {
        mint: 'https://nofees.testnut.cashu.space',
        proofs,
        memo: 'Demo',
      },
      { removeDleq: true },
    );
    expect(encoded).toBe(
      'cashuBpGFteCJodHRwczovL25vZmVlcy50ZXN0bnV0LmNhc2h1LnNwYWNlYXVjc2F0YXSBomFpSAC0zSfYhhpEYXCDo2FhAWFzeEAxMDIxNjQ2N2JiMzNmNmYwNzlhZTkyMzQ5YmE1NGZhMzRkZjk5YmEyNDU3MjY0NWI4YjgxMzY4OGM3NGI1ODJkYWNYIQP_LnKUFkN_nqjQIsUB_1swnWB_mMmrU9Uc0kGFtNPkK6NhYQRhc3hAMWIxYmM3YTA5OWE2M2M4MDhjMTdmOGNhNGVkZTAzZjMwZDNjMjQzY2EzNGVjNGQxMGExMzI3YjdjZmIzZWFkN2FjWCECtFf44eFRzXHdMka1bQ9HmsY3hucZFrRtFjactveAJLmjYWEQYXN4QDg0MjUzNTQ1MzM0MzZjYTdjMjliMzRkYWFlM2FlZjg1YWIwODkyNWM4MTBkMWRiNGYwMDUyNTlkNzlkN2Y5ZjZhY1ghA1cM3zO8gypgZgs-fY3bdNDdMVjg_eWw9gdVW7fo6fsPYWRkRGVtbw',
    );
    expect(utils.getDecodedToken(encoded, ['009a1f293253e41e']).proofs[0].dleq).toBeUndefined();
  });
});

describe('test deriveKeysetId edge cases', () => {
  // v3 (BLS) keysets folded case 2 into the case 1 unit-required branch and rewrote the
  // throw to interpolate the version byte. Cover both paths against the shared guard.
  test('throws when versionByte 1 is requested without a unit', () => {
    expect(() => utils.deriveKeysetId({ 1: 'deadbeef' }, { versionByte: 1, unit: '' })).toThrow(
      /version 01: unit is required/,
    );
  });

  test('throws when versionByte 2 is requested without a unit', () => {
    expect(() => utils.deriveKeysetId({ 1: 'deadbeef' }, { versionByte: 2, unit: '' })).toThrow(
      /version 02: unit is required/,
    );
  });
});

describe('test mapShortKeysetIds edge cases', () => {
  test('forward-compat: prefix-resolves a 0x03-prefixed short ID', () => {
    // Short-ID prefix-match is version-agnostic for modern hex IDs (v1+). v0 is the only
    // short-form outlier and is handled separately. This is the inverse of the strict KDF
    // dispatch in `getDerivationKind` — see `isBlsKeyset` docstring for the design rationale.
    const fullId = '03' + 'ab'.repeat(32); // 66 chars, 0x03-prefixed
    const shortId = fullId.slice(0, 16);
    const token: Token = {
      mint: 'http://localhost:3338',
      proofs: [
        {
          amount: Amount.from(1),
          C: '038618543ffb6b8695df4ad4babcde92a34a96bdcd97dcee0d7ccf98d472126792',
          id: shortId,
          secret: '9a6dbb847bd232ba76db0df197216b29d3b8cc14553cd27827fc1cc942fedb4e',
        },
      ],
      unit: 'sat',
    };
    const encoded = utils.getEncodedToken(token);
    const decoded = utils.getDecodedToken(encoded, [fullId]);
    expect(decoded.proofs[0].id).toBe(fullId);
  });
});

describe('test output selection', () => {
  test('hasCorrespondingKey accepts AmountLike', () => {
    expect(utils.hasCorrespondingKey('8', keys)).toBe(true);
    expect(utils.hasCorrespondingKey(Amount.from(3), keys)).toBe(false);
  });
});
describe('test zero-knowledge utilities', () => {
  // create private public key pair
  const privkey = hexToBytes('1'.padStart(64, '0'));
  const pubkey = pointFromBytes(getPubKeyFromPrivKey(privkey));

  // make up a secret
  const fakeSecret = new TextEncoder().encode('fakeSecret');
  // make up blinding factor
  const r = hexToNumber('123456'.padStart(64, '0'));
  // blind secret
  const fakeBlindedMessage = blindMessage(fakeSecret, r);
  // construct DLEQ
  const fakeDleq = createDLEQProof(fakeBlindedMessage.B_, privkey);
  // blind signature
  const fakeBlindSignature = createBlindSignature(fakeBlindedMessage.B_, privkey, '00');
  // unblind
  const unblinded = constructUnblindedSignature(fakeBlindSignature, r, fakeSecret, pubkey);
  // construct Proof directly (amount = 1, matching keyset key in tests below)
  const serializedProof: Proof = {
    id: unblinded.id,
    amount: Amount.from(1),
    C: unblinded.C.toHex(true),
    secret: new TextDecoder().decode(unblinded.secret),
    dleq: {
      r: numberToHexPadded64(r),
      e: bytesToHex(fakeDleq.e),
      s: bytesToHex(fakeDleq.s),
    },
  };

  test('has valid dleq', () => {
    const keyset = {
      id: '00',
      unit: 'sat',
      keys: { [1]: pubkey.toHex(true) },
    };
    const validDleq = hasValidDleq(serializedProof, keyset);
    expect(validDleq).toBe(true);
  });
  test('has valid dleq with no matching key', () => {
    const keyset = {
      id: '00',
      unit: 'sat',
      keys: { [2]: pubkey.toHex(true) },
    };
    expect(() => hasValidDleq(serializedProof, keyset)).toThrow(/Undefined key for amount/);
  });
  describe('v3 (BLS) proof signature verification via hasValidDleq', () => {
    // Locked Nutshell vector: secret="test_message", r=3, a=2 → C
    const v3Id = '02ce4c47836fd0e64f37a08254777b7fd0dedb95fc1ddd0acadf5600674c743c5d';
    const v3Secret = 'test_message';
    const v3C =
      'b7a4881059133fd91a8753600d9a5e524c65d6224f6fe2d5aef9e59f1507fdad90b3b4d48ee46da5c8dfaa0b88e28b69';
    // K2 = a * G2 with a=2 (compressed G2, 192 hex)
    const aBytes = hexToBytes('0'.repeat(63) + '2');
    const v3K2 = bytesToHex(getG2PubKeyFromPrivKey(aBytes));

    test('returns true for a v3 proof whose pairing equality holds', () => {
      const v3Proof: Proof = {
        amount: Amount.from(1),
        id: v3Id,
        secret: v3Secret,
        C: v3C,
      };
      const keyset = { id: v3Id, unit: 'sat', keys: { [1]: v3K2 } };
      expect(hasValidDleq(v3Proof, keyset)).toBe(true);
    });

    test('returns false for a v3 proof with tampered C', () => {
      const tampered = v3C.slice(0, v3C.length - 2) + (v3C.slice(-2) === 'aa' ? 'bb' : 'aa');
      const v3Proof: Proof = {
        amount: Amount.from(1),
        id: v3Id,
        secret: v3Secret,
        C: tampered,
      };
      const keyset = { id: v3Id, unit: 'sat', keys: { [1]: v3K2 } };
      expect(hasValidDleq(v3Proof, keyset)).toBe(false);
    });

    test('throws on missing key for amount in v3 keyset', () => {
      const v3Proof: Proof = {
        amount: Amount.from(2),
        id: v3Id,
        secret: v3Secret,
        C: v3C,
      };
      const keyset = { id: v3Id, unit: 'sat', keys: { [1]: v3K2 } };
      expect(() => hasValidDleq(v3Proof, keyset)).toThrow(/Undefined key for amount/);
    });

    test('returns false when v3 keyset key is malformed (mirrors secp behaviour)', () => {
      const v3Proof: Proof = {
        amount: Amount.from(1),
        id: v3Id,
        secret: v3Secret,
        C: v3C,
      };
      // Wrong length (66 hex would be a secp point); pointFromHexG2 throws inside try/catch.
      const keyset = { id: v3Id, unit: 'sat', keys: { [1]: '00'.repeat(33) } };
      expect(hasValidDleq(v3Proof, keyset)).toBe(false);
    });
  });

  describe('hasValidDleq default (NUT-12 verify-if-present)', () => {
    const keyset = {
      id: '00',
      unit: 'sat',
      keys: { [1]: pubkey.toHex(true) },
    };

    test('returns true when no DLEQ is present (spec default)', () => {
      const { dleq, ...proofNoDleq } = serializedProof;
      void dleq;
      expect(hasValidDleq(proofNoDleq, keyset)).toBe(true);
    });

    test('returns true for a valid DLEQ', () => {
      expect(hasValidDleq(serializedProof, keyset)).toBe(true);
    });

    test('returns false for a tampered DLEQ', () => {
      const tampered: Proof = {
        ...serializedProof,
        dleq: {
          ...serializedProof.dleq!,
          e: '00'.repeat(32),
        },
      };
      expect(hasValidDleq(tampered, keyset)).toBe(false);
    });

    test('throws if DLEQ is present but no matching keyset key', () => {
      const wrongKeyset = {
        id: '00',
        unit: 'sat',
        keys: { [2]: pubkey.toHex(true) },
      };
      expect(() => hasValidDleq(serializedProof, wrongKeyset)).toThrow(/Undefined key for amount/);
    });

    test('throws on bad amount even when DLEQ is absent (amount check is unbypassable)', () => {
      const { dleq, ...proofNoDleq } = serializedProof;
      void dleq;
      const wrongKeyset = {
        id: '00',
        unit: 'sat',
        keys: { [2]: pubkey.toHex(true) },
      };
      expect(() => hasValidDleq(proofNoDleq, wrongKeyset)).toThrow(
        /Undefined key for amount 1 in keyset 00/,
      );
    });
  });

  describe('hasValidDleq with require: true (opt-in strict)', () => {
    const keyset = {
      id: '00',
      unit: 'sat',
      keys: { [1]: pubkey.toHex(true) },
    };

    test('returns false when no DLEQ is present (above-spec strict policy)', () => {
      const { dleq, ...proofNoDleq } = serializedProof;
      void dleq;
      expect(hasValidDleq(proofNoDleq, keyset, { require: true })).toBe(false);
    });

    test('returns true for a valid DLEQ (same as default)', () => {
      expect(hasValidDleq(serializedProof, keyset, { require: true })).toBe(true);
    });
  });

  describe('verifyProofsForReceive', () => {
    const secpKeyset = { id: '00', unit: 'sat', keys: { [1]: pubkey.toHex(true) } };

    test('accepts a single valid v0/v1/v2 proof (requireDleq=true)', () => {
      const getKeyset = () => secpKeyset;
      expect(() =>
        utils.verifyProofsForReceive([serializedProof], getKeyset, { requireDleq: true }),
      ).not.toThrow();
    });

    test('rejects a missing-DLEQ v0/v1/v2 proof under requireDleq=true (names offender)', () => {
      const { dleq, ...noDleq } = serializedProof;
      void dleq;
      const getKeyset = () => secpKeyset;
      expect(() =>
        utils.verifyProofsForReceive([noDleq], getKeyset, { requireDleq: true }),
      ).toThrow(/invalid or missing DLEQ.*keyset 00/);
    });

    test('rejects a v0/v1/v2 proof whose amount is not in the keyset, even with no DLEQ', () => {
      const { dleq, ...noDleq } = serializedProof;
      void dleq;
      const tampered = { ...noDleq, amount: Amount.from(3) };
      const getKeyset = () => secpKeyset;
      expect(() => utils.verifyProofsForReceive([tampered], getKeyset)).toThrow(
        /Undefined key for amount 3 in keyset 00/,
      );
    });

    describe('v3 BLS batches', () => {
      // Locked Nutshell vector reused for the single-proof v3 happy path.
      const v3Id = '02ce4c47836fd0e64f37a08254777b7fd0dedb95fc1ddd0acadf5600674c743c5d';
      const v3Secret = 'test_message';
      const v3C =
        'b7a4881059133fd91a8753600d9a5e524c65d6224f6fe2d5aef9e59f1507fdad90b3b4d48ee46da5c8dfaa0b88e28b69';
      const v3K2 = bytesToHex(getG2PubKeyFromPrivKey(hexToBytes('0'.repeat(63) + '2')));
      const v3Proof: Proof = {
        amount: Amount.from(1),
        id: v3Id,
        secret: v3Secret,
        C: v3C,
      };
      const v3Keyset = { id: v3Id, unit: 'sat', keys: { [1]: v3K2 } };

      test('single v3 proof verifies via direct pairing', () => {
        expect(() => utils.verifyProofsForReceive([v3Proof], () => v3Keyset)).not.toThrow();
      });

      test('mixed-denomination v3 batch verifies in one pairing', async () => {
        const bls = await import('../../src/crypto');
        // Same mint key (a=2), different secrets + amounts → realistic mixed-denomination receive.
        const aBytes = hexToBytes('0'.repeat(63) + '2');
        const K2hex = bytesToHex(getG2PubKeyFromPrivKey(aBytes));
        const makeProof = (amount: bigint, secret: string, r: bigint): Proof => {
          const s = new TextEncoder().encode(secret);
          const { B_ } = bls.blindMessageBls(s, r);
          const { C_ } = bls.createBlindSignatureBls(B_, aBytes, v3Id);
          const C = bls.unblindSignatureBls(C_, r);
          return {
            amount: Amount.from(amount),
            id: v3Id,
            secret,
            C: bytesToHex(C.toBytes(true)),
          };
        };
        const keyset = {
          id: v3Id,
          unit: 'sat',
          keys: { [1]: K2hex, [2]: K2hex, [4]: K2hex, [8]: K2hex, [16]: K2hex },
        };
        const proofs = [
          makeProof(1n, 's1', 7n),
          makeProof(2n, 's2', 11n),
          makeProof(4n, 's3', 13n),
          makeProof(8n, 's4', 17n),
          makeProof(16n, 's5', 19n),
        ];
        expect(() => utils.verifyProofsForReceive(proofs, () => keyset)).not.toThrow();
      });

      test('tampered C in a 5-proof v3 batch is rejected and offender named', async () => {
        const bls = await import('../../src/crypto');
        const aBytes = hexToBytes('0'.repeat(63) + '2');
        const K2hex = bytesToHex(getG2PubKeyFromPrivKey(aBytes));
        const makeProof = (amount: bigint, secret: string, r: bigint): Proof => {
          const s = new TextEncoder().encode(secret);
          const { B_ } = bls.blindMessageBls(s, r);
          const { C_ } = bls.createBlindSignatureBls(B_, aBytes, v3Id);
          const C = bls.unblindSignatureBls(C_, r);
          return {
            amount: Amount.from(amount),
            id: v3Id,
            secret,
            C: bytesToHex(C.toBytes(true)),
          };
        };
        const keyset = {
          id: v3Id,
          unit: 'sat',
          keys: { [1]: K2hex, [2]: K2hex, [4]: K2hex, [8]: K2hex, [16]: K2hex },
        };
        const good = [
          makeProof(1n, 's1', 7n),
          makeProof(2n, 's2', 11n),
          makeProof(4n, 's3', 13n),
          makeProof(8n, 's4', 17n),
          makeProof(16n, 's5', 19n),
        ];
        // Replace the C on the third proof with the first proof's C — keeps it on-curve
        // (so parseHex doesn't throw) but breaks pairing equality for that secret.
        const tampered = good.map((p, i) => (i === 2 ? { ...p, C: good[0].C } : p));
        expect(() => utils.verifyProofsForReceive(tampered, () => keyset)).toThrow(
          /invalid DLEQ.*amount 4/,
        );
      });

      test('mixed-curve token: v0/v1/v2 path runs DLEQ, v3 path runs pairing', () => {
        const getKeyset = (id: string) => (id === v3Id ? v3Keyset : secpKeyset);
        expect(() =>
          utils.verifyProofsForReceive([serializedProof, v3Proof], getKeyset),
        ).not.toThrow();
      });

      test('v3 proof with malformed C surfaces offender id in error', () => {
        const bad: Proof = { ...v3Proof, C: 'gg'.repeat(48) };
        expect(() => utils.verifyProofsForReceive([bad], () => v3Keyset)).toThrow(
          new RegExp(`invalid DLEQ.*keyset ${v3Id}`),
        );
      });

      // Regression: a v3-prefixed keyset whose pubkey is actually a 33-byte secp key used to
      // escape as an unhandled throw because only the G1 parse was wrapped.
      test('v3-prefixed keyset with a non-G2 pubkey throws CTSError, not an unhandled error', () => {
        const secpPubHex = pubkey.toHex(true); // 33-byte / 66-hex secp key
        const hostileKeyset = { id: v3Id, unit: 'sat', keys: { [1]: secpPubHex } };
        expect(() => utils.verifyProofsForReceive([v3Proof], () => hostileKeyset)).toThrow(
          new RegExp(`invalid DLEQ.*keyset ${v3Id}`),
        );
        expect(() => utils.verifyProofsForReceive([v3Proof], () => hostileKeyset)).toThrow(
          CTSError,
        );
      });

      test('v3 proof with truncated K2 hex throws CTSError, not an unhandled error', () => {
        const truncatedKeyset = {
          id: v3Id,
          unit: 'sat',
          keys: { [1]: v3K2.slice(0, -2) }, // chop one byte off the 96-byte G2 encoding
        };
        expect(() => utils.verifyProofsForReceive([v3Proof], () => truncatedKeyset)).toThrow(
          CTSError,
        );
      });

      test('requireDleq=true uses the strict error message for v3 failures', () => {
        const tampered: Proof = {
          ...v3Proof,
          C: v3C.slice(0, -2) + (v3C.endsWith('aa') ? 'bb' : 'aa'),
        };
        expect(() =>
          utils.verifyProofsForReceive([tampered], () => v3Keyset, { requireDleq: true }),
        ).toThrow(/invalid or missing DLEQ/);
      });
    });
  });
});

describe('test raw tokens', () => {
  const token: Token = {
    mint: 'http://localhost:3338',
    proofs: [
      {
        id: '00ad268c4d1f5826',
        amount: Amount.from(1),
        secret: '9a6dbb847bd232ba76db0df197216b29d3b8cc14553cd27827fc1cc942fedb4e',
        C: '038618543ffb6b8695df4ad4babcde92a34a96bdcd97dcee0d7ccf98d472126792',
      },
    ],
    memo: 'Thank you',
    unit: 'sat',
  };

  test('bytes to token', () => {
    const expectedBytes = hexToBytes(
      '6372617742a4617481a261694800ad268c4d1f5826617081a3616101617378403961366462623834376264323332626137366462306466313937323136623239643362386363313435353363643237383237666331636339343266656462346561635821038618543ffb6b8695df4ad4babcde92a34a96bdcd97dcee0d7ccf98d4721267926164695468616e6b20796f75616d75687474703a2f2f6c6f63616c686f73743a33333338617563736174',
    );

    const decodedToken = utils.getDecodedTokenBinary(expectedBytes);
    expect(decodedToken).toEqual(token);
  });

  test('token to bytes', () => {
    const bytes = utils.getEncodedTokenBinary(token);
    const decodedToken = utils.getDecodedTokenBinary(bytes);
    expect(decodedToken).toEqual(token);
  });

  test('getEncodedTokenBinary accepts JSON-parsed tokens and rehydrates proof amounts', () => {
    const parsedToken = JSON.parse(JSON.stringify(token)) as Token;

    const bytes = utils.getEncodedTokenBinary(parsedToken);
    const decodedToken = utils.getDecodedTokenBinary(bytes);

    expect(decodedToken).toEqual(token);
  });
});

describe('deprecated base64 keyset ids', () => {
  test('verifyKeysetId returns false for a legacy base64 keyset id', () => {
    // Legacy Minibits keyset: removed in v5, non-hex ids never verify.
    const mintKeys = { id: '9mlfd5vCzgGl', unit: 'sat', keys: PUBKEYS } as MintKeys;
    expect(Keyset.verifyKeysetId(mintKeys)).toBe(false);
  });
});

describe('invoiceHasAmountInHRP()', () => {
  test('detects amountless invoices correctly', () => {
    const amountless = [
      'lnbc1p53lqw7pp5d8ntp7kfaqcqtxfgks0n32xd4lng2hhx5z3gvfcm9teyn4vee35sdp82pshjgr5dusyymrfde4jq4mpd3kx2apq24ek2uscqzpuxqr8pqsp5wdg4qaq6ktrvfm4z99ry98y4qrmg3krnc4mhf2rwce230hyyeu4s9qxpqysgqgz7lt5hnxcq3wrpd5qe64a37msj0lhqfa0ky6ppagyedd79lz86zrcg20p78csjtqv3sc2m06uu24ykh8q0jzhu30yr820sysh9wv8gpz44nvz',
    ];
    amountless.forEach((inv) => expect(invoiceHasAmountInHRP(inv)).toBe(false));
  });

  test('detects invoices with amount', () => {
    const withAmount = [
      // 21 sats (210n → valid)
      'lnbc210n1p53lq0wpp5tsmnj3c6znsdyu5v8t2k3y8xw33m9hnd6exzwspxa4pqz3hze8rsdp82pshjgr5dusyymrfde4jq4mpd3kx2apq24ek2uscqzpuxqrwzqsp5jgr8l0yx8zpxfez9hns5t25j9m90yrzjz34gpacssd6lwr7an40q9qxpqysgqws7g2g9hh6awk2n6vhzpqjyf6matulx0cc0ct099nz6kudzv8xmy9clu4kyvurrt99zkr7y03hse85c2jvm7jm8qlqnvzawudn4e3vsq0m6qpa',

      // 1 BTC — no multiplier
      'lnbc11p53lqsgpp5mxs67qwmh34wu3jy7um8u490n2dtgy7dsrhzpdup008g8ygj2eysdp82pshjgr5dusyymrfde4jq4mpd3kx2',

      //uppercase LN — should be valid as BOLT11 is case insensitive
      'lNbc210n1p53lq0wpp5tsmnj3c6znsdyu5v8t2k3y8xw33m9hnd6exzwspxa4pqz3hze8rsdp82pshjgr5dusyymrfde4jq4mpd3kx2apq24ek2uscqzpuxqrwzqsp5jgr8l0yx8zpxfez9hns5t25j9m90yrzjz34gpacssd6lwr7an40q9qxpqysgqws7g2g9hh6awk2n6vhzpqjyf6matulx0cc0ct099nz6kudzv8xmy9clu4kyvurrt99zkr7y03hse85c2jvm7jm8qlqnvzawudn4e3vsq0m6qpa',

      //pico invoice — should be valid last digit of amount is 0
      'lnbc9678785340p1pwmna7lpp5gc3xfm08u9qy06djf8dfflhugl6p7lgza6dsjxq454gxhj9t7a0sd8dgfkx7cmtwd68yetpd5s9xar0wfjn5gpc8qhrsdfq24f5ggrxdaezqsnvda3kkum5wfjkzmfqf3jkgem9wgsyuctwdus9xgrcyqcjcgpzgfskx6eqf9hzqnteypzxz7fzypfhg6trddjhygrcyqezcgpzfysywmm5ypxxjemgw3hxjmn8yptk7untd9hxwg3q2d6xjcmtv4ezq7pqxgsxzmnyyqcjqmt0wfjjq6t5v4khxsp5zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zyg3zygsxqyjw5qcqp2rzjq0gxwkzc8w6323m55m4jyxcjwmy7stt9hwkwe2qxmy8zpsgg7jcuwz87fcqqeuqqqyqqqqlgqqqqn3qq9q9qrsgqrvgkpnmps664wgkp43l22qsgdw4ve24aca4nymnxddlnp8vh9v2sdxlu5ywdxefsfvm0fq3sesf08uf6q9a2ke0hc9j6z6wlxg5z5kqpu2v9wz',
    ];

    withAmount.forEach((inv) => expect(invoiceHasAmountInHRP(inv)).toBe(true));
  });

  test('rejects malformed or invalid HRP structure', () => {
    const invalid = [
      'lnbc0210n1...', // leading zero in amount → invalid per spec
      'lnsomething', // incomplete HRP
      'lnbc9678785343p1pwmna7lpp5g...', // pico invoice — amount not ending with 0
    ];

    invalid.forEach((inv) => expect(invoiceHasAmountInHRP(inv)).toBe(false));
  });
});

describe('serializeProofs / deserializeProofs / normalizeProofAmounts', () => {
  const proofs: Proof[] = [
    { id: '009a1f293253e41e', amount: Amount.from(1), secret: 'abc', C: '02abc' },
    { id: '009a1f293253e41e', amount: Amount.from(2), secret: 'def', C: '02def' },
  ];

  describe('serializeProofs', () => {
    test('returns one JSON string per proof', () => {
      const result = serializeProofs(proofs);
      expect(result).toHaveLength(2);
      expect(typeof result[0]).toBe('string');
      expect(typeof result[1]).toBe('string');
    });

    test('emits amounts as plain JSON numbers', () => {
      const [s0, s1] = serializeProofs(proofs);
      expect(JSON.parse(s0).amount).toBe(1);
      expect(JSON.parse(s1).amount).toBe(2);
    });

    test('accepts a single proof', () => {
      const result = serializeProofs(proofs[0]);
      expect(result).toHaveLength(1);
      expect(JSON.parse(result[0]).amount).toBe(1);
    });

    test('maps cleanly to NutZap proof tags', () => {
      const tags = serializeProofs(proofs).map((s) => ['proof', s]);
      expect(tags[0][0]).toBe('proof');
      expect(JSON.parse(tags[0][1]).secret).toBe('abc');
    });
  });

  describe('deserializeProofs', () => {
    test('restores Amount objects from string[] (NutZap / DB)', () => {
      const strings = serializeProofs(proofs);
      const restored = deserializeProofs(strings);
      expect(restored[0].amount.equals(1)).toBe(true);
      expect(restored[1].amount.equals(2)).toBe(true);
      expect(restored[0].amount).toBeInstanceOf(Amount);
    });

    test('restores Amount objects from raw localStorage string (serializeProofs blob)', () => {
      // serializeProofs returns string[], JSON.stringify wraps it as a JSON array of strings
      const raw = JSON.stringify(serializeProofs(proofs));
      // pass the raw string directly — no JSON.parse needed
      const restored = deserializeProofs(raw);
      expect(restored[0].amount.equals(1)).toBe(true);
      expect(restored[1].amount.equals(2)).toBe(true);
    });

    test('restores Amount objects from JSON.parse of localStorage (string[])', () => {
      const json = JSON.stringify(serializeProofs(proofs));
      // JSON.parse gives string[], deserializeProofs accepts that too
      const restored = deserializeProofs(JSON.parse(json));
      expect(restored[0].amount.equals(1)).toBe(true);
      expect(restored[1].amount.equals(2)).toBe(true);
    });

    test('round-trips all proof fields', () => {
      const restored = deserializeProofs(serializeProofs(proofs));
      expect(restored[0].id).toBe(proofs[0].id);
      expect(restored[0].secret).toBe(proofs[0].secret);
      expect(restored[0].C).toBe(proofs[0].C);
    });

    test('handles amounts above MAX_SAFE_INTEGER without precision loss', () => {
      const large = Amount.from(2n ** 53n + 1n);
      const p: Proof[] = [{ id: '009a1f293253e41e', amount: large, secret: 'abc', C: '02abc' }];
      const restored = deserializeProofs(serializeProofs(p));
      expect(restored[0].amount.equals(large)).toBe(true);
    });

    test('handles empty string[] input', () => {
      expect(deserializeProofs([])).toEqual([]);
    });

    test('throws when string input is not a JSON array', () => {
      expect(() => deserializeProofs('{"id":"abc"}')).toThrow('expected a JSON array of proofs');
    });

    test('handles empty JSON array string', () => {
      expect(deserializeProofs('[]')).toEqual([]);
    });

    test('handles already-parsed object[] (e.g. plain JSON.parse of stored proofs)', () => {
      const legacyObjects = [
        { id: '009a1f293253e41e', amount: 1, secret: 'abc', C: '02abc' },
        { id: '009a1f293253e41e', amount: 2, secret: 'def', C: '02def' },
      ];
      // Simulates: deserializeProofs(JSON.parse(localStorage.getItem('proofs')))
      // where localStorage held a plain JSON array of objects from v3
      const restored = deserializeProofs(legacyObjects);
      expect(restored[0].amount.equals(1)).toBe(true);
      expect(restored[1].amount.equals(2)).toBe(true);
      expect(restored[0].id).toBe('009a1f293253e41e');
      expect(restored[0].secret).toBe('abc');
    });
  });

  describe('normalizeProofAmounts', () => {
    test('converts number amounts to Amount', () => {
      const raw = [{ id: '009a1f293253e41e', amount: 4, secret: 'abc', C: '02abc' }];
      const normalized = normalizeProofAmounts(raw);
      expect(normalized[0].amount.equals(4)).toBe(true);
      expect(normalized[0].amount).toBeInstanceOf(Amount);
    });

    test('accepts string amounts', () => {
      const raw = [{ id: '009a1f293253e41e', amount: '8', secret: 'abc', C: '02abc' }];
      const normalized = normalizeProofAmounts(raw);
      expect(normalized[0].amount.equals(8)).toBe(true);
    });
  });
});

describe('splitAmount edge cases', () => {
  test('throws when keyset has no keys', () => {
    const emptyKeyset: Keys = {};
    expect(() => utils.splitAmount(10, emptyKeyset)).toThrow(/keyset is inactive/);
  });

  test('throws when remaining amount cannot be split', () => {
    // keyset only has denomination 4, so amount 3 can't be represented
    const sparse: Keys = { '4': 'deadbeef' };
    expect(() => utils.splitAmount(3, sparse)).toThrow(/Unable to split remaining amount/);
  });
});

describe('getKeysetAmounts', () => {
  test('returns amounts in descending order by default', () => {
    const amounts = getKeysetAmounts(keys);
    const nums = amounts.map((a) => a.toNumber());
    expect(nums).toStrictEqual([...nums].sort((a, b) => b - a));
    expect(nums[0]).toBe(2048);
  });

  test('returns amounts in ascending order', () => {
    const amounts = getKeysetAmounts(keys, 'asc');
    const nums = amounts.map((a) => a.toNumber());
    expect(nums[0]).toBe(1);
    expect(nums[nums.length - 1]).toBe(2048);
  });
});

describe('sortProofsById', () => {
  test('sorts proofs by keyset id lexicographically', () => {
    const proofs: Proof[] = [
      { id: 'ccc', amount: Amount.from(1), secret: 'a', C: '02a' },
      { id: 'aaa', amount: Amount.from(2), secret: 'b', C: '02b' },
      { id: 'bbb', amount: Amount.from(4), secret: 'c', C: '02c' },
    ];
    const sorted = sortProofsById(proofs);
    expect(sorted.map((p) => p.id)).toStrictEqual(['aaa', 'bbb', 'ccc']);
  });

  test('does not mutate the original array', () => {
    const proofs: Proof[] = [
      { id: 'bbb', amount: Amount.from(1), secret: 'a', C: '02a' },
      { id: 'aaa', amount: Amount.from(2), secret: 'b', C: '02b' },
    ];
    sortProofsById(proofs);
    expect(proofs[0].id).toBe('bbb');
  });
});

describe('getEncodedToken edge cases', () => {
  test('throws for proofs with non-hex keyset IDs', () => {
    const token: Token = {
      mint: 'http://localhost:3338',
      proofs: [{ id: 'not+hex!', amount: Amount.from(1), secret: 'abc', C: '02abc' }],
      unit: 'sat',
    };
    expect(() => utils.getEncodedToken(token)).toThrow(/legacy keyset ID/);
  });
});

describe('getDecodedTokenBinary edge cases', () => {
  test('throws for invalid binary prefix', () => {
    const bad = new TextEncoder().encode('junkBdata');
    expect(() => utils.getDecodedTokenBinary(bad)).toThrow(/not a valid binary token/);
  });
});

describe('tokenFromTemplate rejects valid CBOR of wrong shape', () => {
  test('getDecodedToken (cashuB) throws CTSError, not a raw TypeError', () => {
    const body = utils.encodeCBOR({ m: 'http://localhost:3338', u: 'sat' });
    const token = 'cashuB' + utils.encodeUint8toBase64Url(body);
    expect(() => utils.getDecodedToken(token, [])).toThrow(CTSError);
  });

  test('getDecodedTokenBinary (crawB) throws CTSError, not a raw TypeError', () => {
    const body = utils.encodeCBOR({ m: 'http://localhost:3338', u: 'sat' });
    const prefix = new TextEncoder().encode('crawB');
    const bytes = new Uint8Array(prefix.length + body.length);
    bytes.set(prefix, 0);
    bytes.set(body, prefix.length);
    expect(() => utils.getDecodedTokenBinary(bytes)).toThrow(CTSError);
  });

  test('throws CTSError when a token entry has no proofs array', () => {
    const body = utils.encodeCBOR({ m: 'http://localhost:3338', u: 'sat', t: [{ i: 'nope' }] });
    const token = 'cashuB' + utils.encodeUint8toBase64Url(body);
    expect(() => utils.getDecodedToken(token, [])).toThrow(CTSError);
  });

  test('defaults unit to sat when template omits it', () => {
    const body = utils.encodeCBOR({ m: 'http://localhost:3338', t: [] });
    const token = 'cashuB' + utils.encodeUint8toBase64Url(body);
    const decoded = utils.getDecodedToken(token, []);
    expect(decoded).toEqual({ mint: 'http://localhost:3338', proofs: [], unit: 'sat' });
  });
});

describe('deriveKeysetId edge cases', () => {
  test('throws for unknown version byte', () => {
    expect(() => utils.deriveKeysetId(keys, { versionByte: 99 })).toThrow(
      /Unrecognized keyset ID version/,
    );
  });
});

describe('mapShortKeysetIds via getDecodedToken (v2 keyset IDs)', () => {
  const fullV2Id = NUT02_V2_VECTOR1_KEYS.id; // 01-prefixed, 66 hex chars

  test('maps short v2 keyset ID back to full ID', () => {
    // Encode a token using the full v2 ID — internally it gets truncated to 16 chars
    const token: Token = {
      mint: 'http://localhost:3338',
      proofs: [{ id: fullV2Id, amount: Amount.from(1), secret: 'abc', C: '02' + '00'.repeat(32) }],
      unit: 'sat',
    };
    const encoded = utils.getEncodedToken(token);
    // Decode with the full keyset ID list so mapShortKeysetIds can resolve
    const decoded = utils.getDecodedToken(encoded, [fullV2Id]);
    expect(decoded.proofs[0].id).toBe(fullV2Id);
  });

  test('throws when v2 short ID has no keysets to map to', () => {
    const token: Token = {
      mint: 'http://localhost:3338',
      proofs: [{ id: fullV2Id, amount: Amount.from(1), secret: 'abc', C: '02' + '00'.repeat(32) }],
      unit: 'sat',
    };
    const encoded = utils.getEncodedToken(token);
    expect(() => utils.getDecodedToken(encoded, [])).toThrow(
      /Short keyset ID .* cannot be resolved/,
    );
  });

  test('throws when v2 short ID matches no known keyset', () => {
    const token: Token = {
      mint: 'http://localhost:3338',
      proofs: [{ id: fullV2Id, amount: Amount.from(1), secret: 'abc', C: '02' + '00'.repeat(32) }],
      unit: 'sat',
    };
    const encoded = utils.getEncodedToken(token);
    // Pass an unrelated keyset ID
    expect(() => utils.getDecodedToken(encoded, ['00aaaaaaaaaaaaaaaa'])).toThrow(
      /Couldn't map short keyset ID/,
    );
  });

  test('throws when v2 short ID is ambiguous', () => {
    const token: Token = {
      mint: 'http://localhost:3338',
      proofs: [{ id: fullV2Id, amount: Amount.from(1), secret: 'abc', C: '02' + '00'.repeat(32) }],
      unit: 'sat',
    };
    const encoded = utils.getEncodedToken(token);
    // Two full IDs that share the same 16-char prefix
    const ambiguous = fullV2Id + 'aa';
    expect(() => utils.getDecodedToken(encoded, [fullV2Id, ambiguous])).toThrow(/ambiguous/);
  });
});

describe('mapShortKeysetIds via getDecodedToken (v3 BLS keyset IDs)', () => {
  // 02-prefixed v3 id derived in Phase 3 for the locked Nutshell test vector
  const fullV3Id = '02ce4c47836fd0e64f37a08254777b7fd0dedb95fc1ddd0acadf5600674c743c5d';
  // v3 proofs carry a 96-hex compressed G1 C value
  const v3C =
    'b7a4881059133fd91a8753600d9a5e524c65d6224f6fe2d5aef9e59f1507fdad90b3b4d48ee46da5c8dfaa0b88e28b69';

  test('maps short v3 keyset ID back to full ID round-trip', () => {
    const token: Token = {
      mint: 'http://localhost:3338',
      proofs: [{ id: fullV3Id, amount: Amount.from(1), secret: 'test_message', C: v3C }],
      unit: 'sat',
    };
    const encoded = utils.getEncodedToken(token);
    const decoded = utils.getDecodedToken(encoded, [fullV3Id]);
    expect(decoded.proofs[0].id).toBe(fullV3Id);
    expect(decoded.proofs[0].C).toBe(v3C);
  });

  test('throws when v3 short ID has no keysets to map to', () => {
    const token: Token = {
      mint: 'http://localhost:3338',
      proofs: [{ id: fullV3Id, amount: Amount.from(1), secret: 'test_message', C: v3C }],
      unit: 'sat',
    };
    const encoded = utils.getEncodedToken(token);
    expect(() => utils.getDecodedToken(encoded, [])).toThrow(
      /Short keyset ID .* cannot be resolved/,
    );
  });
});

describe('mapShortKeysetIds full-length pass-through (non-conformant tokens)', () => {
  // Build a cashuB token directly from a CBOR template so we can inject full-length
  // (33-byte) v2/v3 keyset IDs that the standard encoder would otherwise truncate.
  function encodeRawToken(idBytes: Uint8Array, cBytes: Uint8Array): string {
    const template = {
      m: 'http://localhost:3338',
      u: 'sat',
      t: [
        {
          i: idBytes,
          p: [{ a: 1n, s: 'abc', c: cBytes }],
        },
      ],
    };
    return 'cashuB' + utils.encodeUint8toBase64Url(utils.encodeCBOR(template));
  }

  test('passes full-length v2 ID through unchanged with empty keyset cache', () => {
    const fullV2Id = NUT02_V2_VECTOR1_KEYS.id;
    const encoded = encodeRawToken(hexToBytes(fullV2Id), hexToBytes('02' + '00'.repeat(32)));
    const decoded = utils.getDecodedToken(encoded, []);
    expect(decoded.proofs[0].id).toBe(fullV2Id);
  });

  test('passes full-length v3 ID through unchanged with empty keyset cache', () => {
    const fullV3Id = '02ce4c47836fd0e64f37a08254777b7fd0dedb95fc1ddd0acadf5600674c743c5d';
    const v3C =
      'b7a4881059133fd91a8753600d9a5e524c65d6224f6fe2d5aef9e59f1507fdad90b3b4d48ee46da5c8dfaa0b88e28b69';
    const encoded = encodeRawToken(hexToBytes(fullV3Id), hexToBytes(v3C));
    const decoded = utils.getDecodedToken(encoded, []);
    expect(decoded.proofs[0].id).toBe(fullV3Id);
  });

  test('throws on malformed modern hex ID length (neither 16 nor 66)', () => {
    // 20-char hex: 0x01-prefixed but not a valid short (16) or full (66) length
    const malformedId = '01' + '00'.repeat(9); // 20 chars total
    const encoded = encodeRawToken(hexToBytes(malformedId), hexToBytes('02' + '00'.repeat(32)));
    expect(() => utils.getDecodedToken(encoded, [])).toThrow(
      /Malformed keyset ID \(unexpected length\)/,
    );
  });
});

describe('normalizeUrl', () => {
  test('strips trailing slash', () => {
    expect(normalizeUrl('https://mint.example.com/')).toBe('https://mint.example.com');
  });
  test('strips multiple trailing slashes', () => {
    expect(normalizeUrl('https://mint.example.com///')).toBe('https://mint.example.com');
  });
  test('preserves path', () => {
    expect(normalizeUrl('https://mint.example.com/v1/mint')).toBe(
      'https://mint.example.com/v1/mint',
    );
  });
  test('throws on malformed URL', () => {
    expect(() => normalizeUrl('not-a-url')).toThrow('Invalid mint URL: not-a-url');
  });
  test('throws on non-http scheme', () => {
    expect(() => normalizeUrl('ftp://mint.example.com')).toThrow('Invalid mint URL scheme: ftp:');
  });
  test('accepts http', () => {
    expect(normalizeUrl('http://localhost:3338')).toBe('http://localhost:3338');
  });
  test('accepts .onion', () => {
    expect(normalizeUrl('http://abc123.onion/path')).toBe('http://abc123.onion/path');
  });
  test('rejects query parameters', () => {
    expect(() => normalizeUrl('https://mint.example.com?token=abc')).toThrow(
      'Mint URL must not contain query parameters',
    );
  });
  test('rejects trailing ? with no query value', () => {
    expect(() => normalizeUrl('https://mint.example.com/path?')).toThrow(
      'Mint URL must not contain query parameters',
    );
  });
  test('rejects fragment', () => {
    expect(() => normalizeUrl('https://mint.example.com#section')).toThrow(
      'Mint URL must not contain a fragment',
    );
  });
  test('rejects trailing # with no fragment value', () => {
    expect(() => normalizeUrl('https://mint.example.com/path#')).toThrow(
      'Mint URL must not contain a fragment',
    );
  });
  test('rejects credentials', () => {
    expect(() => normalizeUrl('https://user:pass@mint.example.com')).toThrow(
      'Mint URL must not contain credentials',
    );
    expect(() => normalizeUrl('https://user@mint.example.com')).toThrow(
      'Mint URL must not contain credentials',
    );
  });
  test('rejects percent-encoded path characters', () => {
    expect(() => normalizeUrl('https://mint.example.com/path%3Ftoken=abc')).toThrow(
      'Mint URL path must not contain percent-encoded characters',
    );
    expect(() => normalizeUrl('https://mint.example.com/path%23fragment')).toThrow(
      'Mint URL path must not contain percent-encoded characters',
    );
    expect(() => normalizeUrl('https://mint.example.com/path%2Fadmin')).toThrow(
      'Mint URL path must not contain percent-encoded characters',
    );
  });
  test('lowercases hostname', () => {
    expect(normalizeUrl('https://Mint.Example.COM')).toBe('https://mint.example.com');
  });
});
