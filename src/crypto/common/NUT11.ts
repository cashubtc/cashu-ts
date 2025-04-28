import { Secret } from './index.js';

export const parseP2PKSecret = (secret: string | Uint8Array): Secret => {
	try {
		if (secret instanceof Uint8Array) {
			secret = new TextDecoder().decode(secret);
		}
		return JSON.parse(secret);
	} catch (e) {
		throw new Error("can't parse secret");
	}
};
