# The Early Text Corpus

One central, publicly owned library of the texts that shaped the modern world —
free to read, free to reuse, for ever.

The digital texts of the hand-press era are spread across many archives, image
repositories and library catalogues, and some sit behind paywalls. This corpus
gathers public-domain texts into a single open place, as **diplomatic
transcriptions in [Markit](https://github.com/earlytexts/markit)** — a plain,
human-readable format that a person can read and a machine can compile.

```
{#12, pages="34"}
BUT the omission of a trifling circumstance will often, by law, invalidate a
contract, $la:in foro humano$, but not $la:in foro conscienti{ae}$, as
[p:*Malebranche*] and other divines express themselves<n7>. //35// The
magistrate is supposed only to withdraw his power of [-inforcing-][+enforcing+]
the right.
```

That is one paragraph of one edition: block number, printed page, a Latin tag
marked as Latin, a person marked as a person, a footnote reference, the page
turn where it fell, and an editorial correction that keeps both readings. It
still reads as prose, and it still diffs as prose.

## What is in it now

| | |
| ----------------------- | ------------------------------------------------ |
| Authors                 | 71                                               |
| Works recorded          | 355 — **91** with at least one edition transcribed |
| Editions recorded       | 918 — of which **588 are transcribed**           |
| Period                  | 1650 – 1829                                      |
| Words                   | 6.5 million                                      |
| Register of spellings   | 26,653 surface forms, accounting for 99.2% of tokens |

The corpus's depth is currently in **David Hume**, whose works are covered
exhaustively — every lifetime edition of the _Essays and Treatises_, the
_Treatise_, the _History of England_, the _Dialogues_. Its breadth is the
bibliographic record: 355 works by 71 authors are identified, dated and linked
to their catalogue records, and most of them are waiting for someone to
transcribe them.

Two public sites read the corpus: [davidhume.org](https://davidhume.org) and
[englishphilosophy.org](https://englishphilosophy.org).

## Where to go

| If you are…                                     | Read                                                                                     |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Thinking about contributing                     | **[Contributing](./CONTRIBUTING.md)** — scope, choosing a text, how review goes           |
| Transcribing a text                             | **[Editorial policy](./EDITORIAL.md)** — what to preserve, what to regularise             |
| Deciding what to mark up                        | [Markup policy](./MARKUP.md) — people, places, citations, foreign text                    |
| Curating spellings                              | [The dictionary](./DICTIONARY.md) — the register, and the rules that govern it            |
| Looking up the file layout or a metadata key    | [Data model](./DATA_MODEL.md) — entities, layout, the full schema                         |
| Reviewing submissions or cutting a release      | [For editors](./EDITORS.md)                                                               |
| Citing the corpus                               | [Citation](./CITATION.md)                                                                 |
| Changing the code                               | [Architecture](./ARCHITECTURE.md)                                                         |
| Learning the markup language                    | [Writing Markit](https://github.com/earlytexts/markit/blob/main/GUIDE.md)                 |

## Contributing

You do not need to know git, and you do not need to install anything but a text
editor.

1. Install [VS Code](https://code.visualstudio.com/).
2. Install the **[Early Text Compositor](./compositor/README.md)** extension. It
   sets the corpus up on your machine, gives you a browser of authors, works and
   editions, validates as you type, and carries your finished work back to the
   Centre for review — without ever naming a branch, a commit or a pull request.
   [The walkthrough](./compositor/GUIDE.md) takes you from an empty computer to
   a submitted correction.
3. Read [the contributing guide](./CONTRIBUTING.md), pick something, and send it.

The smallest useful contribution is a single corrected misreading. The most
valuable is a text nobody has transcribed. Both are welcome, and neither has to
be perfect — review exists to catch what you missed.

## How it works

Texts live in `data/` as `.mit` files, one per edition, organised by author and
work:

```
data/authors/<author>.mit                 author metadata (no text)
data/works/<author>/<work>/index.mit      the work: identity + canonical edition
data/works/<author>/<work>/<year>.mit     a dated edition (1748, 1742a, 1739-40…)
data/dictionary/<a–z|other>.json          the register of surface forms
```

`deno task build` compiles all of it into `catalogue/` — the boundary artefact
every read-side consumer works from, and the input to
[the computer](https://github.com/earlytexts/computer), which serves search,
comparison and analysis over it.

The corpus keeps itself honest with a rule set that runs in CI and, live, in the
Compositor: every file compiles, every file is canonically formatted, the
metadata schema holds, the layout holds, and every word in every text is either
in the register, inside markup that exempts it, or mechanically excluded. That
last rule — the **accounting rule** — is what lets an editor be shown a word the
corpus has never seen, as a probable transcription error.

## Development

```sh
deno task build      # compile the catalogue to catalogue/
deno task test       # unit tests + full corpus validation + the coverage report
deno task check      # typecheck + lint
deno task fmt        # format the TypeScript, the .mit texts, and the shards
deno task fmt:check  # verify all three
```

The corpus is published to [JSR](https://jsr.io/@earlytexts/corpus) as
`@earlytexts/corpus`, with a deliberately narrow surface: the wire contract the
computer reads, and a test harness. The VS Code extension is a separate npm
package in [compositor/](./compositor/). See
[the architecture notes](./ARCHITECTURE.md).

## Licence

MIT — see [the licence](./LICENSE.md). The underlying printed texts are in the
public domain, and the Centre claims no new rights in them. See
[the citation guide](./CITATION.md).
