import { HDKey as v } from "@scure/bip32";
import { getKeysetIdInt as a } from "../common.es.js";
const y = "m/129372'/0'", I = (e, r, t) => n(
  e,
  r,
  t,
  0
  /* SECRET */
), u = (e, r, t) => n(
  e,
  r,
  t,
  1
  /* BLINDING_FACTOR */
), n = (e, r, t, i) => {
  const d = v.fromMasterSeed(e), s = a(r), c = `${y}/${s}'/${t}'/${i}`, o = d.derive(c);
  if (o.privateKey === null)
    throw new Error("Could not derive private key");
  return o.privateKey;
};
export {
  u as deriveBlindingFactor,
  I as deriveSecret
};
//# sourceMappingURL=NUT09.es.js.map
