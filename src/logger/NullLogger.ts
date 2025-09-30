import type { Logger } from './Logger';

// The default logger implementation - does nothing
/* eslint-disable @typescript-eslint/no-empty-function */
export const NULL_LOGGER: Logger = {
	error() {},
	warn() {},
	info() {},
	debug() {},
	trace() {},
	log() {},
};
/* eslint-enable @typescript-eslint/no-empty-function */
