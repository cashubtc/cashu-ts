import { schnorr as u } from "@noble/curves/secp256k1";
import { sha256 as g } from "@noble/hashes/sha256";
import { parseSecret as f } from "../common/NUT10.es.js";
import { getP2PKExpectedKWitnessPubkeys as a, getP2PKNSigs as d, getP2PKWitnessSignatures as w, verifyP2PKSecretSignature as P } from "../client/NUT11.es.js";
const p = (e) => {
  if (!e.witness)
    throw new Error("could not verify signature, no witness provided");
  const r = f(e.secret), s = a(r);
  if (!s.length)
    throw new Error("no signatures required, proof is unlocked");
  let t = 0;
  const i = d(r), n = w(e.witness);
  for (const o of s)
    n.some((c) => {
      try {
        return P(c, e.secret, o);
      } catch {
        return !1;
      }
    }) && t++;
  return t >= i;
}, v = (e, r) => {
  if (!e.witness)
    throw new Error("could not verify signature, no witness provided");
  return u.verify(
    e.witness.signatures[0],
    g(e.B_.toHex(!0)),
    r.slice(2)
  );
};
export {
  p as verifyP2PKSig,
  v as verifyP2PKSigOutput
};
//# sourceMappingURL=NUT11.es.js.map
