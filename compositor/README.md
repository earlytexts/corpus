# The Early Text Compositor

Everything you need to contribute to the
[Early Text Corpus](https://github.com/earlytexts/corpus) — a public library of
diplomatic digital editions of hand-press books, transcribed in
[Markit](https://github.com/earlytexts/markit).

Open the corpus in VS Code and this extension gives you a browser of authors,
works and editions, the corpus's own rules live in the Problems panel, a
register of early spellings you can curate as you read, and a way to send your
finished work to the Centre for review — **without ever meeting git**.

New here? [The walkthrough](./GUIDE.md) takes you from an empty computer to a
submitted correction.

## Features

### Corpus Browser

An activity-bar tree of authors → works → editions, labelled from the corpus's
own metadata (names, titles, years), with the canonical edition starred.
Clicking an edition opens it; double-clicking an author or a work opens its
metadata, which is also on the context menu.

Right-click an author for **Open in VIAF** or **Open in Wikidata**, or an
edition for **Open in ESTC** and **Open the TCP Text**. Each item appears only
where the corpus records that identifier, and the identifiers show in the node's
tooltip.

### Validation as you type

The corpus's full rule set — the same rules that run in CI — published to the
Problems panel, with a status-bar summary and a badge on the tree: every file
compiles, every file is canonically formatted, the metadata schema holds, the
layout holds, and every word is accounted for. Saving revalidates in about a
second. The tree and the problem list are there within a second of opening the
folder, before anything has been compiled.

### Corpus Search

A docked search-and-replace panel shaped like VS Code's native Search view, but
scoped to the texts: it filters by author rather than by file glob, covers only
catalogue editions, and matches only block content — never `[metadata]`
sections, title lines, or `{#…}` block tags. Results are grouped per edition
under catalogue labels ("Hume · Enquiry · 1748").

Replace per match, per edition, or across everything you have not dismissed;
every match is re-verified against the live document before it is touched.
Case, whole-word and regular-expression toggles work as they do in VS Code.
**Search the Corpus…** on a `.mit` editor's context menu seeds the panel with
the word under the cursor.

### Dictionary

A docked panel over the corpus's register of surface forms, in three tabs:

- **Lemmas** — each headword with the forms filed under it; add a form or a new
  lemma.
- **Variants** — archaic spellings and the modern spellings they stand for.
- **Curation** — every word in the corpus the register does not yet account for,
  **most frequent first**, so the backlog can be burned down highest-impact
  first. Each row is one click from being added as a modern word, a respelling,
  or a form with a lemma.

Entries are written in the corpus's own canonical shard format, so an entry
added here is byte-identical to one the corpus's own formatter would produce.

### Unaccounted words, marked in the text

Every word the register does not yet account for is squiggled where it occurs,
with quick fixes that curate it on the spot — add it as a modern word, as a
respelling of a modern one, or with a lemma. This is how a transcription error
announces itself: a word the corpus has never seen, in the middle of a page of
words it knows.

### Markup suggestions

Likely people, places, organisations, citations and foreign text are flagged as
hints, each with a quick fix that wraps it in the right markup. The suggestions
are mined from the markup the corpus already carries, so they get better as the
corpus does. Cycle them with `F8`, like any diagnostic, and ignore the ones that
are wrong.

### Word hover

Point at a word and see how the corpus accounts for it: the citation lemma it is
filed under, the form it takes within that lemma, and any other readings it
could have — each one click from being pinned in the text with `[w:…]`.

### Scaffolding and one-shot commands

- **New Author**, **New Work** (with its first edition) and **New Edition**
  prompt for the metadata the corpus requires and write canonical,
  already-formatted files.
- **Import TEI Text from TCP…** fetches a Text Creation Partnership
  transcription by its id and converts it into the open edition, which is
  usually a great deal faster than starting from a blank file.
- **Compare Editions…** opens a diff of two editions of the same work — or
  **Compare with Next Edition** straight from the tree.
- **Insert Borrowed Section Reference…** picks an edition from the catalogue and
  inserts the `## <Author.Work.Edition>` placeholder that composes collections.
- **Fix Formatting** applies the Markit formatter to every file in the corpus.

### Contribute

A docked panel that carries your work back to the Centre without naming a
branch, a commit, a push or a pull request. It shows one situation at a time —
your changes, your submission, what the editors decided — with the file list
labelled from the catalogue, a diff of what you changed, an undo per file, and a
description box whose text becomes the title the editors read.

Sending brings in the latest corpus first, asking you about any text that
changed on both sides, then opens the submission on GitHub. The review
conversation happens there; the panel links to it and tells you what was
decided.

It will also set the corpus up for you in the first place: sign in with GitHub
and **Set up the Corpus…** makes your own copy, downloads it, and opens it,
with no git installed and no token to paste.

## Commands

Open the command palette (`Cmd/Ctrl+Shift+P`) and type "Compositor":

| Command                                | Result                                            |
| -------------------------------------- | ------------------------------------------------- |
| Set up the Corpus…                     | Make your copy of the corpus and download it      |
| Send Your Work for Review…             | Open the Contribute panel                         |
| Search the Corpus…                     | Open the Search panel, seeded from the cursor     |
| Validate Corpus                        | Re-run every rule over the whole corpus           |
| Refresh Corpus                         | Reload the corpus from disk                       |
| Fix Formatting (Whole Corpus)          | Canonically format every file                     |
| New Author… / New Work… / New Edition… | Scaffold a new record, prompting for its metadata |
| Import TEI Text from TCP…              | Fetch and convert a TCP transcription             |
| Compare Editions…                      | Diff two editions of the same work                |
| Insert Borrowed Section Reference…     | Insert a `## <Author.Work.Edition>` placeholder   |
| Toggle Dictionary Accounting Hints…    | Turn the squiggles and the hover on or off        |

New Work, New Edition, Compare with Next Edition, the authority-record links and
the metadata stubs live on the Corpus Browser's context menus.

## Settings

| Setting                           | Default | What it does                                                                   |
| --------------------------------- | ------- | ------------------------------------------------------------------------------ |
| `compositor.corpusRoot`           | `""`    | Workspace-relative path to the corpus, when it is a subfolder of the workspace |
| `compositor.flagUnaccountedWords` | `true`  | Squiggle words the dictionary does not account for                             |
| `compositor.suggestMarkup`        | `true`  | Hint likely people, places, organisations, citations and foreign text          |
| `compositor.showTokenHover`       | `true`  | Show the lemma-and-forms tooltip on an accounted word                          |

## Requirements

VS Code 1.85 or later, and a GitHub account if you mean to send work back.
Nothing else: the corpus's logic is bundled with the extension, and so is git.

The [Markit language extension](https://marketplace.visualstudio.com/items?itemName=earlytexts.markit-language)
is installed automatically alongside this one — it provides the colouring, live
compile errors, formatting and preview for `.mit` files, and the Compositor adds
the corpus layer on top.

The extension activates when VS Code is opened in a copy of the corpus (it looks
for `data/authors`). If the corpus is a subfolder of your workspace, point
`compositor.corpusRoot` at it.

## Documentation

- **[Using the Compositor](./GUIDE.md)** — the walkthrough, from installing
  VS Code to your first accepted submission
- [Writing Markit](https://github.com/earlytexts/markit/blob/main/GUIDE.md) —
  the markup language, for transcribers
- [Contributing](https://github.com/earlytexts/corpus/blob/main/CONTRIBUTING.md)
  — what belongs in the corpus, and how review goes
- [Editorial policy](https://github.com/earlytexts/corpus/blob/main/EDITORIAL.md)
  and [markup policy](https://github.com/earlytexts/corpus/blob/main/MARKUP.md)
  — what to preserve, and what to mark
- [The dictionary](https://github.com/earlytexts/corpus/blob/main/DICTIONARY.md)
  — the register and the rules that govern it
- [Architecture](./ARCHITECTURE.md) — for anyone changing the extension

## Licence

MIT — see [the licence](./LICENSE.md).
