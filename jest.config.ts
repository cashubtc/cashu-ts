export default {
	projects: [
		{
			displayName: 'node',
			transform: { '^.+\\.ts?$': 'ts-jest' },
			testEnvironment: 'node',
			resolver: 'ts-jest-resolver',
			testRegex: '/test/.*\\.(test|spec)?\\.(ts|tsx)$',
			moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
			setupFilesAfterEnv: ['./test/_replace-native-fetch.ts']
		},
		{
			displayName: 'browser',
			transform: { '^.+\\.ts?$': 'ts-jest' },
			testEnvironment: 'jsdom',
			resolver: 'ts-jest-resolver',
			testRegex: '/test/.*\\.(test|spec)?\\.(ts|tsx)$',
			moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
			setupFilesAfterEnv: ['./test/_replace-native-fetch.ts']
		}
	]
};
