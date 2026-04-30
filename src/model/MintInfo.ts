import { type Logger, NULL_LOGGER } from '../logger';
import { ABSOLUTE_MAX_BATCH_SIZE, ABSOLUTE_MAX_PER_MINT } from '../utils/limits';
import { normalizeSafeIntegerMetadata } from '../utils/normalizeNumbers';

import {
  type GetInfoResponse,
  type MPPMethod,
  type Nut29Info,
  type SwapMethod,
  type WebSocketSupport,
  type Nut19Policy,
} from './types';

type Method = 'GET' | 'POST';
type Endpoint = { method: Method; path: string };

type ProtectedIndex = {
  exact: Record<Method, Set<string>>;
  prefix: Record<Method, string[]>;
};

export class MintInfo {
  // Full mint info response
  private readonly _mintInfo: GetInfoResponse;
  // NUT-22, Blind-auth protected endpoints
  private readonly _protected22?: ProtectedIndex;
  // NUT-21, Clear-auth protected endpoints
  private readonly _protected21?: ProtectedIndex;

  constructor(info: GetInfoResponse, logger?: Logger) {
    const log = logger ?? NULL_LOGGER;
    this._mintInfo = MintInfo.normalizeInfo(info, log);

    const pe22 = this.toEndpoints(this._mintInfo?.nuts?.[22]?.protected_endpoints);
    this._protected22 = this.buildIndex(pe22);

    const pe21 = this.toEndpoints(this._mintInfo?.nuts?.[21]?.protected_endpoints);
    this._protected21 = this.buildIndex(pe21);
  }

  static normalizeInfo(info: GetInfoResponse, logger: Logger = NULL_LOGGER): GetInfoResponse {
    return {
      ...info,
      nuts: {
        ...info.nuts,
        ...(info.nuts['19'] ? { '19': MintInfo.normalizeNut19(info.nuts['19']) } : {}),
        ...(info.nuts['22'] ? { '22': MintInfo.normalizeNut22(info.nuts['22'], logger) } : {}),
        ...(info.nuts['29'] ? { '29': MintInfo.normalizeNut29(info.nuts['29'], logger) } : {}),
      },
    };
  }

  private static normalizeNut19(
    nut19: GetInfoResponse['nuts']['19'],
  ): GetInfoResponse['nuts']['19'] {
    if (!nut19) return nut19;

    return {
      ...nut19,
      ttl: normalizeSafeIntegerMetadata(nut19.ttl, 'nuts.19.ttl', null),
    };
  }

  private static normalizeNut22(
    nut22: GetInfoResponse['nuts']['22'],
    logger: Logger,
  ): GetInfoResponse['nuts']['22'] {
    if (!nut22) return nut22;

    let bat_max_mint = ABSOLUTE_MAX_PER_MINT;
    try {
      bat_max_mint = normalizeSafeIntegerMetadata(
        nut22.bat_max_mint,
        'nuts.22.bat_max_mint',
        ABSOLUTE_MAX_PER_MINT,
      );
    } catch {
      logger.warn('MintInfo: nuts.22.bat_max_mint is malformed, defaulting to internal cap', {
        value: nut22.bat_max_mint,
      });
      // bat_max_mint stays at ABSOLUTE_MAX_PER_MINT — initialized above
    }

    if (bat_max_mint > ABSOLUTE_MAX_PER_MINT) {
      logger.warn('MintInfo: nuts.22.bat_max_mint exceeds internal cap and was clamped', {
        advertised: bat_max_mint,
        clampedTo: ABSOLUTE_MAX_PER_MINT,
      });
      bat_max_mint = ABSOLUTE_MAX_PER_MINT;
    }

    return {
      ...nut22,
      bat_max_mint,
    };
  }

  private static normalizeNut29(
    nut29: GetInfoResponse['nuts']['29'],
    logger: Logger,
  ): GetInfoResponse['nuts']['29'] {
    if (!nut29) return nut29;

    let max_batch_size = ABSOLUTE_MAX_BATCH_SIZE;
    try {
      max_batch_size = normalizeSafeIntegerMetadata(
        nut29.max_batch_size,
        'nuts.29.max_batch_size',
        ABSOLUTE_MAX_BATCH_SIZE,
      );
    } catch {
      logger.warn('MintInfo: nuts.29.max_batch_size is malformed, defaulting to internal cap', {
        value: nut29.max_batch_size,
      });
      // max_batch_size stays at ABSOLUTE_MAX_BATCH_SIZE — initialized above
    }

    if (max_batch_size > ABSOLUTE_MAX_BATCH_SIZE) {
      logger.warn('MintInfo: nuts.29.max_batch_size exceeds internal cap and was clamped', {
        advertised: max_batch_size,
        clampedTo: ABSOLUTE_MAX_BATCH_SIZE,
      });
      max_batch_size = ABSOLUTE_MAX_BATCH_SIZE;
    }

    // Explicit reconstruction — do not spread ...nut29 here.
    // A spread would reintroduce a malformed max_batch_size from the original object.
    return {
      methods: nut29.methods,
      max_batch_size,
    };
  }

  isSupported(num: 4 | 5): { disabled: boolean; params: SwapMethod[] };
  isSupported(num: 7 | 8 | 9 | 10 | 11 | 12 | 14 | 20): { supported: boolean };
  isSupported(num: 17): { supported: boolean; params?: WebSocketSupport[] };
  isSupported(num: 15): { supported: boolean; params?: MPPMethod[] };
  isSupported(num: 19): { supported: boolean; params?: Nut19Policy };
  isSupported(num: 29): { supported: boolean; params?: Nut29Info };
  isSupported(num: number) {
    switch (num) {
      case 4:
      case 5: {
        return this.checkMintMelt(num);
      }
      case 7:
      case 8:
      case 9:
      case 10:
      case 11:
      case 12:
      case 14:
      case 20: {
        return this.checkGenericNut(num);
      }
      case 17: {
        return this.checkNut17();
      }
      case 15: {
        return this.checkNut15();
      }
      case 19: {
        return this.checkNut19();
      }
      case 29: {
        return this.checkNut29();
      }
      default: {
        throw new Error('nut is not supported by cashu-ts');
      }
    }
  }

  requiresBlindAuthToken(method: 'GET' | 'POST', path: string): boolean {
    return this.matchesProtected(this._protected22, method, path);
  }

  requiresClearAuthToken(method: 'GET' | 'POST', path: string): boolean {
    return this.matchesProtected(this._protected21, method, path);
  }

  private matchesProtected(idx: ProtectedIndex | undefined, method: Method, path: string): boolean {
    if (!idx) return false;

    // Runtime guard for method
    const exact = idx.exact[method];
    const prefix = idx.prefix[method];
    if (!exact || !prefix) return false;

    // Exact match first
    if (idx.exact[method].has(path)) return true;

    // Prefix match fallback
    for (const p of idx.prefix[method]) {
      if (path.startsWith(p)) return true;
    }

    return false;
  }

  private checkGenericNut(num: 7 | 8 | 9 | 10 | 11 | 12 | 14 | 20) {
    return this._mintInfo.nuts[num]?.supported ? { supported: true } : { supported: false };
  }

  private checkMintMelt(num: 4 | 5) {
    const mintMeltInfo = this._mintInfo.nuts[num];
    if (mintMeltInfo && mintMeltInfo.methods.length > 0 && !mintMeltInfo.disabled) {
      return { disabled: false, params: mintMeltInfo.methods };
    }
    return { disabled: true, params: mintMeltInfo?.methods ?? [] };
  }

  private checkNut17() {
    if (this._mintInfo.nuts[17] && this._mintInfo.nuts[17].supported.length > 0) {
      return { supported: true, params: this._mintInfo.nuts[17].supported };
    }
    return { supported: false };
  }

  private checkNut15() {
    if (this._mintInfo.nuts[15] && this._mintInfo.nuts[15].methods.length > 0) {
      return { supported: true, params: this._mintInfo.nuts[15].methods };
    }
    return { supported: false };
  }

  private checkNut19() {
    const rawPolicy = this._mintInfo.nuts?.[19];
    if (rawPolicy && (rawPolicy?.cached_endpoints?.length || 0) > 0) {
      const ttlSeconds = normalizeSafeIntegerMetadata(rawPolicy.ttl, 'nuts.19.ttl', null);
      return {
        supported: true,
        params: {
          // map null to infinity, if not null map seconds to milliseconds.
          // this way ttl is always a number
          ttl: ttlSeconds === null ? Infinity : Math.max(ttlSeconds, 0) * 1000,
          cached_endpoints: rawPolicy.cached_endpoints,
        },
      };
    }
    return { supported: false };
  }

  private checkNut29() {
    const nut29 = this._mintInfo.nuts?.[29];
    if (nut29) {
      return { supported: true, params: nut29 };
    }
    return { supported: false };
  }

  // ---------- private helpers ----------

  private toEndpoints(maybe: unknown): Endpoint[] {
    if (!Array.isArray(maybe)) return [];
    const out: Endpoint[] = [];
    for (const e of maybe) {
      if (e && typeof e === 'object') {
        const rec = e as Record<string, unknown>;
        const mm = rec.method;
        const pp = rec.path;
        if (typeof mm === 'string' && typeof pp === 'string') {
          const method = mm.toUpperCase();
          if (method === 'GET' || method === 'POST') {
            out.push({ method, path: pp });
          }
        }
      }
    }
    return out;
  }

  private buildIndex(endpoints?: Endpoint[]): ProtectedIndex | undefined {
    if (!endpoints?.length) return undefined;

    const exact: ProtectedIndex['exact'] = { GET: new Set(), POST: new Set() };
    const prefix: ProtectedIndex['prefix'] = { GET: [], POST: [] };

    for (const e of endpoints) {
      let p = e.path;

      // Handle deprecated regex formatting (backwards compat)
      // TODO: remove once mints support revised glob wildcard
      // See: https://github.com/cashubtc/nuts/pull/334
      if (p.startsWith('^')) p = p.slice(1);
      if (p.endsWith('$')) p = p.slice(0, -1);

      // Deprecated regex prefix formatting (backwards compat)
      if (p.endsWith('.*')) {
        prefix[e.method].push(p.slice(0, -2));
        continue;
      }

      // Glob style prefix match
      if (p.endsWith('*')) {
        prefix[e.method].push(p.slice(0, -1));
        continue;
      }

      // Exact match
      exact[e.method].add(p);
    }

    // Optional: longer prefixes first for faster early exits
    prefix.GET.sort((a, b) => b.length - a.length);
    prefix.POST.sort((a, b) => b.length - a.length);

    return { exact, prefix };
  }

  // ---------- getters ----------

  get cache(): GetInfoResponse {
    return this._mintInfo;
  }
  get contact() {
    return this._mintInfo.contact;
  }
  get description() {
    return this._mintInfo.description;
  }
  get description_long() {
    return this._mintInfo.description_long;
  }
  get name() {
    return this._mintInfo.name;
  }
  get pubkey() {
    return this._mintInfo.pubkey;
  }
  get nuts() {
    return this._mintInfo.nuts;
  }
  get version() {
    return this._mintInfo.version;
  }
  get motd() {
    return this._mintInfo.motd;
  }

  /**
   * Checks if the mint supports creating invoices/offers with a description for the specified
   * payment method.
   *
   * @param method - The payment method to check ('bolt11' or 'bolt12')
   * @returns True if the mint supports description for the method, false otherwise.
   */
  supportsNut04Description(method: 'bolt11' | 'bolt12', unit?: string): boolean {
    return this._mintInfo.nuts[4]?.methods.some(
      (met) =>
        met.method === method &&
        (unit ? met.unit === unit : true) &&
        (met.options?.description === true || met.description === true),
    );
  }

  supportsAmountless(method: string = 'bolt11', unit: string = 'sat'): boolean {
    const meltMethods = this._mintInfo?.nuts?.[5]?.methods ?? [];

    if (!Array.isArray(meltMethods)) return false;

    return meltMethods.some(
      (met) => met.method === method && met.unit === unit && met.options?.amountless === true,
    );
  }
}
