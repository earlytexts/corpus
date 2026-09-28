# Architecture

For someone changing the code. What the two pipelines are, where the boundaries
run, and why the directories are shaped as they are.

For what the data means, see [the data model](./DATA_MODEL.md); for the register,
[the dictionary](./DICTIONARY.md).

## The shape of it

The code implements two pipelines over the data model, plus the foundations they
share.

Everything in `src/` is **runtime-neutral and pure**: filesystem access goes
through the `CorpusFs` port (`src/fs/ports.ts`), so any host brings its own
binding — the Deno scripts here, the Node-based Compositor, the computer's Deno
build wrapper, an in-memory test corpus.

`src/` groups by concern. The two entry-point modules (`wire`, `index`) sit at
the top and re-export the implementations beneath them:

| Directory     | Holds                                              | Published |
| ------------- | -------------------------------------------------- | --------- |
| `fs/`         | the injected disk layer and path conventions       | yes       |
| `dictionary/` | the register                                       | yes       |
| `catalogue/`  | the compiled catalogue's shape and (de)serialisation | yes     |
| `build/`      | the effectful bindings that produce it on disk     | no        |
| `validation/` | the corpus rules                                   | no        |

Those directories are also the **publish boundary**: `wire` and the pure `fs/`,
`dictionary/`, `catalogue/` ship to JSR, while `build/`, `validation/` and
`index` stay in-repo — so the published surface is a whole-directory subset
rather than a carve-out (see [deno.json](./deno.json)'s `publish.include`).

The third published entry point is the test harness (`tests/harness.ts`, the
`@earlytexts/corpus/test` subpath): fixture-building helper logic, so it lives
under `tests/` with the tests it serves rather than in `src/`.

Modules read top-down: each file's entry points come first, with helpers below
their callers.

## The build pipeline

Compiles the corpus into `catalogue/`, the boundary artefact every read-side
consumer works from:

```
data/*.mit ──buildCatalogue──▶ Catalogue ──serializeCatalogue──▶ writeCatalogue ──▶ catalogue/
 (source)  (catalogue/compile) (in memory) (catalogue/serialize) (build/write)        │
                                                                                      ▼
                             Catalogue ◀──────loadCatalogue───────────────── catalogue.json
                            (in memory)   (catalogue/deserialize)           + documents/*.json
```

- **`catalogue/compile.ts`** — scans `data/`, compiles every file with
  `@earlytexts/markit`, resolves borrowed children, and derives the
  author/work/edition structure (plus the parsed dictionary).
- **`catalogue/serialize.ts` / `catalogue/deserialize.ts`** — the wire format,
  owned here in both directions. Documents are written _uncomposed_ (a borrowed
  child is a `{ __ref }` placeholder); `loadCatalogue` splices the single shared
  instance back in, recreating the object graph.
- **`catalogue/types.ts`** — the catalogue types: each entity is a shared
  metadata base plus the field that differs between the in-memory and serialised
  layers.
- **`build/write.ts`** — writes `catalogue/catalogue.json` plus one document
  file per edition, the expanded `dictionary.json`, and `derivations.json`,
  replacing the directory wholesale so stale files never linger. It lives in
  `build/` (not `catalogue/`) because it is effectful and in-repo only: no
  read-side consumer writes the catalogue. `build/node.ts`, the disk-backed
  `CorpusFs` binding these scripts run on, sits beside it.
- **`build/derivations.ts`** — `catalogue/derivations.json`, a Compositor
  convenience the build emits and the Compositor keeps fresh. Where
  `catalogue/documents/` holds each edition's body for the computer, this holds
  each _source_ `.mit`'s register-independent reductions, so the Compositor can
  paint its tree, rebuild its indexes and validate at cold start with no
  compiles and no positioned documents resident. Keyed by source path, not
  edition key — derivations are per source file, and a composed edition's
  children are separate sources. Each record carries a size and content hash so
  a background sweep can tell which sources changed out-of-session. The computer
  ignores this file.

## The validation pipeline

`validation/rules.ts` enforces the data model's rules: `loadCorpus` compiles
every file standalone, and each `Rule` returns structured violations rather than
throwing. The same rules drive corpus validation (part of `deno task test`) and
the Compositor's editor diagnostics, so the two cannot disagree.

- **`validation/schema.ts`** holds the metadata schema as data — the prose
  tables in [data model §6](./DATA_MODEL.md#6-metadata-schema) are its human
  form.
- **`validation/account.ts`** is the accounting rule (token coverage), shared
  with the Compositor's live squiggle engine. It reads the register but is a
  validation rule, so it lives here rather than in `dictionary/`.
- **`validation/derive.ts`** computes each file's register-_independent_
  reductions once per compile — its formatting comparison, its token candidates,
  its `[w:]`-marked tokens — so a dictionary edit never re-tokenizes or
  re-formats an unchanged file. The register-dependent half of accounting is a
  membership test the consumers apply at the end.
- **`validation/crossFile.ts`** holds the cross-file tier as an **index** rather
  than a sweep. It is the only tier that touches the filesystem, and it does so
  heavily; re-running it whole for a one-file change is what made a structural
  save feel slow. The corpus has exactly two cross-file dependency edges
  (borrowed children, author slugs) and the index keeps a reverse map for each,
  so `update` returns the whole tier's violations while re-deriving only the
  files a change could have reached. `reset` is the from-scratch path, and the
  equivalence between "any sequence of updates" and "a reset over the same
  projections" is the property the tests pin down.
- **`validation/cache.ts`** memoizes the two fixed external inputs — the ~106k
  entry reference word list and the canonical-spelling exceptions — keyed on
  file text rather than path or mtime, because `CorpusFs` exposes neither and
  content is the only thing that can change the answer. Injected on the
  `RuleContext` rather than module-global, so tests and concurrent roots never
  share memos.

### The four tiers

`validateCorpus` runs the flat rule list, and that is the guard. But the rules
also partition by data dependency, so validation never needs the whole corpus
resident as positioned documents:

| Tier                        | Needs                                    | Re-runs when                    |
| --------------------------- | ---------------------------------------- | ------------------------------- |
| `validateFile`              | one file's own doc/errors/derivations    | that file is edited             |
| `validateWordAndOverride`   | marked tokens + overrides + a dictionary | the dictionary changes          |
| `validateCrossFile`         | every file's projection, plus the fs     | a file appears, moves, or renames |
| `validateDictionary`        | the shards on disk                       | the shards change               |

A file is reduced once to two persistable products — its `derived`
(`derive.ts`) and its `FileProjection` (`rules.ts`) — and the tiers work off
those. The tiers recompose to exactly the same violations as the flat list, and
`tests/project.test.ts` is what holds them to it.

## The dictionary

`dictionary/` is the register of surface forms, split by concern:

- **`words.ts`** — word identity: segmentation, folding, roman numerals, and the
  block tokenizer. The primitive the register is keyed on, exported on `wire` so
  every consumer shares one definition of "a word".
- **`types.ts`** — the expanded and authored shapes.
- **`resolve.ts`** — the read side: `[w:]`/override selection, re-exported on
  `wire`.
- **`shards.ts`** — the on-disk shard micro-syntax, both directions.
- **`expand.ts`** — composing authored facts into the expanded dictionary, plus
  the register-level violations.
- **`snapshot.ts`** — one read of the shards, with each derived product (the
  parse, the expansion, the canonical re-render) computed at most once, on
  demand. A snapshot, not a cache: nothing here watches the filesystem.

## Foundations

`fs/` holds the injected disk layer both pipelines share — `ports.ts` (the
`CorpusFs` filesystem ports) and `paths.ts` (slug and resolution conventions:
the edition-slug pattern, borrowed-reference parsing, and case-insensitive
resolution of an ID or stem to a file). The concrete disk binding
(`build/node.ts`) and the catalogue writer (`build/write.ts`) are the effectful
`build/` tier above, kept off the published surface.

## As a library

The package is published to [JSR](https://jsr.io/@earlytexts/corpus) as
unbundled TypeScript source; JSR generates the type declarations, and its npm
compatibility layer (`npm.jsr.io`, package name `@jsr/earlytexts__corpus`)
serves transpiled JS + `.d.ts` to Node consumers. Deno consumers (the computer)
import `jsr:@earlytexts/corpus` directly.

The published package exists for the computer alone, so its surface is
deliberately narrow — just two subpaths:

- **`@earlytexts/corpus/wire`** (`src/wire.ts`) — the wire contract only: the
  catalogue types, serialize/deserialize, `loadCatalogue`, word semantics, and
  dictionary resolution. This is all the computer's _application_ code imports;
  its runtime reads `catalogue/` and never scans or compiles `.mit`. The
  boundary is enforced by the import graph rather than by convention.
- **`@earlytexts/corpus/test`** (`tests/harness.ts`) — the in-memory corpus
  builder the corpus's and the computer's tests share, plus `buildCatalogue`
  (the compiler) to compile a fixture map into a catalogue in memory. It is
  test-support code, so it lives under `tests/`, not `src/` — the one published
  file outside `src/`. This is the computer's only door onto the compiler: in
  production it builds `catalogue/` by running this checkout's own
  `deno task build` (its `scripts/build-corpus.ts` shells out to it), not by
  importing the compiler.

`src/index.ts` is the third entry point and is **not published**. It is the
authoring surface — build functions, validation rules, dictionary authoring, and
the wire contract on top — and the Compositor bundles it from source with
esbuild, since the extension lives inside this repository. Read-side suggestion
logic (markup hints) is the Compositor's own and does not live here.

## The Compositor

The VS Code extension in [compositor/](./compositor/) is a separate npm package
inside this repository, and its own
[architecture notes](./compositor/ARCHITECTURE.md) document its hexagonal
structure. Two facts matter from this side:

- **It imports the corpus's logic, never reimplements it.** esbuild bundles
  `../src/index.ts` straight from source into the extension, so the validation
  rules, the schema, the path conventions and the catalogue read/write pair
  cannot drift from the corpus's own.
- **It aliases `@earlytexts/markit`** (the corpus's Deno bare specifier) to its
  own `@jsr/earlytexts__markit` dependency in `esbuild.mjs`, `vitest.config.ts`
  and `tsconfig.json`. Both halves must resolve to one installed copy, because
  markit tags blocks with `Symbol()`s that compare equal only within a single
  instance.

## Development

```sh
deno task build      # compile the catalogue to catalogue/
deno task test       # unit tests + full corpus validation (test:coverage for a report)
deno task check      # typecheck + lint
deno task fmt        # deno fmt, the Markit formatter over every .mit, canonical shards
deno task fmt:check  # verify all three
```

CI runs `check`, `fmt:check`, `test`, `build` and `deno publish --dry-run` on
every pull request, plus the Compositor's own typecheck, format check and unit
tests. See [editors' guide §8](./EDITORS.md#8-release-and-publish) for what a
release is.
