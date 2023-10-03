import { bytesToHex } from "@noble/curves/abstract/utils";
import { deriveSeedFromMnemonic } from "../src/secrets";
import { deriveBlindingFactor, deriveSecret } from "../src/secrets";
import { HDKey } from "@scure/bip32";

const mnemonic =
  "half depart obvious quality work element tank gorilla view sugar picture humble";
const seed = deriveSeedFromMnemonic(mnemonic);

describe("testing deterministic secrets", () => {
  const secrets = [
    "9bfb12704297fe90983907d122838940755fcce370ce51e9e00a4275a347c3fe",
    "dbc5e05f2b1f24ec0e2ab6e8312d5e13f57ada52594d4caf429a697d9c742490",
    "06a29fa8081b3a620b50b473fc80cde9a575c3b94358f3513c03007f8b66321e",
    "652d08c804bd2c5f2c1f3e3d8895860397df394b30473753227d766affd15e89",
    "654e5997f8a20402f7487296b6f7e463315dd52fc6f6cc5a4e35c7f6ccac77e0",
  ];
  test("derive Secret", async () => {

    const secret1 = deriveSecret(seed, "1cCNIAZ2X/w1", 0);
    const secret2 = deriveSecret(seed, "1cCNIAZ2X/w1", 1);
    const secret3 = deriveSecret(seed, "1cCNIAZ2X/w1", 2);
    const secret4 = deriveSecret(seed, "1cCNIAZ2X/w1", 3);
    const secret5 = deriveSecret(seed, "1cCNIAZ2X/w1", 4);

    expect(bytesToHex(secret1)).toBe(secrets[0]);
    expect(bytesToHex(secret2)).toBe(secrets[1]);
    expect(bytesToHex(secret3)).toBe(secrets[2]);
    expect(bytesToHex(secret4)).toBe(secrets[3]);
    expect(bytesToHex(secret5)).toBe(secrets[4]);
  })
});
