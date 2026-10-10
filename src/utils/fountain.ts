import { CTSError } from '../model/Errors';
import type { Token } from '../model/types/token';

import { getEncodedTokenBinary, getTokenBinaryFromString } from './core';

// NUT-16 binary fountain frames: 'NF', version 01, flags 00, then four u32 header fields.
const FRAME_PREFIX = [0x4e, 0x46, 0x01, 0x00];
const HEADER_LENGTH = 20;
const FRAME_OVERHEAD = 24;
const MAX_FRAGMENT_SIZE = 4096;
const MAX_FRAGMENTS = 1024;
const MAX_MESSAGE_LENGTH = 1_048_576;
const MAX_SEQUENCE = 0xffffffff;
// 189 + 24 bytes fills a version 10-M QR symbol exactly.
const DEFAULT_FRAGMENT_SIZE = 189;
// QR alphanumeric mode's 45 characters, in RFC 9285 order.
const BASE45 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';
// no text prefix until the spec picks one; every frame already starts 'D+9' ('NF').
const TEXT_PREFIX = '';
const TEXT_MAGIC = TEXT_PREFIX + 'D+9';
const MAX_TEXT_LENGTH = TEXT_PREFIX.length + ((MAX_FRAGMENT_SIZE + 24) / 2) * 3;

let crcTable: Uint32Array | undefined;

/**
 * CRC-32/ISO-HDLC, as NUT-16 specifies for both message and frame checksums.
 *
 * @internal
 */
export function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * NUT-16 `SELECT(q, N)`: the source fragments frame `sequence` combines, as packed bit words.
 *
 * @remarks
 * `Math.imul` and the int32 coercion of `^` give exactly the spec's mod 2^32 arithmetic.
 * @internal
 */
export function selectFragments(sequence: number, count: number): Uint32Array {
  const bits = new Uint32Array((count + 31) >>> 5);
  if (sequence <= count) {
    setBit(bits, sequence - 1);
    return bits;
  }
  let state = sequence;
  let selected = false;
  for (let i = 0; i < count; i++) {
    state = (state + 0x6d2b79f5) >>> 0;
    let a = Math.imul(state ^ (state >>> 15), state | 1);
    const b = Math.imul(a ^ (a >>> 7), a | 61);
    a ^= a + b;
    if ((a ^ (a >>> 14)) & 1) {
      setBit(bits, i);
      selected = true;
    }
  }
  if (!selected) setBit(bits, (sequence - 1) % count);
  return bits;
}

function setBit(bits: Uint32Array, index: number): void {
  bits[index >>> 5] |= 1 << (index & 31);
}

function xorInto(
  target: Uint8Array | Uint32Array,
  source: Uint8Array | Uint32Array,
  from = 0,
): void {
  for (let i = from; i < target.length; i++) target[i] ^= source[i];
}

/**
 * RFC 9285 Base45: two bytes to three QR alphanumeric characters.
 *
 * @internal
 */
export function encodeBase45(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 2) {
    const pair = i + 1 < bytes.length;
    let n = pair ? bytes[i] * 256 + bytes[i + 1] : bytes[i];
    for (let digits = pair ? 3 : 2; digits > 0; digits--) {
      out += BASE45[n % 45];
      n = Math.floor(n / 45);
    }
  }
  return out;
}

/**
 * RFC 9285 Base45 decode, rejecting bad characters, lengths and out-of-range groups.
 *
 * @internal
 */
export function decodeBase45(text: string): Uint8Array {
  if (text.length % 3 === 1) {
    throw new CTSError('Invalid base45 text: bad length');
  }
  const out = new Uint8Array(Math.floor(text.length / 3) * 2 + (text.length % 3 ? 1 : 0));
  let o = 0;
  for (let i = 0; i < text.length; i += 3) {
    const group = text.slice(i, i + 3);
    let n = 0;
    for (let d = group.length - 1; d >= 0; d--) {
      const value = BASE45.indexOf(group[d]);
      if (value < 0) {
        throw new CTSError('Invalid base45 text: unexpected character');
      }
      n = n * 45 + value;
    }
    if (n > (group.length === 3 ? 0xffff : 0xff)) {
      throw new CTSError('Invalid base45 text: group out of range');
    }
    if (group.length === 3) out[o++] = n >>> 8;
    out[o++] = n & 0xff;
  }
  return out;
}

function frameFromText(text: string): Uint8Array {
  if (text.length > MAX_TEXT_LENGTH || !text.startsWith(TEXT_PREFIX)) {
    throw new CTSError('Invalid fountain frame text');
  }
  return decodeBase45(text.slice(TEXT_PREFIX.length));
}

type FrameHeader = {
  sequence: number;
  count: number;
  length: number;
  checksum: number;
  size: number;
};

/**
 * Validates a NUT-16 frame and returns its header and payload.
 *
 * @remarks
 * Nothing is allocated from header values until every check has passed.
 * @internal
 */
export function parseFrame(frame: Uint8Array): FrameHeader & { payload: Uint8Array } {
  if (!(frame instanceof Uint8Array)) {
    throw new CTSError('Fountain frame must be a Uint8Array');
  }
  const size = frame.length - FRAME_OVERHEAD;
  if (size < 1 || size > MAX_FRAGMENT_SIZE) {
    throw new CTSError(`Invalid fountain frame: length ${frame.length} is out of range`);
  }
  if (FRAME_PREFIX.some((b, i) => frame[i] !== b)) {
    throw new CTSError('Unsupported fountain frame: not NF version 1, or flags set');
  }
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  const end = HEADER_LENGTH + size;
  if (crc32(frame.subarray(0, end)) !== view.getUint32(end)) {
    throw new CTSError('Invalid fountain frame: checksum mismatch');
  }
  const header: FrameHeader = {
    sequence: view.getUint32(4),
    count: view.getUint32(8),
    length: view.getUint32(12),
    checksum: view.getUint32(16),
    size,
  };
  if (header.sequence === 0) {
    throw new CTSError('Invalid fountain frame: sequence 0');
  }
  if (header.count < 1 || header.count > MAX_FRAGMENTS) {
    throw new CTSError(`Invalid fountain frame: fragment count ${header.count} is out of range`);
  }
  if (header.length > MAX_MESSAGE_LENGTH) {
    throw new CTSError(`Invalid fountain frame: message length ${header.length} is out of range`);
  }
  if (header.count !== Math.max(1, Math.ceil(header.length / size))) {
    throw new CTSError('Invalid fountain frame: fragment count does not match length and size');
  }
  // Copy explicitly: Buffer#slice returns a view, and the decoder XORs into the payload.
  return { ...header, payload: new Uint8Array(frame.subarray(HEADER_LENGTH, end)) };
}

/**
 * Splits a message into NUT-16 binary fountain frames for an animated QR code.
 *
 * @remarks
 * Show each frame as one byte-mode QR symbol. The first `fragmentCount` frames carry the message in
 * order; later frames mix fragments so a receiver can fill gaps from any of them.
 */
export class FountainEncoder {
  /**
   * Source fragment count. A receiver needs at least this many frames.
   */
  readonly fragmentCount: number;
  private readonly fragmentSize: number;
  private readonly fragments: Uint8Array;
  private readonly header: Uint8Array;
  private sequence = 0;

  /**
   * @param message Bytes to send. For a Cashu token, use {@link FountainEncoder.forToken}.
   * @param options.fragmentSize Payload bytes per frame, 1 to 4096. Default 189; each frame is
   *   `fragmentSize + 24` bytes and must fit the QR symbol.
   * @throws {CTSError} If the message needs more than 1024 fragments or exceeds 1 MiB.
   */
  constructor(message: Uint8Array, options?: { fragmentSize?: number }) {
    if (!(message instanceof Uint8Array)) {
      throw new CTSError('Fountain message must be a Uint8Array');
    }
    const size = options?.fragmentSize ?? DEFAULT_FRAGMENT_SIZE;
    if (!Number.isInteger(size) || size < 1 || size > MAX_FRAGMENT_SIZE) {
      throw new CTSError(`fragmentSize must be an integer from 1 to ${MAX_FRAGMENT_SIZE}`);
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      throw new CTSError(`Fountain message exceeds ${MAX_MESSAGE_LENGTH} bytes`);
    }
    const count = Math.max(1, Math.ceil(message.length / size));
    if (count > MAX_FRAGMENTS) {
      throw new CTSError(
        `Fountain message needs ${count} fragments, more than ${MAX_FRAGMENTS}; use a larger fragmentSize`,
      );
    }
    this.fragmentCount = count;
    this.fragmentSize = size;
    this.fragments = new Uint8Array(count * size);
    this.fragments.set(message);
    this.header = new Uint8Array(HEADER_LENGTH);
    this.header.set(FRAME_PREFIX);
    const view = new DataView(this.header.buffer);
    view.setUint32(8, count);
    view.setUint32(12, message.length);
    view.setUint32(16, crc32(message));
  }

  /**
   * Encoder for a Cashu V4 token, sent as its raw binary form (`crawB`).
   *
   * @remarks
   * A `cashuB` string keeps its original bytes, as NUT-16 requires. `cashuA` tokens are rejected.
   */
  static forToken(token: string | Token, options?: { fragmentSize?: number }): FountainEncoder {
    if (typeof token !== 'string' && !Array.isArray(token?.proofs)) {
      throw new CTSError('forToken needs a cashuB token string or a Token');
    }
    const message =
      typeof token === 'string' ? getTokenBinaryFromString(token) : getEncodedTokenBinary(token);
    return new FountainEncoder(message, options);
  }

  /**
   * Returns the next frame. Loop the display over as many frames as the receiver needs.
   *
   * @throws {CTSError} After 2^32 - 1 frames; start a new encoder.
   */
  nextFrame(): Uint8Array {
    if (this.sequence === MAX_SEQUENCE) {
      throw new CTSError('Fountain sequence exhausted; start a new encoder');
    }
    const sequence = ++this.sequence;
    const size = this.fragmentSize;
    const frame = new Uint8Array(size + FRAME_OVERHEAD);
    frame.set(this.header);
    const view = new DataView(frame.buffer);
    view.setUint32(4, sequence);
    const payload = frame.subarray(HEADER_LENGTH, HEADER_LENGTH + size);
    const selected = selectFragments(sequence, this.fragmentCount);
    for (let i = 0; i < this.fragmentCount; i++) {
      if (selected[i >>> 5] & (1 << (i & 31))) {
        xorInto(payload, this.fragments.subarray(i * size, (i + 1) * size));
      }
    }
    view.setUint32(HEADER_LENGTH + size, crc32(frame.subarray(0, HEADER_LENGTH + size)));
    return frame;
  }

  /**
   * Returns the next frame as Base45 text, for a QR alphanumeric-mode symbol.
   *
   * @remarks
   * Text costs 1.5 characters per byte: a version 10-M symbol fits a `fragmentSize` of 183.
   */
  nextFrameText(): string {
    return TEXT_PREFIX + encodeBase45(this.nextFrame());
  }
}

type Equation = { coefficients: Uint32Array; data: Uint8Array };

/**
 * Reassembles a message from NUT-16 binary fountain frames, in any order and with gaps.
 *
 * @remarks
 * For a Cashu token, pass {@link FountainDecoder.result} to `wallet.decodeToken()`, which validates
 * it and resolves short keyset ids. A failed reassembly resets the decoder.
 */
export class FountainDecoder {
  private transfer?: Omit<FrameHeader, 'sequence'>;
  private equations: Array<Equation | undefined> = [];
  private rank = 0;
  private message?: Uint8Array;

  /**
   * True when a scanned frame, as bytes or Base45 text, carries the NUT-16 `NF` magic. Unsupported
   * versions still match, and {@link FountainDecoder.receive} rejects them.
   */
  static isFrame(frame: Uint8Array | string): boolean {
    if (typeof frame === 'string') return frame.startsWith(TEXT_MAGIC);
    return frame instanceof Uint8Array && frame[0] === 0x4e && frame[1] === 0x46;
  }

  /**
   * True once the message is reassembled and verified.
   */
  get isComplete(): boolean {
    return this.message !== undefined;
  }

  /**
   * Share of the message recovered so far, from 0 to 1.
   */
  get progress(): number {
    if (this.message) return 1;
    return this.transfer ? this.rank / this.transfer.count : 0;
  }

  /**
   * The reassembled message, once complete.
   */
  get result(): Uint8Array | undefined {
    return this.message?.slice();
  }

  /**
   * Adds a scanned frame.
   *
   * @returns True if the frame added information, false for duplicates and redundant frames.
   * @throws {CTSError} If the frame is invalid, belongs to another transfer (call
   *   {@link FountainDecoder.reset} to switch), or completes a message that fails its checksum.
   */
  receive(frame: Uint8Array | string): boolean {
    const bytes = typeof frame === 'string' ? frameFromText(frame) : frame;
    const { sequence, payload, ...transfer } = parseFrame(bytes);
    if (this.transfer && !sameTransfer(this.transfer, transfer)) {
      throw new CTSError('Fountain frame belongs to a different transfer; call reset() to switch');
    }
    if (this.message) return false;
    if (!this.transfer) {
      this.transfer = transfer;
      this.equations = new Array<Equation | undefined>(transfer.count);
    }
    const coefficients = selectFragments(sequence, transfer.count);
    // Reduce against stored rows, lowest pivot first; a row only has bits at or above its pivot.
    for (let w = 0; w < coefficients.length; w++) {
      while (coefficients[w] !== 0) {
        const pivot = (w << 5) + 31 - Math.clz32(coefficients[w] & -coefficients[w]);
        const row = this.equations[pivot];
        if (!row) {
          this.equations[pivot] = { coefficients, data: payload };
          if (++this.rank === transfer.count) this.solve();
          return true;
        }
        xorInto(coefficients, row.coefficients, w);
        xorInto(payload, row.data);
      }
    }
    return false;
  }

  /**
   * Discards all frames, ready for a new transfer.
   */
  reset(): void {
    this.transfer = undefined;
    this.equations = [];
    this.rank = 0;
    this.message = undefined;
  }

  private solve(): void {
    const { count, size, length, checksum } = this.transfer!;
    const fragments = new Uint8Array(count * size);
    for (let i = count - 1; i >= 0; i--) {
      const row = this.equations[i]!;
      const fragment = fragments.subarray(i * size, (i + 1) * size);
      fragment.set(row.data);
      for (let j = i + 1; j < count; j++) {
        if (row.coefficients[j >>> 5] & (1 << (j & 31))) {
          xorInto(fragment, fragments.subarray(j * size, (j + 1) * size));
        }
      }
    }
    const message = fragments.slice(0, length);
    if (crc32(message) !== checksum || fragments.subarray(length).some((b) => b !== 0)) {
      this.reset();
      throw new CTSError('Fountain message failed verification; the transfer restarts');
    }
    this.message = message;
    this.equations = [];
  }
}

function sameTransfer(a: Omit<FrameHeader, 'sequence'>, b: Omit<FrameHeader, 'sequence'>): boolean {
  return (
    a.count === b.count && a.size === b.size && a.length === b.length && a.checksum === b.checksum
  );
}
