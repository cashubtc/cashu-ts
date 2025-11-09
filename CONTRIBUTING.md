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

## Integration tests

These tests expect a local mint at `http://localhost:3338`. Use the Make targets below to start one, you will need Docker installed locally, for example via Homebrew or Docker Desktop.

```bash
# CDK Mint
DEV=1 make cdk-up
# tear down
DEV=1 make cdk-down

# Nutshell
DEV=1 make nutshell-up
# tear down
DEV=1 make nutshell-down
```

To prevent accidental use, these targets require `DEV=1` to be set, either by prefixing the command as shown above, or by exporting it in your shell:

```bash
export DEV=1
make cdk-up
make nutshell-up
```

On Apple Silicon the Makefile detects arm64 and runs the container with an amd64 image automatically, if you need to override, pass `PLATFORM=linux/amd64` or `PLATFORM=linux/arm64`.

For a faster developer experience, these developer presets enable friendly defaults such as a permissive transaction rate limit and short fake wallet delays.

Then run the tests:

```bash
# full test suite
npm test
# integration only
npm run test-integration
```

### Notes that save time

- Both CDK Mint and Nutshell remember Lightning invoices, so for a fresh run, tear down the container with volumes. The `*-down` targets already do this for you.
- If websocket tests time out or you see rate limit warnings, bump the Nutshell rate limit, for example `MINT_TRANSACTION_RATE_LIMIT_PER_MINUTE=100`. The developer preset sets a higher limit by default.
- The integration project uses websockets, ensure nothing else is bound to port `3338`.

## Build output contracts

- **TS sources** use extensionless imports.
- **Runtime ESM** (`lib/**/*.js`) must have `.js` on relative imports.
- **Type declarations** (`lib/types/**/*.d.ts`) must stay **extensionless**.
- Our `post-process-dts.js` intentionally skips `.d.ts` to keep API Extractor happy.
