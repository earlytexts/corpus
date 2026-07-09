# The Corpus

A corpus of early modern texts from the hand press era, stored in [Markit](https://github.com/earlytexts/markit/SPECIFICATION.md) format (`.mit` files). This document defines the corpus's data model, directory layout, and metadata schema. Files in this repository are expected to conform; the test pipeline enforces it.

## Data model

The corpus is organised around three entities:

- **Author** — a person who wrote one or more works in the corpus.
- **Work** — a distinct piece of writing by an author, abstracted from any particular printing (e.g. Hume's _Enquiry concerning Human Understanding_). A work is a directory; its `index.mit` is a metadata-only **stub** that holds the work's edition-independent identity (title, breadcrumb) and names its **canonical edition**.
- **Edition** — a concrete dated text of a work: a transcription of the work as it appeared in a particular year (`1748`, `1742a`, …), enabling edition-to-edition comparison. Every work has at least one edition; the **canonical** one is the default a work resolves to (clicking the work, or searching without naming an edition). Works with only one edition still draw the distinction.

Note that editions can contain other editions. For example, the 1753 edition of Hume's _Essays and Treatises_ contains the 1750 edition of the _Enquiry concerning Human Understanding_ (which was reprinted with no changes) and the 1753 edition of the _Enquiry concerning the Principles of Morals_ (which was revised) - alongside some other works. This also means that some editions belong to more than one work: the 1750 edition of the _Enquiry concerning Human Understanding_ belongs to both the _Enquiry concerning Human Understanding_ work and the _Essays and Treatises_ work.

In these cases, every edition still has exactly one **host work** (the work that prefixes its ID), which is the work it is stored under on disk. This is its most "direct" ancestor (i.e. not usually a collection).

## Directory layout

```
data/authors/<author>.mit                      author metadata (no text)
data/works/<author>/<work>/index.mit           the work (metadata + canonical pointer)
data/works/<author>/<work>/<year>.mit          a dated edition (year = 1748, 1742a, …)
data/dictionary/<a–z|other>.json               the dictionary shards (see The dictionary)
```

- `<author>` and `<work>` directory/file names are lowercase slugs. The `<author>` segment is normally one author's slug; a co-authored work instead uses a **joint host slug** — its authors' slugs joined with a hyphen, e.g. `astell-norris` — which is the work's identity but not itself an author (see below).
- **Every work is a directory.** Its `index.mit` is a metadata-only stub carrying `title`, `breadcrumb`, and `canonical` (the slug of the default edition). It holds no text. A work's first-publication year is **not** stored here — it is derived from its editions (see below).
- Sibling entries are the work's dated editions. An edition contains its text inline, and/or borrows the text of other editions through angle-bracket section references (see _Borrowed children_).

## Identifiers

Markit document IDs follow the dotted form `Author.Work` (the stub) or `Author.Work.Edition` (a dated edition), e.g. `Hume.EHU` and `Hume.EHU.1748`. The ID must match the file path case-insensitively: `data/works/hume/ehu/1748.mit` holds `# Hume.EHU.1748`, and the stub `data/works/hume/ehu/index.mit` holds `# Hume.EHU`. Section IDs extend the document ID with one segment per level of nesting (`Hume.THN.1.2.3`); a borrowed edition carries its own full ID in its root heading (`# Hume.EHU.1750`), and is named from the borrowing collection by that ID in angle brackets (`## <Hume.EHU.1750>`).

A work may have **more than one author**. For works with a clear primary author (collections, edited volumes) the work lives under that author's directory and lists just them. For **genuinely co-authored works** — epistolary exchanges where each author contributes equally — the work lives under a **joint host directory** whose slug joins the authors' slugs with a hyphen (in alphabetical order), e.g. `astell-norris`, and its root `authors` lists every author. That joint slug is the work's single identity and URL — its ID is `Astell-Norris.LLG` and it is served at `/astell-norris/llg`. Each section (e.g. a letter) overrides `authors` with the slug of whoever wrote it. The work appears once on disk but is listed in the catalogue under every author it names (and reached only through its joint URL, not under either author individually).

## Borrowed children

By default a document's sections are its inline `##` texts, in file order. A section whose ID is wrapped in **angle brackets** is instead a _borrowed child_: a placeholder naming another edition, whose text is spliced in at that point. For example, in `data/works/hume/etss/1753.mit`:

```
## <Hume.EHU.1750>
```

declares that the collection contains the text of `Hume.EHU.1750` (the edition at `data/works/hume/ehu/1750.mit`) here. The bracketed value is a full `Author.Work.Edition` document ID, resolved to its file case-insensitively (its `.mit` form, or its `<edition>/index.mit` directory form). A borrowed-child placeholder carries no text or metadata of its own — the loaded edition supplies both.

Inline and borrowed sections mix freely, in file order, so a collection can interleave its own front matter (an advertisement, say) with editions borrowed from sibling works.

## Metadata schema

Keys are camelCase. Values use Markit's TOML-style `key = value` syntax. Keys not listed here are not allowed; propose additions in this document first.

### Author (root of `data/authors/<author>.mit`)

| Key           | Type   | Required | Notes                          |
| ------------- | ------ | -------- | ------------------------------ |
| `forename`    | string | yes      |                                |
| `surname`     | string | yes      |                                |
| `title`       | string | no       | honorific, e.g. `"Lord Kames"` |
| `birth`       | number | yes      | year                           |
| `death`       | number | yes      | year                           |
| `nationality` | string | yes      | e.g. `"Scottish"`, `"English"` |
| `sex`         | string | yes      | `"Male"` or `"Female"`         |

### Texts (document roots and sections in `data/works/`)

One schema applies to every text, all the way down: document roots and sections take the same keys. The keys split into two groups:

- **Identity keys** (`title`, `breadcrumb`, `canonical`, `standalone`) describe the text itself and are never inherited.
- **Cascading keys** (`authors`, `imported`, `published`, `sourceUrl`, `sourceDesc`, `dictionary`) flow downward: a section without the key takes the nearest ancestor's value; setting it overrides the value for that text and its descendants. Don't set a cascading key on a section when the inherited value is already right. (`dictionary` cascades per surface: a section's map merges over its ancestors' rather than replacing them.)

Inheritance operates within a file. Each file is valid on its own terms: required keys must be present on the document root, and present _or inherited_ on every section.

| Key          | Type     | Required | Inherited | Notes                                                                                                                                         |
| ------------ | -------- | -------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `title`      | string   | yes      | no        | full title; may contain Markit inline markup                                                                                                  |
| `breadcrumb` | string   | yes      | no        | short title for navigation                                                                                                                    |
| `authors`    | string[] | yes      | yes       | author slugs; a section overrides with whoever wrote it                                                                                       |
| `canonical`  | string   | stub     | no        | **stub only**: slug of the work's default edition                                                                                             |
| `standalone` | boolean  | no       | no        | **stub only**: whether the work lists in indexes on its own (default `true`)                                                                  |
| `imported`   | boolean  | yes\*    | yes       | whether the text itself is present, beyond its metadata                                                                                       |
| `published`  | number[] | yes\*    | yes       | year(s) this edition was published — usually one, an array only for an edition printed over several years (e.g. a multi-volume first edition) |
| `sourceUrl`  | string   | no       | yes       | online transcription/facsimile the text was derived from                                                                                      |
| `sourceDesc` | string   | no       | yes       | prose note on the text's provenance and editorial choices                                                                                     |
| `dictionary` | map      | no       | yes       | `[metadata.dictionary]` section: per-surface default-reading overrides (see [Edition overrides](#edition-overrides-metadatadictionary))       |

Notes:

- The **work stub** (`index.mit`) is the exception to the schema: it carries `title`, `breadcrumb`, `authors`, and `canonical`, and nothing else (no text). `authors` is required (the work's authorship is identity), and `canonical` must name an edition that exists. The `yes\*` rows above (`imported`, `published`) are required on editions, not on stubs — and `published` must **not** appear on the stub, since a work's first-publication year is derived, not stored.
- A work's first-publication year is **derived** as the earliest publication year across all its editions (the catalogue exposes it as `firstPublished`). When a work's earliest printing predates the oldest edition the corpus holds, record that year with an `imported = false` stub edition so the derived value stays right.
- A text is "imported" when its content is present in the corpus (directly or via its descendants) — i.e. when a site can usefully link to it rather than merely list it. A partially-transcribed work sets `imported = true` at the root and `imported = false` on the missing sections (or vice versa).
- `published` on a section records that the section entered the work in a particular year — e.g. an essay added to a later edition of the _Essays_.
- `standalone` governs index listing only. A work borrowed into a collection (its editions spliced in as borrowed children, e.g. the parts of _Essays and Treatises_) is also a directory of its own, so it lists independently by default. Set `standalone = false` on its stub to keep it out of the indexes while leaving it reachable through the collection(s) that borrow it. It does not affect search, retrieval, or the collection itself.

### Block metadata

| Key          | Type     | Notes                                                                     |
| ------------ | -------- | ------------------------------------------------------------------------- |
| `pages`      | string   | page range in the source text, e.g. `"253"`, `"253-5"`                    |
| `speaker`    | string   | who speaks this block, in dialogues (e.g. `"Philo"` in the _Dialogues_)   |
| `subsection` | string   | numbered subdivision this block opens, where sections have internal parts |
| `authors`    | string[] | author(s) of this block, where they differ from the section's authors     |

## The dictionary

The dictionary (`data/dictionary/`) is the corpus's curated register of surface forms: every word as printed, lower-cased (the only mechanical normalisation). It aspires to be a **full register**, not an exception table, so that we can highlight unseen words in the texts as potential typographical errors. While still in development, coverage is reported rather than enforced.

### Entries and readings

Every surface maps to one or more **readings**. More than one reading means the surface is **ambiguous**. Ambiguous surfaces are resolved to the first reading in the list by default (which should be the most common). Markit's `[w:surface=value]` markup can override the default reading for a particular occurrence.

A reading is a sequence of **words**, each with a canonical **spelling** and a **lemma**. It is almost always just one word, but has to be a sequence to support contractions: `'tis` reads as "it is" (lemmas "it be").

A **lemma** is a citation string, not a sense: `lie` (recline) and `lie` (falsehood) share the lemma "lie". Sense-level distinctions are explicitly out of scope for the dictionary.

On disk, normalisation and lemmatisation are **factored**, so each editorial fact is stated exactly once. A bare value is a **cross-reference**: `"vertues": "virtues"` reads as "vertues: see *virtues*" — the lexicographer's convention for variant spellings. Lemmas are stated only on an entry for the modern word itself (`"virtues": "=virtue"`); a cross-referenced surface's lemmas are **derived** from its target's entry. Lemma ambiguity therefore inherits through a cross-reference (it is a property of the modern word), while spelling ambiguity does not (it is a property of the surface).

Entries live in JSON shards keyed by the surface's first letter (ignoring non-letters), `other.json` for anything outside a–z. Keys are sorted, one entry per line; values use a micro-syntax mirroring the `[w:]` markup:

```jsonc
{
  "the": null,                 // seen; modern; lemma = itself
  "increases": "=increase",    // modern; lemma stated, on its one home
  "vertue": "virtue",          // cross-reference: see "virtue"
  "vertues": "virtues",        // cross-reference; lemma derives via "virtues"
  "'tis": "it is",             // one surface, two words, each its own entry
  "then": [null, "than"],      // spelling-ambiguous; default first
  "lay": [null, "=lie"],       // one spelling, two lemmas (a modern word's fact)
  "compleat": "?complete"      // machine-suggested, unconfirmed
}
```

Grammar of a value (`null` is the doubly-identity reading: the surface is a modern word, spelled and lemmatised as itself — a reading that is just the surface's own spelling is always written `null`, never as a self-cross-reference):

```
entry    := value | "[" value ("," value)+ "]"    // array = ambiguous, ordered
value    := null | string
string   := "?"? reading                          // "?" alone = unconfirmed null
reading  := "=" lemma                             // identity: a lemma statement
          | spelling (" " spelling)*              // cross-reference (>1 = expansion)
```

The `?` prefix marks a machine-suggested, human-unconfirmed entry; confirming it is deleting the prefix. There is no escaping: spellings and lemmas must be words (letters and apostrophes), so `=`, space, `?`, and `]` can never collide with the syntax. The register is **closed under derivation**: every cross-referenced spelling must itself have an entry with an identity reading (so lemmas derive in a single step — no respelling chains — and a typo in a value dangles instead of passing silently), and every stated lemma an entry with a `null` reading (a lemma is a citation form). The accepted price is that the register includes modern targets (`virtue`, `be`) even where they are never printed. `deno task fmt` canonicalises the shards (sorting, shard placement, minimal values, whitespace); multi-word *keys* (`to morrow`) are deliberately unimplemented — each half is an ordinary seen word, and `[w:to morrow=tomorrow]` covers important occurrences.

### The accounting rule

> Every token in every text is accounted for by **at least one** of: a dictionary entry for its folded surface; enclosure in person (`[p:]`) / place (`[l:]`) / org (`[o:]`) / citation (`[…]`) / language (`$…$`) markup; or a mechanical class (contains digits, or reads as a strict roman numeral — note `I` is both a numeral and a pronoun, which is why accounting is "at least one of").

The rule is one pure function (`accountTokens` in `src/dictionary.ts`, over the word identity defined in `src/words.ts`: letters plus internal/leading/trailing apostrophes, hyphens split, digit-bearing tokens are not words). It is simultaneously the corpus coverage validation and the Compositor's live squiggle engine. Recorded trade-off of the citation exemption: citation contents never normalise ("A Treatise of Humane Nature" won't match a search for "human nature") — accepted; do not "fix" it by adding citation words to the register. Name *normalisation* (Tully = Cicero) is entity resolution — out of scope.

### `[w:surface=value]` markup

Markit's word element disambiguates occurrences; the corpus defines its semantics:

- **Single-token surface**: the entry for the folded surface must be ambiguous — 2+ **derived** readings, so ambiguity inherited through a cross-reference counts — and the value must select **exactly one** of them: it matches a reading whose full spelling string *or* full lemma string (words joined by single spaces) equals the value: `[w:then=than]`, `[w:lay=lie]`, `[w:borne=born]`. Markup on an unambiguous surface is a validation error, keeping the texts free of noise. Unmarked occurrences mean the first reading — which is therefore the one reading that need not be uniquely selectable (in `"lay": [null, "=lie"]` the string "lay" matches both readings; only `lie` is ever needed in markup).
- **Multi-token surface** (the interim mechanism for `to morrow`): the value is a **cross-reference reading** — spellings only, same grammar as dictionary values: `[w:to morrow=tomorrow]`. No dictionary entry is required; the marked tokens are accounted for by the markup itself, and the value's lemmas derive from the register where its words are registered.

### Edition overrides (`[metadata.dictionary]`)

Orthographic conventions are properties of a *printing*, not of the language corpus-wide: in a 1650s edition `humane` ordinarily reads "human", in a 1750s edition it reads "humane". An edition whose conventions differ from the register's defaults states so once, in its metadata, instead of marking every occurrence:

```
[metadata.dictionary]
humane = "human"
then = "than"
```

Each pair overrides the **default reading** of an ambiguous surface for the text's unmarked occurrences. Values use the same selection grammar as `[w:]` markup — a reading's full spelling string or full lemma string, selecting exactly one of the entry's derived readings — and an override may only *select among* the register's readings, never introduce one: there is exactly one register. The full precedence chain for an occurrence is:

> `[w:]` markup on the occurrence → the text's override for the surface → the entry's first reading

implemented once as `resolveReading` (exported on `wire`, so the computer and the Compositor share it). The map cascades per surface (a section's map merges over its ancestors'), so a borrowed edition keeps its own conventions inside a collection. As with `[w:]` markup, an override on an unambiguous surface is a validation error. Selecting the entry's *current* default is legal — a **pin**, keeping the edition's meaning stable if the register's reading order is ever revised (possible only where the default is itself uniquely selectable). One markit constraint: metadata keys are `\w+`, so a surface containing an apostrophe or a non-ASCII letter cannot be overridden this way — per-occurrence `[w:]` markup covers such (rare) cases.

### Validation tiers

- **Structural** (error): shards parse; keys are folded words, in the right shard, sorted; values are well-formed; shards are byte-for-byte canonical.
- **Referential** (error): the register is closed under derivation (above); an entry's derived readings are distinct and (beyond the default) uniquely selectable; every `[w:]` in the texts, and every `[metadata.dictionary]` override, obeys the semantics above.
- **Coverage** (report only): per work and corpus-wide — % tokens accounted, split into confirmed / unconfirmed / unaccounted. Printed by `deno task test`; flipping it to a hard error is the last step of backfill.

The compiled catalogue emits the dictionary **expanded** — explicit spelling and lemma per word per reading, plus `confirmed` — as `catalogue/dictionary.json`, so consumers never parse the micro-syntax. The computer derives its search levels from it; it has no linguistic heuristics of its own.

## Formatting

Every `.mit` file must compile without errors and be formatted exactly as the Markit formatter (`format()` from `@earlytexts/markit`) would emit it, and every dictionary shard must match the canonical form written by `deno task fmt`. The test pipeline checks both.

## Validation

```sh
deno task build      # compile the catalogue to catalogue/ (the computer's input)
deno task test       # unit tests for the catalogue build + full corpus validation
                     #   (compile + formatting + schema + layout + dictionary checks,
                     #   and the dictionary coverage report)
deno task fmt        # apply deno fmt, the Markit formatter to every .mit file,
                     #   and canonicalise the dictionary shards
deno task check      # typecheck and lint the source and test code
```

The rules themselves live in `src/validate.ts` as pure functions returning structured violations; `tests/validate.test.ts` is a thin test wrapper that runs each rule over the real corpus.

## Architecture

The code implements two pipelines over the data model above, plus the foundations they share. Everything in `src/` is runtime-neutral and pure: filesystem access goes through the `CorpusFs` port (`src/types.ts`), so any host — the Deno scripts here, the Node-based Compositor, the computer's Deno build wrapper, an in-memory test corpus — brings its own binding. Modules read top-down: each file's entry points come first, with helpers below their callers.

**The build pipeline** compiles the corpus into `catalogue/`, the boundary artefact every read-side consumer works from:

```
data/*.mit ──buildCatalogue──▶ Catalogue ──serializeCatalogue──▶ writeCatalogue ──▶ catalogue/
 (source)    (catalogue.ts)   (in memory)     (serialize.ts)  (catalogue-output.ts)    │
                                                                                       ▼
                              Catalogue ◀──────loadCatalogue───────────────── catalogue.json
                             (in memory)       (deserialize.ts)              + documents/*.json
```

- `catalogue.ts` — scans `data/`, compiles every file with `@earlytexts/markit`, resolves borrowed children, and derives the author/work/edition structure (plus the parsed dictionary).
- `serialize.ts` / `deserialize.ts` — the wire format, owned here in both directions. Documents are written _uncomposed_ (a borrowed child is a `{ __ref }` placeholder); `loadCatalogue` splices the single shared instance back in, recreating the object graph.
- `catalogue-output.ts` — writes `catalogue/catalogue.json` plus one document file per edition and the expanded `dictionary.json`, replacing the directory wholesale so stale files never linger.

**The validation pipeline** (`validate.ts`) enforces this document's rules: `loadCorpus` compiles every file standalone, and each `Rule` returns structured violations. The same rules drive corpus validation (part of `deno task test`) and the Compositor's editor diagnostics.

**Foundations**: `types.ts` (the catalogue types — each entity is a shared metadata base plus the field that differs between the in-memory and serialised layers — and the `CorpusFs` ports), `schema.ts` (the metadata schema as data; the tables above are its prose form), `paths.ts` (slug and resolution conventions), `words.ts` (word identity: segmentation, folding, roman numerals, and the block tokenizer — exported on `wire` so every consumer shares one definition of "a word"), and `dictionary.ts` (the register: the entry micro-syntax, the shard files, and the accounting rule).

## As a library

The package is published to [JSR](https://jsr.io/@earlytexts/corpus) as unbundled TypeScript source; JSR generates the type declarations, and its npm compatibility layer (`npm.jsr.io`, package name `@jsr/earlytexts__corpus`) serves transpiled JS + `.d.ts` to Node consumers like the Compositor. Deno consumers (the computer) import `jsr:@earlytexts/corpus` directly. The entry points are role-based:

- `@earlytexts/corpus` (`src/index.ts`) — the authoring surface, re-exporting the `build` and `wire` subpaths below and adding validation, schema, and paths on top. The Compositor VSCode extension bundles this to run the catalogue build, validation, and the `catalogue/` write in-process under Node. (Read-side suggestion logic — the markup hints — lives in the Compositor, not here.)
- `@earlytexts/corpus/wire` (`src/wire.ts`) — the wire contract only: the catalogue types, serialize/deserialize, `loadCatalogue`. This is all the computer's _application_ code imports (via its Deno import map, which maps only this and the `build` subpath, never the full entry); its runtime reads `catalogue/` and never scans or compiles `.mit`.
- `@earlytexts/corpus/build` (`src/build.ts`) — the build surface: `buildCatalogue`/`writeCatalogue` plus the disk-backed `nodeCorpusFs` binding (on `node:fs`, which Deno provides natively). The computer's `scripts/build-corpus.ts` imports this subpath to produce `catalogue/` in prod from the pinned package version — reusing the corpus's compiler rather than reimplementing it, and the one build-time seam its build touches — so the corpus checkout there stays pure data.
- `@earlytexts/corpus/harness` (`src/harness.ts`) — the in-memory corpus builder the corpus's and the computer's tests share.
