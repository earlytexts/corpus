# The Corpus

A corpus of early modern texts from the hand press era, stored in [Markit](https://github.com/earlytexts/markit/SPECIFICATION.md) format (`.mit` files). This document defines the corpus's data model, directory layout, and metadata schema. Files in this repository are expected to conform; the test pipeline enforces it.

## Data model

The corpus is organised around three entities:

- **Author** — a person who wrote one or more works in the corpus.
- **Work** — a distinct piece of writing by an author, abstracted from any particular printing (e.g. Hume's *Enquiry concerning Human Understanding*).
- **Edition** — a concrete text of a work. Every work has a **reading text**: the curated, corrected text we present by default, constructed from a chosen copytext. A work may additionally have any number of **dated editions**: transcriptions of the work as it appeared in a particular year (`1748`, `1742a`, …), enabling edition-to-edition comparison.

Two further notions are represented without dedicated entities:

- **Sections** — the internal divisions of an edition (parts, books, essays, chapters…). These are Markit's nested texts (`##`, `###`, …), either inline in the edition's file or split into separate files referenced by `children` metadata (see below).
- **Collections** — works whose published form bundles other works (e.g. Hume's *Essays and Treatises on Several Subjects*, or the multi-volume *History of England*). A collection is simply a composite work: its editions reference other works' texts through `children`, so the underlying text is stored once and shared. There is no separate collection entity.

## Directory layout

```
authors/<author>.mit                      author metadata (no text)
works/<author>/<work>.mit                 work whose only text is its reading text
works/<author>/<work>/index.mit           reading text of a multi-edition or multi-file work
works/<author>/<work>/<year>.mit          dated edition (year = 1748, 1742a, …)
works/<author>/<work>/<year>/index.mit    dated edition split across files
works/<author>/<work>/.../<part>.mit      part files referenced via children
```

- `<author>` and `<work>` directory/file names are lowercase slugs.
- A work directory always contains an `index.mit` (its reading text). Sibling entries whose names look like years (`/^\d{4}[a-z]?$/`) are its dated editions; anything else is a part file or directory referenced via `children`.
- A single `.mit` file directly under the author directory is a work with no dated editions and no separate part files: the file is the reading text.

## Identifiers

Markit document IDs follow the dotted form `Author.Work` (reading texts) or `Author.Work.Edition` (dated editions), e.g. `Hume.EHU` and `Hume.EHU.1748`. The ID must match the file path case-insensitively: `works/hume/ehu/1748.mit` holds `# Hume.EHU.1748`. Section IDs extend the document ID with one segment per level of nesting (`Hume.THN.1.2.3`); part files carry their full ID in their root heading (`# Astell.LLG.5`).

A part's author segment need not match the directory's author: a work may contain sections by another hand (e.g. `Norris.LLG.2` inside `works/astell/llg/`).

For works with a clear primary author (collections, edited volumes) the work lives only under that author's directory. For **genuinely co-authored works** — epistolary exchanges where each author contributes equally — the work is stored under *both* authors and appears twice in the catalog. Each author's `index.mit` assembles the full sequence using `children`, with their own letters referenced by bare slug and the co-author's letters by a relative
cross-directory path. The letters themselves are stored once, under their respective authors, and shared by reference. (LLG and LD are the current examples of this pattern.)

## The `children` metadata

By default a document's sections are its inline `##` texts in file order. A text may instead (or additionally) declare `children`, an array of references, each of which is either:

- the ID (last segment) of an inline section of the same file, or
- a relative file path without the `.mit` extension (`"1/index"`, `"../../ehu/1777"`). Paths may cross work boundaries — this is how collections share text.

The referenced texts become the document's sections, in array order.

## Metadata schema

Keys are camelCase. Values use Markit's TOML-style `key = value` syntax only (colon-style `key: value` is invalid Markit). Keys not listed here are not allowed; propose additions in this document first.

### Author (root of `authors/<author>.mit`)

| Key           | Type   | Required | Notes                                       |
| ------------- | ------ | -------- | ------------------------------------------- |
| `forename`    | string | yes      |                                             |
| `surname`     | string | yes      |                                             |
| `title`       | string | no       | honorific, e.g. `"Lord Kames"`              |
| `birth`       | number | yes      | year                                        |
| `death`       | number | yes      | year                                        |
| `published`   | number | yes      | year of first publication; used for sorting |
| `nationality` | string | yes      | e.g. `"Scottish"`, `"English"`              |
| `sex`         | string | yes      | `"Male"` or `"Female"`                      |

### Texts (document roots and sections in `works/`)

One schema applies to every text, all the way down: document roots and sections take the same keys. The keys split into two groups:

- **Identity keys** (`title`, `breadcrumb`, `children`) describe the text itself and are never inherited.
- **Cascading keys** (`imported`, `published`, `copytext`, `sourceUrl`, `sourceDesc`) describe provenance, which flows downward: a section without the key takes the nearest ancestor's value; setting it overrides the value for that text and its descendants. Don't set a cascading key on a section when the inherited value is already right.

Inheritance operates within a file. Each file is valid on its own terms: required keys must be present on the document root, and present _or inherited_ on every section.

| Key          | Type     | Required | Inherited | Notes                                                        |
| ------------ | -------- | -------- | --------- | ------------------------------------------------------------ |
| `title`      | string   | yes      | no        | full title; may contain Markit inline markup                 |
| `breadcrumb` | string   | yes      | no        | short title for navigation                                   |
| `imported`   | boolean  | yes      | yes       | whether the text itself is present, beyond its metadata      |
| `published`  | number[] | yes      | yes       | years this text's content was first published                |
| `copytext`   | string[] | no       | yes       | reading texts only: edition(s) this text is constructed from |
| `children`   | string[] | no       | no        | section references (see above)                               |
| `sourceUrl`  | string   | no       | yes       | online transcription/facsimile the text was derived from     |
| `sourceDesc` | string   | no       | yes       | prose note on the text's provenance and editorial choices    |

Notes:

- A text is "imported" when its content is present in the corpus (directly or via its descendants) — i.e. when a site can usefully link to it rather than merely list it. A partially-transcribed work sets `imported = true` at the root and `imported = false` on the missing sections (or vice versa).
- `published` on a section records that the section entered the work in a particular year — e.g. an essay added to a later edition of the *Essays*.
- `copytext` belongs on reading texts (and their sections, where sections derive from different copytexts). Dated editions are their own copytext, so the key is meaningless there.
- Edition ordering (previous/next) is **derived** from the dated edition file names, not stored. If an edge case ever needs manual ordering, the optional keys `previousEdition` / `nextEdition` (full document IDs) are reserved as overrides.

### Block metadata

| Key          | Type   | Notes                                                                     |
| ------------ | ------ | ------------------------------------------------------------------------- |
| `pages`      | string | page range in the copytext, e.g. `"253"`, `"253-5"`                       |
| `speaker`    | string | who speaks this block, in dialogues (e.g. `"Philo"` in the *Dialogues*)   |
| `subsection` | string | numbered subdivision this block opens, where sections have internal parts |
| `author`     | string | author of this block, where it differs from the text's author             |

## Formatting

Every `.mit` file must compile without errors and be formatted exactly as the Markit formatter (`format()` from `@earlytexts/markit`) would emit it. The test pipeline checks both.

## Validation

```sh
deno task test    # compile + formatting + schema + layout checks over the whole corpus
deno task fix     # apply the Markit formatter to every file in place
deno task check   # typecheck + lint + fmt for the test code itself
```

The suite is honest rather than green: files with known editorial problems (chiefly Hume's essays and the History) fail the compile check until they are actually fixed. Suites other than the first skip files that don't compile, so fixing a compile error may surface new schema or layout findings in that file.
