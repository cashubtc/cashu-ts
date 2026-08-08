import { describe, it, expect } from 'vitest';

import { bolt11AmountMsat } from '../../src/utils';

// The 2,000 sat fixture invoice from test/wallet/_setup (not imported: _setup pulls in msw/node,
// which does not load in the browser projects).
const invoice =
  'lnbc20u1p3u27nppp5pm074ffk6m42lvae8c6847z7xuvhyknwgkk7pzdce47grf2ksqwsdpv2phhwetjv4jzqcneypqyc6t8dp6xu6twva2xjuzzda6qcqzpgxqyz5vqsp5sw6n7cztudpl5m5jv3z6dtqpt2zhd3q6dwgftey9qxv09w82rgjq9qyyssqhtfl8wv7scwp5flqvmgjjh20nf6utvv5daw5h43h69yqfwjch7wnra3cn94qkscgewa33wvfh7guz76rzsfg9pwlk8mqd27wavf2udsq3yeuju';

describe('bolt11AmountMsat', () => {
  it('reads the fixture invoice amount (20u = 2,000 sat)', () => {
    expect(bolt11AmountMsat(invoice)).toBe(2_000_000n);
  });

  it.each([
    ['lnbc20u1pfake', 2_000_000n], // micro-bitcoin
    ['lnbc1m1pfake', 100_000_000n], // milli-bitcoin, amount digit before the separator
    ['lnbc1500n1pfake', 150_000n], // nano-bitcoin
    ['lnbc2500p1pfake', 250n], // pico-bitcoin
    ['lnbc21pfake', 200_000_000_000n], // whole bitcoin, no multiplier
    ['lntbs10u1pfake', 1_000_000n], // signet prefix
    ['lnbcrt500n1pfake', 50_000n], // regtest prefix
    ['LNBC20U1PFAKE', 2_000_000n], // uppercase form
  ])('parses %s', (pr, msat) => {
    expect(bolt11AmountMsat(pr)).toBe(msat);
  });

  it('returns null for an amountless invoice', () => {
    expect(bolt11AmountMsat('lnbc1pfake')).toBeNull();
  });

  it.each([
    ['lnbc2501p1pfake'], // pico amount not a multiple of 10 (sub-msat)
    ['lnbc0500u1pfake'], // leading zero
    ['lnbc01pfake'], // zero amount
    ['lnbc20u'], // no separator
    ['notaninvoice'],
    [''],
  ])('throws on %s', (pr) => {
    expect(() => bolt11AmountMsat(pr)).toThrow();
  });

  it('throws on non-string input', () => {
    expect(() => bolt11AmountMsat(null as unknown as string)).toThrow();
  });
});
