# Consumer smoke tests

These fixtures verify that `@cashu/cashu-ts` can be consumed across common environments with minimal configuration. They focus on type checking and a tiny runtime probe, so they run fast and give early signal about packaging or exports issues.

## What each target proves

Bundler: TypeScript compiles with `moduleResolution` set to `bundler`. One line node runtime eval confirms the ESM entry is loadable and that `createP2PKsecret` is exported.

CommonJS: TypeScript compiles with `module` set to `commonjs`, then `node index.js` runs. This catches classic CJS interop mistakes at runtime.

IIFE: We build the standalone browser bundle, rewrite a local `index.html` to point at it, then load it in headless Chromium and watch for console errors.

NodeNext: TypeScript compiles with `module` and `moduleResolution` set to `nodenext`. One line node runtime eval confirms the ESM entry loads and a `Wallet` can be constructed.

React Native: TypeScript compiles using `@tsconfig/react-native`, with Jest types removed to keep the dependency tree small. No runtime for RN here, that would belong in a dedicated RN app test.

## Running locally

From the repo root:

```bash
npm run test:consumer            # run all targets, sequential
npm run test:consumer:bundler
npm run test:consumer:commonjs
npm run test:consumer:iife
npm run test:consumer:nodenext
npm run test:consumer:reactnative
```
