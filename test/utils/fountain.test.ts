import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { describe, expect, test } from 'vitest';

import { CTSError } from '../../src/model/Errors';
import { encodeUint8ToBase64Url } from '../../src/utils/base64';
import { getDecodedTokenBinary } from '../../src/utils/core';
import {
  crc32,
  decodeBase45,
  encodeBase45,
  FountainDecoder,
  FountainEncoder,
  parseFrame,
  selectFragments,
} from '../../src/utils/fountain';
import vectors from '../vectors/nut16.json';

function indexes(bits: Uint32Array, count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) if (bits[i >>> 5] & (1 << (i & 31))) out.push(i);
  return out;
}

function frameFor(transfer: (typeof vectors.transfers)[number], sequence: number): Uint8Array {
  return hexToBytes(transfer.frames.find((f) => f.sequence === sequence)!.frame_hex);
}

function decode(frames: Uint8Array[]): FountainDecoder {
  const decoder = new FountainDecoder();
  for (const frame of frames) decoder.receive(frame);
  return decoder;
}

const tokenTransfer = vectors.transfers.find((t) => t.scope === 'token')!;
const tokenString =
  'cashuB' + encodeUint8ToBase64Url(hexToBytes(tokenTransfer.message_hex.slice(10)));

describe('NUT-16 vectors', () => {
  test('crc32 check values', () => {
    const check = new TextEncoder().encode(vectors.checksum_check.input_ascii);
    expect(crc32(check).toString(16).padStart(8, '0')).toBe(vectors.checksum_check.crc32);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  test.each(vectors.selection_vectors)(
    'selects $indexes for q=$sequence, N=$fragment_count',
    ({ sequence, fragment_count, indexes: expected }) => {
      expect(indexes(selectFragments(sequence, fragment_count), fragment_count)).toEqual(expected);
    },
  );

  describe.each(vectors.transfers)('transfer $name', (transfer) => {
    const message = hexToBytes(transfer.message_hex);
    const systematic = transfer.frames.filter((f) => f.sequence <= transfer.fragment_count);

    test('encodes each frame byte for byte', () => {
      const encoder = new FountainEncoder(message, { fragmentSize: transfer.fragment_size });
      expect(encoder.fragmentCount).toBe(transfer.fragment_count);
      for (const f of transfer.frames) {
        // The last vector is sequence 0xffffffff; jump the counter to it.
        (encoder as unknown as { sequence: number }).sequence = f.sequence - 1;
        expect(bytesToHex(encoder.nextFrame())).toBe(f.frame_hex);
      }
    });

    test('parses each frame, including the last sequence', () => {
      for (const f of transfer.frames) {
        const frame = parseFrame(hexToBytes(f.frame_hex));
        expect(frame.sequence).toBe(f.sequence);
        expect(bytesToHex(frame.payload)).toBe(f.data_hex);
        expect(
          indexes(selectFragments(f.sequence, transfer.fragment_count), transfer.fragment_count),
        ).toEqual(f.indexes);
      }
    });

    test('recovers from systematic frames', () => {
      const decoder = decode(systematic.map((f) => hexToBytes(f.frame_hex)));
      expect(bytesToHex(decoder.result!)).toBe(transfer.message_hex);
    });

    test('recovers from repair frames alone', () => {
      const frames = transfer.mixed_only_recovery_sequences.map((q) => frameFor(transfer, q));
      expect(bytesToHex(decode(frames).result!)).toBe(transfer.message_hex);
    });

    test('recovers from reversed frames with duplicates', () => {
      const frames = transfer.frames.map((f) => hexToBytes(f.frame_hex));
      const decoder = decode([...frames].reverse().concat(frames));
      expect(bytesToHex(decoder.result!)).toBe(transfer.message_hex);
    });

    test(`is ${transfer.scope === 'token' ? '' : 'not '}a Cashu token`, () => {
      const parse = () => getDecodedTokenBinary(message, []);
      if (transfer.scope === 'token') expect(parse).not.toThrow();
      else expect(parse).toThrow(CTSError);
    });
  });

  test.each(vectors.valid_frames)('accepts valid frame $name', (f) => {
    const frame = parseFrame(hexToBytes(f.frame_hex));
    expect(frame).toMatchObject({
      sequence: f.sequence,
      count: f.fragment_count,
      length: f.message_length,
      size: f.fragment_size,
    });
    expect(frame.checksum.toString(16).padStart(8, '0')).toBe(f.message_crc32);
    expect(bytesToHex(frame.payload)).toBe(f.data_hex);
    expect(new FountainDecoder().receive(hexToBytes(f.frame_hex))).toBe(true);
  });

  test.each(vectors.invalid_frames)('rejects $name at $reject_at', (f) => {
    const decoder = new FountainDecoder();
    const receive = () => decoder.receive(hexToBytes(f.frame_hex));
    if (f.reject_at !== 'token') {
      expect(receive).toThrow(CTSError);
      expect(decoder.progress).toBe(0);
      return;
    }
    receive();
    expect(decoder.isComplete).toBe(true);
    expect(() => getDecodedTokenBinary(decoder.result!, [])).toThrow(CTSError);
  });
});

describe('FountainEncoder', () => {
  test('defaults to 189-byte fragments, a 213-byte frame', () => {
    expect(new FountainEncoder(new Uint8Array(500)).nextFrame()).toHaveLength(213);
  });

  test.each([0, 4097, 1.5, NaN])('rejects fragmentSize %s', (fragmentSize) => {
    expect(() => new FountainEncoder(new Uint8Array(1), { fragmentSize })).toThrow('fragmentSize');
  });

  test('rejects a message over 1 MiB or over 1024 fragments', () => {
    expect(() => new FountainEncoder(new Uint8Array(1_048_577), { fragmentSize: 4096 })).toThrow(
      '1048576 bytes',
    );
    expect(() => new FountainEncoder(new Uint8Array(1025), { fragmentSize: 1 })).toThrow(
      'larger fragmentSize',
    );
  });

  test('rejects a non-byte message', () => {
    expect(() => new FountainEncoder('abc' as never)).toThrow('Uint8Array');
  });

  test('stops at the last sequence number', () => {
    const encoder = new FountainEncoder(new Uint8Array(4), { fragmentSize: 1 });
    (encoder as unknown as { sequence: number }).sequence = 0xfffffffe;
    expect(parseFrame(encoder.nextFrame()).sequence).toBe(0xffffffff);
    expect(() => encoder.nextFrame()).toThrow('exhausted');
  });

  test('forToken keeps a cashuB string byte for byte', () => {
    for (const token of [tokenString, `cashu:${tokenString}`]) {
      const encoder = FountainEncoder.forToken(token, {
        fragmentSize: tokenTransfer.fragment_size,
      });
      expect(bytesToHex(encoder.nextFrame())).toBe(bytesToHex(frameFor(tokenTransfer, 1)));
    }
  });

  test('forToken encodes a Token object', () => {
    const token = getDecodedTokenBinary(hexToBytes(tokenTransfer.message_hex), []);
    const encoder = FountainEncoder.forToken(token, { fragmentSize: 64 });
    const decoder = new FountainDecoder();
    while (!decoder.isComplete) decoder.receive(encoder.nextFrame());
    expect(getDecodedTokenBinary(decoder.result!, [])).toEqual(token);
  });

  test('forToken rejects a cashuA token and a malformed cashuB string', () => {
    expect(() => FountainEncoder.forToken('cashuAeyJ0b2tlbiI6W119')).toThrow('cashuB');
    expect(() => FountainEncoder.forToken('cashuBnotatoken')).toThrow(CTSError);
    expect(() => FountainEncoder.forToken(undefined as never)).toThrow('forToken needs');
  });
});

describe('FountainDecoder', () => {
  const transfer = vectors.transfers.find((t) => t.name === 'padded-multipart')!;

  test('isFrame matches the NF magic only', () => {
    expect(FountainDecoder.isFrame(frameFor(transfer, 1))).toBe(true);
    expect(FountainDecoder.isFrame(hexToBytes(vectors.invalid_frames[1].frame_hex))).toBe(true);
    expect(FountainDecoder.isFrame(new TextEncoder().encode('cashuB'))).toBe(false);
    expect(FountainDecoder.isFrame(new Uint8Array())).toBe(false);
  });

  test('reports progress, ignores duplicates, and stops at completion', () => {
    const decoder = new FountainDecoder();
    expect(decoder.progress).toBe(0);
    expect(decoder.receive(frameFor(transfer, 1))).toBe(true);
    expect(decoder.receive(frameFor(transfer, 1))).toBe(false);
    expect(decoder.progress).toBe(0.25);
    for (const q of [2, 3, 4]) decoder.receive(frameFor(transfer, q));
    expect(decoder.isComplete).toBe(true);
    expect(decoder.progress).toBe(1);
    expect(decoder.receive(frameFor(transfer, 5))).toBe(false);
  });

  test('result is a copy', () => {
    const decoder = decode([1, 2, 3, 4].map((q) => frameFor(transfer, q)));
    decoder.result![0] ^= 1;
    expect(bytesToHex(decoder.result!)).toBe(transfer.message_hex);
  });

  test('refuses a frame from another transfer until reset', () => {
    const other = vectors.transfers.find((t) => t.name === 'canonical-four-fragments')!;
    const decoder = new FountainDecoder();
    decoder.receive(frameFor(transfer, 1));
    expect(() => decoder.receive(frameFor(other, 1))).toThrow('different transfer');
    decoder.reset();
    expect(decoder.progress).toBe(0);
    expect(decoder.receive(frameFor(other, 1))).toBe(true);
  });

  test('resets after a reassembly that fails its checksum', () => {
    const bad = vectors.invalid_frames.find((f) => f.name === 'valid-frame-crc-wrong-message-crc')!;
    const decoder = new FountainDecoder();
    expect(() => decoder.receive(hexToBytes(bad.frame_hex))).toThrow('failed verification');
    expect(decoder.progress).toBe(0);
    expect(decoder.receive(frameFor(transfer, 1))).toBe(true);
  });

  test('rejects a frame that is not a Uint8Array', () => {
    expect(() => new FountainDecoder().receive([0x4e, 0x46] as never)).toThrow('Uint8Array');
  });

  test('copies frames, even from a reused scan buffer whose slice is a view', () => {
    // Buffer#slice returns a view; scanners often reuse one buffer at an offset.
    class ViewSlice extends Uint8Array {
      slice(start?: number, end?: number): Uint8Array<ArrayBuffer> {
        return this.subarray(start, end);
      }
    }
    const encoder = new FountainEncoder(hexToBytes(transfer.message_hex), { fragmentSize: 5 });
    const scan = new ViewSlice(64);
    const decoder = new FountainDecoder();
    for (let q = 5; !decoder.isComplete && q < 40; q++) {
      const frame = encoder.nextFrame();
      if (q < 9) continue; // skip the systematic frames so rows get reduced
      scan.set(frame, 3);
      const view = scan.subarray(3, 3 + frame.length);
      decoder.receive(view);
      expect(bytesToHex(view)).toBe(bytesToHex(frame));
    }
    expect(bytesToHex(decoder.result!)).toBe(transfer.message_hex);
  });

  test('recovers 1024 fragments from repair frames alone', () => {
    const message = Uint8Array.from({ length: 1024 * 16 - 7 }, (_, i) => (i * 131 + 7) & 0xff);
    const encoder = new FountainEncoder(message, { fragmentSize: 16 });
    for (let i = 0; i < encoder.fragmentCount; i++) encoder.nextFrame();
    const decoder = new FountainDecoder();
    let frames = 0;
    while (!decoder.isComplete && frames < 1100) {
      decoder.receive(encoder.nextFrame());
      frames++;
    }
    expect(bytesToHex(decoder.result!)).toBe(bytesToHex(message));
  });
});

describe('Base45 text frames', () => {
  const ascii = (s: string) => new TextEncoder().encode(s);

  test.each([
    ['AB', 'BB8'],
    ['Hello!!', '%69 VD92EX0'],
    ['base-45', 'UJCLQE7W581'],
    ['ietf!', 'QED8WEX0'],
    ['', ''],
  ])('RFC 9285 example %j <-> %j', (plain, encoded) => {
    expect(encodeBase45(ascii(plain))).toBe(encoded);
    expect(decodeBase45(encoded)).toEqual(ascii(plain));
  });

  test.each(['GGW', 'A', 'ab', 'A!B', ':::'])('rejects invalid base45 %j', (text) => {
    expect(() => decodeBase45(text)).toThrow(CTSError);
  });

  test('every frame text starts with the NF magic', () => {
    expect(encodeBase45(hexToBytes('4e460100'))).toBe('D+9V50');
  });

  describe.each(vectors.transfers)('transfer $name as text', (transfer) => {
    test('encodes the same frames as Base45', () => {
      const encoder = new FountainEncoder(hexToBytes(transfer.message_hex), {
        fragmentSize: transfer.fragment_size,
      });
      for (const f of transfer.frames.filter((f) => f.sequence <= 13)) {
        expect(encoder.nextFrameText()).toBe(encodeBase45(hexToBytes(f.frame_hex)));
      }
    });

    test('recovers from repair frames received as text', () => {
      const decoder = new FountainDecoder();
      for (const q of transfer.mixed_only_recovery_sequences) {
        const text = encodeBase45(frameFor(transfer, q));
        expect(FountainDecoder.isFrame(text)).toBe(true);
        decoder.receive(text);
      }
      expect(bytesToHex(decoder.result!)).toBe(transfer.message_hex);
    });
  });

  test.each(vectors.invalid_frames.filter((f) => f.reject_at === 'frame'))(
    'rejects invalid frame $name as text',
    (f) => {
      expect(() => new FountainDecoder().receive(encodeBase45(hexToBytes(f.frame_hex)))).toThrow(
        CTSError,
      );
    },
  );

  test('isFrame and receive reject other text', () => {
    expect(FountainDecoder.isFrame('cashuBo2Ft')).toBe(false);
    expect(FountainDecoder.isFrame('')).toBe(false);
    expect(() => new FountainDecoder().receive('cashuBo2Ft')).toThrow(CTSError);
    expect(() => new FountainDecoder().receive('D+9' + '0'.repeat(7000))).toThrow('frame text');
  });

  test('a 207-byte frame is 311 characters, the 10-M alphanumeric capacity', () => {
    const encoder = new FountainEncoder(new Uint8Array(1000), { fragmentSize: 183 });
    expect(encoder.nextFrameText()).toHaveLength(311);
  });
});
