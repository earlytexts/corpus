# Data Model

How the corpus is organised: the three entities it is built from, how they sit
on disk, how they are identified, and the full metadata schema every file must
conform to. The test pipeline enforces everything in this document.

This is the reference. For what a corpus text _is_ and how to make one, see
[the editorial policy](./EDITORIAL.md); for the register of spellings, see
[the dictionary](./DICTIONARY.md); for the code that compiles and validates all
of this, see [the architecture notes](./ARCHITECTURE.md).

## Contents

1. [The three entities](#1-the-three-entities)
2. [Directory layout](#2-directory-layout)
3. [Identifiers](#3-identifiers)
4. [Co-authored works](#4-co-authored-works)
5. [Borrowed children](#5-borrowed-children)
6. [Metadata schema](#6-metadata-schema)
7. [External identifiers](#7-external-identifiers)
8. [Block metadata](#8-block-metadata)
9. [Formatting and validation](#9-formatting-and-validation)

## 1. The three entities

- **Author** — a person who wrote one or more works in the corpus.
- **Work** — a distinct piece of writing by an author, abstracted from any
  particular printing (Hume's _Enquiry concerning Human Understanding_). A work
  is a directory; its `index.mit` is a metadata-only **stub** that holds the
  work's edition-independent identity (title, breadcrumb) and names its
  **canonical edition**.
- **Edition** — a concrete dated text of a work: a transcription of the work as
  it appeared in a particular year (`1748`, `1742a`, …), enabling
  edition-to-edition comparison. Every work has at least one edition; the
  **canonical** one is the default a work resolves to (clicking the work, or
  searching without naming an edition). Works with only one edition still draw
  the distinction.

Editions can contain other editions. The 1753 edition of Hume's _Essays and
Treatises_ contains the 1750 edition of the _Enquiry concerning Human
Understanding_ (reprinted with no changes) and the 1753 edition of the _Enquiry
concerning the Principles of Morals_ (revised), alongside other works. So some
editions belong to more than one work: the 1750 _Enquiry concerning Human
Understanding_ belongs both to the _Enquiry_ work and to the _Essays and
Treatises_ work.

In these cases every edition still has exactly one **host work** — the work that
prefixes its ID, and the work it is stored under on disk. This is its most
"direct" ancestor, i.e. not usually a collection.

A work's **first-publication year is derived**, not stored: it is the earliest
publication year across all the work's editions, exposed by the catalogue as
`firstPublished`. When a work's earliest printing predates the oldest edition
the corpus holds, record that year with an `imported = false` stub edition so
the derived value stays right.

## 2. Directory layout

```
data/authors/<author>.mit                      author metadata (no text)
data/works/<author>/<work>/index.mit           the work (metadata + canonical pointer)
data/works/<author>/<work>/<year>.mit          a dated edition (year = 1748, 1742a, …)
data/dictionary/<a–z|other>.json               the dictionary shards (see DICTIONARY.md)
data/reference/                                pinned external reference data
```

- `<author>` and `<work>` directory and file names are **lowercase slugs**. The
  `<author>` segment is normally one author's slug; a co-authored work instead
  uses a **joint host slug** ([§4](#4-co-authored-works)).
- **Every work is a directory.** Its `index.mit` is a metadata-only stub
  carrying `title`, `breadcrumb`, `authors` and `canonical` (the slug of the
  default edition). It holds no text.
- **Sibling entries are the work's dated editions.** An edition contains its
  text inline, and/or borrows the text of other editions through angle-bracket
  section references ([§5](#5-borrowed-children)).

An **edition slug** is four digits, optionally with a disambiguating letter and
optionally spanning to a later year: `1748`, `1742a`, `1739-40`, `1739-1740`.

Every text — edition or stub — resolves either as `<name>.mit` or as
`<name>/index.mit`, so an edition long enough to want its own directory is
supported. No corpus edition currently uses that form.

## 3. Identifiers

Markit document IDs follow the dotted form `Author.Work` (the stub) or
`Author.Work.Edition` (a dated edition): `Hume.EHU` and `Hume.EHU.1748`.

The ID must match the file path case-insensitively — `data/works/hume/ehu/1748.mit`
holds `# Hume.EHU.1748`, and the stub `data/works/hume/ehu/index.mit` holds
`# Hume.EHU`.

Section IDs extend the document ID with one segment per level of nesting
(`Hume.THN.1.2.3`), and a section heading is a **bare segment** — no dots. A
borrowed edition carries its own full ID in its root heading (`# Hume.EHU.1750`)
and is named from the borrowing collection by that ID in angle brackets
(`## <Hume.EHU.1750>`).

Block IDs extend the section ID by one further segment, so every paragraph in
the corpus has a stable, citable address: `Hume.THN.1739-40.1.1.1.1`. They are a
promise to readers, not an implementation detail — see
[editorial policy §9](./EDITORIAL.md#9-blocks-are-citations).

## 4. Co-authored works

A work may have **more than one author**.

For works with a clear primary author (collections, edited volumes) the work
lives under that author's directory and lists just them.

For **genuinely co-authored works** — epistolary exchanges where each author
contributes equally — the work lives under a **joint host directory** whose slug
joins the authors' slugs with a hyphen, in alphabetical order, e.g.
`astell-norris`, and its root `authors` lists every author. That joint slug is
the work's single identity and URL: its ID is `Astell-Norris.LLG` and it is
served at `/astell-norris/llg`. Each section (a letter, say) overrides `authors`
with the slug of whoever wrote it.

The work appears once on disk but is listed in the catalogue under every author
it names — and is reached only through its joint URL, not under either author
individually. A joint slug is a work's identity; it is not itself an author, and
there is no `data/authors/astell-norris.mit`.

## 5. Borrowed children

By default a document's sections are its inline `##` texts, in file order. A
section whose ID is wrapped in **angle brackets** is instead a _borrowed child_:
a placeholder naming another edition, whose text is spliced in at that point.
For example, in `data/works/hume/etss/1753.mit`:

```
## <Hume.EHU.1750>
```

declares that the collection contains the text of `Hume.EHU.1750` (the edition
at `data/works/hume/ehu/1750.mit`) at that point. The bracketed value is a full
`Author.Work.Edition` document ID, resolved to its file case-insensitively
(either its `.mit` form or its `<edition>/index.mit` directory form). A
borrowed-child placeholder carries no text or metadata of its own — the loaded
edition supplies both.

Inline and borrowed sections mix freely, in file order, so a collection can
interleave its own front matter (an advertisement, say) with editions borrowed
from sibling works.

Borrowing has one consequence worth stating for
[external identifiers](#7-external-identifiers): an edition that only ever
appeared _inside_ a collection was never a printed item on its own, so it has no
ESTC record and carries no `estc`. Of the corpus's editions, well over half are
borrowed children in exactly this way.

## 6. Metadata schema

Keys are camelCase. Values use Markit's TOML-style `key = value` syntax. **Keys
not listed here are not allowed**; propose additions in this document first.

The schema is held as data in `src/validation/schema.ts`, which is the single
source of truth the validator enforces; the tables below are its prose form.

### Author (root of `data/authors/<author>.mit`)

An author file holds metadata only — no sections, no content blocks.

| Key           | Type   | Required | Notes                                                       |
| ------------- | ------ | -------- | ----------------------------------------------------------- |
| `forename`    | string | yes      |                                                             |
| `surname`     | string | yes      |                                                             |
| `title`       | string | no       | honorific, e.g. `"Lord Kames"`                              |
| `birth`       | number | yes      | year                                                        |
| `death`       | number | yes      | year                                                        |
| `nationality` | string | yes      | e.g. `"Scottish"`, `"English"`                              |
| `sex`         | string | yes      | `"Male"` or `"Female"`                                      |
| `viaf`        | string | no       | VIAF cluster ID, digits only, e.g. `"49226972"` ([§7](#7-external-identifiers)) |
| `wikidata`    | string | no       | Wikidata item ID, e.g. `"Q37160"` ([§7](#7-external-identifiers)) |

### Texts (document roots and sections in `data/works/`)

One schema applies to every text, all the way down: document roots and sections
take the same keys. The keys split into two groups:

- **Identity keys** (`title`, `breadcrumb`, `canonical`, `standalone`) describe
  the text itself and are never inherited.
- **Cascading keys** (`authors`, `imported`, `published`, `sourceUrl`,
  `sourceDesc`, `estc`, `tcp`, `dictionary`) flow downward: a section without
  the key takes the nearest ancestor's value; setting it overrides the value for
  that text and its descendants. Don't set a cascading key on a section when the
  inherited value is already right. (`dictionary` cascades per surface: a
  section's map merges over its ancestors' rather than replacing them.)

Inheritance operates **within a file**. Each file is valid on its own terms:
required keys must be present on the document root, and present _or inherited_
on every section.

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
| `sourceDesc` | string   | no       | yes       | prose note on the text's provenance and editorial choices                                                                                      |
| `estc`       | string   | no       | yes       | ESTC citation number of the printed item this edition transcribes, e.g. `"T77181"` ([§7](#7-external-identifiers))                            |
| `tcp`        | string   | no       | yes       | Text Creation Partnership text ID, e.g. `"A52437"` ([§7](#7-external-identifiers))                                                             |
| `dictionary` | map      | no       | yes       | `[metadata.dictionary]` section: per-surface default-reading overrides (see [Edition overrides](DICTIONARY.md#edition-overrides-metadatadictionary)) |

Notes:

- The **work stub** (`index.mit`) is the exception to the schema: it carries
  `title`, `breadcrumb`, `authors` and `canonical`, and nothing else (no text).
  `authors` is required — the work's authorship is identity — and `canonical`
  must name an edition that exists. The `yes*` rows above (`imported`,
  `published`) are required on editions, not on stubs; `published` must **not**
  appear on the stub, since a work's first-publication year is derived, not
  stored.
- A text is **"imported"** when its content is present in the corpus (directly
  or via its descendants) — i.e. when a site can usefully link to it rather than
  merely list it. A partially-transcribed work sets `imported = true` at the
  root and `imported = false` on the missing sections (or vice versa).
- `published` on a section records that the section entered the work in a
  particular year — an essay added to a later edition of the _Essays_, say.
- `standalone` governs index listing only. A work borrowed into a collection
  (its editions spliced in as borrowed children — the parts of _Essays and
  Treatises_) is also a directory of its own, so it lists independently by
  default. Set `standalone = false` on its stub to keep it out of the indexes
  while leaving it reachable through the collection(s) that borrow it. It does
  not affect search, retrieval, or the collection itself.
- `estc` and `tcp` are edition-level, like `sourceUrl`: they belong on a dated
  edition, never on the work stub (a work is abstracted from any particular
  printing, so it has no ESTC record).

## 7. External identifiers

Four optional keys tie the corpus's own entities to the authority records for
them elsewhere. Each holds the **bare identifier, not a URL** — the URL is built
from it, so a change of provider does not touch the data:

| Key        | On      | Form                                            | Resolves to                                       |
| ---------- | ------- | ----------------------------------------------- | ------------------------------------------------- |
| `viaf`     | author  | digits, e.g. `49226972`                         | `https://viaf.org/viaf/<id>`                      |
| `wikidata` | author  | `Q` + digits, e.g. `Q37160`                     | `https://www.wikidata.org/wiki/<id>`              |
| `estc`     | edition | `N`/`P`/`R`/`S`/`T`/`W` + digits, e.g. `T77181` | `https://datb.cerl.org/estc/<id>`                 |
| `tcp`      | edition | `A00002`, `K000039.000`                         | `https://github.com/textcreationpartnership/<id>` |

- **`viaf`** — the [VIAF](https://viaf.org) cluster for the author: the
  identifier libraries agree on, and the hub from which the national authority
  files (LC, BnF, DNB, …) hang. Digits only; VIAF clusters do merge, in which
  case the old ID redirects. Long 21–22 digit IDs are real, so the form is not
  length-capped.
- **`wikidata`** — the [Wikidata](https://www.wikidata.org) item for the author.
  Preferred over a Wikipedia article title because it survives a page rename,
  and because it reaches the article in every language (and the author's other
  identifiers) from one stable ID.
- **`estc`** — the citation number of the record in the
  [English Short Title Catalogue](https://datb.cerl.org/estc) describing the
  printed item this edition transcribes. ESTC describes items **as published**,
  so the key belongs on the edition that was itself a printed item. An edition
  that only ever appeared inside a collection — a single essay, or a part
  reprinted unchanged within a larger volume — has no ESTC record of its own and
  carries no `estc`; the collection edition that _was_ printed carries it. ESTC
  moved from the British Library to CERL, which serves the records at
  `datb.cerl.org` (the old `estc.bl.uk/<id>` URLs no longer resolve to a
  record).
- **`tcp`** — the [Text Creation Partnership](https://github.com/textcreationpartnership)
  text ID, where a TCP transcription of this same edition exists. The prefix
  names the phase: `A`/`B` = EEBO-TCP 1/2, `K` = ECCO-TCP, `N` = Evans-TCP. Set
  it only when the TCP text transcribes _this_ edition, not merely the same
  work. The ID resolves to the TCP text's own repository, which is the project's
  distribution point for every phase; where the corpus took its text from a
  reading interface over TCP (Michigan's `quod.lib.umich.edu`), that URL is in
  `sourceUrl`.

**`sourceUrl` is not the edition's identity.** Several corpus files take a TCP
transcription of the _first_ edition and work it up into a later one — their
`sourceDesc` says so plainly. Deriving `estc`/`tcp` from `sourceUrl` in those
cases attaches a first-edition identifier to a third-edition file. Match on the
edition the file _is_.

## 8. Block metadata

| Key          | Type     | Notes                                                                     |
| ------------ | -------- | ------------------------------------------------------------------------- |
| `pages`      | string   | page range in the source text, e.g. `"253"`, `"253-5"`                    |
| `speaker`    | string   | who speaks this block, in dialogues (e.g. `"Philo"` in the _Dialogues_)   |
| `subsection` | string   | numbered subdivision this block opens, where sections have internal parts |
| `authors`    | string[] | author(s) of this block, where they differ from the section's authors     |

## 9. Formatting and validation

Every `.mit` file must compile without errors and be formatted exactly as the
Markit formatter (`format()` from `@earlytexts/markit`) would emit it, and every
dictionary shard must match the canonical form written by `deno task fmt`. The
test pipeline checks both.

```sh
deno task build      # compile the catalogue to catalogue/ (the computer's input)
deno task test       # unit tests for the catalogue build + full corpus validation
                     #   (compile + formatting + schema + layout + dictionary checks,
                     #   and the dictionary coverage report)
deno task fmt        # apply deno fmt, the Markit formatter to every .mit file,
                     #   and canonicalise the dictionary shards
deno task check      # typecheck and lint the source and test code
```

The rules themselves live in `src/validation/rules.ts` as pure functions
returning structured violations; `tests/validate.test.ts` is a thin test wrapper
that runs each rule over the real corpus, and the Compositor runs the same rules
as editor diagnostics. The full list, in the order they run:

| Rule                                                | Checks                                                          |
| --------------------------------------------------- | --------------------------------------------------------------- |
| every file compiles without errors                  | Markit diagnostics                                              |
| every file is formatted canonically                 | byte-identical to `format()`                                    |
| author files match the author schema                | keys, types, required keys, no sections or content              |
| texts match the text schema                         | keys, types, required-or-inherited, stub key placement          |
| work stubs name a canonical edition that exists     | `canonical` resolves in the work's directory                    |
| block metadata matches the block schema             | keys and types                                                  |
| every authors slug names a known author             | `authors` resolves to `data/authors/<slug>.mit`                 |
| root IDs match file paths                           | `# Hume.EHU.1748` ⇄ `works/hume/ehu/1748.mit`                    |
| section headings are bare segments                  | no dots outside a borrowed reference                            |
| borrowed-child references resolve to an edition     | `## <Author.Work.Edition>` names a real file                    |
| layout: lowercase names, index.mit in every directory | slug case, directory shape                                    |
| dictionary shards are well-formed                   | parse, key order, shard placement, canonical formatting         |
| dictionary readings resolve within the register     | closure under derivation                                        |
| canonical spelling matches the reference word list  | SCOWL, with pinned exceptions                                   |
| word markup selects a dictionary reading            | every `[w:]` selects a reading the entry offers                 |
| dictionary overrides select a reading               | every `[metadata.dictionary]` entry likewise                    |

Dictionary **coverage** is reported alongside these but is not a rule: it prints
the percentage of tokens accounted for per work and corpus-wide, and never
fails, because the register is still being backfilled.
