import { describe, expect, test } from 'vitest';

import { Amount, CTSError, type Proof } from '../../src';
import {
  assertSecretKind,
  createSecret,
  getDataField,
  getSecretData,
  getSecretKind,
  getTag,
  getTagInt,
  getTagScalar,
  getTags,
  hasTag,
  parseHTLCSecret,
  parseSecret,
} from '../../src/crypto';

// Valid NUT-10 data slots reused when building malformed fixtures.
const NONCE = 'c9b0fabb8007c0db4bef64d5d128cdcf3c79e8bb780c3294adf4c88e96c32647';
const DATA = 'ec4916dd28fc4c10d78e287ca5d9cc51ee1ae73cbfde08c6b37324cbfaac8bc5';

const proof: Proof = {
  amount: Amount.from(2),
  id: '00bfa73302d12ffd',
  secret:
    '["HTLC",{"nonce":"c9b0fabb8007c0db4bef64d5d128cdcf3c79e8bb780c3294adf4c88e96c32647","data":"ec4916dd28fc4c10d78e287ca5d9cc51ee1ae73cbfde08c6b37324cbfaac8bc5","tags":[["pubkeys","039e6ec7e922abb4162235b3a42965eb11510b07b7461f6b1a17478b1c9c64d100"],["locktime","1"],["refund","02ce1bbd2c9a4be8029c9a6435ad601c45677f5cde81f8a7f0ed535e0039d0eb6c","03c43c00ff57f63cfa9e732f0520c342123e21331d0121139f1b636921eeec095f"],["n_sigs_refund","2"],["sigflag","SIG_ALL"]]}]',
  C: '0344b6f1471cf18a8cbae0e624018c816be5e3a9b04dcb7689f64173c1ae90a3a5',
  witness:
    '{"preimage":"0000000000000000000000000000000000000000000000000000000000000001","signatures":["98e21672d409cc782c720f203d8284f0af0c8713f18167499f9f101b7050c3e657fb0e57478ebd8bd561c31aa6c30f4cd20ec38c73f5755b7b4ddee693bca5a5","693f40129dbf905ed9c8008081c694f72a36de354f9f4fa7a61b389cf781f62a0ae0586612fb2eb504faaf897fefb6742309186117f4743bcebcb8e350e975e2"]}',
};

describe('NUT10 module core functions', () => {
  test('parseSecret parses a valid secret', () => {
    const result = parseSecret(proof.secret);
    expect(result).toContain('HTLC');
  });

  test('parseSecret throws for invalid NUT-10 secret (bad JSON)', () => {
    const secretStr = `["HTLC",{"nonce":"c9b0fabb8007c0db4bef64d5d128cdcf3c79e8bb780c3294adf4c88e96c32647","bad"data":"028c7651fc36f8c10287833a2ad78c996febf5213dc7aab798f744f86385e28d9a"}]`;
    expect(() => {
      parseHTLCSecret(secretStr);
    }).toThrow("Can't parse secret");
    try {
      parseHTLCSecret(secretStr);
    } catch (e) {
      expect(e).toBeInstanceOf(CTSError);
      expect((e as CTSError).cause).toBeInstanceOf(SyntaxError);
    }
  });

  test('parseSecret throws for invalid NUT-10 secret (bad kind)', () => {
    const secretStr = `[123,{"nonce":"c9b0fabb8007c0db4bef64d5d128cdcf3c79e8bb780c3294adf4c88e96c32647","data":"028c7651fc36f8c10287833a2ad78c996febf5213dc7aab798f744f86385e28d9a"}]`;
    expect(() => {
      parseHTLCSecret(secretStr);
    }).toThrow(/Invalid NUT-10 secret/);
  });

  test('parseSecret throws for invalid NUT-10 secret (bad nonce)', () => {
    const secretStr = `["P2PK",{"nonce":123,"data":"028c7651fc36f8c10287833a2ad78c996febf5213dc7aab798f744f86385e28d9a"}]`;
    expect(() => {
      parseHTLCSecret(secretStr);
    }).toThrow(/Invalid NUT-10 secret/);
  });

  test('parseSecret throws for invalid NUT-10 secret (bad data)', () => {
    const secretStr =
      '["HTLC",{"nonce":"c9b0fabb8007c0db4bef64d5d128cdcf3c79e8bb780c3294adf4c88e96c32647","data":123,"tags":[["pubkeys","039e6ec7e922abb4162235b3a42965eb11510b07b7461f6b1a17478b1c9c64d100"],["locktime","1"],["refund","02ce1bbd2c9a4be8029c9a6435ad601c45677f5cde81f8a7f0ed535e0039d0eb6c","03c43c00ff57f63cfa9e732f0520c342123e21331d0121139f1b636921eeec095f"],["n_sigs_refund","2"],["sigflag","SIG_ALL"]]}]';
    expect(() => {
      parseHTLCSecret(secretStr);
    }).toThrow(/Invalid NUT-10 secret/);
  });

  test('parseSecret throws for invalid NUT-10 secret (tags not array)', () => {
    const secretStr =
      '["HTLC",{"nonce":"c9b0fabb8007c0db4bef64d5d128cdcf3c79e8bb780c3294adf4c88e96c32647","data":"123","tags":{"pubkeys":"039e6ec7e922abb4162235b3a42965eb11510b07b7461f6b1a17478b1c9c64d100","locktime":"1"}}]';
    expect(() => {
      parseHTLCSecret(secretStr);
    }).toThrow(/Invalid NUT-10 secret/);
  });

  test('parseSecret throws for invalid NUT-10 secret (n_sigs_refund tag is not a string)', () => {
    const secretStr =
      '["HTLC",{"nonce":"c9b0fabb8007c0db4bef64d5d128cdcf3c79e8bb780c3294adf4c88e96c32647","data":"123","tags":[["pubkeys","039e6ec7e922abb4162235b3a42965eb11510b07b7461f6b1a17478b1c9c64d100"],["locktime","1"],["refund","02ce1bbd2c9a4be8029c9a6435ad601c45677f5cde81f8a7f0ed535e0039d0eb6c","03c43c00ff57f63cfa9e732f0520c342123e21331d0121139f1b636921eeec095f"],["n_sigs_refund",2],["sigflag","SIG_ALL"]]}]';
    expect(() => {
      parseHTLCSecret(secretStr);
    }).toThrow(/Invalid NUT-10 tag/);
  });

  test('parseSecret throws for invalid NUT-10 secret (n_sigs_refund tag has empty value)', () => {
    const secretStr =
      '["HTLC",{"nonce":"c9b0fabb8007c0db4bef64d5d128cdcf3c79e8bb780c3294adf4c88e96c32647","data":"123","tags":[["pubkeys","039e6ec7e922abb4162235b3a42965eb11510b07b7461f6b1a17478b1c9c64d100"],["locktime","1"],["refund","02ce1bbd2c9a4be8029c9a6435ad601c45677f5cde81f8a7f0ed535e0039d0eb6c","03c43c00ff57f63cfa9e732f0520c342123e21331d0121139f1b636921eeec095f"],["n_sigs_refund","2",""],["sigflag","SIG_ALL"]]}]';
    expect(() => {
      parseHTLCSecret(secretStr);
    }).toThrow(/Invalid NUT-10 tag/);
  });

  test('hasTag finds tags', () => {
    expect(hasTag(proof.secret, 'locktime')).toBeTruthy();
    expect(hasTag(proof.secret, 'n_sigs_refund')).toBeTruthy();
    expect(hasTag(proof.secret, 'not_exists')).toBeFalsy();
  });

  test('getTagInt finds tags', () => {
    expect(getTagInt(proof.secret, 'locktime')).toEqual(1);
    expect(getTagInt(proof.secret, 'not_exists')).toBeFalsy();
    expect(getTagInt(proof.secret, 'sigflag')).toBeFalsy();
  });
});

describe('NUT10 parseSecret round-trip and serialization', () => {
  test('parseSecret preserves kind, nonce, data and tags', () => {
    const [kind, data] = parseSecret(proof.secret);
    expect(kind).toBe('HTLC');
    expect(data.nonce).toBe(NONCE);
    expect(data.data).toBe(DATA);
    expect(data.tags).toContainEqual(['locktime', '1']);
    expect(data.tags).toContainEqual([
      'refund',
      '02ce1bbd2c9a4be8029c9a6435ad601c45677f5cde81f8a7f0ed535e0039d0eb6c',
      '03c43c00ff57f63cfa9e732f0520c342123e21331d0121139f1b636921eeec095f',
    ]);
  });

  test('createSecret output parses back to the same kind, data and tags', () => {
    const tags = [['locktime', '42']];
    const [kind, data] = parseSecret(createSecret('P2PK', DATA, tags));
    expect(kind).toBe('P2PK');
    expect(data.data).toBe(DATA);
    expect(data.tags).toEqual(tags);
    // Nonce is 32 random bytes hex-encoded (64 chars).
    expect(data.nonce).toMatch(/^[0-9a-f]{64}$/);
  });

  test('createSecret without tags yields no tags', () => {
    const [, data] = parseSecret(createSecret('P2PK', DATA));
    expect(data.tags).toBeUndefined();
  });

  test('parseSecret accepts a Secret tuple unchanged (pass-through)', () => {
    const [kind, data] = parseSecret(['P2PK', { nonce: NONCE, data: DATA }]);
    expect(kind).toBe('P2PK');
    expect(data.data).toBe(DATA);
  });
});

describe('NUT10 parseSecret shape validation', () => {
  test('rejects a non-array top level', () => {
    expect(() => parseSecret(`{"nonce":"${NONCE}","data":"${DATA}"}`)).toThrow(
      /^Invalid NUT-10 secret$/,
    );
  });

  test('rejects an array whose length is not 2', () => {
    expect(() => parseSecret(`["P2PK",{"nonce":"${NONCE}","data":"${DATA}"},"extra"]`)).toThrow(
      /^Invalid NUT-10 secret$/,
    );
    expect(() => parseSecret('["P2PK"]')).toThrow(/^Invalid NUT-10 secret$/);
  });

  test('rejects a non-string kind', () => {
    expect(() => parseSecret(`[123,{"nonce":"${NONCE}","data":"${DATA}"}]`)).toThrow(
      /^Invalid NUT-10 secret$/,
    );
  });

  test('rejects a blank (whitespace-only) kind', () => {
    expect(() => parseSecret(`["   ",{"nonce":"${NONCE}","data":"${DATA}"}]`)).toThrow(
      /^Invalid NUT-10 secret$/,
    );
  });

  test('rejects a non-object data slot', () => {
    expect(() => parseSecret('["P2PK","not-an-object"]')).toThrow(/^Invalid NUT-10 secret$/);
  });

  test('rejects a null data slot', () => {
    expect(() => parseSecret('["P2PK",null]')).toThrow(/^Invalid NUT-10 secret$/);
  });

  test('rejects a non-string nonce or data', () => {
    expect(() => parseSecret(`["P2PK",{"nonce":123,"data":"${DATA}"}]`)).toThrow(/nonce \/ data/);
    expect(() => parseSecret(`["P2PK",{"nonce":"${NONCE}","data":123}]`)).toThrow(/nonce \/ data/);
  });
});

describe('NUT10 parseSecret tag validation', () => {
  const withTags = (tags: string): string =>
    `["P2PK",{"nonce":"${NONCE}","data":"${DATA}","tags":${tags}}]`;

  test('rejects tags that are not an array', () => {
    expect(() => parseSecret(withTags('{"a":"b"}'))).toThrow(/Invalid NUT-10 secret tags/);
  });

  test('rejects a tag element that is not an array', () => {
    expect(() => parseSecret(withTags('[["locktime","1"],"oops"]'))).toThrow(/Invalid NUT-10 tag/);
  });

  test('rejects an empty tag array', () => {
    expect(() => parseSecret(withTags('[[]]'))).toThrow(/Invalid NUT-10 tag/);
  });

  test('rejects a non-string tag value', () => {
    expect(() => parseSecret(withTags('[["locktime",123]]'))).toThrow(/Invalid NUT-10 tag/);
  });

  test('rejects an empty-string tag value', () => {
    expect(() => parseSecret(withTags('[["locktime",""]]'))).toThrow(/Invalid NUT-10 tag/);
  });
});

describe('NUT10 kind and data accessors', () => {
  test('assertSecretKind returns the parsed secret when the kind matches', () => {
    const parsed = assertSecretKind(['HTLC', 'P2PK'], proof.secret);
    expect(parsed[0]).toBe('HTLC');
  });

  test('assertSecretKind lists allowed kinds comma-separated on mismatch', () => {
    const secret = `["BOGUS",{"nonce":"${NONCE}","data":"${DATA}"}]`;
    expect(() => assertSecretKind(['P2PK', 'HTLC'], secret)).toThrow(/Allowed: P2PK, HTLC/);
  });

  test('getSecretKind, getSecretData and getDataField read the secret', () => {
    expect(getSecretKind(proof.secret)).toBe('HTLC');
    expect(getSecretData(proof.secret).nonce).toBe(NONCE);
    expect(getDataField(proof.secret)).toBe(DATA);
  });
});

describe('NUT10 tag accessors', () => {
  test('getTags returns an empty array when a secret has no tags', () => {
    const tags = getTags(createSecret('P2PK', DATA));
    expect(tags).toEqual([]);
    expect(tags).toHaveLength(0);
  });

  test('getTag returns tag values excluding the key', () => {
    expect(getTag(proof.secret, 'refund')).toEqual([
      '02ce1bbd2c9a4be8029c9a6435ad601c45677f5cde81f8a7f0ed535e0039d0eb6c',
      '03c43c00ff57f63cfa9e732f0520c342123e21331d0121139f1b636921eeec095f',
    ]);
  });

  test('getTag returns undefined for a key-only tag', () => {
    const secret = `["P2PK",{"nonce":"${NONCE}","data":"${DATA}","tags":[["flag"]]}]`;
    expect(getTag(secret, 'flag')).toBeUndefined();
  });

  test('getTag returns undefined for a missing key', () => {
    expect(getTag(proof.secret, 'not_exists')).toBeUndefined();
  });

  test('getTagScalar returns the first value for a present tag', () => {
    expect(getTagScalar(proof.secret, 'locktime')).toBe('1');
  });

  test('getTagScalar returns undefined for a missing key', () => {
    expect(getTagScalar(proof.secret, 'not_exists')).toBeUndefined();
  });
});
