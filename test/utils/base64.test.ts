import { test, describe, expect } from 'vitest';

import { CTSError } from '../../src/model/Errors';
import {
  decodeBase64UrlToJson,
  decodeBase64UrlToUint8,
  decodeBase64ToUint8Legacy,
  encodeJsonToBase64Url,
  encodeUint8ToBase64,
  isBase64String,
} from '../../src/utils';
describe('testing uint8 encoding', () => {
  test('uint8 to base64', async () => {
    const message = 'test';
    const enc = new TextEncoder();
    const encoded = enc.encode(message);
    expect(encodeUint8ToBase64(encoded)).toBe('dGVzdA==');
  });
  test('base64 to uint8', async () => {
    const dec = new TextDecoder();
    expect(dec.decode(decodeBase64UrlToUint8('dGVzdA=='))).toBe('test');
  });
  test('Object to base64', () => {
    const obj = [
      {
        id: '0NI3TUAs1Sfy',
        amount: 8,
        C: '037695083226b9c63649d8068eb789a891e621e77dff4e7d75ac02479fe71c886b',
        secret: 'lFcxbPO870srsOKb4e+MvRAmWBE206b6BMi5nKrq1t4=',
      },
      {
        id: '0NI3TUAs1Sfy',
        amount: 64,
        C: '03e58e37f3aa5719c5743811511a6e6459245f008269bd809b9b89cc2fd3683241',
        secret: 'HV6S9GY9f9YsiZSY9V/T4uc239VwsfqDbUfqr+vd4w0=',
      },
      {
        id: '0NI3TUAs1Sfy',
        amount: 128,
        C: '030715a873242f59fe3f67121f0a4afb22aaa24b10a9832929f61ab28cdf0d3630',
        secret: 'GI85ytubezCEDgxecriX6eKOZJV9p831BlsMQeBzjvQ=',
      },
    ];
    expect(encodeJsonToBase64Url(obj)).toBe(
      'W3siaWQiOiIwTkkzVFVBczFTZnkiLCJhbW91bnQiOjgsIkMiOiIwMzc2OTUwODMyMjZiOWM2MzY0OWQ4MDY4ZWI3ODlhODkxZTYyMWU3N2RmZjRlN2Q3NWFjMDI0NzlmZTcxYzg4NmIiLCJzZWNyZXQiOiJsRmN4YlBPODcwc3JzT0tiNGUrTXZSQW1XQkUyMDZiNkJNaTVuS3JxMXQ0PSJ9LHsiaWQiOiIwTkkzVFVBczFTZnkiLCJhbW91bnQiOjY0LCJDIjoiMDNlNThlMzdmM2FhNTcxOWM1NzQzODExNTExYTZlNjQ1OTI0NWYwMDgyNjliZDgwOWI5Yjg5Y2MyZmQzNjgzMjQxIiwic2VjcmV0IjoiSFY2UzlHWTlmOVlzaVpTWTlWL1Q0dWMyMzlWd3NmcURiVWZxcit2ZDR3MD0ifSx7ImlkIjoiME5JM1RVQXMxU2Z5IiwiYW1vdW50IjoxMjgsIkMiOiIwMzA3MTVhODczMjQyZjU5ZmUzZjY3MTIxZjBhNGFmYjIyYWFhMjRiMTBhOTgzMjkyOWY2MWFiMjhjZGYwZDM2MzAiLCJzZWNyZXQiOiJHSTg1eXR1YmV6Q0VEZ3hlY3JpWDZlS09aSlY5cDgzMUJsc01RZUJ6anZRPSJ9XQ',
    );
  });
  const base64String =
    'W3siaWQiOiIwTkkzVFVBczFTZnkiLCJhbW91bnQiOjgsIkMiOiIwMzc2OTUwODMyMjZiOWM2MzY0OWQ4MDY4ZWI3ODlhODkxZTYyMWU3N2RmZjRlN2Q3NWFjMDI0NzlmZTcxYzg4NmIiLCJzZWNyZXQiOiJsRmN4YlBPODcwc3JzT0tiNGUrTXZSQW1XQkUyMDZiNkJNaTVuS3JxMXQ0PSJ9LHsiaWQiOiIwTkkzVFVBczFTZnkiLCJhbW91bnQiOjY0LCJDIjoiMDNlNThlMzdmM2FhNTcxOWM1NzQzODExNTExYTZlNjQ1OTI0NWYwMDgyNjliZDgwOWI5Yjg5Y2MyZmQzNjgzMjQxIiwic2VjcmV0IjoiSFY2UzlHWTlmOVlzaVpTWTlWL1Q0dWMyMzlWd3NmcURiVWZxcit2ZDR3MD0ifSx7ImlkIjoiME5JM1RVQXMxU2Z5IiwiYW1vdW50IjoxMjgsIkMiOiIwMzA3MTVhODczMjQyZjU5ZmUzZjY3MTIxZjBhNGFmYjIyYWFhMjRiMTBhOTgzMjkyOWY2MWFiMjhjZGYwZDM2MzAiLCJzZWNyZXQiOiJHSTg1eXR1YmV6Q0VEZ3hlY3JpWDZlS09aSlY5cDgzMUJsc01RZUJ6anZRPSJ9XQ';
  test('base64 to object', () => {
    expect(decodeBase64UrlToJson(base64String)).toEqual([
      {
        id: '0NI3TUAs1Sfy',
        amount: 8,
        C: '037695083226b9c63649d8068eb789a891e621e77dff4e7d75ac02479fe71c886b',
        secret: 'lFcxbPO870srsOKb4e+MvRAmWBE206b6BMi5nKrq1t4=',
      },
      {
        id: '0NI3TUAs1Sfy',
        amount: 64,
        C: '03e58e37f3aa5719c5743811511a6e6459245f008269bd809b9b89cc2fd3683241',
        secret: 'HV6S9GY9f9YsiZSY9V/T4uc239VwsfqDbUfqr+vd4w0=',
      },
      {
        id: '0NI3TUAs1Sfy',
        amount: 128,
        C: '030715a873242f59fe3f67121f0a4afb22aaa24b10a9832929f61ab28cdf0d3630',
        secret: 'GI85ytubezCEDgxecriX6eKOZJV9p831BlsMQeBzjvQ=',
      },
    ]);
  });
  test('bigint amount round-trip', () => {
    const unsafeAmount = 2n ** 53n + 1n; // first value above MAX_SAFE_INTEGER
    const obj = [
      {
        id: '0NI3TUAs1Sfy',
        amount: unsafeAmount,
        C: '037695083226b9c63649d8068eb789a891e621e77dff4e7d75ac02479fe71c886b',
        secret: 'lFcxbPO870srsOKb4e+MvRAmWBE206b6BMi5nKrq1t4=',
      },
    ];
    const encoded = encodeJsonToBase64Url(obj);
    const decoded = decodeBase64UrlToJson<typeof obj>(encoded);
    expect(decoded[0].amount).toBe(unsafeAmount);
    expect(typeof decoded[0].amount).toBe('bigint');
  });
  test('safe integer amount stays number', () => {
    const obj = [{ amount: 8 }];
    const decoded = decodeBase64UrlToJson<typeof obj>(encodeJsonToBase64Url(obj));
    expect(decoded[0].amount).toBe(8);
    expect(typeof decoded[0].amount).toBe('number');
  });
  test('base64url: convert to/from base64', () => {
    const base64url = 'eyJ0ZXN0RGF0YSI6IvCfj7PvuI_wn4-z77iPIn0';
    // const base64 = 'eyJ0ZXN0RGF0YSI6IvCfj7PvuI/wn4+z77iPIn0='
    const obj = { testData: '🏳️🏳️' };

    expect(decodeBase64UrlToJson(base64url)).toStrictEqual(obj);
    expect(encodeJsonToBase64Url(obj)).toStrictEqual(base64url);
  });
  test('test script secret to from base64', () => {
    const base64url =
      'eyJ0b2tlbiI6W3sicHJvb2ZzIjpbeyJpZCI6IjAwOWExZjI5MzI1M2U0MWUiLCJhbW91bnQiOjEsInNlY3JldCI6IltcIlAyUEtcIix7XCJub25jZVwiOlwiZDU2YWM4MzljMzdiZWRiNGM1MGIxODcxOTY1MDI2N2E2MWIzMTBlZjdhY2Q5ZWFjMzgwZmIxZmRmNmM1ZjkxNlwiLFwiZGF0YVwiOlwiYjM4Y2FjMmY0N2QzZWNjYjY0NmUxYmFiZDBiNDFlMzZhMTc5MmRlZjlhODU5ODRlNWZiZmVkZTU1ZjQ4Yjc4OVwifV0iLCJDIjoiMDM4YTcyZWRmNWRmN2M3ZmNiMTRhMDhjYjhiZDljODVlOTVkZmM0MzY4ZTU5YTk3OTRkZmI5OTAxZWEyZDIxNzI5In1dLCJtaW50IjoiaHR0cHM6Ly90ZXN0bnV0LmNhc2h1LnNwYWNlIn1dfQ';
    // const base64 = 'eyJ0ZXN0RGF0YSI6IvCfj7PvuI/wn4+z77iPIn0='
    const obj = {
      token: [
        {
          proofs: [
            {
              id: '009a1f293253e41e',
              amount: 1,
              secret:
                '["P2PK",{"nonce":"d56ac839c37bedb4c50b18719650267a61b310ef7acd9eac380fb1fdf6c5f916","data":"b38cac2f47d3eccb646e1babd0b41e36a1792def9a85984e5fbfede55f48b789"}]',
              C: '038a72edf5df7c7fcb14a08cb8bd9c85e95dfc4368e59a9794dfb9901ea2d21729',
            },
          ],
          mint: 'https://testnut.cashu.space',
        },
      ],
    };

    expect(decodeBase64UrlToJson(base64url)).toStrictEqual(obj);
    expect(encodeJsonToBase64Url(obj)).toStrictEqual(base64url);
  });
});
describe('isBase64String', () => {
  // standard base64 with padding
  test('valid: standard base64 with padding', () => {
    expect(isBase64String('dGVzdA==')).toBe(true); // "test"
  });

  // base64url without padding
  test('valid: base64url without padding', () => {
    expect(isBase64String('eyJ0ZXN0Ijoi8J-QiCJ9')).toBe(true); // {"test":"😀"} url-safe, no padding
  });

  // accepts missing padding where implied
  test('valid: missing padding but decodable', () => {
    // "test" without padding
    expect(isBase64String('dGVzdA')).toBe(true);
  });

  // invalid characters
  test('invalid: contains forbidden characters', () => {
    expect(isBase64String('abc$def')).toBe(false);
  });

  // invalid length (cannot be padded to valid base64)
  test('invalid: undecodable sequence', () => {
    // crafted to fail decode after padding
    expect(isBase64String('ab?')).toBe(false);
  });

  test('invalid: empty string', () => {
    expect(isBase64String('')).toBe(false);
  });
});
// One codec now, so there is no Buffer / atob backend split left to parametrize over.
describe('strict base64 decoding', () => {
  const dec = new TextDecoder();

  test.each([
    ['mid-string padding', 'dGVz=dA=='],
    ['invalid characters', 'dGVz$dA='],
    ['excess padding', 'dGVzdA==='],
    ['a length no padding can complete', 'dGVzd'],
  ])('rejects %s', (_label, input) => {
    expect(() => decodeBase64UrlToUint8(input)).toThrow(/Invalid base64/);
  });

  test.each([
    ['padded input', 'dGVzdA==', 'test'],
    ['unpadded input', 'dGVzdA', 'test'],
    ['short padding', 'dGVzdA=', 'test'],
    ['spurious padding', 'dGVz=', 'tes'],
    ['padding-only input', '==', ''],
    ['line-wrapped input', 'dGVz\ndA==\n', 'test'],
    ['edge Unicode whitespace', '\u00a0\ufeffdGVzdA==\u3000', 'test'],
  ])('decodes %s', (_label, input, expected) => {
    expect(dec.decode(decodeBase64UrlToUint8(input))).toBe(expected);
  });
});

test('v3 token path rejects excess padding', () => {
  expect(() => decodeBase64UrlToJson('eyJhIjoxfQ===')).toThrow(/Invalid base64/);
});

describe('alphabet split', () => {
  test('decodes a deprecated keyset ID, which is standard base64', () => {
    expect(decodeBase64ToUint8Legacy('+//wAAAAAAAA')).toEqual(
      new Uint8Array([251, 255, 240, 0, 0, 0, 0, 0, 0]),
    );
  });

  test('rejects a url-safe payload on the legacy decoder', () => {
    expect(() => decodeBase64ToUint8Legacy('--__AAAAAAAA')).toThrow(CTSError);
  });

  test('rejects a mixed-alphabet string, as CDK does', () => {
    expect(isBase64String('a-b+cAAAAAAA')).toBe(false);
  });

  test('rejects input that normalizes to empty', () => {
    expect(isBase64String('   ')).toBe(false);
    expect(isBase64String('==')).toBe(false);
  });

  test('encodes undefined as an empty payload', () => {
    expect(encodeJsonToBase64Url(undefined)).toBe('');
  });
});
