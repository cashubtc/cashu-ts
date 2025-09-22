import { runSmokeTest } from '../utils.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

runSmokeTest({
	testName: 'Bundler',
	fixtureDir: path.resolve(__dirname, '.'), // Points to bundler/ for tsconfig.json
	installDepsCommand: 'npm i typescript --save-dev',
	validationCommands: [
		'npx tsc --noEmit',
		`node --unhandled-rejections=strict --input-type=module -e "import('@cashu/cashu-ts').then(m=>{ if(!m.createP2PKsecret) throw new Error('missing export'); console.log('bundler runtime ok') })"`,
	],
});
