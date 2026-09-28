# Contributing

The corpus is publicly owned and publicly maintained. Anyone can contribute, and
everyone gets the benefit — that is the only way something of this scale
endures.

This document is the **social contract**: what belongs in the corpus, what makes
a submission a good one, what happens after you send it, and what you are
agreeing to by sending it. It is deliberately not a git tutorial — you do not
need to know git, and the tooling is built so that you never meet it.

If you are looking for the mechanics, they are elsewhere:

| You want to…                    | Read                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------- |
| Install the tools and get going | [Using the Compositor](./compositor/GUIDE.md) — the walkthrough                          |
| Learn the markup language       | [Writing Markit](https://github.com/earlytexts/markit/blob/main/GUIDE.md)                 |
| Know what to preserve and what to fix | [Editorial policy](./EDITORIAL.md)                                                     |
| Decide what to mark up          | [Markup policy](./MARKUP.md)                                                                 |
| Curate the register of spellings | [The dictionary](./DICTIONARY.md)                                                        |
| Understand the file layout      | [Data model](./DATA_MODEL.md)                                                         |

## Contents

1. [What belongs in the corpus](#1-what-belongs-in-the-corpus)
2. [Choosing a text](#2-choosing-a-text)
3. [Ways to contribute](#3-ways-to-contribute)
4. [What makes a good submission](#4-what-makes-a-good-submission)
5. [How to send it](#5-how-to-send-it)
6. [What the editors check](#6-what-the-editors-check)
7. [How review goes](#7-how-review-goes)
8. [Licensing your contribution](#8-licensing-your-contribution)
9. [Conduct](#9-conduct)

## 1. What belongs in the corpus

The ambition is enormous; the scope is disciplined. Four criteria, all of which
must hold.

**Public domain.** The corpus gathers texts that are free to read and free to
reuse, for ever. A text still in copyright — including a modern scholarly
edition, its apparatus, and its introduction — does not belong here, however
convenient it would be to work from.

**The hand-press era.** Printings from roughly the middle of the seventeenth
century to the first third of the nineteenth. The corpus currently runs from
1650 to 1829.

**Published in the author's own English.** The corpus records what an author
wrote, so a translation is not the work. There is one narrow exception, made
once: Conway's _Principles_ survives only as an English translation of a
posthumous Latin translation of a lost English manuscript, and the unusual
history was judged to merit it. Expect that bar.

**Within the corpus's subject.** Philosophy and theology, and the writing that
sits alongside them — moral, political and economic thought, natural religion,
the history of ideas. This is a boundary of practice rather than principle, and
it moves: the corpus is a corpus of the texts that shaped the modern world, and
the argument for widening it is an argument the editors will hear.

### Not every edition — the ones that matter

The corpus does **not** want every printing of every book. For the history of
ideas what matters are:

1. the **first edition**;
2. every later edition the **author revised**;
3. the **last edition published in the author's lifetime**.

A reprint that changes nothing but the imprint is not worth a transcription. It
_is_ worth an `imported = false` stub, so the record of what was printed stays
complete and the work's first-publication year comes out right.

### The texts, not the history of the book

Excellent bibliographic resources already exist — the ESTC, VIAF, and many
focused projects — and the corpus does not set out to replace them. Its concern
is the texts and the history of ideas. Where a bibliographic record is wanted,
the corpus links out (see
[external identifiers](./DATA_MODEL.md#7-external-identifiers)) rather than
maintaining its own.

## 2. Choosing a text

**Look for a gap, not a duplicate.** The corpus browser in the Compositor shows
every work and edition, including the stubs with no text yet. A stub marked
`imported = false` is an explicit invitation: the Centre has already decided the
text belongs, recorded its identity, and is waiting for somebody to transcribe
it. That is the best place to start.

**An unrevised reprint is not a contribution.** If a work already has an edition
in the corpus and your candidate differs from it only in the imprint, the corpus
gains nothing from a second transcription.

**Check for an existing transcription first.** The Text Creation Partnership has
transcribed a great deal of this material, and starting from a TCP text is
faster and usually more accurate than starting from scratch. The Compositor's
"Import TCP text" command does the mechanical part. You still have to check it
against the page — see
[editorial policy §14](./EDITORIAL.md#14-working-from-an-existing-transcription).

**Say what you are doing before you do it.** For anything larger than a
correction, open an issue naming the work and edition you mean to take on. It
costs you five minutes and it prevents two people transcribing the same book.

**Bringing a new author.** A work by an author the corpus does not yet hold
needs the author added too — a short metadata file, plus the VIAF and Wikidata
identifiers. Raise it as an issue first: whether an author is in scope is an
editorial decision, not a transcription decision.

## 3. Ways to contribute

Not every contribution is a whole book. In rough order of how much they cost:

- **Report an error.** A misreading, a wrong date, a broken structure. An issue
  with the block ID and what is wrong is genuinely useful, and takes a minute.
- **Correct a text.** Open the edition, fix what is wrong, send it. This is the
  smallest useful unit of work and the best way to start.
- **Curate the dictionary.** The register is about 99% complete by token count,
  and the last percent is a long tail. The Compositor's dictionary panel ranks
  the gap by corpus-wide frequency, so you can work highest-impact first. See
  [the dictionary](./DICTIONARY.md).
- **Add markup.** People, places, citations and foreign text are unevenly marked
  across the corpus. Marking up an edition that has none is self-contained,
  scholarly work with an immediate measurable effect on coverage. See
  [the markup policy](./MARKUP.md).
- **Fill a stub.** Transcribe a text the corpus has already identified.
- **Bring a new work or edition.** The largest unit, and the most valuable.

## 4. What makes a good submission

**One thing at a time.** A submission that fixes twenty misreadings in one
edition is easy to review. A submission that fixes twenty misreadings, adds a
new work, and reorganises the dictionary is not, and it will sit unreviewed for
longer than all three would have taken separately.

**It passes validation.** The Compositor shows the corpus's own rules live in
the Problems panel, and the same rules run in CI. A submission with outstanding
violations is not ready; a submission with none is most of the way to accepted.
Run "Fix Formatting" before you send.

**The provenance is recorded.** Every new edition needs `published`,
`sourceUrl`, and a `sourceDesc` in prose saying what the copytext is, why it was
chosen, and what you did to it. If you know the ESTC number, add it.

**The description says what you did and what you were unsure about.** The
description box in the Contribute panel becomes the title and body the editors
read. "Corrected 14 misreadings in Book 1, checked against the Gale facsimile;
left three Greek passages marked uncertain because the scan is illegible" tells
a reviewer everything. "Fixes" tells them nothing.

**Doubt is declared, not resolved.** A marked uncertainty (`[?…?]`) is a
contribution. A confident guess is a liability. See
[editorial policy §15](./EDITORIAL.md#15-when-you-are-unsure).

**Block numbering is left alone.** Block IDs are the corpus's citable
identifiers. Renumbering the blocks of a published edition breaks every citation
anyone has made of it, so it is not a change to make unilaterally — flag it and
let the editors decide
([editorial policy §9](./EDITORIAL.md#9-blocks-are-citations)).

**Perfection is not the bar.** An imperfect transcription of a text nobody has
transcribed is worth more than a perfect one of a text we already have. Review
exists to catch what you missed.

## 5. How to send it

Through the Compositor's **Contribute** panel. It carries your work back to the
Centre without you ever naming a branch, a commit, a push or a pull request:

1. Make your changes and save them.
2. Open the Contribute panel. It lists what you have changed, labelled by text
   ("Hume · Enquiry · 1748"), with a diff per file and an undo per file.
3. Write a description of what you did.
4. Send for review.

The panel brings in the latest corpus first, and asks you about any text that
changed on both sides — better to meet a clash while you still remember doing
the work. Then it opens the submission for you.

**One submission is in flight at a time.** That is a deliberate constraint:
several at once would mean files changing on disk underneath you. Once a
submission is sent, further edits go to the same submission until it is decided.

If you would rather use git directly, you can — fork, branch, pull request, in
the ordinary way. The Compositor exists because most contributors should not
have to.

## 6. What the editors check

The full checklist is [the editors' guide](./EDITORS.md), which is public precisely so
that you can read it before you send. In summary, a reviewer asks:

- **Is it in scope?** ([§1](#1-what-belongs-in-the-corpus))
- **Does it validate?** Compile, formatting, schema, layout, dictionary — all of
  it is mechanical and all of it runs in CI.
- **Is the transcription faithful?** Spot-checked against the copytext, with
  attention to the recurring defects: flattened ligatures, silent modernisation,
  dropped italics, omitted Greek.
- **Is the provenance right?** Does `sourceDesc` say what was done? Does `estc`
  describe the edition the file _is_, not the one `sourceUrl` points at?
- **Is the structure right?** Do the sections follow the book's own divisions?
  Is one printed paragraph one block? Have block IDs moved?
- **Is the markup consistent with policy?** ([the markup policy](./MARKUP.md))
- **Do dictionary changes follow the register's rules?**
  ([the dictionary](./DICTIONARY.md))

## 7. How review goes

The review conversation happens on GitHub, on the submission itself. The
Compositor links to it rather than rebuilding it.

**Expect questions, not a verdict.** Most submissions of any size get comments,
and most comments are questions about a reading rather than objections. Answer
them in the thread; push further changes to the same submission.

**Expect it to take a while.** The Centre is small. A correction usually turns
around quickly; a new text takes longer, because somebody has to check it
against the page.

**A submission can be declined**, and the commonest reasons are scope (the text
is in copyright, or a translation, or an unrevised reprint) and duplication
(somebody is already working on it). Both are much better discovered before you
start — hence [§2](#2-choosing-a-text).

**Accepted work is merged and published.** The next release rebuilds the
catalogue, and the text appears on the sites built over the corpus.

**Your name stays on it.** The commit history is the record of who transcribed
what, and it is permanent. Where you have taken a text from someone else's
transcription, credit them in `sourceDesc` — that record is permanent too.

## 8. Licensing your contribution

The repository is released under the [MIT licence](./LICENSE.md). By sending a
contribution you agree that it is released under the same terms, and that you
have the right to release it.

Two things that follow:

- **Do not submit text you do not have the right to give away.** A transcription
  of a public-domain printing is fine. A modern edition's text, notes,
  translation or introduction is not, and neither is a transcription somebody
  else made under terms that do not permit redistribution.
- **Where you have built on somebody else's public-domain or openly-licensed
  transcription, name them** in `sourceDesc` and give the URL in `sourceUrl`.
  This is a scholarly obligation independent of the legal one.

See [the citation guide](./CITATION.md) for how the corpus and its texts should be
cited, and for the position on the texts themselves.

## 9. Conduct

Be civil, be specific, and assume the person you are disagreeing with has read
the page. Disagreements about a reading are the substance of the work and are
welcome; they are settled by looking at the copy.
