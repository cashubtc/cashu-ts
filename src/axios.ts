import * as _axios from 'axios';
import { CreateAxiosDefaults } from 'axios';

export let axios = _axios.default.create();
/**
 * Run axios with a custom config
 * @param config custom config
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function setupAxios(config?: CreateAxiosDefaults<any> | undefined) {
	axios = _axios.default.create(config);
}
