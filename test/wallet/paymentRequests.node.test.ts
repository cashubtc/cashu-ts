import { expect, test } from 'vitest';

import { PaymentRequest } from '../../src/index';
import { MAX_PAYLOAD_LENGTH } from '../../src/utils/limits';

// Node only: the heap reading comes from `process.memoryUsage`.
test('streams a run of unknown records in a raw binary request', () => {
  const prefix = new TextEncoder().encode('creqB');
  // Empty unknown records (`ff 00 00`) up to the cap: decoded as an empty request without
  // the heap growing in step with the record count (about 70 MiB if every part is held).
  const records = Math.floor((MAX_PAYLOAD_LENGTH - prefix.length) / 3);
  const filler = new Uint8Array(prefix.length + records * 3);
  filler.set(prefix);
  for (let offset = prefix.length; offset < filler.length; offset += 3) {
    filler[offset] = 0xff;
  }
  const before = process.memoryUsage().heapUsed;
  const decoded = PaymentRequest.fromEncodedRequest(filler);
  const grown = process.memoryUsage().heapUsed - before;
  expect(decoded.toRawRequest()).toEqual({});
  expect(grown).toBeLessThan(32 * MAX_PAYLOAD_LENGTH);
});
