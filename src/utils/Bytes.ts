import { CTSError } from '../model/Errors';
type Base64Encoding = 'base64';

interface BufferLike {
  toString(encoding: Base64Encoding): string;
}

interface BufferConstructorLike {
  from(data: Uint8Array): BufferLike;
  from(data: string, encoding: Base64Encoding): Uint8Array;
}

function getBufferConstructor(): BufferConstructorLike | undefined {
  return (globalThis as typeof globalThis & { Buffer?: BufferConstructorLike }).Buffer;
}

export class Bytes {
  static fromString(str: string): Uint8Array {
    str = str.trim();
    return new TextEncoder().encode(str);
  }

  static toString(bytes: Uint8Array): string {
    return new TextDecoder('utf-8').decode(bytes);
  }

  static concat(...arrays: Uint8Array[]): Uint8Array {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of arrays) {
      result.set(arr, offset);
      offset += arr.length;
    }
    return result;
  }

  static toBase64(bytes: Uint8Array): string {
    const bufferConstructor = getBufferConstructor();
    if (bufferConstructor) {
      return bufferConstructor.from(bytes).toString('base64');
    }
    // Chunk to avoid a String.fromCharCode arg-spread stack overflow. Chunk
    // size must be a multiple of 3, else each chunk emits mid-string '='
    // padding and the concatenated result is not valid base64.
    const chunkSize = 32766;
    if (bytes.length > chunkSize) {
      let result = '';
      for (let i = 0; i < bytes.length; i += chunkSize) {
        const chunk = bytes.slice(i, i + chunkSize);
        result += btoa(String.fromCharCode(...chunk));
      }
      return result;
    }
    return btoa(String.fromCharCode(...bytes));
  }

  static fromBase64(base64: string): Uint8Array {
    // Normalize: trim, strip ASCII whitespace (line-wrapped input is common),
    // map base64url to base64, drop trailing padding.
    const unpadded = base64
      .trim()
      .replace(/[\t\n\f\r ]+/g, '')
      .replace(/-/g, '+')
      .replace(/_/g, '/')
      .replace(/={1,2}$/, '');
    if (/[^A-Za-z0-9+/]/.test(unpadded) || unpadded.length % 4 === 1) {
      throw new CTSError('Invalid base64 string');
    }
    // Re-pad canonically so both decoder backends see the same validated string.
    const normalized = unpadded + '='.repeat((4 - (unpadded.length % 4)) % 4);
    const bufferConstructor = getBufferConstructor();
    if (bufferConstructor) {
      return new Uint8Array(bufferConstructor.from(normalized, 'base64'));
    }
    return new Uint8Array([...atob(normalized)].map((c) => c.charCodeAt(0)));
  }
  // NOTE: MUST remain a constant-time implementation (full byte check)
  // because callers rely on it (e.g. deriveP2BKSecretKey, verifyDLEQProof).
  static equals(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a[i] ^ b[i];
    }
    return result === 0;
  }

  static toBigInt(bytes: Uint8Array): bigint {
    let result = 0n;
    for (const byte of bytes) {
      result = (result << 8n) | BigInt(byte);
    }
    return result;
  }
}
