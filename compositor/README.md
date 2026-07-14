# The Early Text Compositor

The _Early Text Compositor_ is a VSCode extension for contributing to the
[Early Text Corpus](https://github.com/earlytexts/corpus), a collection of
diplomatic digital editions of texts from the hand press era, stored in
[Markit](https://github.com/earlytexts/markit) — a human-friendly markup
language designed for early text preservation.

The extension activates when VSCode is opened in a clone of the corpus (it
looks for `data/authors`; if the corpus is a subfolder of the workspace, point
`compositor.corpusRoot` at it). Git stays in the contributor's hands — the
extension reads and writes the working tree, nothing more.

It sits on top of the [Markit language extension](https://github.com/earlytexts/markit)
(declared as an extension dependency), which provides syntax highlighting,
live compile errors, formatting, and preview for individual `.mit` files. The
Compositor adds the corpus layer:

- **Corpus Browser** — an activity-bar tree of authors → works → editions,
  labelled from metadata (names, titles, years; the canonical edition is
  starred). Clicking an author or edition opens its file; works expand to
  their editions, with the metadata stub on the context menu.
- **Validation** — the corpus's full rule set (the same rules `deno task
validate` runs) published to the Problems panel, with a status-bar summary
  and a badge on the tree. Saving a file revalidates in about a second; the
  initial load compiles the whole corpus and takes ~20s.
- **Scaffolding** — New Author, New Work (with its first edition), and New
  Edition commands that prompt for the required metadata and write canonical,
  already-formatted files.
- **Fix Formatting** — the one-click equivalent of the corpus's
  `deno task fmt`, applying the Markit formatter to every file.
- **Insert Borrowed Section Reference** — pick an edition from the catalogue
  and insert a `## <Author.Work.Edition>` placeholder at the cursor.
- **Dictionary diagnostics** — an opt-in overlay
  (`compositor.flagUnaccountedWords`) that squiggles every word the corpus
  dictionary does not yet account for (unknown surfaces as warnings,
  unconfirmed `?` entries as hints), each with quick-fixes that curate the
  entry — add it as a modern word, a respelling, or with a lemma; confirm an
  unconfirmed one — writing the shard file canonically.
- **Dictionary Curation** — an activity-bar view listing the unaccounted and
  unconfirmed surfaces corpus-wide, most frequent first, so the register can be
  backfilled highest-impact first; selecting one opens it in context, the
  right-click menu curates it.

All corpus logic (catalogue building, validation rules, path conventions) is
this repository's own `src/`, bundled directly by esbuild, so the rules cannot
drift from the corpus's own — and contributors need nothing installed beyond
VSCode.

## Development

The Compositor lives inside the corpus repository, alongside the `src/` it
bundles — there is no sibling checkout to manage. Markit is the one remaining
external dependency, installed through JSR's npm compatibility layer under its
registry name `@jsr/earlytexts__markit` (the committed `.npmrc` maps the
`@jsr` scope to `npm.jsr.io`).

```sh
npm install
npm run build     # bundle to dist/
npm run check     # typecheck
npm run fmt:check # format check (npm run fmt to apply)
npm test          # unit tests (scaffold templates against the real rule set)
npm run package   # build the .vsix
```

To try it: open the corpus repository root (this extension's parent folder,
which carries the launch config) in VSCode, press F5, and open a corpus
checkout in the Extension Development Host.

## Architecture

### Key decisions

- **Standalone extension** with `extensionDependencies` on
  `earlytexts.markit-language` (which owns syntax highlighting, per-file live
  compile errors, formatting, and preview). The Compositor adds only the
  corpus layer, and suppresses its own copy of compile errors for open
  documents so the two never double-report.
- **Corpus logic is imported, never reimplemented.** `@earlytexts/corpus`
  (`../src/index.ts`, this repository's own source — see esbuild.mjs) exports
  the corpus's own catalogue build, metadata schema, path conventions,
  validation rules, and the `catalogue/` read/write pair as runtime-neutral
  logic (everything takes a `CorpusFs` port; the disk binding —
  `node:fs`-backed, shared with the corpus's own scripts — is `nodeCorpusFs`,
  re-exported from the main entry). esbuild bundles it straight from source
  into `dist/extension.cjs`, so contributors need nothing beyond VSCode and a
  plain `npm install`. The corpus's own source imports markit under its Deno
  bare specifier (`@earlytexts/markit`); esbuild.mjs, vitest.config.ts, and
  tsconfig.json each alias that specifier to this extension's own markit
  dependency (`@jsr/earlytexts__markit`, from JSR's npm compatibility layer),
  so both halves of the suggestion pipeline resolve to the one installed
  copy — which matters because markit tags blocks with `Symbol()`s that only
  compare equal within one instance.
- **One compile pass per change.** `src/corpusModel.ts` compiles the corpus
  once, feeds the compiled files to the validation rules, and hands the same
  documents to `buildCatalogue` (its `precompiled` parameter) so the catalogue
  composes without recompiling. A watcher on `data/**` recompiles just the
  saved `.mit` file (~1s round trip); non-file events trigger a full reload
  (~20s, cold-start cost).
- **The compiled `catalogue/` masks the cold start.** At startup the model seeds
  the tree from `catalogue/` via the corpus's `loadCatalogue` (~0.5s) while the
  full compile runs; diagnostics always wait for the compile (serialised
  documents carry no source ranges). Every completed load writes `catalogue/`
  back (`writeCatalogue`, ~0.5s, chained so writes never interleave), so the
  cache — and the computer's dev input — stays fresh.
- **Clone Corpus** (welcome-view button / command) delegates to the built-in
  `git.clone` with the corpus URL; opening the clone activates the extension,
  and no separate build step is needed (the model builds in memory).
- **Build tooling**: esbuild + npm; `vsce package` for the .vsix; vitest for
  unit tests (scaffold templates are validated against the real corpus rule
  set via the corpus's in-memory test harness).

### Structure

Three layers, from entry point down into detail. `surface/` is everything that
touches the VSCode API; `lib/` is pure, editor-free logic, unit-tested and free
of any `vscode` import. The rule of thumb — _does this file import `vscode`?_ —
is a directory line: if it needs the editor it lives in `surface/`, otherwise in
`lib/`.

**Entry & state** (`src/`)

- `extension.ts` — activation (corpus-root detection), wiring, commands
- `corpusModel.ts` — in-memory corpus: load/validate/catalogue + watcher, plus
  the catalogue/ cache (seed + write-back). The state every surface hangs off.

**Surface** (`src/surface/`, VSCode-facing)

- `corpusTree.ts` — Corpus Browser tree data provider (rendering only)
- `curationView.ts` — Dictionary Curation tree data provider
- `diagnostics.ts` — Problems-panel + status bar adapter over `planDiagnostics`
- `commands/` — scaffolds, fix formatting, insert borrowed reference, compare
  editions, replace in scope, suggest markup, dictionary diagnostics. Each
  gathers input and applies effects; the decisions are pulled into `lib/`.

**Pure logic** (`src/lib/`, no `vscode`, unit-tested)

- `nodes.ts` — the tree's node vocabulary (`TreeNode`) and the catalogue→file
  path lookups shared by the tree and the commands
- `hints.ts` — the markup-suggestion engine (mine lexicons, scan raw source,
  shared source tokenizer)
- `suggestions.ts` — markup-suggestion helpers (categories, wrap text)
- `hintOverrides.ts` — manual patches to the mined language lexicons
- `dictionaryScan.ts` — locate unaccounted/unconfirmed surfaces in a document's
  source (runs the corpus's accounting rule)
- `dictionaryEdits.ts` — place a curation decision into a shard's canonical text
- `dictionaryEntryText.ts` — validate entry input; squiggle + quick-fix wording
- `curation.ts` — the corpus-wide, frequency-ranked curation worklist
- `diagnosticsPlan.ts` — validations → collection action + status text
- `replaceScope.ts` — which files a replacement touches; the scopes to offer
- `compareScope.ts` — which works are comparable; an edition's successor
- `templates.ts` — scaffold file builders (formatted, schema-correct)
- `wholeWord.ts` — whole-word, case-sensitive replacement

### Markup suggestions

`compositor.suggestMarkup` flags likely people, citations, and foreign text
(Latin/French/Greek/…) in the open edition so a contributor can cycle them
(F8, like any diagnostic) and mark each up with a quick fix — or ignore it.
The finding logic lives here, in `src/lib/hints.ts`: `buildHints`/`scanSource`
mine lexicons from the markup the corpus already carries (so suggestions
improve as markup accumulates) and scan a file's raw source. This is read-side
text processing over the compiled catalogue, which the Compositor owns outright
(the corpus is the write side) — it was moved out of the corpus package into
this extension. The rest is the editor surface: `src/surface/commands/suggestMarkup.ts`
owns the toggle
picker, a dedicated Information-severity diagnostic collection (kept apart from
validation, whose diagnostics share the "compositor" source, so the two never
tangle), and the quick-fix code-action provider. Hints are cached and rebuilt
only when the corpus model reloads; scanning is per-file and on-demand. Pure
rules (category ⇄ suggestion mapping, wrap delimiters) live in
`src/lib/suggestions.ts` and are unit-tested; `test/suggestionsPipeline.test.ts`
runs the whole mine→scan→filter→wrap path — which only holds together because
markit resolves to one instance across the corpus/markit boundary (its block
`Symbol()`s compare equal only within one instance), guaranteed here by the
`@earlytexts/markit` alias in esbuild.mjs/vitest.config.ts pointing both the
corpus's own import and this extension's dependency at the single installed
`@jsr/earlytexts__markit` copy.

### Dictionary curation

The corpus's dictionary (its curated register of surface forms) drives two
editor surfaces, both off the corpus's own **accounting rule** (`accountTokens`
in `@earlytexts/corpus` — the one coverage engine shared by corpus validation
and this extension, so the two cannot disagree):

- **Diagnostics** (`compositor.flagUnaccountedWords`, off by default —
  toggle with `compositor.toggleUnaccountedWords`). While on, the active
  editions are scanned and every unaccounted surface squiggled. The corpus owns
  the _decision_ (which folded surfaces are unaccounted or unconfirmed);
  `src/lib/dictionaryScan.ts` only _locates_ them, reusing the markup-suggestion
  tokenizer (`documentSourceTokens`) so exempting markup (names, citations,
  foreign spans, `[w:]`) is skipped and page breaks/escapes are read through.
  A word built from `{…}` character escapes or a kept ligature (`œconomy`) may
  go unflagged rather than mis-flagged; the coverage counts stay exact.
- **Quick-fixes and the Curation view** write dictionary entries. The pure
  placement (`src/lib/dictionaryEdits.ts`) parses the surface's shard, adds or
  confirms the entry, and re-serialises with the corpus's own `shardDictionary`
  — so an entry added from the editor is byte-identical to one `deno task fmt`
  would produce and round-trips through corpus validation. Whether the result
  is _coherent_ (references resolve, readings select) is the corpus validation's
  business, reported live in the Problems panel after the write. The Curation
  view (`src/lib/curation.ts` + `src/surface/curationView.ts`) ranks the whole backlog by
  corpus-wide frequency so it can be burned down highest-impact first.

The two overlays compose: enable the markup suggestions too, and a squiggled
name offers both "mark up as a person" (from the suggestion provider) and the
dictionary fixes at the same spot — the register and the mined lexicons
reinforce each other, as intended, with no coupling between the features.

The dictionary quick-fixes deliberately do not re-offer name/citation/language
markup (that lives in the markup-suggestion overlay), nor `[w:]`/edition-default
disambiguation of an already-accounted ambiguous surface (which has no
diagnostic to hang a fix on); both are natural follow-ups.

### Corpus layout (what the tree and scaffolds produce)

```
data/authors/<author>.mit            author metadata (no text)
data/works/<host>/<work>/index.mit   work stub: identity + canonical pointer
data/works/<host>/<work>/<year>.mit  a dated edition (1748, 1742a, 1739-40…)
```

`<host>` is the author slug, or a hyphen-joined joint slug for co-authored
works. A section heading `## <Author.Work.Edition>` borrows another edition's
text (collections are composed this way). Metadata lives in `[metadata]`
blocks inside the `.mit` files; the schema is `../src/validation/schema.ts`.

### Conventions

- TypeScript strict (no stricter than the corpus's typecheck, whose sources
  this project typechecks directly via the `@earlytexts/corpus` alias).
  Functional style: arrow functions, no classes.
- Imports use explicit `.ts` extensions (`allowImportingTsExtensions`).
- The corpus itself is bundled directly from the sibling `../src/`; markit
  remains an external dependency (`@jsr/earlytexts__markit`, from JSR's npm
  compatibility layer).
