import { bytesToHex as r } from "@noble/curves/abstract/utils";
import { Buffer as o } from "buffer";
function f(e) {
  return t(r(e));
}
function t(e) {
  return BigInt(`0x${e}`);
}
function i(e) {
  return o.from(e, "base64");
}
export {
  f as bytesToNumber,
  i as encodeBase64toUint8,
  t as hexToNumber
};
//# sourceMappingURL=util.es.js.map
