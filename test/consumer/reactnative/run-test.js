import { runSmokeTest } from '../utils.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

runSmokeTest({
	testName: 'ReactNative',
	fixtureDir: path.resolve(__dirname, '.'), // Points to reactnative/ for tsconfig.json
	installDepsCommand:
		'npm i --save-dev typescript @tsconfig/react-native @types/react @types/react-native',
	validationCommands: ['npx tsc --noEmit'],
});
