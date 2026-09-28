# Citing the Corpus

How to cite the corpus, an individual edition, and a single passage — and what
the licence permits.

## Why the corpus is citable

Every paragraph in the corpus carries a stable identifier:

```
Hume.THN.1739-40.1.1.1.1
```

Read left to right, that is: author, work, edition, book, part, section,
paragraph. It is the difference between a blob of text and a work a scholar can
point to. A passage you can search for is a passage you can cite, and the
identifier does not move when the surrounding text is corrected.

Block IDs are treated as a promise. They are not renumbered as a side effect of
editorial work; changing one is a deliberate decision, taken by the Centre and
announced. See
[editorial policy §9](./EDITORIAL.md#9-blocks-are-citations).

## Citing the corpus as a whole

Give the corpus, the Centre, the URL, and the version you consulted:

> The Early Text Corpus. The Early Text Centre.
> <https://github.com/earlytexts/corpus>. Accessed 1 August 2026.

The corpus is a living document, so **name the version**. The repository has no
release tags; the durable version identifier is the **commit hash** of the state
you worked from:

> The Early Text Corpus. The Early Text Centre.
> <https://github.com/earlytexts/corpus>, commit `1a2b3c4`.

For quantitative work — coverage figures, word counts, collocations — the commit
is not optional. The corpus grows, and a figure without a version is not
reproducible.

(The `version` in `deno.json` is the version of the published _package_ — the
wire contract the software consumes — not of the corpus's contents. Do not cite
it as the corpus's version.)

## Citing an individual edition

An edition in the corpus is a transcription of a particular printing, and a
citation should make both facts visible: what was printed, and what you actually
read.

> David Hume, _Philosophical Essays concerning Human Understanding_ (London,
> 1748). The Early Text Corpus, edition `Hume.EHU.1748`.
> <https://github.com/earlytexts/corpus>, commit `1a2b3c4`.

Three points of good practice:

- **Cite the printing, not the work.** `Hume.EHU.1748` and `Hume.EHU.1777` are
  different texts, which is the whole reason the corpus keeps them apart.
- **Use the title as printed**, which for the 1748 _Enquiry_ is _Philosophical
  Essays concerning Human Understanding_. The edition's `title` records it.
- **Where a bibliographic identity matters**, give the edition's ESTC citation
  number, which the file records in `estc`: ESTC `T4022`. That is the
  identifier a librarian will recognise.

The edition's `sourceDesc` states what the copytext was, why it was chosen, and
what was done to it. Where you are making a claim that depends on the state of
the text, it is worth reading — and worth quoting, if the claim is fine-grained.

## Citing a passage

Give the block ID. It is unambiguous, permanent, and short:

> Hume, _Treatise_ 1739–40, `Hume.THN.1739-40.1.1.1.1`.

Alongside a conventional reference rather than instead of one, if you are
writing for readers who do not use the corpus:

> Hume, _Treatise_ 1.1.1 (`Hume.THN.1739-40.1.1.1.1`).

Where an edition records pagination, the printed page is available too, and a
citation may give it in the ordinary way; but the block ID is the one that
resolves mechanically.

## Citing through the reading sites

Two public sites are built over the corpus and are the pleasanter way to read
it:

- [davidhume.org](https://davidhume.org) — the works of David Hume;
- [englishphilosophy.org](https://englishphilosophy.org) — philosophical and
  theological works by a range of authors.

Their URLs are stable and may be cited directly. They render the same texts, so
a citation of a site URL and a citation of a block ID point at the same words;
where you need the version, the corpus commit is what pins it.

## Licence

**The repository is released under the [MIT licence](./LICENSE.md).** That
covers everything in it: the code, the schema, the dictionary, and the
transcribed texts. Its one condition is that the copyright notice and permission
notice travel with substantial portions of the material.

**The underlying printed texts are in the public domain.** The corpus's editions
are transcriptions of printings from the hand-press era, whose copyright expired
long ago, and the Centre claims no new rights in the works themselves. The
corpus exists so that these texts are free to read and free to reuse, for ever;
the licence is chosen to be as close to that as a licence gets.

**Some transcriptions began as somebody else's work**, most often the
[Text Creation Partnership](https://www.textcreationpartnership.org), whose
texts are in the public domain, and sometimes an individual scholar's online
edition. Where that is so, the edition's `sourceDesc` names them and `sourceUrl`
gives the URL. Contributors are required to record this
([contributing guide §8](./CONTRIBUTING.md#8-licensing-your-contribution)), and the
record is permanent.

**Attribution is a scholarly obligation as well as a legal one.** The licence
asks little; scholarship asks more. If the corpus's work is load-bearing in
yours — if you have relied on its readings, its structure, its register, or its
comparison between editions — cite it, and cite the version.
