/**
 * Entries of CheckStateResponse with state of the proof.
 */
export type ProofState = {
	Y: string;
	state: CheckStateEnum;
	witness: string | null;
};

/**
 * Enum for the state of a proof.
 */
export const CheckStateEnum = {
	UNSPENT: 'UNSPENT',
	PENDING: 'PENDING',
	SPENT: 'SPENT',
} as const;
export type CheckStateEnum = (typeof CheckStateEnum)[keyof typeof CheckStateEnum];
