"use strict";Object.defineProperty(exports,Symbol.toStringTag,{value:"Module"});const r=require("@noble/curves/abstract/utils"),o=require("buffer");function n(e){return t(r.bytesToHex(e))}function t(e){return BigInt(`0x${e}`)}function u(e){return o.Buffer.from(e,"base64")}exports.bytesToNumber=n;exports.encodeBase64toUint8=u;exports.hexToNumber=t;
//# sourceMappingURL=util.cjs.js.map
