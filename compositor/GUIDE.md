# Using the Compositor

A walkthrough for contributors, from an empty computer to a submitted
correction. It assumes you are a reader of early books rather than a programmer:
you will not be asked to use a terminal, and you will never meet git.

Work through §1–§4 once — twenty minutes, most of it downloading — and you have
a working copy of the whole corpus. After that, use the section for whatever you
are doing.

Three companion documents:

- [Writing Markit](https://github.com/earlytexts/markit/blob/main/GUIDE.md)
  teaches the markup language itself. This guide is about the tool; that one is
  about what you type into it.
- [Contributing](../CONTRIBUTING.md) is what belongs in the corpus, what makes a
  good submission, and how review goes. Read it before you take on anything
  larger than a correction.
- [Editorial policy](../EDITORIAL.md) and [markup policy](../MARKUP.md) are the
  scholarly decisions — what to preserve, what to regularise, what to mark up.

---

## Contents

1. [What you need](#1-what-you-need)
2. [Installing the tools](#2-installing-the-tools)
3. [Getting your own copy of the corpus](#3-getting-your-own-copy-of-the-corpus)
4. [The corpus on your screen](#4-the-corpus-on-your-screen)
5. [Choosing something to do](#5-choosing-something-to-do)
6. [Correcting a text](#6-correcting-a-text)
7. [The marks in the margin](#7-the-marks-in-the-margin)
8. [Curating the dictionary](#8-curating-the-dictionary)
9. [Searching the whole corpus](#9-searching-the-whole-corpus)
10. [Comparing two editions](#10-comparing-two-editions)
11. [Filling a stub: a text nobody has transcribed](#11-filling-a-stub-a-text-nobody-has-transcribed)
12. [Adding a work, an edition, or an author](#12-adding-a-work-an-edition-or-an-author)
13. [Getting to a clean file](#13-getting-to-a-clean-file)
14. [Sending your work for review](#14-sending-your-work-for-review)
15. [What happens next](#15-what-happens-next)
16. [When something goes wrong](#16-when-something-goes-wrong)
17. [Where next](#17-where-next)

---

## 1. What you need

Three things, all free:

1. **A computer** running macOS, Windows or Linux. Nothing is asked of it beyond
   a few gigabytes of disk for the texts.
2. **A GitHub account** — [github.com](https://github.com/) — which is how the
   Centre knows who you are and how your work travels back. Signing up takes a
   minute and costs nothing. You do not need to learn anything about GitHub
   beyond having the account.
3. **A copy of the book you are working from**: a facsimile, a scan, or the
   thing itself. The corpus is a corpus of _diplomatic_ transcriptions, so the
   printed page is the authority for every decision.

You do **not** need git, a terminal, or any knowledge of programming.

---

## 2. Installing the tools

**Install Visual Studio Code.** Download it from
[code.visualstudio.com](https://code.visualstudio.com/) and open it. It is a
free text editor from Microsoft; you can think of it as a word processor that
does not reformat anything behind your back.

**Install the Compositor.** In VS Code, click the Extensions icon in the bar
down the left-hand side (four squares), search for **Early Text Compositor**,
and press Install.

The [Markit language extension](https://marketplace.visualstudio.com/items?itemName=earlytexts.markit-language)
is installed automatically alongside it. That is the one that colours your text,
underlines mistakes as you type, tidies your formatting, and gives you the
preview. The Compositor adds everything that has to do with the corpus as a
whole.

You will now see a new icon in the left-hand bar — the Centre's mark. That is
the Compositor.

---

## 3. Getting your own copy of the corpus

Click the Compositor icon. Because there is no corpus open yet, the panel says
so and offers a button: **Set up the corpus**.

Press it, and four things happen, none of which need anything from you but a
folder and a sign-in:

1. **Choose where to keep it.** Pick or make a folder — `Documents/corpus` is a
   perfectly good answer.
2. **Sign in to GitHub.** VS Code opens the sign-in for you. Approve it and come
   back.
3. **Your own copy is made.** The corpus is copied into your GitHub account.
   This copy is yours: you can change anything in it without affecting anybody
   else, and nothing you do is public until you choose to send it.
4. **It is downloaded.** A progress bar counts through a few thousand files.
   This is the slow step — a few minutes on a normal connection.

When it finishes you are asked whether to open the corpus now. Say yes.

> **If you already have the corpus** — because somebody set it up for you, or
> because you use git yourself — just open that folder in VS Code
> (`File → Open Folder`). The Compositor recognises a corpus by the
> `data/authors` folder inside it and starts up on its own.

---

## 4. The corpus on your screen

Click the Compositor icon again. Four panels stack down the sidebar.

### Browse

The corpus itself: letters of the alphabet, then authors, then works, then
editions.

- An **author** shows as `Surname, Forename` with their dates. Double-click to
  open their metadata; right-click for **Open in VIAF** or **Open in Wikidata**,
  where the corpus records those identifiers.
- A **work** shows its short title and the year it first appeared. Double-click
  for its metadata — the record of the work itself, as distinct from any one
  printing of it.
- An **edition** shows its year. A **star** marks the canonical edition: the one
  the reading sites show by default. Click an edition to open it. Right-click
  for **Open in ESTC** (the English Short Title Catalogue's record of that
  printing) or **Open the TCP Text** where one exists.

A collection — an _Essays and Treatises_, say — expands to the texts it borrows,
each of which lives in its own file elsewhere in the corpus. Editing one changes
it everywhere it is borrowed, which is the point of the arrangement.

Above the tree are three buttons: refresh, **New Author…**, and **Validate
Corpus**.

### Search, Dictionary, Contribute

The other three panels are §9, §8 and §14 respectively. Open them by clicking
their headings.

### The Problems panel and the status bar

At the bottom right of the window you will see either `✓ Corpus` or
`✗ Corpus: 12`. That is every rule the corpus keeps, over every file — not just
the one you have open. Click it, or press `Cmd/Ctrl+Shift+M`, to see the list.

The corpus's rules are the same ones that run when a submission arrives at the
Centre, so a clean status bar here means a submission that will not bounce.
There are five of them: every file compiles, every file is canonically
formatted, the metadata is complete and correct, the file layout matches the
work's structure, and every word in every text is accounted for by the register
(§8).

The tree and the problem list appear within a second of opening the folder. If
files have changed since you last had it open, they are quietly brought up to
date in the background.

---

## 5. Choosing something to do

In rough order of size — and every one of them is a real contribution:

| If you have…                       | Do this                                       |
| ---------------------------------- | --------------------------------------------- |
| Ten minutes and sharp eyes         | Correct a misreading in a text you know (§6)  |
| An hour and no particular book     | Burn down the dictionary backlog (§8)         |
| A text you know well               | Mark up its people, places and citations (§7) |
| A book and some months             | Fill a stub — transcribe a text (§11)         |
| A book the corpus has never listed | Add the work, then transcribe it (§12)        |

[The contributing guide](../CONTRIBUTING.md) says which texts belong in the corpus and
which do not — read §1 and §2 of it before starting anything large, and say what
you are taking on before you take it on, so that two people do not transcribe
the same book.

A **stub** is a text the Centre has already decided belongs in the corpus, but
which nobody has transcribed: it has a full metadata record and no content. Open
an edition and find nothing under the `[metadata]` block, and you have found
one. They are the best place to start on real work, because the decision that it
belongs has already been made.

---

## 6. Correcting a text

The commonest and most useful contribution.

1. **Find the text.** Either walk the Browse tree, or use Search (§9) if you
   know a phrase from the passage.
2. **Fix what is wrong.** A `.mit` file is plain text with markers in it; type
   into it as you would into any document. If a marker is unfamiliar, look it up
   in the [element index](https://github.com/earlytexts/markit/blob/main/SPECIFICATION.md#5-element-index).
3. **Watch the underlines.** The Markit extension compiles the file as you type
   and underlines anything malformed; the Compositor adds the corpus's own rules
   and its three overlays (§7).
4. **Preview it.** `Cmd/Ctrl+Shift+V` opens a rendered view of the text beside
   your source, and follows you as you type. It is the fastest way to check a
   title page or a stretch of Greek.
5. **Tidy it.** `Alt+Shift+F` formats the file: blank lines normalised, tables
   aligned, and every `{e/}` you typed turned into a real `é`.
6. **Save.** The corpus revalidates in about a second, and the status bar tells
   you where you stand.

Two things worth knowing before you change anything:

- **Do not renumber blocks.** The `{#12}` tags are how the corpus cites itself,
  and how the reading sites link to a passage. Renumbering the blocks of a
  published edition breaks every citation anybody has made of it. If the
  numbering is genuinely wrong, say so in your submission and let the editors
  decide ([editorial policy §9](../EDITORIAL.md#9-blocks-are-citations)).
- **Declare doubt rather than resolving it.** `[?reading?]` marks a reading you
  are unsure of, and `[...]` a gap you cannot read at all. Both are
  contributions. A confident guess is not
  ([editorial policy §15](../EDITORIAL.md#15-when-you-are-unsure)).

---

## 7. The marks in the margin

Three overlays run over any edition you have open. All three are on by default,
and all three can be turned off — **Toggle Dictionary Accounting Hints…** in the
command palette, or in Settings.

### Words the corpus has never seen

A word squiggled with the message _"…" is not in the dictionary_ is a word the
corpus's register does not account for. That means one of two things, and only
you can tell which:

- **A transcription error.** `modeft` for `modest`, `tbe` for `the`, an `f` read
  for a long ſ. Fix the text.
- **A spelling the register has not caught up with yet.** `vertue`, `compleat`,
  `shew'd`. Add it to the dictionary — hover the word and take the quick fix
  (§8).

This is the single most valuable thing the tool does. A transcription error
looks exactly like an unknown word, and there are only about a thousand unknown
words left in six and a half million.

### Suggestions for markup

Faint hints under likely people, places, organisations, citations and foreign
phrases, each with a quick fix that wraps it in the right marker — `[p:…]` for a
person, `$la:…$` for a Latin phrase, and so on. Press `F8` to walk from one to
the next; `Cmd/Ctrl+.` opens the fixes.

The suggestions are mined from markup the corpus already carries, so they are
suggestions and not instructions: they miss things, and they will occasionally
offer to mark a place as a person. What _ought_ to be marked, and how, is
[the markup policy](../MARKUP.md) — particularly the awkward cases, like whether "the
Duke of York" is a person or a place.

### The word hover

Point at any accounted word and a tooltip tells you how the corpus files it: the
lemma it belongs to, the form it takes within that lemma, and — where the
spelling is ambiguous — the other readings it could have, each one click from
being pinned into the text as `[w:humane=human]`.

Use it when a word could be read two ways and the sentence settles it. That is
exactly the case `[w:]` exists for
([markup policy §12](../MARKUP.md#12-word-disambiguation)).

---

## 8. Curating the dictionary

The corpus keeps a **register**: every spelling that appears in its texts, and
what each one stands for. It is what makes searching for "virtue" find `vertue`,
and it is what lets the tool tell you that `modeft` is probably a mistake.

The register accounts for about 99% of the words in the corpus. The remaining 1%
is a long tail, and working through it is self-contained scholarly work that
needs no particular book.

### From the text

Squiggled word, `Cmd/Ctrl+.`, and choose:

| Quick fix                  | Use it when                                                             |
| -------------------------- | ----------------------------------------------------------------------- |
| **Add … (modern word)**    | The spelling is our spelling. `chariot`, `Sarmatian`                    |
| **Add … as a respelling…** | It is an old spelling of a word we spell differently. `vertue` → virtue |
| **Add … with a lemma…**    | It is a form of another word. `vertues` files under `virtue`            |

If the word you point at as a respelling has no entry of its own, you are asked
about that one too, and so on until everything resolves — the register is never
left with a dangling reference.

### From the Dictionary panel

Three tabs:

- **Lemmas** — every headword and the forms filed under it. Add a form to a
  lemma, or a new lemma outright.
- **Variants** — the archaic spellings and the modern spellings they stand for.
- **Curation** — the backlog: every unaccounted word in the whole corpus, **most
  frequent first**, with the same three actions on each row.

The Curation tab is the one to open if you want to be useful without choosing a
book. The word at the top is the word costing the corpus the most, and each edit
re-ranks the list immediately.

Before you make many entries, read [the dictionary](../DICTIONARY.md): what the
register is for, what counts as a word, and — the part that catches everybody —
when an archaic form should be lemmatised rather than respelled.

Entries are written straight into the corpus's dictionary files in exactly the
form the corpus itself would write them, so a dictionary edit is an ordinary
change you send with everything else (§14).

---

## 9. Searching the whole corpus

Open the **Search** panel, or right-click a word in a text and choose **Search
the Corpus…** to start from it.

It looks like VS Code's own search, and behaves like it — case, whole word,
regular expression — with three differences that matter:

- **It searches the texts only.** Never metadata, title lines or block tags, so
  a search for `title` finds the word in the prose and not the thousand places
  it appears as a key.
- **It is scoped by author, not by folder.** Open the filter row and type author
  slugs (`hume, smith`) to include, or prefix with `!` to exclude.
- **Results are grouped by text**, under labels you recognise ("Hume · Enquiry ·
  1748").

Replace works per match, per edition, or across everything you have not
dismissed. Every match is re-checked against the file before it is touched, so a
replace cannot land in the wrong place because something moved under it.

Corpus-wide replace is powerful and blunt. Use it for a spelling you are certain
of, look through the results before pressing the third button, and be aware that
a submission touching two hundred files is a submission that takes a long time
to review.

---

## 10. Comparing two editions

Right-click a work or an edition in the tree and choose **Compare Editions…**,
or **Compare with Next Edition** to go straight to the following printing. Two
editions open side by side, with the differences marked.

This is how you see what an author actually changed between printings, and it is
also the fastest way to check a transcription: a passage that differs from the
next edition in a way no author would have bothered to change is usually a
misreading in one of the two.

---

## 11. Filling a stub: a text nobody has transcribed

The largest and most valuable contribution. Before you start, read
[contributing guide §2](../CONTRIBUTING.md#2-choosing-a-text) and say what you are
taking on.

### Start from an existing transcription if there is one

The Text Creation Partnership has transcribed a great deal of this material, and
starting from its text is much faster than typing a book from nothing. Where the
corpus records a TCP identifier, the edition's context menu offers **Open the
TCP Text**.

With the stub open, run **Import TEI Text from TCP…** from the editor's
right-click menu and give it the identifier. The text is fetched, converted into
Markit, and appended below the file's metadata.

What arrives is a starting point and not a transcription. It will carry
structure the corpus does not use, and the conversion is mechanical: every
squiggle you now see is real work. And an imported text has still never been
checked against the page —
[editorial policy §14](../EDITORIAL.md#14-working-from-an-existing-transcription) is
about exactly this, and it is not optional.

### Or transcribe from the page

Open the stub and type. The
[Markit guide](https://github.com/earlytexts/markit/blob/main/GUIDE.md) teaches
the language in the order you meet it; the
[editorial policy](../EDITORIAL.md) tells you what to preserve — and the short
answer is nearly everything: the spelling, the capitalisation, the punctuation,
the ligatures, the long ſ as a plain `s`, the italics.

### Finish the record

A transcribed text needs its metadata completed. In the file's `[metadata]`
block:

- `imported = false` becomes `imported = true` — the corpus now holds the text
  and not merely the record of it.
- `sourceUrl` points at the facsimile or scan you worked from.
- `sourceDesc` says in prose what the copytext is, why you chose it, and what
  you did to it. This is the scholarly heart of the record; see
  [editorial policy §13](../EDITORIAL.md#13-choosing-and-recording-a-copytext).
- `estc` is the English Short Title Catalogue number of the printing your file
  _is_, which is not always the printing your scan came from.

Every key the corpus expects, with its rules, is in
[data model §6](../DATA_MODEL.md#6-metadata-schema). You do not have to learn
it: leave a key out and the Problems panel will tell you which one, in the file
where it belongs.

---

## 12. Adding a work, an edition, or an author

When the corpus has no record of the thing at all, three commands write the
files for you, prompting for what the schema needs and producing canonical,
already-formatted records.

- **New Edition…** — right-click a work. It asks for the year slug (`1748`,
  `1742a`, `1739-40`), the title as printed, and the publication year, and asks
  whether this edition should become the canonical one.
- **New Work…** — right-click an author. It asks for the work's short directory
  name (`ehu`), its document ID, its full and short titles, and then makes its
  first edition in the same breath.
- **New Author…** — the button above the tree. Forename, surname, dates,
  nationality. Whether an author belongs in the corpus is an editorial decision
  rather than a transcription decision, so
  [raise it as an issue first](../CONTRIBUTING.md#2-choosing-a-text).

Two conventions the prompts will not explain:

- **A slug is a short lower-case name** with no spaces — `hume`, `ehu`,
  `1739-40` — and it becomes the file or folder name. Keep it short; it is what
  citations are built from.
- **Not every printing deserves an edition.** The corpus wants the first
  edition, every edition the author revised, and the last one published in their
  lifetime. Other printings are worth an `imported = false` stub, so the record
  stays complete, and no more
  ([contributing guide §1](../CONTRIBUTING.md#1-what-belongs-in-the-corpus)).

To compose a collection out of texts that live elsewhere in the corpus, put the
cursor where the borrowed text belongs and use **Insert Borrowed Section
Reference…** from the editor's right-click menu.

---

## 13. Getting to a clean file

Before you send anything:

1. **Run Fix Formatting.** From the command palette: **Compositor: Fix
   Formatting (Whole Corpus)**. It applies the Markit formatter to every file,
   which is what the corpus's own rules require. It never changes a word of your
   text.
2. **Look at the Problems panel.** `Cmd/Ctrl+Shift+M`. Work down the list. Most
   entries name the file and the line and say plainly what is wrong.
3. **Aim for `✓ Corpus`**, but do not be paralysed by it. Unaccounted words are
   warnings, not errors, and a submission that leaves a few of them for the
   editors is perfectly normal. Schema and layout violations are not: fix those.

If a rule is telling you something you think is wrong, that is worth saying in
your submission. The rules encode editorial policy, and policy is revisable.

---

## 14. Sending your work for review

Open the **Contribute** panel. It shows you one situation at a time, and it
never mentions a branch, a commit, a push or a pull request.

**Your changes.** Every file you have touched, labelled by text ("Hume · Enquiry
· 1748"). Two buttons on each: **⇄** shows what you changed, and **↺** undoes
it. Check the diffs — this is the last time you see your work before someone
else does.

**Say what you did.** A description box, and an optional notes box. The
description becomes the title the editors read, so make it specific:

> Corrected 14 misreadings in Book 1, checked against the Gale facsimile; left
> three Greek passages marked uncertain because the scan is illegible.

tells a reviewer everything. "Fixes" tells them nothing. The notes box is where
to record which printing you checked against and anything you were unsure of.

**Send for review.** The panel then:

1. brings in the latest corpus, in case anything changed while you were working;
2. asks you about any text that changed on both sides (see below);
3. sends your work to the Centre and opens the submission in your browser.

### If a text changed on both sides

If somebody else edited a text you also edited, you are asked, file by file,
whether to keep your version or take the corpus's — with a diff of the two if
you want to see it. Nothing is lost either way, and the choice is recorded.

You are asked at the moment of sending, rather than weeks later during review,
deliberately: a clash is much easier to judge while you still remember doing the
work.

### One submission at a time

Once you have sent something, further changes are added to that same submission
until the editors decide on it. That is a deliberate constraint: several
submissions in flight at once would mean files changing on disk underneath you
while you work.

---

## 15. What happens next

**The conversation happens on GitHub.** The panel links to your submission;
click through to read the editors' comments and answer them.

**Expect questions rather than a verdict.** Most submissions of any size get
comments, and most comments are questions about a reading. Answer in the thread.
If you need to change something, change it in the editor and press **Add to your
submission** — it joins the same submission.

**Press "Check for a Reply from the Editors"** (the refresh button on the panel)
to see whether anything has been decided. When it has, the panel says so:
_accepted into the corpus_, or closed without being accepted.

**Then start something new.** After a decision, **Start something new** clears
the decks and puts you back where you began, with the latest corpus in hand.

Your name stays on the work permanently — the record of who transcribed what is
part of what the corpus is.

[Contributing guide §6–§7](../CONTRIBUTING.md#6-what-the-editors-check) is what
reviewers actually check, and it is public precisely so that you can read it
before you send.

---

## 16. When something goes wrong

**"No corpus found."** The window is not open on a corpus. Either
`File → Open Folder` on the folder you downloaded in §3, or — if the corpus is a
subfolder of the project you have open — set `compositor.corpusRoot` in Settings
to the path of the folder containing `data/`.

**The tree is empty, or out of date.** Press the refresh button above it.

**"Set up the corpus" fails saying you already have a repository called
`corpus`.** You have a repository of that name on GitHub that is not a copy of
the Centre's. Rename it on GitHub and try again.

**A send stopped part-way.** If the connection dropped between sending and
opening the submission, the panel says so and offers to finish. Nothing has been
lost; press it.

**Everything is squiggled.** You have probably left a marker unclosed — an `_`
or a `*` with no partner swallows the rest of the paragraph. Look at where the
italics start in the preview.

**The corpus takes twenty seconds to load.** That is the full-compile path,
which happens when the corpus's prebuilt index is missing or stale — after a
large update, for instance. It should happen once and not again.

---

## 17. Where next

- [Writing Markit](https://github.com/earlytexts/markit/blob/main/GUIDE.md) —
  the language, taught in the order you meet it
- [The element index](https://github.com/earlytexts/markit/blob/main/SPECIFICATION.md#5-element-index)
  — one page of every marker, to keep open while you work
- [The contributing guide](../CONTRIBUTING.md) — scope, choosing a text, how review goes
- [The editorial policy](../EDITORIAL.md) — what to preserve and what to regularise
- [The markup policy](../MARKUP.md) — what to mark up, and how to decide
- [The dictionary](../DICTIONARY.md) — the register and its rules
- [The data model](../DATA_MODEL.md) — the file layout and the metadata schema
- [The editors' guide](../EDITORS.md) — the review checklist, if you would like to know
  exactly what happens to your submission
- [The Compositor README](./README.md) — every command and setting in one list
