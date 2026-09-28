# Editorial Policy

What a corpus text is, and how to make one. This is the craft document: it says
what to preserve from the printed page, what to regularise, and what to do when
the page and the text come apart.

It is the policy of record. Where it says "must", the editors will hold a
submission to it; where it says "prefer", it is stating the house habit and your
judgement can depart from it if you say why.

Three companion documents divide the same ground:

- Markit's [specification](https://github.com/earlytexts/markit/blob/main/SPECIFICATION.md)
  and [guide](https://github.com/earlytexts/markit/blob/main/GUIDE.md) teach the
  _syntax_ — what a marker is and how to type it. This document says which of
  the things you _can_ mark you _should_.
- [The markup policy](./MARKUP.md) takes the semantic markers — people, places,
  citations, foreign text — one at a time, and settles the edge cases.
- [The dictionary](./DICTIONARY.md) owns the register of spellings. Nothing in
  this document ever asks you to change a spelling; that is the dictionary's
  job, done once for the whole corpus.

## Contents

1. [What a corpus text is](#1-what-a-corpus-text-is)
2. [The governing principle](#2-the-governing-principle)
3. [What to preserve](#3-what-to-preserve)
4. [What to regularise](#4-what-to-regularise)
5. [Ligatures](#5-ligatures)
6. [Damage, illegibility and gaps](#6-damage-illegibility-and-gaps)
7. [Editorial intervention](#7-editorial-intervention)
8. [The shape of a text](#8-the-shape-of-a-text)
9. [Blocks are citations](#9-blocks-are-citations)
10. [Pages](#10-pages)
11. [Title pages and front matter](#11-title-pages-and-front-matter)
12. [Verse, drama and tables](#12-verse-drama-and-tables)
13. [Choosing and recording a copytext](#13-choosing-and-recording-a-copytext)
14. [Working from an existing transcription](#14-working-from-an-existing-transcription)
15. [When you are unsure](#15-when-you-are-unsure)

## 1. What a corpus text is

Every text in the corpus is a **diplomatic transcription of one printed
edition**. Three words there, each doing work:

- **Diplomatic** — it reproduces what the printer set, not what a modern reader
  would prefer to read. It is not a modernised reading text, and it is not a
  critical edition that synthesises several witnesses into one ideal text.
- **Transcription** — it is text, not an image and not a facsimile. Everything
  that survives the move from page to plain characters survives; everything that
  does not (type size, leading, the shape of an ornament) is either recorded
  structurally or let go.
- **One printed edition** — an edition file is a transcription of a particular
  printing, identified by year, and answerable to a particular copy of it. Where
  a work went through several lifetime editions, each is transcribed separately
  and the corpus holds them side by side. Comparing them is the point (see
  [the data model](./DATA_MODEL.md)).

The corpus's concern is the texts and the history of ideas, not the history of
the book. Bibliographic description belongs to the ESTC and we link to it rather
than reproducing it. What we add is the words, accurately, in a form a machine
can read.

## 2. The governing principle

One rule decides most questions:

> **Preserve the text; regularise the page.**

Everything a reader in 1748 would have taken as part of the _text_ — spelling,
capitalisation, punctuation, italic and small capital, word division within a
line — is transcribed as printed. Everything that belongs to the _page_ rather
than the text — where the lines fell, the long s, catchwords, signatures,
running heads — is regularised away or recorded structurally instead.

The line is drawn there for three reasons, and it is worth understanding them,
because they decide the cases this document does not anticipate.

**Because the diff is the point.** The corpus exists in large part so that the
1748 and the 1777 _Enquiry_ can be set against each other and the difference
read off. Silently regularising spelling or punctuation would erase exactly what
that comparison is for. A normalisation applied to the text is a fact destroyed;
a normalisation applied downstream is a fact preserved _and_ a convenience
gained.

**Because modernisation is recoverable and the printed form is not.** The
dictionary maps "vertue" onto "virtue" for every reader and every search, once,
for the whole corpus. Nothing can map "virtue" back onto the page that printed
"vertue". So the destructive operation is the one we refuse, and the
constructive one we do in software.

**Because page facts are better recorded than imitated.** A page break is a fact
about the copy: recorded as `//34//` it is queryable, and it does not interfere
with reading the paragraph as a paragraph. Preserving the printed line breaks
would give us neither.

## 3. What to preserve

### Spelling

Exactly as printed. _Vertue_, _encrease_, _Falshood_, _atchiev'd_, _thro'_,
_compleat_, _shew_, _soveraign_, _publick_. Do not modernise, do not correct,
and do not make a text internally consistent that was not — hand-press printing
varies spelling within a page, and that variation is data.

The modern spelling of every one of those is recorded in the dictionary, so
nothing is lost to a reader or a search by leaving them alone. If a surface is
not yet in the register, the Compositor will squiggle it; the fix is a
dictionary entry, never an edit to the text.

Apostrophes in elided forms (_call'd_, _'tis_, _lov'd_) are part of the
spelling. Keep them where the printer has them, and do not add them where he has
not (_Mans_, _Mens_ are printed genitives without apostrophes; they stay that
way).

### Capitalisation

Exactly as printed, including the eighteenth century's initial capitals on
common nouns ("MORAL Philosophy, or the Science of human Nature"). This is a
feature of the printing worth keeping, and it is a strong signal that a text has
been silently modernised when it is missing.

Two conventions for display capitals:

- A **word set entirely in capitals** is transcribed in capitals. The opening
  word or phrase of a chapter is usually set this way and is transcribed that
  way: `MORAL Philosophy…`, `'TIS certain, that…`.
- A **drop capital** (a large initial dropped into the first lines) is
  transcribed as an ordinary capital letter. Its size is a page fact, and one we
  do not record.

### Punctuation

As printed, including the heavy pointing of the period — the colons and
semicolons where a modern editor would put a full stop, the comma before a
parenthesis, the full stop after a roman numeral. Do not repunctuate for sense.

Printed quotation marks are the exception, and are markup rather than
characters: an opening and closing pair becomes `"…"` (see
[§4](#4-what-to-regularise)).

### Emphasis and small capitals

Two markers cover almost all early printing:

| Printed             | Markit    |
| ------------------- | --------- |
| italic              | `_text_`  |
| small capitals      | `*text*`  |

There is no bold in hand-press printing; if you find yourself wanting it, look
again. Full capitals are transcribed as capital letters, not as small-capital
markup — `*` is for type that is genuinely smaller than the surrounding capitals.

Where a whole passage is italic with roman words inside it, mark it as printed
rather than inverting it: `_a _b_ c_` is an italic phrase with a roman `b` in
the middle, which is exactly how the compositor set it.

### Word division

Compound words are transcribed as printed: `self-love` hyphenated if the printer
hyphenated it, `selflove` if he did not, `self love` as two words if he set it
that way. The dictionary treats a hyphen as a word boundary, so both halves are
ordinary words either way — you are not making trouble for the register by being
faithful here.

An end-of-line hyphen is a page fact, not a word division; see
[§4](#4-what-to-regularise).

### Notes

Footnotes, endnotes, marginal notes and shoulder notes are all part of the text
and are all transcribed. Their handling differs:

- **Footnotes and endnotes** become a reference (`<n1>`) at the point the mark
  appears, and a `{#n1}` block at the end of the text. Number them `n1`, `n2`, …
  in the order they appear, whatever the printed mark (`*`, `†`, `(a)`); the
  identifier is a cross-reference, not a transcription.
- **Marginal and shoulder notes** are inline asides, `#_Counsell what._#`,
  placed at the point in the text they sit beside. They are held apart from the
  reading text, so a plain-prose rendering drops them.

### Diacritics and non-Latin script

As printed. Accents that the printer set are kept; accents he omitted are not
supplied. This matters most in Greek, which the hand-press era often set
unaccented — transcribe the unaccented form, do not accent it for him.

## 4. What to regularise

Everything in this list is regularised **always and silently**. None of it is an
editorial intervention, because none of it is a departure from the text.

| Page fact                       | What we do                                                         |
| ------------------------------- | ------------------------------------------------------------------ |
| Long s (ſ)                      | Transcribe as `s`. It is a letterform, not a letter.                |
| End-of-line hyphenation         | Join the word; drop the hyphen.                                     |
| Line breaks within a paragraph  | Drop. A block is a paragraph, not a set of lines.                   |
| Multiple spaces, blank lines    | Collapse. The formatter does this for you.                          |
| Catchwords                      | Omit.                                                               |
| Signatures and press figures    | Omit.                                                               |
| Running heads                   | Omit.                                                               |
| Rules, ornaments, factotums     | Omit.                                                               |
| Printed quotation marks         | Transcribe as `"…"` quotation markup.                               |
| Turned letters and foul case    | Transcribe the letter the printer meant.                            |
| Roman numerals                  | Leave as roman. Do not convert.                                     |

Three of these deserve a word.

**Quotation marks.** Early printing marks quotation in several ways — paired
inverted commas, a comma repeated down the left margin of every quoted line,
guillemets. All of them become `"…"`, which records _that_ the passage is
quoted and renders with marks. Do not transcribe a margin of repeated commas
literally; do not hunt for typographic quote characters.

**Turned letters and foul case.** A `u` set for an `n`, an `l` for a `1`, a
broken sort that prints as something else — these are mechanical accidents of
one impression, not readings. Transcribe what the printer meant. This is _not_
an emendation and takes no `[+…+]` markup: there is no textual variant here to
preserve.

**End-of-line hyphenation combined with a page turn.** When a word breaks across
two pages, join the word and put the page break inside it, with no spaces:
`be///ginning`. Markit calls this a _tight_ break, joins the word for reading
and for search, and still knows the page turned mid-word.

## 5. Ligatures

The æ and œ ligatures are **letters**, not letterforms, and are transcribed:
`œconomy`, `phænomena`, `dæmon`, `prætor`, `Cæsar`. Type them as `{oe}` and
`{ae}` and let the formatter cash the braces in.

The policy in one line: **trust the letters, only fuse them.**

- Restore a ligature only where the printed form has the two letters that make
  it. `Chaerilus` becomes `Chærilus` (æ from a-e), never `Chœrilus` — that would
  be cross-normalising to a different classical spelling, which is emendation
  wearing a typographic disguise.
- Where the printer set two separate vowels, leave two separate vowels. The
  hiatus words are the trap: _poet_, _poem_, _aerial_, _aer_, _proem_,
  _Laertius_, _Boethius_, _does_, and the `-soever` family are not ligatures and
  never were. Nor are Hebrew, Dutch, Welsh and French names — _Israel_,
  _Michael_, _Maestricht_, _Caen_, _Ploermel_.
- An author's own idiosyncrasy stands. Hobbes prints _hœresie_, _dœmons_,
  _prœtors_ with œ where the classical spelling wants æ; those are kept as
  printed, and the dictionary reconciles them.

If a source transcription has flattened the ligatures to `ae`/`oe` digraphs —
which most do — restoring them is a transcription fix, not an emendation, and
needs no markup.

## 6. Damage, illegibility and gaps

Three states, three markers.

**You can read it, but not with confidence.** Mark the reading uncertain and
give your best reading inside:

```markit
the [?revenous?] Animals of the Desert
```

**You cannot read it at all.** Mark the gap:

```markit
and sink thyself [...] those Animals
```

**It is not there.** A leaf is missing, a passage is cropped, the copy is
imperfect. Mark it as illegible and say what is missing in `sourceDesc`. The
corpus has no separate marker for a lacuna in the copy, and inventing one for a
handful of cases would cost more than it is worth.

Two rules over all three:

- **Never guess into a gap.** A conjecture is an editorial insertion
  ([§7](#7-editorial-intervention)), not a transcription, and it is marked as
  one.
- **A gap you can fill from another witness should be filled.** If a sibling
  edition of the same work prints the passage plainly, take the reading from
  there, and note in `sourceDesc` that you did. This is the single most common
  repair on imported texts, where the source transcription simply skipped what
  it could not handle — most often Greek.

## 7. Editorial intervention

An **editorial intervention** is a place where the corpus text departs from the
copytext deliberately. It is always marked, never silent, and it always keeps
both readings:

```markit
AS when there are [-more Minds than one,-][+other Minds, besides the chief one;+]
```

The deletion is what the copytext prints; the insertion is what we print
instead. Nothing is thrown away — the compiler can produce the _original_
reading (deletions kept, insertions dropped) or the _edited_ reading (the
reverse) from the same file, so a reader gets the corrected text and a scholar
collating editions gets the copytext.

**When to intervene.** Three cases, and essentially only three:

1. **The author corrected it.** An errata list, an appendix of changes, a
   revised passage the author directed to be substituted. Hume's _Treatise_ is
   the model: the Appendix published with Book 3 in 1740 makes changes to Book 1,
   and those changes appear in the 1739–40 file as insertion/deletion pairs.
2. **A surviving manuscript or another authorial witness gives a better
   reading.** The 1779 _Dialogues_ is the model: printed posthumously, with
   Hume's own manuscript surviving and consulted.
3. **The compositor made an error the sense will not bear**, and the correct
   reading is not in doubt (`[-desection-][+dissection+]`).

Record the ground of the intervention in the edition's `sourceDesc`, once, in
prose. It does not go on the individual intervention.

**When not to intervene.** Do not use insertion and deletion for:

- spelling variants, however archaic — that is the dictionary's business;
- capitalisation or punctuation you would set differently;
- long s, ligatures, or anything else in
  [§4](#4-what-to-regularise)/[§5](#5-ligatures) — those are regularisations,
  not emendations, and take no markup;
- turned letters and foul case — transcribe what was meant;
- a reading you merely prefer. Preferring is what a critical edition does, and
  this is not one.

**Correcting the transcription is not an intervention.** If the file departs
from the printed page — a typo introduced by whoever typed it, a flattened
ligature, a dropped word, a paragraph broken in the wrong place — fix it
outright. You are moving the file _towards_ the copytext, which is where it was
always supposed to be. Only a departure _from_ the copytext gets markup.

## 8. The shape of a text

A text is a tree of sections, and the tree mirrors **the book's own divisions**:
book, part, chapter, section, essay, letter, dialogue. It never mirrors the
page, and it never mirrors what would be convenient to render.

```
# Hume.THN.1739-40          the edition
## 1                        Book 1, Of the Understanding
### 1                       Part 1, Of Ideas, their Origin…
#### 1                      Section 1, Of the Origin of our Ideas
```

Conventions that have settled:

- **Number sections from 1 within their parent**, following the book's own
  numbering where it has one. IDs need only be unique among siblings, so every
  level can restart at `1`.
- **A section with no blocks of its own is normal.** "Book 1" exists to hold its
  parts and carry a title.
- **Where the book numbers or names its divisions, use its numbering.** Where it
  does not — an unnumbered preface, an advertisement, a dedication — use a short
  mnemonic segment (`Intro`, `Pref`, `Adv`, `Ded`).
- **`title` is the full title as a reader would want it**, `breadcrumb` is the
  short form for navigation. For an edition, the breadcrumb is conventionally
  just the year.

## 9. Blocks are citations

Inside a section, the unit is the **block**, and a block is one paragraph of the
book. Blocks are numbered from 1 within each section, which makes every
paragraph in the corpus addressable: `Hume.THN.1739-40.1.1.1.1`.

That address is the corpus's citable identifier, and it is a promise. Two
consequences:

- **Do not renumber the blocks of a published edition.** Fixing a typo is
  routine; resegmenting a text so that paragraph 12 becomes paragraph 13 breaks
  every citation anyone has made of it. If a text really is missegmented, say so
  in the submission and let the editors decide — this is one of the few changes
  that is not the contributor's to make unilaterally.
- **One printed paragraph is one block.** Do not merge two short paragraphs, and
  do not split a long one. Where the printing itself is ambiguous — a paragraph
  broken across a chapter head, a run-on after a displayed quotation — follow
  the sense.

Displayed matter that interrupts a paragraph (a block quotation, a verse
quotation, a table) stays inside the block it interrupts if the paragraph
continues after it, and becomes its own block if it does not.

## 10. Pages

Pagination is **optional but welcome**, and there are two ways to record it,
which do different jobs:

- **`//34//` in the text** marks the point at which the page turned, with the
  reference exactly as printed — arabic, roman, or a signature (`//A3//`). Use
  `///` where you know the turn but the page is unnumbered. This is the precise
  record, and it is what makes "which page is this sentence on?" answerable.
- **`{#12, pages="34-35"}`** on the block records the range the block occupies.
  This is the cheaper record, useful when you are working from a transcription
  that gives page ranges but not exact turns.

Either is better than neither, and both together are fine. A text with no
pagination at all is still a perfectly good corpus text; several are.

Transcribe the reference as printed, including a printer's error in it. Page
numbering that restarts (front matter in roman, body in arabic) is transcribed
as printed and needs no special handling.

## 11. Title pages and front matter

The title page is a `{#title}` block, and it is the one place (with `{#subtitle}`)
where heading lines are allowed. The number after the caret is **relative
display size, not outline depth**: `^1` is the largest thing on the page, `^6`
the smallest.

```markit
{#title}
^5 A
^1 TREATISE
^6 OF
^2 Human Nature :
^5 BEING
^4 An *Attempt* to introduce the experimental Method of Reasoning
```

Read the page and judge the sizes. You are recording the typographic shout of a
title page, not building a hierarchy, so it is fine and normal for the sizes to
jump about.

- **The imprint** is transcribed with hard line breaks (`\`) where the lines are
  genuinely separate: `London: \` / `Printed for [p:*John Noon*], 1739.`
- **The date** is transcribed as printed, roman numerals and all
  (`M. DC. XC. IX.`, `MDCCXLVII.`). The real year lives in `published`.
- **An epigraph** is a block quotation (`>`), with its attribution as a citation
  on the last line.
- **Rules, ornaments and the printer's device** are omitted.

Everything else in the front matter — dedication, preface, advertisement,
contents, errata — is an ordinary section of the text, transcribed like any
other. A contents list is a list; an errata list is a list, and it is
transcribed as printed even where its corrections have been applied in the text
as interventions.

## 12. Verse, drama and tables

**Verse.** Lineation is text, not page, and it is preserved: one `*` line per
line of verse, a blank line between stanzas. Indentation is not recorded.

**Drama and dialogue.** For a work with sustained speeches — Hume's
_Dialogues_ — put the speaker in block metadata (`{#4, speaker="Philo"}`) and
use the inline `@Philo@` only where the name is actually printed in the line.
Stage business printed inline is `::rising::`; stage business standing on its
own between speeches is a `:` block.

**Tables.** Pipe-separated cells, with a separator row only where the print has
a genuine header. Column alignment and rule style are not recorded. A table too
irregular to sit in a grid — a two-column display, a genealogical chart — is
better transcribed as the prose or verse it really is than forced into a table.

## 13. Choosing and recording a copytext

**Which edition.** The corpus does not want every printing. It wants the
editions in which an author's mind is at work: the **first edition**, and every
later edition the **author revised**. A reprint that changes nothing but the
imprint is not worth a transcription — but it is worth a stub, so the record of
what was printed stays complete (see [the data model](./DATA_MODEL.md)).

**Which copy.** Any copy of that edition. Where two copies of one edition differ
— stop-press correction, a cancel leaf — say which you used in `sourceDesc`.

**One edition, one file.** Do not conflate two printings into a single "best
text". If the 1748 and 1750 _Enquiry_ differ, that is two files, and the
difference is the corpus's most valuable asset.

**Recording it.** Four keys carry the provenance, and between them they should
let a reader reconstruct exactly what you worked from:

| Key          | Holds                                                                        |
| ------------ | ---------------------------------------------------------------------------- |
| `published`  | the year(s) of this printing                                                 |
| `estc`       | the ESTC citation number of the printed item — the bibliographic identity    |
| `tcp`        | the TCP text ID, where a TCP transcription of _this_ edition exists          |
| `sourceUrl`  | the online transcription or facsimile you actually worked from              |
| `sourceDesc` | prose: what the copytext is, why it was chosen, and what you did to it       |

`sourceDesc` is the document a future editor will read before touching your
text, and it is worth writing properly. The house style is a short paragraph in
plain prose:

> Berkeley's [Treatise Concerning the Principles of Human Knowledge] was first
> published in 1710, and then again in 1734 together with the [Three Dialogues
> Between Hylas and Philonous]. Our copytext is this later edition, which
> corrects a few typographical errors, makes some small stylistic improvements,
> and uses more modern spelling. The original dedication and preface from the
> 1710 edition, not reprinted in 1734, are also included. The text here derives
> from David Wilkins's online edition.

Say the publication history in a sentence, name the copytext, give the reason,
and credit whoever transcribed it before you.

**`sourceUrl` is not the edition's identity.** This is the trap worth naming
twice. It is common and legitimate to take a transcription of the _first_
edition and work it up into a _later_ one — several corpus texts do exactly
that, and their `sourceDesc` says so. When that happens, `estc` and `tcp` must
describe the edition the file _is_, not the one the URL points at.

## 14. Working from an existing transcription

Most corpus texts began as somebody else's transcription — the Text Creation
Partnership, a scholar's online edition, a thesis. This is entirely proper, and
it is usually the fastest route to a good text. Three obligations come with it.

**Credit it.** Name the source in `sourceDesc` and give the URL in `sourceUrl`.

**Check it.** An imported transcription is a starting point; the printed page is
the authority. The recurring defects, in rough order of frequency:

- **flattened ligatures** — `oeconomy`, `Phaenomena`, `AEgyptians`
  ([§5](#5-ligatures));
- **omitted Greek** — a `<gap>` or a `[greek text]` placeholder where the
  printer set Greek ([§6](#6-damage-illegibility-and-gaps));
- **silent modernisation** — capitalisation flattened, spelling regularised. If
  the transcription reads too clean for its date, it has been modernised, and
  the fix is to check it against a facsimile;
- **lost typography** — italic and small capitals dropped, which matters because
  the corpus's name and citation markup often hangs on them;
- **structural mush** — footnotes inlined where they were printed, paragraphs
  split at page breaks, the contents list run into the preface.

**Do not inherit its editorial policy.** Another project's conventions are not
ours. A transcription that expands abbreviations, or supplies accents, or
regularises `u`/`v` and `i`/`j`, has made decisions this document does not make;
undo them.

The Compositor has an "Import TCP text" command that fetches a TCP transcription
and converts it to Markit, which does the mechanical part of all of this. The
checking is still yours.

## 15. When you are unsure

The house preference, in order:

1. **Prefer the printed reading.** When you can transcribe what is there without
   deciding anything, do that.
2. **Record doubt rather than resolving it.** `[?…?]` is always available and
   costs nothing. A marked uncertainty is a contribution; a confident guess is a
   liability.
3. **Ask.** Say what you found and what you did in the submission description.
   The editors would far rather adjudicate a question than discover a decision.

Nothing in this document is a reason not to submit a text. An imperfect
transcription of a text nobody has transcribed is worth more than a perfect one
of a text we already have, and review exists to catch what you missed. See
[the contributing guide](./CONTRIBUTING.md).
