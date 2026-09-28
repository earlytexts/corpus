# Architecture

For someone changing the Compositor. What the layers are, why the corpus model
is shaped as it is, and where a new feature goes.

For what the extension _does_, see the [README](./README.md); for how a
contributor uses it, [the guide](./GUIDE.md). For the corpus package this
extension bundles, see the corpus's own
[architecture notes](../ARCHITECTURE.md).

## Contents

- [Key decisions](#key-decisions)
- [Structure](#structure)
- [The corpus model](#the-corpus-model)
- [Markup suggestions](#markup-suggestions)
- [Dictionary curation](#dictionary-curation)
- [Contributing back](#contributing-back)
- [Conventions](#conventions)
- [Development](#development)
- [Testing](#testing)

## Key decisions

**A standalone extension** with `extensionDependencies` on
`earlytexts.markit-language`, which owns syntax highlighting, per-file live
compile errors, formatting, and preview. The Compositor adds only the corpus
layer, and suppresses its own copy of compile errors for open documents so the
two never double-report.

**Corpus logic is imported, never reimplemented.** `@earlytexts/corpus`
(`../src/index.ts`, this repository's own source — see `esbuild.mjs`) exports
the corpus's catalogue build, metadata schema, path conventions, validation
rules, and the `catalogue/` read/write pair as runtime-neutral logic
(everything takes a `CorpusFs` port; the disk binding — `node:fs`-backed,
shared with the corpus's own scripts — is `nodeCorpusFs`, re-exported from the
main entry). esbuild bundles it straight from source into
`dist/extension.cjs`, so contributors need nothing beyond VS Code and a plain
`npm install`.

The corpus's own source imports markit under its Deno bare specifier
(`@earlytexts/markit`); `esbuild.mjs`, `vitest.config.ts` and `tsconfig.json`
each alias that specifier to this extension's own markit dependency
(`@jsr/earlytexts__markit`, from JSR's npm compatibility layer), so both halves
of the pipeline resolve to the one installed copy.

**Git is the extension's business, not the contributor's.** Both halves of the
round trip — setting the corpus up, and sending work back — run on bundled git
(isomorphic-git) and the GitHub REST API, authenticated with VS Code's built-in
GitHub sign-in, so there is no system git to install and no token to paste.
Set-up forks the corpus into the contributor's account, clones the fork, and
points `upstream` at the canonical corpus; opening the clone activates the
extension, and no separate build step is needed (the model builds in memory).
See [Contributing back](#contributing-back).

**Build tooling**: esbuild + npm; `vsce package` for the `.vsix`; vitest for
unit tests, with the core held at 100% coverage.

## Structure

A hexagon, from entry point down into detail. `src/core/` is the domain: every
decision, written over ports it owns, and testable without a running editor.
`src/adapters/` is everything that names the outside world — the VS Code API,
isomorphic-git, the network — each adapter thin enough to review at a glance.
`src/webview/` is the panels' front-ends, plain DOM bundles that reach the
extension only by message.

The rule of thumb — _does this file import `vscode`, `node:*`, or
`isomorphic-git`?_ — is a directory line, and `test/coreBoundary.test.ts`
enforces it: if it needs the outside world it lives in `adapters/`, otherwise
in `core/`. When that test fails the fix is never to relax it, but to move the
offending code out and hand the core a port.

**Entry** (`src/`)

- `extension.ts` — activation (corpus-root detection), command registration,
  and the composition root: the one place adapters are built and injected

**Core** (`src/core/`, no `vscode`/`node:*`/`isomorphic-git`, held at 100%
coverage)

One folder per feature the extension offers, plus the state they share. `test/`
mirrors the shape: a module's tests sit at the same path under `test/`, with
the whole-pipeline tests (`markup/suggestionsPipeline`,
`dictionary/repro-possessive`) alongside them and the boundary guard at the
root.

- `model/` — the corpus state everything else hangs off. `corpusModel.ts`
  (load/validate/catalogue, the derivations seed and the write-back),
  `compiledFileCache.ts` (the bounded, on-demand compile cache),
  `reloadKind.ts` (what a change under `data/` actually has to re-run),
  `workspace.ts` (which open folder is the corpus; what the tree says per
  phase). See [The corpus model](#the-corpus-model)
- `catalogue/` — pure vocabulary over the compiled catalogue. `nodes.ts` (the
  tree's node types and the catalogue→file-path lookups shared by the tree and
  the commands), `walk.ts` (each work and each edition document visited exactly
  once, despite co-authorship and borrowing), `links.ts` (VIAF/Wikidata/ESTC/TCP
  URLs, and the `viewItem` tokens deciding which link items a menu offers)
- `dictionary/` — the register. `curation.ts` (the corpus-wide,
  frequency-ranked backlog), `scan.ts` (locate unaccounted surfaces in a
  document's source), `resolve.ts` and `cascade.ts` (the attestation rule, and
  the interactive walk that resolves every target an entry names), `edits.ts`
  (place a decision into a shard's canonical text), `entryText.ts` (validate
  entry input; squiggle and quick-fix wording), `shardIO.ts` (the
  read-modify-write primitive both write paths share), `views.ts` (the two
  cross-cut views the panel browses), and `panel/` — its `viewModel.ts`, the
  optimistic `patches.ts`, `input.ts` validation, and the `client.ts`
  filter/page transforms the webview applies
- `hover/` — the token-accounting hover: `info.ts` (how the corpus accounts for
  one hovered token), `view.ts` (that as Markdown), `pinMarkup.ts` (the
  `[w:surface=value]` a pin inserts)
- `markup/` — the suggestion engine: `hints.ts` (mine lexicons from existing
  markup, scan raw source), `suggestions.ts` (category ⇄ markup rules, wrap
  delimiters), `hintIndex.ts` and `hintOverrides.ts` (the mined index, and
  manual patches to it)
- `search/` — `panel.ts`: the query matcher, the block-content line filter,
  author scoping over the catalogue, the per-file scan, and the replace plan
  with its regex-aware replacement strings
- `authoring/` — the cores of the one-shot editing commands: `scaffolds.ts`
  with its `templates.ts` (formatted, schema-correct file builders),
  `borrowedRef.ts`, `fixFormatting.ts`, `importTcp.ts`, and `compareEditions.ts`
  with `compareScope.ts` (which works are comparable; an edition's successor)
- `contribute/` — the round trip. `gitPort.ts` and `github.ts` declare the two
  ports (what changed, branch, commit, merge, push; and the REST calls that are
  not git — the signed-in user, the fork, the pull request); `workflow.ts` is
  the translation layer, where `describeState` decides where a contributor
  stands and the four verbs are written over both ports; `contribution.ts`
  gathers the panel's scene; `setup.ts` holds the onboarding decisions
- `diagnostics/` — `plan.ts` (validations → collection action + status text) and
  `overlayEngine.ts` (the lifecycle both inline overlays share: the scanned-map
  state, the per-document debounce, the scan/drop/refresh branching)
- `shared/` — the primitives several folders need: `sourceTokens.ts` (Markit's
  own tokens placed back in raw `.mit` source — the atom the markup scanner, the
  dictionary scan, the hover, and search all agree on), `serialize.ts` (a FIFO
  mutex, so shard read-modify-writes cannot interleave), `emitter.ts` (a
  vscode-free `EventEmitter` an adapter can still subscribe to)

**Adapters** (`src/adapters/`, the only code that names the outside world)

- `vscode/` — `corpusTree.ts` (Corpus Browser tree data provider, rendering
  only), `diagnostics.ts` (Problems panel + status bar over the plan),
  `hover.ts`, `corpusWatcher.ts`, `overlay.ts`, `doubleClickOpen.ts`,
  `notifier.ts`, and the three webview panels — `searchPanel.ts`,
  `dictionaryPanel.ts` and `contributionPanel.ts`, the last owning what only
  VS Code can do (sign-in, progress, the conflict dialogs, the diffs).
  `panelShell.ts` carries the shared CSP shell and each `*Css.ts` its styles.
  `commands/` is one file per registered command, each gathering input and
  applying effects while the decisions stay in `core/`
- `git/` — `gitPort.ts` (the one place isomorphic-git lives: cloning, remotes,
  and the `GitPort` implementation), `github.ts` (the REST client behind
  `GitHubClient`), `setup.ts` (the "Set up the Corpus" command)
- `http/` — `tcpText.ts`, the Text Creation Partnership fetch

**Webviews** (`src/webview/`, framework-free DOM)

- `main.ts` (the dictionary panel), `search.ts`, `contribute.ts`

## The corpus model

`src/core/model/corpusModel.ts` is the state the tree, the diagnostics and every
command share, and its shape is dictated by one constraint: **resident memory
must scale with the corpus's vocabulary and structure, not with its file
count.** A compiled, positioned copy of every document does not — so the model
does not keep one.

Instead it holds, per source file, a `DerivationRecord`: the corpus's
register-independent `derived`, its `FileProjection`, its per-file violations,
and a block-empty structure `skeleton` — plus a stub-bodied catalogue built from
those skeletons. Positioned documents are needed only by search and by the
buffer being edited, and they are compiled on demand through
`compiledFileCache.ts` and released.

**Cold start does no compiling.** The corpus's build emits
`catalogue/derivations.json` (see the corpus's
[build pipeline](../ARCHITECTURE.md#the-build-pipeline)), and the model seeds
everything from it — structure via `buildCatalogue` over the skeletons, the
indexes and doc-free violations via the persisted records — so the tree and the
Problems panel appear in well under a second instead of after a ~20s
whole-corpus compile. A background sweep then hashes the sources and reconciles
if any changed out of session, recompiling only what moved (or streaming a full
compile when the set of files itself changed). A missing or stale derivations
file falls back to that full compile, which also rewrites the build output.

**In-session edits recompile one file.** `reloadKind.ts` is the pure decision
behind the watcher on `data/**`:

| What changed        | What re-runs                                           |
| ------------------- | ------------------------------------------------------ |
| a `.mit` file       | that file's compile, then indexes/violations/structure |
| a dictionary shard  | validation and the catalogue build only — no compiles  |
| anything structural | the full reload                                        |

The middle row is load-bearing: a shard changes no documents, and recompiling
the corpus on every dictionary edit is what made curation unusable (and what an
out-of-memory crash was made of). Every completed load writes the touched
editions' `catalogue/documents/` back, so the computer's dev input tracks the
edit without a whole-catalogue rewrite.

The bounded cache evicts by **byte budget**, not entry count: edition sizes span
about three orders of magnitude, so a count cap would either thrash on the large
ones or waste memory on the small. It never evicts below a small floor, so one
enormous edition cannot empty the cache, and concurrent requests for the same
uncached path share a single compile.

## Markup suggestions

`compositor.suggestMarkup` flags likely people, places, organisations,
citations, and foreign text (Latin/French/Greek/…) in the open edition so a
contributor can cycle them (F8, like any diagnostic) and mark each up with a
quick fix — or ignore it.

The finding logic lives in `src/core/markup/hints.ts`: `buildHints`/`scanSource`
mine lexicons from the markup the corpus already carries (so suggestions improve
as markup accumulates) and scan a file's raw source. This is read-side text
processing over the compiled catalogue, which the Compositor owns outright — the
corpus package is the write side — and it was moved out of the corpus package
into this extension for that reason.

The rest is the editor layer:
`src/adapters/vscode/commands/suggestMarkup.ts` owns the toggle picker, a
dedicated Information-severity diagnostic collection (kept apart from
validation, whose diagnostics share the "compositor" source, so the two never
tangle), and the quick-fix code-action provider. Hints are cached and rebuilt
only when the corpus model reloads; scanning is per-file and on demand. The pure
rules — category ⇄ suggestion mapping, wrap delimiters — live in
`src/core/markup/suggestions.ts`, and `test/markup/suggestionsPipeline.test.ts`
runs the whole mine→scan→filter→wrap path.

Which findings are _correct_ is an editorial question, answered by the corpus's
[markup policy](../MARKUP.md), not here.

## Dictionary curation

The corpus's dictionary (its curated register of surface forms) drives three
editor surfaces, all off the corpus's own **accounting rule** (`accountTokens`
in `@earlytexts/corpus` — the one coverage engine shared by corpus validation
and this extension, so the two cannot disagree):

- **Diagnostics** (`compositor.flagUnaccountedWords`). The active editions are
  scanned and every unaccounted surface squiggled. The corpus owns the
  _decision_ (which folded surfaces are unaccounted); `src/core/dictionary/scan.ts`
  only _locates_ them, reusing the markup-suggestion tokenizer
  (`documentSourceTokens`) so exempting markup (names, citations, foreign spans,
  `[w:]`) is skipped and page breaks and escapes are read through. A word built
  from `{…}` character escapes or a kept ligature (`œconomy`) may go unflagged
  rather than mis-flagged; the coverage counts stay exact.
- **Quick fixes and the Curation tab** write dictionary entries. The pure
  placement (`src/core/dictionary/edits.ts`) parses the surface's shard, adds
  the entry, and re-serialises with the corpus's own `shardDictionary` — so an
  entry added from the editor is byte-identical to one `deno task fmt` would
  produce and round-trips through corpus validation. Whether the result is
  _coherent_ (references resolve, readings select) is corpus validation's
  business, reported live in the Problems panel after the write.
  `cascade.ts` walks the targets an entry names, so a respelling whose target
  has no entry of its own asks for that one too rather than writing a dangling
  reference. The backlog (`src/core/dictionary/curation.ts`) ranks the whole
  register gap by corpus-wide frequency, counted from the model's token index
  rather than by walking documents — so an edit re-ranks it in milliseconds.
- **The hover** (`compositor.showTokenHover`) reports how one printed word is
  accounted for: the citation lemma, the form it takes in that lemma's paradigm,
  and any other readings, each a click from being pinned with `[w:]`. It speaks
  the dictionary's language (lemma and forms) rather than the accounting
  engine's internal classes, and declines to show anything at all for a token
  with no lemma view to give.

The overlays compose: with both on, a squiggled name offers "mark up as a
person" (from the suggestion provider) and the dictionary fixes at the same
spot — the register and the mined lexicons reinforce each other, with no
coupling between the features. The dictionary quick fixes deliberately do not
re-offer name/citation/language markup (that is the suggestion overlay's), nor
`[w:]`/edition-default disambiguation of an already-accounted ambiguous surface
(which has no diagnostic to hang a fix on); both are natural follow-ups.

The rules the entries themselves must obey are the corpus's
[dictionary policy](../DICTIONARY.md).

## Contributing back

The Contribute panel exists so that someone who has never used git can send a
corrected text to the Centre. Its whole design follows from one decision: **one
unit of work is in flight at a time, and it is called a submission** — one
branch, one pull request, one lifecycle that can be stated in a sentence.
Several submissions at once would mean switching between them, which means files
changing on disk underneath the contributor, which is exactly where a
non-technical user loses trust in the tool.

The vocabulary is fixed, and nothing below the panel is allowed to leak into it:

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
- **decided** — accepted or closed. With nothing pending it offers to clear away
  and start afresh; with new edits it offers to send them as a new submission (a
  settled submission cannot be added to).

Sending is: commit everything as one described commit on a branch named for the
date and the description, bring in the corpus, push to the fork, open the pull
request. Bringing in the corpus at send time — rather than leaving it to the
editors — is deliberate: a contributor should meet a clash with their own work
while they still remember doing it.

A clash is handled in two passes, which is why `mergeCorpus` takes its choices
as a second call rather than a callback. The first pass is a probe that aborts on
conflict, so backing out costs nothing and nothing has moved; the contributor is
then asked, per file, to keep their version or take the corpus's (with a diff of
the two on request); the second pass replays the merge, writes the chosen sides
into the working files, and commits the result with both parents, so it reads as
an ordinary merge to git. Conflict-marker editing is deliberately not offered:
for a corpus of separate texts the realistic clash is "we both edited this text",
which a per-file choice settles, and anything finer is an editorial judgment that
belongs in the review conversation.

The review conversation itself stays on GitHub — the panel links to it rather
than rebuilding it.

## Conventions

- TypeScript strict (no stricter than the corpus's typecheck, whose sources this
  project typechecks directly via the `@earlytexts/corpus` alias). Functional
  style: arrow functions, no classes.
- Imports use explicit `.ts` extensions (`allowImportingTsExtensions`).
- Modules are ordered by the **stepdown rule**: the exported surface first, then
  the helpers it calls beneath it.
- The corpus is bundled directly from `../src/`; markit remains an external
  dependency (`@jsr/earlytexts__markit`, from JSR's npm compatibility layer).
- What the tree and the scaffolds produce — the directory layout, the metadata
  schema, borrowed children — is the corpus's [data model](../DATA_MODEL.md),
  enforced by `../src/validation/schema.ts`. Nothing here restates it.

## Development

The Compositor lives inside the corpus repository, alongside the `src/` it
bundles — there is no sibling checkout to manage. Markit is the one remaining
external dependency, installed through JSR's npm compatibility layer under its
registry name `@jsr/earlytexts__markit` (the committed `.npmrc` maps the `@jsr`
scope to `npm.jsr.io`).

```sh
npm install
npm run build         # bundle to dist/
npm run check         # typecheck (extension + webviews)
npm run fmt:check     # format check (npm run fmt to apply)
npm test              # unit tests
npm run test:coverage # unit tests with the 100% core gate
npm run package       # build the .vsix
```

To try it: open the corpus repository root (this extension's parent folder,
which carries the launch config) in VS Code, press F5, and open a corpus
checkout in the Extension Development Host.

CI runs the typecheck, the format check and the unit tests on every pull request
to the corpus, alongside the corpus's own.

## Testing

`src/core/**` is held at **100% coverage**, enforced by a threshold in
`vitest.config.ts` rather than by review. `all: true` counts every core file, so
a new untested one fails the gate rather than passing unseen; the thresholds
only bite under `--coverage`, so plain `npm test` stays fast. The adapters are
excluded by design — their quality criterion is thinness (reviewable at a
glance), not coverage.

Two tests carry more weight than their size suggests:

- `test/coreBoundary.test.ts` is the hexagon's guard. If a core module starts
  importing `vscode`, `node:*` or `isomorphic-git`, it fails; the fix is to move
  that code into an adapter and hand the core a port.
- `test/markup/suggestionsPipeline.test.ts` runs the whole mine→scan→filter→wrap
  path against the real corpus rule set, which is where the corpus/markit
  aliasing is actually proved.

Scaffold templates are validated against the real corpus rule set via the
corpus's in-memory test harness (`@earlytexts/corpus/test`), so a template that
would not survive validation fails here rather than in a contributor's editor.

Write the test first, and put it at the mirror of the module's path under
`test/`.
