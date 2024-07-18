import {Proof} from "./index";

/**
 * A Cashu token
 */
export type Token = {
  /**
   * token entries
   */
  token: Array<TokenEntry>;
  /**
   * a message to send along with the token
   */
  memo?: string;
  /**
   * the unit of the token
   */
  unit?: string;
};
/**
 * TokenEntry that stores proofs and mints
 */
export type TokenEntry = {
  /**
   * a list of proofs
   */
  proofs: Array<Proof>;
  /**
   * the mints URL
   */
  mint: string;
};
