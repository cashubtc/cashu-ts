import { CashuWallet, CashuMint } from '@cashu/cashu-ts';
import { createCairoSend } from '@cashu/cashu-ts';

// Example usage of the createCairoSend helper function
async function exampleCairoSend() {
	const mint = new CashuMint('https://your-mint-url.com');
	const wallet = new CashuWallet(mint, { unit: 'sat' });

	// Your Cairo executable as a JSON string
	const cairoExecutable = JSON.stringify({
		program: {
			bytecode: [
				"0x40780017fff7fff",
				"0x2",
				// ... more bytecode
			]
		}
	});

	// Expected output from the Cairo program
	const expectedOutput = 1;

	// Use the helper function to create cairoSend object
	const cairoSend = createCairoSend(cairoExecutable, expectedOutput);

	// Now you can use it in wallet.send
	const { send } = await wallet.send(64, proofs, {
		cairoSend: cairoSend
	});

	console.log('Program hash:', cairoSend.programHash);
	console.log('Output hash:', cairoSend.outputHash);
}
