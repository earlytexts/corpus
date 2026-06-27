# The Corpus

A corpus of early modern texts from the hand press era, stored in [Markit](https://github.com/earlytexts/markit/SPECIFICATION.md) format (`.mit` files). This document defines the corpus's data model, directory layout, and metadata schema. Files in this repository are expected to conform; the test pipeline enforces it.

## Data model

The corpus is organised around three entities:

- **Author** — a person who wrote one or more works in the corpus.
- **Work** — a distinct piece of writing by an author, abstracted from any particular printing (e.g. Hume's *Enquiry concerning Human Understanding*). A work is a directory; its `index.mit` is a metadata-only **stub** that holds the work's edition-independent identity (title, breadcrumb) and names its **canonical edition**.
- **Edition** — a concrete dated text of a work: a transcription of the work as it appeared in a particular year (`1748`, `1742a`, …), enabling edition-to-edition comparison. Every work has at least one edition; the **canonical** one is the default a work resolves to (clicking the work, or searching without naming an edition). Works with only one edition still draw the distinction.

Note that editions can contain other editions. For example, the 1753 edition of Hume's *Essays and Treatises* contains the 1750 edition of the *Enquiry concerning Human Understanding* (which was reprinted with no changes) and the 1753 edition of the *Enquiry concerning the Principles of Morals* (which was revised) - alongside some other works. This also means that some editions belong to more than one work: the 1750 edition of the *Enquiry concerning Human Understanding* belongs to both the *Enquiry concerning Human Understanding* work and the *Essays and Treatises* work.

In these cases, every edition still has exactly one **host work** (the work that prefixes its ID), which is the work it is stored under on disk. This is its most "direct" ancestor (i.e. not usually a collection).

## Directory layout

```
data/authors/<author>.mit                      author metadata (no text)
data/works/<author>/<work>/index.mit           the work (metadata + canonical pointer)
data/works/<author>/<work>/<year>.mit          a dated edition (year = 1748, 1742a, …)
```

- `<author>` and `<work>` directory/file names are lowercase slugs.
- **Every work is a directory.** Its `index.mit` is a metadata-only stub carrying `title`, `breadcrumb`, optional `published`, and `canonical` (the slug of the default edition). It holds no text.
- Sibling entries are the work's dated editions. An edition contains its text inline, and/or borrows the text of other editions through angle-bracket section references (see *Borrowed children*).

## Identifiers

Markit document IDs follow the dotted form `Author.Work` (the stub) or `Author.Work.Edition` (a dated edition), e.g. `Hume.EHU` and `Hume.EHU.1748`. The ID must match the file path case-insensitively: `data/works/hume/ehu/1748.mit` holds `# Hume.EHU.1748`, and the stub `data/works/hume/ehu/index.mit` holds `# Hume.EHU`. Section IDs extend the document ID with one segment per level of nesting (`Hume.THN.1.2.3`); a borrowed edition carries its own full ID in its root heading (`# Hume.EHU.1750`), and is named from the borrowing collection by that ID in angle brackets (`## <Hume.EHU.1750>`).

Authorship is carried by the `authors` metadata key (below), not by the ID's author segment: every part of a work uses the host author in its ID, so a part's ID always matches its directory path, even when another hand wrote it.

A work may have **more than one author**. For works with a clear primary author (collections, edited volumes) the work lives under that author's directory and lists just them. For **genuinely co-authored works** — epistolary exchanges where each author contributes equally — the work lives in a single directory under its **first author alphabetically** (the host), and its root `authors` lists every author. Each section (e.g. a letter) overrides `authors` with the slug of whoever wrote it; the letters are the edition's inline `##` sections. The work appears once on disk but is listed in the catalog under every author it names. (LLG — Astell & Norris — and the Clarke–Collins Dodwell correspondence are the current examples of this pattern.)

## Borrowed children

By default a document's sections are its inline `##` texts, in file order. A section whose ID is wrapped in **angle brackets** is instead a *borrowed child*: a placeholder naming another edition, whose text is spliced in at that point. For example, in `data/works/hume/etss/1753.mit`:

```
## <Hume.EHU.1750>
```

declares that the collection contains the text of `Hume.EHU.1750` (the edition at `data/works/hume/ehu/1750.mit`) here. The bracketed value is a full `Author.Work.Edition` document ID, resolved to its file case-insensitively (its `.mit` form, or its `<edition>/index.mit` directory form). A borrowed-child placeholder carries no text or metadata of its own — the loaded edition supplies both.

Inline and borrowed sections mix freely, in file order, so a collection can interleave its own front matter (an advertisement, say) with editions borrowed from sibling works. This is how collections like ETSS, FD, and HE share text with the standalone works they gather.

## Metadata schema

Keys are camelCase. Values use Markit's TOML-style `key = value` syntax only (colon-style `key: value` is invalid Markit). Keys not listed here are not allowed; propose additions in this document first.

### Author (root of `data/authors/<author>.mit`)

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

### Texts (document roots and sections in `data/works/`)

One schema applies to every text, all the way down: document roots and sections take the same keys. The keys split into two groups:

- **Identity keys** (`title`, `breadcrumb`, `canonical`, `standalone`) describe the text itself and are never inherited.
- **Cascading keys** (`authors`, `imported`, `published`, `copytext`, `sourceUrl`, `sourceDesc`) flow downward: a section without the key takes the nearest ancestor's value; setting it overrides the value for that text and its descendants. Don't set a cascading key on a section when the inherited value is already right.

Inheritance operates within a file. Each file is valid on its own terms: required keys must be present on the document root, and present _or inherited_ on every section.

| Key          | Type     | Required | Inherited | Notes                                                        |
| ------------ | -------- | -------- | --------- | ------------------------------------------------------------ |
| `title`      | string   | yes      | no        | full title; may contain Markit inline markup                 |
| `breadcrumb` | string   | yes      | no        | short title for navigation                                   |
| `authors`    | string[] | yes      | yes       | author slugs; a section overrides with whoever wrote it      |
| `canonical`  | string   | stub     | no        | **stub only**: slug of the work's default edition            |
| `standalone` | boolean  | no       | no        | **stub only**: whether the work lists in indexes on its own (default `true`); set `false` for a subwork shown only within the collection that borrows it |
| `imported`   | boolean  | yes\*    | yes       | whether the text itself is present, beyond its metadata      |
| `published`  | number[] | yes\*    | yes       | years this text's content was first published                |
| `copytext`   | string[] | no       | yes       | the edition(s) a curated text is constructed from            |
| `sourceUrl`  | string   | no       | yes       | online transcription/facsimile the text was derived from     |
| `sourceDesc` | string   | no       | yes       | prose note on the text's provenance and editorial choices    |

Notes:

- The **work stub** (`index.mit`) is the exception to the schema: it carries `title`, `breadcrumb`, `authors`, `canonical`, and optionally `published`, and nothing else (no text). `authors` is required (the work's authorship is identity), and `canonical` must name an edition that exists. The `yes\*` rows above (`imported`, `published`) are required on editions, not on stubs.
- A text is "imported" when its content is present in the corpus (directly or via its descendants) — i.e. when a site can usefully link to it rather than merely list it. A partially-transcribed work sets `imported = true` at the root and `imported = false` on the missing sections (or vice versa).
- `published` on a section records that the section entered the work in a particular year — e.g. an essay added to a later edition of the *Essays*.
- `copytext` belongs on curated reading texts (and sections that derive from different copytexts). A dated edition is its own copytext, so the key is meaningless — and disallowed — there.
- `standalone` governs index listing only. A work borrowed into a collection (its editions spliced in as borrowed children, e.g. the parts of *Essays and Treatises*) is also a directory of its own, so it lists independently by default. Set `standalone = false` on its stub to keep it out of the indexes while leaving it reachable through the collection(s) that borrow it. It does not affect search, retrieval, or the collection itself.

### Block metadata

| Key          | Type   | Notes                                                                     |
| ------------ | ------ | ------------------------------------------------------------------------- |
| `pages`      | string | page range in the copytext, e.g. `"253"`, `"253-5"`                       |
| `speaker`    | string | who speaks this block, in dialogues (e.g. `"Philo"` in the *Dialogues*)   |
| `subsection` | string | numbered subdivision this block opens, where sections have internal parts |
| `authors`    | string[] | author(s) of this block, where they differ from the section's authors   |

## Formatting

Every `.mit` file must compile without errors and be formatted exactly as the Markit formatter (`format()` from `@earlytexts/markit`) would emit it. The test pipeline checks both.

## Validation

```sh
deno task test    # compile + formatting + schema + layout checks over the whole corpus
deno task fix     # apply the Markit formatter to every file in place
deno task check   # typecheck + lint + fmt for the test code itself
```

The suite is honest rather than green: a file with editorial problems fails the compile check until it is actually fixed, rather than being papered over. Suites other than the first skip files that don't compile, so fixing a compile error may surface new schema or layout findings in that file.
