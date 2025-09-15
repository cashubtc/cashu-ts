import { type Secret } from './index';

export const parseSecret = (secret: string | Uint8Array): Secret => {
	try {
		if (secret instanceof Uint8Array) {
			secret = new TextDecoder().decode(secret);
		}
		return JSON.parse(secret) as Secret;
	} catch {
		const secretStr = secret instanceof Uint8Array ? new TextDecoder().decode(secret) : secret;
		throw new Error("can't parse secret:, " + secretStr);
	}
};
