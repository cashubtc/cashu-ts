import { HttpResponse, http } from 'msw';
import { test, describe, expect } from 'vitest';

import { randomBytes } from '@noble/hashes/utils.js';

import { Wallet, type MintKeys, type MintKeyset } from '../../src';
import { deriveKeysetId, isValidHex, isBase64String } from '../../src/utils';
import { DUMMY_TEST_KEYS, DUMMY_TEST_KEYSET, PUBKEYS } from '../consts';
import { useTestServer, mint, mintUrl, token3sat } from './_setup';

const server = useTestServer();

// Legacy (pre-v1) deprecated base64 keyset whose id verifies against its keys
const legacyId = deriveKeysetId(PUBKEYS, { isDeprecatedBase64: true });
const legacyKeyset: MintKeyset = { id: legacyId, unit: 'sat', active: true, input_fee_ppk: 0 };
const legacyKeys: MintKeys = { ...legacyKeyset, keys: PUBKEYS };

// Inactive v2 (01-prefixed) keyset whose id verifies against its keys
const inactiveId = deriveKeysetId(PUBKEYS, { versionByte: 1, unit: 'sat' });
const inactiveKeyset: MintKeyset = { id: inactiveId, unit: 'sat', active: false, input_fee_ppk: 0 };
const inactiveKeys: MintKeys = { ...inactiveKeyset, keys: PUBKEYS };

// valid compressed secp point (any well-formed 33-byte point will do)
const VALID_POINT = '021179b095a67380ab3285424b563b7aab9818bd38068e1930641b3dceb364d422';

function useLegacyHandlers() {
  server.use(
    http.get(mintUrl + '/v1/keysets', () =>
      HttpResponse.json({ keysets: [DUMMY_TEST_KEYSET, legacyKeyset] }),
    ),
    http.get(mintUrl + '/v1/keys', () =>
      HttpResponse.json({ keysets: [DUMMY_TEST_KEYS, legacyKeys] }),
    ),
  );
}

function useInactiveHandlers() {
  server.use(
    http.get(mintUrl + '/v1/keysets', () =>
      HttpResponse.json({ keysets: [DUMMY_TEST_KEYSET, inactiveKeyset] }),
    ),
    http.get(mintUrl + '/v1/keys', () =>
      HttpResponse.json({ keysets: [DUMMY_TEST_KEYS, inactiveKeys] }),
    ),
  );
}

describe('Legacy (pre-v1) keyset output gating', () => {
  test('fixture sanity: legacy keyset id is base64, not hex, and verifies', async () => {
    expect(isValidHex(legacyId)).toBe(false);
    expect(isBase64String(legacyId)).toBe(true);

    useLegacyHandlers();
    const wallet = new Wallet(mint);
    await wallet.loadMint();

    // Keys must survive keychain verification, or the gate test below would
    // pass for the wrong reason ('Keyset has no keys loaded').
    const keyset = wallet.keyChain.getKeyset(legacyId);
    expect(keyset.hasKeys).toBe(true);
    expect(keyset.hasHexId).toBe(false);
  });

  test('prepareMint refuses to create proofs on a legacy keyset', async () => {
    useLegacyHandlers();
    const wallet = new Wallet(mint);
    await wallet.loadMint();

    await expect(
      wallet.prepareMint('bolt11', 3, { quote: 'test-quote' }, { keysetId: legacyId }),
    ).rejects.toThrow(/legacy keyset/i);
  });

  test('receive refuses to create proofs on a legacy keyset', async () => {
    useLegacyHandlers();
    const wallet = new Wallet(mint);
    await wallet.loadMint();

    await expect(wallet.receive(token3sat, { keysetId: legacyId })).rejects.toThrow(
      /legacy keyset/i,
    );
  });

  test('prepareMint still works on the bound (hex) keyset', async () => {
    useLegacyHandlers();
    const wallet = new Wallet(mint);
    await wallet.loadMint();

    const preview = await wallet.prepareMint('bolt11', 3, { quote: 'test-quote' });
    expect(preview.keysetId).toBe(DUMMY_TEST_KEYSET.id);
  });

  test('prepareMint refuses to create proofs on an inactive keyset', async () => {
    useInactiveHandlers();
    const wallet = new Wallet(mint);
    await wallet.loadMint();

    // Fixture sanity: keys must survive verification so the gate fails for
    // the right reason (not 'Keyset has no keys loaded').
    const keyset = wallet.keyChain.getKeyset(inactiveId);
    expect(keyset.hasKeys).toBe(true);
    expect(keyset.isActive).toBe(false);

    await expect(
      wallet.prepareMint('bolt11', 3, { quote: 'test-quote' }, { keysetId: inactiveId }),
    ).rejects.toThrow(/inactive keyset/i);
  });

  test('completeMint constructs proofs even if the keyset was deactivated after prepare', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();

    const preview = await wallet.prepareMint('bolt11', 3, { quote: 'test-quote' });

    // Keyset rotates to inactive between prepare and complete. The mint has
    // already signed; refusing to construct proofs would strand the ecash.
    server.use(
      http.get(mintUrl + '/v1/keysets', () =>
        HttpResponse.json({ keysets: [{ ...DUMMY_TEST_KEYSET, active: false }] }),
      ),
      http.get(mintUrl + '/v1/keys', () =>
        HttpResponse.json({ keysets: [{ ...DUMMY_TEST_KEYS, active: false }] }),
      ),
      http.post(mintUrl + '/v1/mint/bolt11', () =>
        HttpResponse.json({
          signatures: preview.outputData.map((d) => ({
            id: d.blindedMessage.id,
            amount: Number(d.blindedMessage.amount.toString()),
            C_: VALID_POINT,
          })),
        }),
      ),
    );
    await wallet.loadMint(true);

    const proofs = await wallet.completeMint(preview);
    expect(proofs).toHaveLength(preview.outputData.length);
  });

  test('mint quotes are refused when the mint has no active keyset', async () => {
    // Mint only has an inactive keyset: loadMint tolerates this (wallet
    // remains unbound), but a paid quote could never be redeemed for proofs.
    server.use(
      http.get(mintUrl + '/v1/keysets', () => HttpResponse.json({ keysets: [inactiveKeyset] })),
      http.get(mintUrl + '/v1/keys', () => HttpResponse.json({ keysets: [inactiveKeys] })),
    );
    const wallet = new Wallet(mint);
    await wallet.loadMint();

    await expect(wallet.createMintQuoteBolt11(1000)).rejects.toThrow(/no active keyset/i);
    await expect(wallet.createMintQuote('bolt11', { amount: 1000 })).rejects.toThrow(
      /no active keyset/i,
    );
  });

  test('generic quote methods refuse methods the mint does not advertise (NUT-04/05)', async () => {
    const wallet = new Wallet(mint);
    await wallet.loadMint();

    await expect(wallet.createMintQuote('fancypay', { amount: 1000 })).rejects.toThrow(
      /does not support/i,
    );
    await expect(wallet.createMeltQuote('fancypay', { request: 'x' })).rejects.toThrow(
      /does not support/i,
    );
  });

  test('mint quotes still work when an active keyset exists', async () => {
    server.use(
      http.post(mintUrl + '/v1/mint/quote/bolt11', () =>
        HttpResponse.json({
          quote: 'bolt11-quote-1',
          request: 'lnbc1000...',
          unit: 'sat',
          amount: 1000,
          state: 'UNPAID',
          expiry: 3600,
        }),
      ),
    );
    const wallet = new Wallet(mint);
    await wallet.loadMint();

    const quote = await wallet.createMintQuoteBolt11(1000);
    expect(quote.quote).toBe('bolt11-quote-1');
  });

  test('restore still works on a legacy keyset', async () => {
    useLegacyHandlers();
    server.use(
      http.post(mintUrl + '/v1/restore', () => HttpResponse.json({ outputs: [], signatures: [] })),
    );

    const wallet = new Wallet(mint, { bip39seed: randomBytes(32) });
    await wallet.loadMint();

    const res = await wallet.restore(0, 2, { keysetId: legacyId });
    expect(res.proofs).toEqual([]);
  });
});
