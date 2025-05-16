## Types

Types should be co-located in the same module alongside the code they belong to. This makes lookups simple and fast.

```ts
type SpecificThing = {
  a: string,
  b: string
}

export specificFunction(param: SpecificThing): string {
  return param.a + param.b
}
```

Types can be exported from their modules and can be used throughout the codebase. They can also be added to the public API surface by adding an explicit export in `index.ts`

Types that do not explicitly belong to a single module should be added to the types directory.

> [!WARNING]
> As of right now ALL types in the types directory are added to the public API.
