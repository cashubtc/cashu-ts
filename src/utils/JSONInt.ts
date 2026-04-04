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
	 * Unquoted JSON number tokens are parsed to BigInt.
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
	 * Bigint aware JSON stringify.
	 *
	 * @remarks
	 * BigInt is stringified as an unquoted JSON number token.
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
		const out = this.parseValue();
		this.skipWhitespace();
		if (!this.isEnd()) {
			throw this.syntaxError('Unexpected trailing input');
		}
		return out;
	}

	private parseValue(): JSONIntValue {
		this.skipWhitespace();
		const ch = this.peek();
		if (ch === '{') return this.parseObject();
		if (ch === '[') return this.parseArray();
		if (ch === '"') return this.parseString();
		if (ch === '-' || this.isDigit(ch)) return this.parseNumber();
		if (ch === 't') return this.parseLiteral('true', true);
		if (ch === 'f') return this.parseLiteral('false', false);
		if (ch === 'n') return this.parseLiteral('null', null);
		throw this.syntaxError(`Unexpected token '${ch || 'EOF'}'`);
	}

	private parseObject(): { [key: string]: JSONIntValue } {
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
				value: this.parseValue(),
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

	private parseArray(): JSONIntValue[] {
		this.expect('[');
		this.skipWhitespace();
		const out: JSONIntValue[] = [];
		if (this.peek() === ']') {
			this.expect(']');
			return out;
		}

		while (!this.isEnd()) {
			out.push(this.parseValue());
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
					throw new Error('BigInt is not available in this runtime');
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
	const current = holder[key as keyof typeof holder];
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
		throw new Error(
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
		throw new Error('Failed to stringify string value');
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
		throw new Error('stringify: replacer must be a function or array');
	}

	const propertyList = Array.isArray(replacer) ? replacer.map((k) => String(k)) : undefined;

	const serialize = (holder: Record<string, unknown>, key: string): string | undefined => {
		let val: unknown = holder[key];

		if (isToJSONCapable(val)) {
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
			case 'bigint':
				// Intentionally emit raw JSON number tokens for BigInt.
				return String(val);
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
