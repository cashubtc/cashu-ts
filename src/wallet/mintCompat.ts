import { type MintInfo } from '../model/MintInfo';

/**
 * Version-gated compatibility shims for known mint implementations. Each entry records the first
 * release that drops a legacy behavior; delete the entry and its legacy code path once the fleet
 * has upgraded.
 */

/**
 * First releases that verify the amended mint-quote signature message (cashubtc/nuts#375,
 * `Cashu_MintQuoteSig_v1`) for NUT-20 single and NUT-29 batch minting. Earlier releases only verify
 * the legacy NUT-20 concatenation, and quotes carry no version, so the wallet picks the format from
 * the mint's advertised version.
 *
 * PLACEHOLDER versions (next minor above the latest releases, which verify only the legacy message)
 * — pin to the actual upstream releases before merging.
 */
export const AMENDED_QUOTE_SIG_RELEASES: ReadonlyArray<readonly [string, string]> = [
  ['nutshell', '0.21.0'],
  ['cdk-mintd', '0.17.0'],
];

/**
 * True when the mint only verifies the legacy NUT-20 quote-signature message: a known
 * implementation below its amended release. Unknown implementations and missing mint info are
 * treated as current (amended format).
 */
export function requiresLegacyQuoteSignature(mintInfo: MintInfo | undefined): boolean {
  return AMENDED_QUOTE_SIG_RELEASES.some(([implementation, version]) =>
    mintInfo?.isImplementationBelow(implementation, version),
  );
}
