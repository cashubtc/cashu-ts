/**
 * calculates the fees based on inputs for a given keyset
 * @param {number} nInputs number of inputs
 * @param {number} feeInPPK fee per thousand inputs (PPK)
 * @returns fee amount
 */
export function getTotalInputFee(nInputs: number, feeInPPK: number): number {
	return Math.max(Math.ceil((nInputs * feeInPPK) / 1000));
}
