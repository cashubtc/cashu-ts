import { ProjPointType } from '@noble/curves/abstract/weierstrass';
import { secp256k1 } from '@noble/curves/secp256k1';
import { MintKeys, Proof, SerializedBlindedSignature } from './model/types/index.js';
import { bytesToNumber } from './utils.js';
import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/curves/abstract/utils';

function hashToCurve(secret: Uint8Array): ProjPointType<bigint> {
	let point: ProjPointType<bigint> | undefined;
	while (!point) {
		const hash = sha256(secret);
		const hashHex = bytesToHex(hash);
		const pointX = '02' + hashHex;
		try {
			point = pointFromHex(pointX);
		} catch (error) {
			secret = sha256(secret);
		}
	}
	return point;
}
export function pointFromHex(hex: string) {
	return secp256k1.ProjectivePoint.fromHex(hex);
}
/* export function h2cToPoint(h2c: H2CPoint<bigint>): ProjPointType<bigint> {
	return secp256k1.ProjectivePoint.fromAffine(h2c.toAffine());
} */
function blindMessage(secret: Uint8Array, r?: bigint): { B_: ProjPointType<bigint>; r: bigint } {
	const secretMessage = new TextEncoder().encode(bytesToHex(secret));
	const Y = hashToCurve(secretMessage);
	if (!r) {
		r = bytesToNumber(secp256k1.utils.randomPrivateKey());
	}
	const rG = secp256k1.ProjectivePoint.BASE.multiply(r);
	const B_ = Y.add(rG);
	return { B_, r };
}

function unblindSignature(
	C_: ProjPointType<bigint>,
	r: bigint,
	A: ProjPointType<bigint>
): ProjPointType<bigint> {
	const C = C_.subtract(A.multiply(r));
	return C;
}

function constructProofs(
	promises: Array<SerializedBlindedSignature>,
	rs: Array<bigint>,
	secrets: Array<Uint8Array>,
	keyset: MintKeys
): Array<Proof> {
	return promises.map((p: SerializedBlindedSignature, i: number) => {
		const C_ = pointFromHex(p.C_);
		const A = pointFromHex(keyset.keys[p.amount]);
		const C = unblindSignature(C_, rs[i], A);
		const secret = bytesToHex(secrets[i])
		const proof = {
			id: p.id,
			amount: p.amount,
			secret: secret,
			C: C.toHex(true)
		};
		return proof;
	});
}

export { hashToCurve, blindMessage, unblindSignature, constructProofs };
