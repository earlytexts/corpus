# For Editors

The Centre's own working document: how a submission is reviewed, how the
register is maintained, when to decline, and how a release is cut.

It is public on purpose. A contributor who can read the checklist before sending
is a contributor whose submission arrives closer to acceptable, and a policy
that cannot be published is a policy that is not ready.

Editors are also readers of [the editorial policy](./EDITORIAL.md),
[the markup policy](./MARKUP.md) and [the dictionary](./DICTIONARY.md) — those are the
policy of record, and this document does not restate them. It says how to apply
them.

## Contents

1. [The review checklist](#1-the-review-checklist)
2. [Reviewing a transcription](#2-reviewing-a-transcription)
3. [Reviewing markup](#3-reviewing-markup)
4. [Reviewing dictionary changes](#4-reviewing-dictionary-changes)
5. [Maintaining the register](#5-maintaining-the-register)
6. [When to say no](#6-when-to-say-no)
7. [Deciding policy](#7-deciding-policy)
8. [Release and publish](#8-release-and-publish)

## 1. The review checklist

In order, cheapest first. Stop at the first failure and say so — there is no
point reading a transcription closely if the text is out of scope.

**Scope.** Public domain, hand-press era, published in the author's own English,
within the corpus's subject. Not an unrevised reprint. Not a duplicate of work
already in flight. See
[contributing guide §1](./CONTRIBUTING.md#1-what-belongs-in-the-corpus).

**Mechanics.** CI runs `check`, `fmt:check`, `test` (unit tests plus full corpus
validation), `build`, and a JSR publish dry run. Green CI means: every file
compiles, every file is canonically formatted, the schema holds, the layout
holds, the dictionary is well-formed and closed under derivation, canonical
spellings match the reference list, and every `[w:]` and override selects a
reading the register offers. None of that needs a human.

**Scale.** Is it one thing? A submission mixing a new text, corrections
elsewhere, and dictionary work should be split. Ask for the split rather than
reviewing it whole.

**Provenance.** For any new edition:

- `published` correct, and `sourceUrl` pointing at what was actually used;
- `sourceDesc` in prose — what the copytext is, why it was chosen, what was done
  to it, who transcribed it first;
- `estc` describing the edition the file **is**, not the edition `sourceUrl`
  points at. This is the commonest provenance error, because it is common and
  legitimate to take a first-edition transcription and work it up into a later
  edition;
- `tcp` only where the TCP text transcribes _this_ edition, not merely the same
  work.

**Structure.** Sections follow the book's own divisions. One printed paragraph
is one block. Footnote blocks after the paragraph blocks, referenced from the
same text. Title page in `{#title}`, display sizes judged rather than nested.

**Block IDs.** Have any moved? A renumbering breaks every citation made of the
edition. If the text really is missegmented, that is a decision to take
deliberately and announce, not to accept as a side effect of a correction.

**Transcription.** [§2](#2-reviewing-a-transcription).

**Markup.** [§3](#3-reviewing-markup).

**Dictionary.** [§4](#4-reviewing-dictionary-changes).

**Coverage.** The test run prints coverage per work and corpus-wide. A new text
should not drag its work's figure far below the corpus average (currently around
99%). A low figure is nearly always missing markup, not missing dictionary
entries — check before asking for entries.

## 2. Reviewing a transcription

You cannot read a whole book against the page in review, and you should not try.
Sample, and sample where the defects live.

**Spot-check three places**: the first page of the text proper, one page from
the middle, and one footnote-heavy page. Most systematic defects show up in any
of them.

**Look for the recurring imports' diseases**, in rough order of frequency:

| Symptom                                                       | Diagnosis                               |
| ------------------------------------------------------------- | --------------------------------------- |
| `oeconomy`, `Phaenomena`, `AEgyptians`                        | flattened ligatures                     |
| `$grc:[...]$`, `[greek text]`                                 | Greek dropped by the source             |
| Text reads too clean for its date; no initial caps on nouns   | silently modernised                     |
| No italics at all across a page that must have had them       | typography lost in import               |
| Footnotes inline where printed; paragraphs split at page turns | structure not reconstructed             |
| `p. 307.The`                                                  | missing space — a transcription error   |
| Long s transcribed as `f`                                     | OCR, not transcription                  |

**Check the title page carefully.** It is short, it is the densest concentration
of judgement in the file, and a contributor who has got it right has usually
understood the conventions.

**Check one insertion/deletion pair, if there are any.** Is it one of the three
licensed cases — authorial correction, another authorial witness, an
uncontestable compositor error — and does `sourceDesc` say which? An
insertion/deletion pair used to record a spelling preference is the misuse to
watch for.

## 3. Reviewing markup

Markup is the area where a well-meaning contributor most often goes wrong in a
consistent direction, so look for patterns rather than instances.

- **Over-marking.** Peoples and demonyms marked as places (`[l:Gauls]`);
  offices marked as people (`[p:the king]`); common nouns derived from names.
  These are dictionary words.
- **Span shape.** Possessives inside the span; sentence punctuation inside the
  span; formatting outside the marker instead of inside it.
- **Citations without a signal.** A capitalised run wrapped as a citation with
  no siglum, title or citing name in it. "About 400,000 l. Sterling." is the
  canonical false positive.
- **Dangling labels.** A citation span ending on `vol.` with the number outside.
- **Unlabelled foreign runs.** A bare `$…$` where the language is perfectly
  determinable, or an unmarked Latin footnote (which the coverage figure will
  have flagged already).
- **`[w:]` doing the dictionary's job.** Per-occurrence disambiguation of an
  ordinary archaic spelling. The fix is a register entry, once.

Under-marking is not a reason to decline. An unmarked ambiguous toponym is a
question sitting in the coverage report, which is where questions belong.

## 4. Reviewing dictionary changes

Most of the register's invariants are machine-checked, so review is about the
judgements the machine cannot make:

- **Is a new entry a word of the corpus, or a proper noun?** Proper nouns are
  not registered — they are marked up. Casing in the corpus is the practical
  test.
- **Is a claimed respelling really the same word?** Normalisation is for
  orthographic variation of the same form. An archaic form that is arguably a
  distinct word (_thou_, _hath_) keeps its own spelling and lemmatises onto the
  modern headword instead.
- **Is a new ambiguity earned?** The rule is strict and it exists to stop labour
  being created lightly: a surface is marked ambiguous **if and only if** there
  is a sibling form in the corpus that could only have come from the other
  lemma. Ask for the sibling.
- **Is the default reading plausibly the commoner one?** Advisory, unenforceable,
  and worth a glance.
- **Structural pairing.** Where an own-lemma reading pairs with a same-spelling
  lemma statement, the `null` reading must come first — non-default readings are
  selected by their spelling or lemma string, and only the lemma statement has a
  distinct one.

## 5. Maintaining the register

The register is the Centre's standing work, not a contributor's. Three habits.

**Burn the backlog down by frequency.** The Compositor's dictionary panel ranks
every unaccounted surface corpus-wide by frequency. Working from the top is
worth many times working alphabetically: a single common respelling can move
corpus coverage by a tenth of a percent.

**Diagnose before registering.** An unaccounted surface is one of four things,
and only the first wants a dictionary entry:

1. a genuine English word or spelling the register lacks — register it;
2. a proper noun — mark it up ([the markup policy](./MARKUP.md));
3. a foreign word — mark up the run;
4. a transcription error — fix the text.

Registering (2), (3) or (4) is worse than leaving the surface unaccounted,
because it silently removes the signal that something is wrong.

**Keep the reference authority pinned.** The canonical-spelling rule reads
`data/reference/words.txt`, generated from SCOWL at British spelling, size 60.
The size is chosen deliberately — wider lists re-admit archaic forms such as
`compleat`, which would then beat `complete` as canonical. When the corpus grows
a genuine modern word the list omits, pin it in
`data/reference/canonical-exceptions.json` rather than widening the list. See
[the reference data README](./data/reference/README.md).

## 6. When to say no

Decline plainly, in one paragraph, with the reason and the nearest thing the
contributor could do instead. The legitimate grounds:

- **Out of scope** — in copyright, a translation, outside the period, an
  unrevised reprint.
- **Duplicated effort** — somebody is already working on it. Say who, and put
  the two in touch.
- **Not a corpus decision to make** — a block renumbering, a change of editorial
  policy, a new author. These are not refusals of the work; they are refusals of
  the route. Move them to an issue.
- **Unverifiable provenance** — a text whose source cannot be named, or whose
  right to be redistributed is unclear.
- **Wholesale editorial rewriting** — a submission that modernises spelling,
  repunctuates, or silently emends. This is the one to catch early and explain
  fully, because the contributor has usually done a great deal of careful work
  in the wrong direction.

What is _not_ a ground for declining: an imperfect transcription, an
under-marked text, a low coverage figure, or unfamiliarity with the conventions.
Those are review comments.

## 7. Deciding policy

When a case is not covered:

1. **Decide it, and write it down in the document that owns it** — the
   documents are the policy of record, and a decision that lives only in a
   review thread will be re-litigated within a month.
2. **Prefer a deterministic rule to a judgement**, and an externally-fixed
   authority to an internal one. The canonical-spelling rule is the model: the
   answer comes from a pinned external word list, so it never drifts as the
   corpus grows and nobody ever has to think about it twice.
3. **Prefer the rule that leaves a question visible.** An unmarked ambiguity
   shows up in the coverage report. A wrong decision shows up nowhere.
4. **Do not create labour lightly.** Marking a surface ambiguous, or introducing
   a distinction that must be applied per occurrence, is a cost paid by every
   future editor of every text. The bar is corpus evidence, not plausibility.

## 8. Release and publish

There is no separate release ceremony: `main` is the corpus, and CI does the
rest.

**On every pull request and every push to `main`** the Test workflow runs
`deno task check`, `deno task fmt:check`, `deno task test`, `deno task build`
and `deno publish --dry-run`, plus the Compositor's own typecheck, format check
and unit tests.

**On a successful Test run against `main`** the Publish workflow runs:

- `deno publish` to [JSR](https://jsr.io/@earlytexts/corpus) — a no-op unless
  `deno.json`'s `version` has been bumped;
- the Compositor to the VS Code Marketplace — a no-op unless
  `compositor/package.json`'s `version` differs from the published one.

So **a release is a version bump**, made in the pull request that earns it:

- bump `deno.json` when the **published surface** changes — the catalogue wire
  types, serialisation, word semantics, dictionary resolution, or the test
  harness. Adding a text or a dictionary entry does not change the surface and
  does not need a bump.
- bump `compositor/package.json` when the extension changes.

Downstream, the computer consumes `@earlytexts/corpus` from JSR and builds
`catalogue/` by running this checkout's own `deno task build`, so a schema change
lands in two steps: publish here, then bump the dependency there.
