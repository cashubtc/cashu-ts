import { numberToBytesBE } from '@noble/curves/utils.js';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { BLS_FR_ORDER, blindMessageBls } from '../../src/crypto';

// randomScalar() (module-private in curve_bls.ts) feeds the no-r path of blindMessageBls — the
// production random-output path for v3 BLS keysets. It must rejection-sample uniformly in
// [1, BLS_FR_ORDER), like deriveBatchWeights. Fr.fromBytes mod-reduces (BLS_FR_ORDER ~ 0.45·2^256),
// which biases scalars small; this guards against a regression back to that.
const { randomBytesMock } = vi.hoisted(() => ({ randomBytesMock: vi.fn() }));

vi.mock('@noble/curves/utils.js', async (importActual) => {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- vitest importActual generic
  const actual = await importActual<typeof import('@noble/curves/utils.js')>();
  return { ...actual, randomBytes: randomBytesMock };
});

describe('randomScalar uniform rejection sampling (no-r blinding path)', () => {
  afterEach(() => randomBytesMock.mockReset());

  test('discards an out-of-range draw instead of mod-reducing it', () => {
    const secret = new TextEncoder().encode('unlinkability');
    // 1st draw >= BLS_FR_ORDER: rejection sampling must discard it. 2nd draw in range: accepted.
    randomBytesMock
      .mockReturnValueOnce(numberToBytesBE(BLS_FR_ORDER + 7n, 32))
      .mockReturnValueOnce(numberToBytesBE(11n, 32));

    const { r } = blindMessageBls(secret);

    // Rejection sampling keeps the 2nd draw = 11. Mod-reduction would consume only the 1st draw:
    // (BLS_FR_ORDER + 7) mod BLS_FR_ORDER = 7 — never 11.
    expect(r).toBe(11n);
  });
});
