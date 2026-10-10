import { bytesToHex, hexToBytes } from '@noble/hashes/utils.js';
import { describe, expect, test } from 'vitest';

import { CTSError } from '../../src/model/Errors';
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

function textFor(transfer: (typeof vectors.transfers)[number], sequence: number): string {
  return transfer.frames.find((f) => f.sequence === sequence)!.qr_text;
}

function decode(frames: string[]): FountainDecoder {
  const decoder = new FountainDecoder();
  for (const frame of frames) decoder.receive(frame);
  return decoder;
}

function jumpTo(encoder: FountainEncoder, sequence: number): void {
  (encoder as unknown as { sequence: number }).sequence = sequence - 1;
}

const tokenTransfer = vectors.transfers.find((t) => t.scope === 'token')!;
const tokenText = tokenTransfer.token_text!;

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

  test.each(vectors.base45_vectors)('base45 $text', ({ bytes_hex, text }) => {
    expect(encodeBase45(hexToBytes(bytes_hex))).toBe(text);
    expect(bytesToHex(decodeBase45(text))).toBe(bytes_hex);
  });

  describe.each(vectors.transfers)('transfer $name', (transfer) => {
    const message = hexToBytes(transfer.message_hex);

    test('encodes each frame as the exact QR text', () => {
      const encoder = new FountainEncoder(message, { fragmentSize: transfer.fragment_size });
      expect(encoder.fragmentCount).toBe(transfer.fragment_count);
      for (const f of transfer.frames) {
        // The last vector is sequence 0xffffffff; jump the counter to it.
        jumpTo(encoder, f.sequence);
        expect(encoder.nextFrame()).toBe(f.qr_text);
      }
    });

    test('each QR text decodes to its frame', () => {
      for (const f of transfer.frames) {
        const frame = parseFrame(decodeBase45(f.qr_text));
        expect(bytesToHex(decodeBase45(f.qr_text))).toBe(f.frame_hex);
        expect(frame.sequence).toBe(f.sequence);
        expect(bytesToHex(frame.payload)).toBe(f.data_hex);
        expect(
          indexes(selectFragments(f.sequence, transfer.fragment_count), transfer.fragment_count),
        ).toEqual(f.indexes);
      }
    });

    test('recovers from systematic frames', () => {
      const systematic = transfer.frames.filter((f) => f.sequence <= transfer.fragment_count);
      expect(bytesToHex(decode(systematic.map((f) => f.qr_text)).result!)).toBe(
        transfer.message_hex,
      );
    });

    test('recovers from repair frames alone', () => {
      const frames = transfer.mixed_only_recovery_sequences.map((q) => textFor(transfer, q));
      expect(bytesToHex(decode(frames).result!)).toBe(transfer.message_hex);
    });

    test('recovers from reversed frames with duplicates', () => {
      const frames = transfer.frames.map((f) => f.qr_text);
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
    expect(encodeBase45(hexToBytes(f.frame_hex))).toBe(f.qr_text);
    const frame = parseFrame(decodeBase45(f.qr_text));
    expect(frame).toMatchObject({
      sequence: f.sequence,
      count: f.fragment_count,
      length: f.message_length,
      size: f.fragment_size,
    });
    expect(frame.checksum.toString(16).padStart(8, '0')).toBe(f.message_crc32);
    expect(bytesToHex(frame.payload)).toBe(f.data_hex);
    expect(new FountainDecoder().receive(f.qr_text)).toBe(true);
  });

  test.each(vectors.invalid_frames)('rejects $name at $reject_at', (f) => {
    const decoder = new FountainDecoder();
    const receive = () => decoder.receive(f.qr_text);
    if (f.reject_at === 'frame') {
      // The binary layer rejects it too, even where the text bounds catch it first.
      expect(() => parseFrame(hexToBytes(f.frame_hex))).toThrow(CTSError);
    }
    if (f.reject_at !== 'token') {
      expect(receive).toThrow(CTSError);
      expect(decoder.progress).toBe(0);
      return;
    }
    receive();
    expect(decoder.isComplete).toBe(true);
    expect(() => getDecodedTokenBinary(decoder.result!, [])).toThrow(CTSError);
  });

  test.each(vectors.invalid_qr_text)('rejects QR text $name', ({ text }) => {
    const decoder = new FountainDecoder();
    expect(() => decoder.receive(text)).toThrow(CTSError);
    expect(decoder.progress).toBe(0);
  });

  test.each(vectors.routing_vectors)('routes $name to the $parser parser', ({ text, parser }) => {
    expect(FountainDecoder.isFrame(text)).toBe(parser === 'fountain');
  });

  test.each(vectors.receiver_sequences)('receiver sequence $name', (sequence) => {
    const decoder = new FountainDecoder();
    for (const step of sequence.steps) {
      const text = step.qr_text;
      if (text === undefined) {
        decoder.reset();
        continue;
      }
      if (step.result === 'reject') {
        expect(() => decoder.receive(text)).toThrow(CTSError);
        continue;
      }
      decoder.receive(text);
      expect(decoder.isComplete).toBe(step.result === 'complete');
    }
    expect(bytesToHex(decoder.result!)).toBe(sequence.message_hex);
  });
});

describe('FountainEncoder', () => {
  test('defaults to 183-byte fragments, 311 characters: a version 10-M symbol', () => {
    expect(new FountainEncoder(new Uint8Array(500)).nextFrame()).toHaveLength(311);
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
    jumpTo(encoder, 0xffffffff);
    expect(parseFrame(decodeBase45(encoder.nextFrame())).sequence).toBe(0xffffffff);
    expect(() => encoder.nextFrame()).toThrow('exhausted');
  });

  test('forToken keeps a cashuB string byte for byte', () => {
    for (const token of [tokenText, `cashu:${tokenText}`]) {
      const encoder = FountainEncoder.forToken(token, {
        fragmentSize: tokenTransfer.fragment_size,
      });
      expect(encoder.nextFrame()).toBe(textFor(tokenTransfer, 1));
    }
  });

  test('forToken encodes a Token object', () => {
    const token = getDecodedTokenBinary(hexToBytes(tokenTransfer.message_hex), []);
    const encoder = FountainEncoder.forToken(token, { fragmentSize: 64 });
    const decoder = new FountainDecoder();
    while (!decoder.isComplete) decoder.receive(encoder.nextFrame());
    expect(getDecodedTokenBinary(decoder.result!, [])).toEqual(token);
  });

  test('forToken rejects a cashuA token, a malformed cashuB string, and a non-token', () => {
    expect(() => FountainEncoder.forToken('cashuAeyJ0b2tlbiI6W119')).toThrow('cashuB');
    expect(() => FountainEncoder.forToken('cashuBnotatoken')).toThrow(CTSError);
    expect(() => FountainEncoder.forToken(undefined as never)).toThrow('forToken needs');
  });
});

describe('FountainDecoder', () => {
  const transfer = vectors.transfers.find((t) => t.name === 'padded-multipart')!;

  test('isFrame matches D+9 text only', () => {
    expect(FountainDecoder.isFrame(textFor(transfer, 1))).toBe(true);
    expect(FountainDecoder.isFrame(tokenText)).toBe(false);
    expect(FountainDecoder.isFrame('')).toBe(false);
    expect(FountainDecoder.isFrame(new Uint8Array([0x4e, 0x46]) as never)).toBe(false);
  });

  test('rejects a frame that is not text', () => {
    expect(() => new FountainDecoder().receive(new Uint8Array(40) as never)).toThrow('QR text');
  });

  test('reports progress, ignores duplicates, and stops at completion', () => {
    const decoder = new FountainDecoder();
    expect(decoder.progress).toBe(0);
    expect(decoder.receive(textFor(transfer, 1))).toBe(true);
    expect(decoder.receive(textFor(transfer, 1))).toBe(false);
    expect(decoder.progress).toBe(0.25);
    for (const q of [2, 3, 4]) decoder.receive(textFor(transfer, q));
    expect(decoder.isComplete).toBe(true);
    expect(decoder.progress).toBe(1);
    expect(decoder.receive(textFor(transfer, 5))).toBe(false);
  });

  test('result is a copy', () => {
    const decoder = decode([1, 2, 3, 4].map((q) => textFor(transfer, q)));
    decoder.result![0] ^= 1;
    expect(bytesToHex(decoder.result!)).toBe(transfer.message_hex);
  });

  test('refuses a frame from another transfer until reset', () => {
    const other = vectors.transfers.find((t) => t.name === 'canonical-four-fragments')!;
    const decoder = new FountainDecoder();
    decoder.receive(textFor(transfer, 1));
    expect(() => decoder.receive(textFor(other, 1))).toThrow('different transfer');
    decoder.reset();
    expect(decoder.progress).toBe(0);
    expect(decoder.receive(textFor(other, 1))).toBe(true);
  });

  test('resets itself after a reassembly that fails verification', () => {
    const bad = vectors.invalid_frames.find((f) => f.name === 'valid-frame-crc-wrong-message-crc')!;
    const decoder = new FountainDecoder();
    expect(() => decoder.receive(bad.qr_text)).toThrow('failed verification');
    expect(decoder.progress).toBe(0);
    expect(decoder.receive(textFor(transfer, 1))).toBe(true);
  });

  test('recovers 1024 fragments from repair frames alone', () => {
    const message = Uint8Array.from({ length: 1024 * 16 - 7 }, (_, i) => (i * 131 + 7) & 0xff);
    const encoder = new FountainEncoder(message, { fragmentSize: 16 });
    jumpTo(encoder, encoder.fragmentCount + 1);
    const decoder = new FountainDecoder();
    for (let frames = 0; !decoder.isComplete && frames < 1100; frames++) {
      decoder.receive(encoder.nextFrame());
    }
    expect(bytesToHex(decoder.result!)).toBe(bytesToHex(message));
  });
});
