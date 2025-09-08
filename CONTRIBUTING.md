# Contribution Guide

## API-Extractor

This library runs [API-Extractor](https://api-extractor.com/) in its CI pipeline to ensure API changes are intentional and properly reviewed.
The process involves two kinds of reports:

- `/temp/*.md`: The reports in the `temp` directory are created on your local machine and compared against the status quo report. These must not be commited.
- `/etc/cashu-ts.api.md`: This report is the status quo report and is included in the repository. Local versions are compared against this report to detect changes.

There are two scripts to interact with the API-Extractor:

`npm run api:check`
This command will create an API report in the `/temp` directory and compare it against the current status quo report (`/etc/cashu-ts.api.md`). The `/temp` report is not supposed to be commited.
If the two differ, the public API has changed and you will see a warning in the console.

`npm run api:update`
This command will create an API report in the `/temp` directory AND update the status quo report in `/etc`. If there are changes to the status quo report commit the updated report. Otherwise CI will fail.

## Build output contracts

- **TS sources** use extensionless imports.
- **Runtime ESM** (`lib/**/*.js`) must have `.js` on relative imports.
- **Type declarations** (`lib/types/**/*.d.ts`) must stay **extensionless**.
- Our `post-process-dts.js` intentionally skips `.d.ts` to keep API Extractor happy.
