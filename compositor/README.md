# The Early Text Compositor

The _Early Text Compositor_ is a VSCode extension for contributing to the
[Early Text Corpus](https://github.com/earlytexts/corpus), a collection of
diplomatic digital editions of texts from the hand press era, stored in
[Markit](https://github.com/earlytexts/markit) — a human-friendly markup
language designed for early text preservation.

The extension activates when VSCode is opened in a copy of the corpus (it
looks for `data/authors`; if the corpus is a subfolder of the workspace, point
`compositor.corpusRoot` at it). Contributors are not expected to know git: the
extension sets the corpus up on their machine and carries their finished work
back to the Centre for review, using a GitHub account and nothing else.

It sits on top of the [Markit language extension](https://github.com/earlytexts/markit)
(declared as an extension dependency), which provides syntax highlighting,
live compile errors, formatting, and preview for individual `.mit` files. The
Compositor adds the corpus layer:

- **Corpus Browser** — an activity-bar tree of authors → works → editions,
  labelled from metadata (names, titles, years; the canonical edition is
  starred). Clicking an author or edition opens its file; works expand to
  their editions, with the metadata stub on the context menu.
- **Corpus Search** — a docked search-and-replace panel shaped like VSCode's
  native Search view, scoped to the corpus's works: it filters by author
  (include/exclude) rather than file glob, covers only catalogue editions, and
  matches only block content — never `[metadata]` sections, title lines, or
  `{#…}` block tags. Results group per edition under catalogue labels
  ("Hume · Enquiry · 1748"); replacement works per match, per edition, or
  across everything not dismissed, with each match re-verified against the
  live document before it is touched. "Search the Corpus…" on a `.mit`
  editor's context menu seeds the panel with the word under the cursor
  (whole-word, case-sensitive).
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
- **Contribute** — a docked panel that carries a contributor's work back to
  the Centre without ever naming a branch, a commit, a push or a pull request.
  It shows one situation at a time — your changes, your submission, what the
  editors decided — with the file list labelled from the catalogue ("Hume ·
  Enquiry · 1748"), a diff of what you changed, an undo per file, and a
  description box whose text becomes the title the editors read. Sending
  brings in the latest corpus first, asking about any text that changed on
  both sides, then opens the submission on GitHub. See
  [Contributing back](#contributing-back).
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
- **Git is the extension's business, not the contributor's.** Both halves of
  the round trip — setting the corpus up, and sending work back — run on
  bundled git (isomorphic-git) and the GitHub REST API, authenticated with
  VSCode's built-in GitHub sign-in, so there is no system git to install and
  no token to paste. Set-up forks the corpus into the contributor's account,
  clones the fork, and points `upstream` at the canonical corpus; opening the
  clone activates the extension, and no separate build step is needed (the
  model builds in memory). See [Contributing back](#contributing-back) for the
  rest.
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
- `searchPanel.ts` — the Corpus Search webview: scans the model's compiled
  files on each query message, posts grouped results, verifies and applies
  replaces (`panelShell.ts` carries the shared CSP shell, `searchPanelCss.ts`
  the styles, `src/webview/search.ts` the front-end)
- `contributionPanel.ts` — the Contribute webview: reads the working copy
  through the git port, asks GitHub about the submission, posts the scene
  `workflow.ts` decides, and owns what only VSCode can do — sign-in, progress,
  the conflict dialogs, the diffs (`contributionPanelCss.ts` the styles,
  `src/webview/contribute.ts` the front-end)
- `commands/` — scaffolds, fix formatting, insert borrowed reference, compare
  editions, suggest markup, dictionary diagnostics. Each gathers input and
  applies effects; the decisions are pulled into `lib/`.

**Git and GitHub** (`src/git/`, no `vscode` below `setup.ts`)

- `gitPort.ts` — the one place isomorphic-git lives: cloning and remotes for
  set-up, and the `GitPort` type (what changed, branch, commit, merge, push)
  the contribution flow works through
- `github.ts` — the REST calls that are not git: the signed-in user, finding
  or creating the fork, opening and following pull requests. `ensureFork` is
  pure over the `GitHubClient` port
- `workflow.ts` — the translation layer: `describeState` (pure) decides where
  a contributor stands, and the four verbs — send for review, add to a
  submission, get the latest corpus, tidy up — are written over the two ports,
  so the whole flow is tested without a repository or a network
- `setup.ts` — the "Set up the corpus" onboarding command (VSCode-facing)

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
- `searchPanel.ts` — the search core: the query matcher, the block-content
  line filter, author scoping over the catalogue, the per-file scan, and
  regex-aware replacement strings
- `compareScope.ts` — which works are comparable; an edition's successor
- `templates.ts` — scaffold file builders (formatted, schema-correct)

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

### Contributing back

The Contribute panel exists so that someone who has never used git can send a
corrected text to the Centre. Its whole design follows from one decision: **one
unit of work is in flight at a time, and it is called a submission** — one
branch, one pull request, one lifecycle that can be stated in a sentence.
Several submissions at once would mean switching between them, which means
files changing on disk underneath the contributor, which is exactly where a
non-technical user loses trust in the tool.

The vocabulary is fixed, and nothing below the panel is allowed to leak into
it:

| git                                   | what the contributor is told |
| ------------------------------------- | ---------------------------- |
| fork                                  | your copy of the corpus      |
| working tree changes                  | your changes                 |
| branch + commit + push + pull request | send for review              |
| a pull request                        | your submission              |
| merging `upstream/main`               | getting the latest corpus    |
| merged                                | accepted into the corpus     |

`describeState` reads three facts — which branch the copy is on, what has
changed, and what GitHub says about the submission — and returns exactly one
situation, which is the only thing the panel can render:

- **clean** — nothing changed, nothing outstanding; offers the latest corpus.
- **editing** — work not yet sent: the changed files, and the description box
  that sends them.
- **unfinished** — a send that stopped part-way (the connection dropped between
  the push and the pull request). The work is safe on its branch, and the panel
  offers to finish, named after the commit it carries. Without this a
  contributor would be stranded on a branch with no way forward.
- **sent** — awaiting review; further edits go to the same submission.
- **decided** — accepted or closed. With nothing pending it offers to clear
  away and start afresh; with new edits it offers to send them as a new
  submission (a settled submission cannot be added to).

Sending is: commit everything as one described commit on a branch named for the
date and the description, bring in the corpus, push to the fork, open the pull
request. Bringing in the corpus at send time — rather than leaving it to the
editors — is deliberate: a contributor should meet a clash with their own work
while they still remember doing it.

A clash is handled in two passes, which is why `mergeCorpus` takes its choices
as a second call rather than a callback. The first pass is a probe that aborts
on conflict, so backing out costs nothing and nothing has moved; the
contributor is then asked, per file, to keep their version or take the corpus's
(with a diff of the two on request); the second pass replays the merge, writes
the chosen sides into the working files, and commits the result with both
parents, so it reads as an ordinary merge to git. Conflict-marker editing is
deliberately not offered: for a corpus of separate texts the realistic clash is
"we both edited this text", which a per-file choice settles, and anything finer
is an editorial judgment that belongs in the review conversation.

The review conversation itself stays on GitHub — the panel links to it rather
than rebuilding it.

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
