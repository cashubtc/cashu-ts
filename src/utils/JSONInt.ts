import { Amount } from '../model/Amount';
import { CTSError } from '../model/Errors';

/**
 * BigInt-safe JSON parser/stringifier.
 *
 * @remarks
 * - Based on Crockford's JSON reference parser approach (recursive descent), adapted for BigInt.
 * - Does not touch the global `JSON` object.
 * - Stringifies BigInt as pure JSON numbers (no quotes, no `n`).
 *
 * Gotchas.
 *
 * - `s === JSONInt.stringify(JSONInt.parse(s))` is generally true for canonical JSON inputs.
 * - `o !== JSONInt.parse(JSONInt.stringify(o))` can happen because:
 *
 *   - BigInt is stringified as an unquoted JSON number token (loss of JS type on parse).
 *   - `undefined` values are dropped or become `null` in arrays, per JSON rules.
 *   - Custom `toJSON`/replacer behavior can change output.
 *
 * There is no consistent way to preserve BigInt type through JSON today, so handling that case is
 * up to users. In Cashu-TS, we use the `Amount` VO to normalize numbers.
 */
export const JSONInt: JSONIntApi = Object.freeze({
  parse,
  stringify,
});

export default JSONInt;

export interface JSONIntApi {
  /**
   * Bigint aware JSON parser.
   *
   * @remarks
   * Returns `unknown`, so validate or cast the result to an application-specific type.
   *
   * Unquoted JSON number tokens are parsed to BigInt when outside the safe integer range, otherwise
   * to number. Integer tokens longer than 100 characters are rejected as a syntax error.
   */
  parse(
    source: string,
    reviver?: (this: unknown, key: string, value: unknown) => unknown,
    options?: {
      strict?: boolean;
      fallbackTo?: 'number' | 'string' | 'error';
    },
  ): unknown;

  /**
   * BigInt aware JSON stringify.
   *
   * @remarks
   * - BigInt is stringified as an unquoted JSON number token; a BigInt whose decimal form exceeds 100
   *   characters throws, symmetric with the parse cap, so output always round-trips.
   * - Parsing the result may yield `number` or `bigint` depending on the value and parse options.
   * - Returns `undefined` for top-level values that JSON cannot represent, matching `JSON.stringify`
   *   behavior.
   */
  stringify(
    value: unknown,
    replacer?:
      | ((this: unknown, key: string, value: unknown) => unknown)
      | ReadonlyArray<string | number>,
    space?: string | number,
  ): string | undefined;
}

interface ParseOptions {
  strict?: boolean;
  fallbackTo?: 'number' | 'string' | 'error';
}

type JSONIntPrimitive = null | boolean | number | bigint | string;
type JSONIntValue = JSONIntPrimitive | JSONIntValue[] | { [key: string]: JSONIntValue };

type ReviverFn = (this: unknown, key: string, value: unknown) => unknown;
type ReplacerFn = (this: unknown, key: string, value: unknown) => unknown;
type ReplacerList = ReadonlyArray<string | number>;

// The largest legitimate Cashu integer is a u64 (20 digits); reject absurdly
// long tokens before conversion. Applies in all runtimes and fallback modes.
const MAX_INT_TOKEN_LENGTH = 100;

// Legitimate Cashu payloads nest a handful of levels; the recursive descent
// overflows the call stack near ~5k. Mirrors MAX_CBOR_DEPTH in cbor.ts.
const MAX_PARSE_DEPTH = 64;

let safeBigIntLimits: { max: bigint; min: bigint } | undefined;
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toBigIntCtor(): ((value: string) => bigint) | undefined {
  const ctor = globalThis.BigInt;
  return typeof ctor === 'function' ? ctor : undefined;
}

function getSafeBigIntLimits(bigIntCtor: (value: string) => bigint): {
  max: bigint;
  min: bigint;
} {
  if (!safeBigIntLimits) {
    const max = bigIntCtor(String(Number.MAX_SAFE_INTEGER));
    safeBigIntLimits = { max, min: -max };
  }
  return safeBigIntLimits;
}

class Parser {
  private i = 0;

  constructor(
    private readonly src: string,
    private readonly strict: boolean,
    private readonly fallbackTo: 'number' | 'string' | 'error',
    private readonly bigIntCtor: ((value: string) => bigint) | undefined,
  ) {}

  parse(): JSONIntValue {
    const out = this.parseValue(0);
    this.skipWhitespace();
    if (!this.isEnd()) {
      throw this.syntaxError('Unexpected trailing input');
    }
    return out;
  }

  private parseValue(depth: number): JSONIntValue {
    if (depth > MAX_PARSE_DEPTH) {
      throw this.syntaxError('JSON nesting exceeds the maximum depth');
    }
    this.skipWhitespace();
    const ch = this.peek();
    if (ch === '{') return this.parseObject(depth);
    if (ch === '[') return this.parseArray(depth);
    if (ch === '"') return this.parseString();
    if (ch === '-' || this.isDigit(ch)) return this.parseNumber();
    if (ch === 't') return this.parseLiteral('true', true);
    if (ch === 'f') return this.parseLiteral('false', false);
    if (ch === 'n') return this.parseLiteral('null', null);
    throw this.syntaxError(`Unexpected token '${ch || 'EOF'}'`);
  }

  private parseObject(depth: number): { [key: string]: JSONIntValue } {
    this.expect('{');
    this.skipWhitespace();
    const out: { [key: string]: JSONIntValue } = {};
    const seen = new Set<string>();
    if (this.peek() === '}') {
      this.expect('}');
      return out;
    }

    while (!this.isEnd()) {
      const key = this.parseString();
      if (this.strict && seen.has(key)) {
        throw this.syntaxError(`Duplicate key "${key}"`);
      }
      seen.add(key);
      this.skipWhitespace();
      this.expect(':');
      // Define explicitly to avoid __proto__ prototype pollution.
      Object.defineProperty(out, key, {
        value: this.parseValue(depth + 1),
        writable: true,
        enumerable: true,
        configurable: true,
      });
      this.skipWhitespace();
      const ch = this.peek();
      if (ch === '}') {
        this.expect('}');
        return out;
      }
      this.expect(',');
      this.skipWhitespace();
    }

    throw this.syntaxError('Unterminated object');
  }

  private parseArray(depth: number): JSONIntValue[] {
    this.expect('[');
    this.skipWhitespace();
    const out: JSONIntValue[] = [];
    if (this.peek() === ']') {
      this.expect(']');
      return out;
    }

    while (!this.isEnd()) {
      out.push(this.parseValue(depth + 1));
      this.skipWhitespace();
      const ch = this.peek();
      if (ch === ']') {
        this.expect(']');
        return out;
      }
      this.expect(',');
      this.skipWhitespace();
    }

    throw this.syntaxError('Unterminated array');
  }

  private parseString(): string {
    this.expect('"');
    let out = '';
    while (!this.isEnd()) {
      const ch = this.next();
      if (ch === '"') {
        return out;
      }
      if (ch === '\\') {
        const esc = this.next();
        switch (esc) {
          case '"':
          case '\\':
          case '/':
            out += esc;
            break;
          case 'b':
            out += '\b';
            break;
          case 'f':
            out += '\f';
            break;
          case 'n':
            out += '\n';
            break;
          case 'r':
            out += '\r';
            break;
          case 't':
            out += '\t';
            break;
          case 'u': {
            const hex = this.src.slice(this.i, this.i + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
              throw this.syntaxError('Invalid unicode escape');
            }
            this.i += 4;
            out += String.fromCharCode(parseInt(hex, 16));
            break;
          }
          default:
            throw this.syntaxError(`Invalid escape '\\${esc}'`);
        }
        continue;
      }

      if (ch < ' ') {
        throw this.syntaxError('Invalid control character in string');
      }
      out += ch;
    }

    throw this.syntaxError('Unterminated string');
  }

  private parseNumber(): number | bigint | string {
    const start = this.i;

    if (this.peek() === '-') this.i += 1;

    if (this.peek() === '0') {
      this.i += 1;
    } else {
      this.readDigits();
    }

    if (this.peek() === '.') {
      this.i += 1;
      this.readDigits();
    }

    const p = this.peek();
    if (p === 'e' || p === 'E') {
      this.i += 1;
      const sign = this.peek();
      if (sign === '+' || sign === '-') this.i += 1;
      this.readDigits();
    }

    const token = this.src.slice(start, this.i);
    const isInteger =
      token.indexOf('.') === -1 && token.indexOf('e') === -1 && token.indexOf('E') === -1;

    if (!isInteger) {
      const n = Number(token);
      if (!Number.isFinite(n)) throw this.syntaxError('Bad number');
      return n;
    }

    if (token.length > MAX_INT_TOKEN_LENGTH) {
      throw this.syntaxError('Number token too long');
    }

    if (!this.bigIntCtor) {
      switch (this.fallbackTo) {
        case 'number': {
          const n = Number(token);
          if (!Number.isFinite(n)) throw this.syntaxError('Bad number');
          return n;
        }
        case 'string':
          return token;
        case 'error':
          throw new CTSError('BigInt is not available in this runtime');
      }
    }

    const bi = this.bigIntCtor(token);
    const { max, min } = getSafeBigIntLimits(this.bigIntCtor);
    if (bi > max || bi < min) {
      return bi;
    }
    return Number(token);
  }

  private parseLiteral<T extends true | false | null>(literal: string, value: T): T {
    if (this.src.slice(this.i, this.i + literal.length) !== literal) {
      throw this.syntaxError(`Unexpected token near '${this.src.slice(this.i, this.i + 8)}'`);
    }
    this.i += literal.length;
    return value;
  }

  private readDigits(): void {
    const start = this.i;
    while (this.isDigit(this.peek())) {
      this.i += 1;
    }
    if (this.i === start) {
      throw this.syntaxError('Bad number');
    }
  }

  private skipWhitespace(): void {
    while (!this.isEnd()) {
      const ch = this.peek();
      if (ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t') {
        this.i += 1;
        continue;
      }
      break;
    }
  }

  private expect(c: string): void {
    if (this.next() !== c) {
      throw this.syntaxError(`Expected '${c}'`);
    }
  }

  private peek(): string {
    return this.src.charAt(this.i);
  }

  private next(): string {
    const ch = this.src.charAt(this.i);
    this.i += 1;
    return ch;
  }

  private isDigit(ch: string): boolean {
    return ch >= '0' && ch <= '9';
  }

  private isEnd(): boolean {
    return this.i >= this.src.length;
  }

  private syntaxError(message: string): SyntaxError {
    return new SyntaxError(`${message} at position ${this.i}`);
  }
}

function walkReviver(
  holder: Record<string, unknown> | unknown[],
  key: string,
  reviver: ReviverFn,
): unknown {
  const current: unknown = Array.isArray(holder) ? holder[Number(key)] : holder[key];
  if (Array.isArray(current)) {
    for (let i = 0; i < current.length; i += 1) {
      const v = walkReviver(current, String(i), reviver);
      if (v === undefined) Reflect.deleteProperty(current, i);
      else current[i] = v;
    }
  } else if (isRecord(current)) {
    for (const k of Object.keys(current)) {
      const v = walkReviver(current, k, reviver);
      if (v === undefined) delete current[k];
      else current[k] = v;
    }
  }
  return reviver.call(holder, key, current);
}

function parse(source: string, reviver?: ReviverFn, options?: ParseOptions): unknown {
  const strict = options?.strict === true;
  const fallbackTo = options?.fallbackTo ?? 'number';
  if (fallbackTo !== 'number' && fallbackTo !== 'string' && fallbackTo !== 'error') {
    throw new CTSError(
      `Incorrect value for fallbackTo option, must be "number", "string", "error" or undefined but passed ${String(options?.fallbackTo)}`,
    );
  }

  const parsed = new Parser(String(source), strict, fallbackTo, toBigIntCtor()).parse();
  if (typeof reviver !== 'function') return parsed;
  return walkReviver({ '': parsed }, '', reviver);
}

function quoteString(value: string): string {
  const quoted = JSON.stringify(value);
  if (typeof quoted !== 'string') {
    throw new CTSError('Failed to stringify string value');
  }
  return quoted;
}

function isToJSONCapable(value: unknown): value is { toJSON: (key: string) => unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'toJSON' in value &&
    typeof (value as { toJSON?: unknown }).toJSON === 'function'
  );
}

function unboxBoxedPrimitive(value: unknown): unknown {
  if (value instanceof Number || value instanceof String || value instanceof Boolean) {
    return value.valueOf();
  }
  return value;
}

function stringify(
  value: unknown,
  replacer?: ReplacerFn | ReplacerList,
  space?: string | number,
): string | undefined {
  let gap = '';
  let indent = '';
  const inProgress = new WeakSet<object>();

  if (typeof space === 'number') {
    indent = ' '.repeat(Math.min(10, Math.max(0, Math.floor(space))));
  } else if (typeof space === 'string') {
    indent = space;
  }

  if (replacer && typeof replacer !== 'function' && !Array.isArray(replacer)) {
    throw new CTSError('stringify: replacer must be a function or array');
  }

  const propertyList = Array.isArray(replacer) ? replacer.map((k) => String(k)) : undefined;

  const serialize = (holder: Record<string, unknown>, key: string): string | undefined => {
    let val: unknown = holder[key];

    // Amount VO: bypass toJSON() and emit as raw bigint → unquoted integer on the wire.
    // This is intentional: the Cashu protocol requires unquoted numeric tokens for amounts,
    // so JSONInt must emit e.g. 1000 not "1000". Plain JSON.stringify uses Amount.toJSON()
    // which returns a quoted string — correct for app-level storage but not for wire format.
    if (val instanceof Amount) {
      val = val.toBigInt();
    } else if (isToJSONCapable(val)) {
      val = val.toJSON(key);
    }
    if (typeof replacer === 'function') {
      val = replacer.call(holder, key, val);
    }
    val = unboxBoxedPrimitive(val);

    switch (typeof val) {
      case 'string':
        return quoteString(val);
      case 'number':
        return Number.isFinite(val) ? String(val) : 'null';
      case 'boolean':
        return val ? 'true' : 'false';
      case 'bigint': {
        // Emit BigInt as a raw JSON number token, but refuse one longer than the parser accepts
        // (see MAX_INT_TOKEN_LENGTH) so stringify output always round-trips back through parse.
        const token = String(val);
        if (token.length > MAX_INT_TOKEN_LENGTH) {
          throw new CTSError(`integer token exceeds ${MAX_INT_TOKEN_LENGTH} characters`);
        }
        return token;
      }
      case 'undefined':
        return undefined;
      case 'object': {
        if (val === null) return 'null';
        if (inProgress.has(val)) {
          throw new TypeError('Converting circular structure to JSON');
        }
        inProgress.add(val);
        const mind = gap;
        gap += indent;

        try {
          if (Array.isArray(val)) {
            const parts: string[] = [];
            // eslint-disable-next-line no-restricted-syntax -- array-as-record view for the shared index walk
            const arrayHolder = val as unknown as Record<string, unknown>;
            for (let i = 0; i < val.length; i += 1) {
              const item = serialize(arrayHolder, String(i));
              parts.push(item ?? 'null');
            }
            const out =
              parts.length === 0
                ? '[]'
                : gap
                  ? `[\n${gap}${parts.join(`,\n${gap}`)}\n${mind}]`
                  : `[${parts.join(',')}]`;
            gap = mind;
            return out;
          }

          const obj = val as Record<string, unknown>;
          const keys = propertyList ?? Object.keys(obj);
          const pairs: string[] = [];
          for (const k of keys) {
            const item = serialize(obj, k);
            if (item !== undefined) {
              pairs.push(`${quoteString(k)}${gap ? ': ' : ':'}${item}`);
            }
          }

          const out =
            pairs.length === 0
              ? '{}'
              : gap
                ? `{\n${gap}${pairs.join(`,\n${gap}`)}\n${mind}}`
                : `{${pairs.join(',')}}`;
          gap = mind;
          return out;
        } finally {
          inProgress.delete(val);
        }
      }
      default:
        return undefined;
    }
  };

  const root = { '': value };
  const out = serialize(root, '');
  return out;
}
