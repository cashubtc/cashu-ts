import { runSmokeTest } from '../utils.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

runSmokeTest({
	testName: 'NodeNext',
	fixtureDir: path.resolve(__dirname, '.'),
	installDepsCommand: 'npm i typescript --save-dev',
	validationCommands: [
		'npx tsc --noEmit',
		// runtime import to catch exports field mistakes
		`node --unhandled-rejections=strict --input-type=module -e "import('@cashu/cashu-ts').then(m=>{ new m.Wallet('http://localhost:3338'); console.log('nodenext runtime ok') })"`,
	],
});
