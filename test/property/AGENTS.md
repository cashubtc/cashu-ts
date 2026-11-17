# Property tests

Generated-input tests built on [fast-check](https://fast-check.dev). Each `it` states a rule that must hold for every input, draws inputs from an arbitrary, and on failure prints the smallest counterexample it could shrink to, with a `seed` and `path` to replay it.

## Running

- PR counts: `npx vitest run test/property --project node` (about 5 s).
- Nightly counts: `PROPERTY_RUNS=500 npx vitest run test/property --project node --testTimeout=1800000` (about 5 min). `.github/workflows/nightly-property-tests.yml` runs this daily.
- Replay a failure: `PROPERTY_SEED=<seed> PROPERTY_PATH=<path> npx vitest run test/property --project node -t '<test name>'`. The path without its shrink suffix (`250` rather than `250:0:2`) replays the original draw.

## Map

`arbitraries.ts` holds the generators (`hex`, `text`, `amount`, `proof`, `token`, `creqAOptions`, `creqBOptions`), `hostile` (anything a caller or peer could pass instead of the declared type), `mutated` (one hostile value at one path of a well-formed value), tree helpers, the `runs(n)` budget helper, and the rejection rule `isLibraryError`: a `CTSError` or a dependency's plain `Error` is a proper rejection; a `TypeError` or `RangeError` means a value reached code that never checked it.

Pure functions:

- `roundtrip`: encode then decode returns the input (tokens, payment requests, preview serializers).
- `rejection`: every public decoder and constructor returns a well-formed value or rejects per `isLibraryError`, on hostile values, arbitrary strings and mutated payloads.
- `nullish`: a `null` optional field decodes the same as an absent one, for every field the NUTs mark optional.
- `selection`: coin selectors and `sendOffline` partition the input exactly and cover the target.
- `aliasing`: builders and derivers share no mutable state with their callers.

Wallet against a mint (`mint/`):

- `mint.ts`: `InMemoryMint`, an honest mint behind `fetch` that signs for real, charges fees and logs every exchange. `tamper` rewrites a response and `hold` delays it, both after the mint has committed the request.
- `harness.ts`: the op model (`mint`, `send`, `receive`, `melt`, `restore`), the app's view of what it owns, and the oracles: `expectSound`, `expectModel`, `expectResult`, `expectQuotesEcho`, `resync`.
- `faulty.ts`: the one-response fault kinds (`mutate`, `replay`, `swap element`, `reorder`, `shorten`, `lengthen`, `move amounts`).
- `honest`: random op sequences at three fee levels keep holdings equal to the model, and restore recovers exactly them.
- `faulty`: one altered response; each op rejects with a library error or returns what was asked, and no value is lost.
- `quotes`: a returned quote answers the request it was asked, or the call rejects.
- `nullish`: null means absent in mint responses, at the `Mint` class and through a wallet flow.
- `reload`: reloads from persisted counters, stale snapshots and caller-chosen counters never reissue an output or quote lock key.
- `abort`: after an abort, a one-shot op sends at most its commit and otherwise rejects with `CallerAbortError`; `loadMint` and the polling watches send nothing.

## Conventions

- The `it` name is the property. Keep it readable as a true statement about the library.
- `numRuns` below the default is a CI budget choice; wrap it in `runs(n)` so the nightly can raise it.
- A failing property is a counterexample, not a flaky test: replay it with the seed before changing either side. When a property is wrong about the library, fix the oracle in the harness, not the generator.
- Keep the test tree free of `any`; the harness types bodies as `unknown` and narrows at the route.
