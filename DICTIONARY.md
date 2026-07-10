# The Dictionary

The dictionary (`data/dictionary/`) is the corpus's curated register of **surface
forms**: every word as it is printed, lower-cased ([almost](#the-one-exception-to-lower-casing-i)
the only mechanical change we make). It aspires to be a **full register**, not a
list of exceptions — every word we have ever seen eventually earns an entry, even
plain modern words with nothing special to say — so that a word *without* an
entry stands out as something unseen, and probably a typographical error. While
the register is still being filled in, missing coverage is reported rather than
treated as an error.

The dictionary is editorial data, so it lives here in the corpus (the write
side). The computer reads the compiled result and derives all its search
behaviour from it, holding no spelling or grammar rules of its own; the
Compositor provides the editing UI. This file is the complete reference for the
dictionary: what it records, the policy behind those judgments, the on-disk
format, and how it is validated.

## What the dictionary records

For every surface form, the dictionary answers up to four questions:

1. Has it been **seen** before (is it accounted for)?
2. What is its **modern spelling**, if that differs from how it is printed?
3. What is its **lemma** — the headword you would look it up under (see below)?
4. Is it **ambiguous** — could it be read in more than one way?

### Entries and readings

Every surface maps to one or more **readings**. More than one reading means the
surface is **ambiguous**. An ambiguous surface is read as the *first* reading in
the list by default (so list the most common one first); Markit's
`[w:surface=value]` markup can override that default for a particular occurrence
in a text.

A reading is a sequence of **words**, each with a modern **spelling** and a
**lemma**. It is almost always a single word, but it has to be a sequence so that
contractions can expand: `'tis` reads as the two words "it is" (with lemmas "it"
and "be").

### The one exception to lower-casing: "I"

Lower-casing every surface is what lets us treat a sentence-initial *The* and a
mid-sentence *the* as the same word. That kind of capital is **positional** — an
accident of where the word falls. *I* is the one English word whose capital is
**lexical**: it is written *I* wherever it appears, and there is no lower-case
pronoun for it to fold onto. So the bare token *I* is kept capital — it is its
own entry, `"I"`, with the lemma **I**, and *me* / *my* / *mine* point to it.

This also keeps it clear of the roman numeral: a lower-case *i* is always the
numeral (accounted for mechanically, needing no entry), while a capital *I* may
be either the pronoun or a numeral — which the accounting rule allows, since a
token need only be accounted for in *one* way. Only the bare word is treated
specially; contractions such as *I'll* lower-case as usual and reach the pronoun
through their reading.

## Lemmatisation policy

This is the heart of the dictionary's editorial judgment, so it is worth stating
plainly.

### What a lemma is

A **lemma** is the headword you would look a word up under in an ordinary
dictionary — its "citation form". *Walks*, *walked*, and *walking* are all forms
of one word, and that word's lemma is **walk**. *Mice* has the lemma **mouse**.
Giving many forms a shared lemma is what lets a reader search for "walk" and find
every occurrence of "walked" as well.

Two clarifications before the policy proper:

- **A lemma is a spelling, not a meaning.** *Lie* (to recline) and *lie* (an
  untruth) happen to be spelled and inflected identically, so they share the one
  lemma **lie**. We do not split a lemma by meaning, and we do not record what
  part of speech a word is. This keeps the register simple and is a deliberate
  limit, not an oversight.
- **A lemma is not the same as a modern spelling.** The dictionary handles two
  separate things. *Modernising the spelling* turns an old spelling of a word
  into today's spelling of **the same form** (*vertue* → *virtue*). *Finding the
  lemma* gathers all the grammatical forms of a word under one headword (*virtue*
  and *virtues* → **virtue**). The two are recorded independently, and the next
  section is only about the second.

### The governing principle

There is a standard, non-arbitrary line, and we follow it:

> **Collapse the grammatical forms of one word onto a single lemma. Keep
> genuinely different words apart, even when one is built out of another.**

Put as a test you can apply by eye: *would an ordinary dictionary give this its
own headword?* If it is just the same word wearing a different grammatical ending
— a plural, a past tense, a comparison — it does **not** get its own headword, so
it shares a lemma. If it is a new word made from another one — an adverb made
from an adjective, a noun made from a verb — it **does** get its own headword, so
it keeps its own lemma.

Everything below follows from that one line.

### What collapses onto a shared lemma

These are all "the same word in different grammatical clothes":

- **Plurals onto singulars**: *virtues* → **virtue**, *men* → **man**,
  *children* → **child**. Foreign plurals too, which this corpus sees often:
  *data* → **datum**, *indices* → **index**.
- **Verb forms onto the plain form**: *increases*, *increased*, *increasing* →
  **increase**; *made* → **make**; *was*, *were*, *been*, *being* → **be**.
- **Comparisons onto the plain adjective or adverb** — *including irregular ones*.
  *Greater*, *greatest* → **great**; and, yes, **good** / *better* / *best*
  collapse onto **good**, exactly as *big* / *bigger* / *biggest* would. (*Better*
  and *best* can also be forms of *well*; that simply makes them ambiguous, which
  the register handles — see below.)
- **The different forms of a pronoun onto one headword**: *me*, *my*, *mine* →
  **I**; *him*, *his* → **he**; *us*, *our* → **we**; *them*, *their* → **they**.
- **Old grammatical forms** that a modern reader would recognise as the same
  word: *hath* → **have**, *doth* → **do**. Note the earlier point — *hath* is
  not *re-spelled* as *has* (they are different forms); its spelling stays *hath*,
  and it is the *lemma* that gathers it with the rest of **have**.

### What stays apart, with its own lemma

These *look* related but are different words, so each keeps its own headword:

- **Adverbs made from adjectives** (the "-ly" words): *quick* and *quickly* are
  two words, two lemmas. Likewise *true* / *truly*.
- **Reflexive pronouns**: *himself*, *herself*, *themselves* are their own
  headwords — **not** forms of *he*, *she*, *they*. They are compounds (*him* +
  *self*) and behave as distinct words, and a reader searching for "he" would be
  surprised to be shown every "himself".
- **Modal verbs and their historical pasts**: *can* / *could*, *will* / *would*,
  *shall* / *should*, *may* / *might* are each kept as **separate** lemmas.
  Although *could* began life as the past of *can*, the two now work as
  independent words with their own meanings, and standard practice keeps them
  apart. *(This is the one genuinely debatable line in the policy — a project
  aiming purely at retrieval might choose to collapse them. We keep them apart;
  if that is ever revisited, it must be revisited for the whole set at once.)*
- **"Thou" and "you" are two different words**, not two forms of one — just as *I*
  and *we* are different words. So *thou*, *thee*, *thy*, *thine* all share the
  lemma **thou**, and *ye*, *you*, *your*, *yours* all share the lemma **you**,
  but the two families stay separate. (This also preserves the old
  familiar/formal distinction for anyone studying it, while still letting a search
  for "you" gather its own forms.)
- **Ordinals and cardinals**: *first* is not a form of *one*, *second* not a form
  of *two*. Each keeps its own lemma.
- **Periphrastic comparison**: *more* and *most* are ordinary words in their own
  right (as in "more virtue"), each its own lemma — they are not forms of
  anything.

### Two consequences worth spelling out

- **A word that shifts between noun and verb keeps one lemma.** Because a lemma is
  a spelling and we do not record part of speech, *love* the noun and *love* the
  verb are simply the one lemma **love**. This falls out of the policy for free
  and is the behaviour we want.
- **Words that are lexicalised keep their own lemma even if built from another.**
  *People* is treated as its own headword, not as a plural of *person*;
  *government* as its own word, not merely a form of *govern*. The dictionary test
  above is the guide: if it has settled into a word in its own right, it gets its
  own headword.

## The on-disk format

Normalisation (modern spelling) and lemmatisation are **factored** on disk, so
each editorial fact is stated exactly once. A bare string value is a
**cross-reference**: `"vertues": "virtues"` reads as "vertues: see *virtues*" —
the lexicographer's convention for a variant spelling. A word's lemma is stated
only on the entry for the modern word itself (`"virtues": "=virtue"`); a
cross-referenced surface's lemma is then **derived** from its target's entry.
Lemma ambiguity therefore *inherits* through a cross-reference (it is a fact about
the modern word), while spelling ambiguity does *not* (it is a fact about the one
surface).

Entries live in JSON shards keyed by the surface's first letter (ignoring any
leading non-letter), with `other.json` for anything outside a–z. Keys are sorted,
one entry per line — diff- and merge-friendly. Values use a micro-syntax
mirroring the `[w:]` markup:

```jsonc
{
  "the": null,                 // seen; modern; lemma = itself
  "increases": "=increase",    // modern spelling; lemma stated here, its one home
  "vertue": "virtue",          // cross-reference: see "virtue"
  "vertues": "virtues",        // cross-reference; lemma derives via "virtues"
  "'tis": "it is",             // one surface, two words, each its own entry
  "then": [null, "than"],      // spelling-ambiguous; default first
  "lay": [null, "=lie"],       // one spelling, two lemmas (a modern word's fact)
  "compleat": "?complete"      // machine-suggested, unconfirmed
}
```

`null` is the doubly-identity reading: the surface is a modern word, spelled and
lemmatised as itself. A reading that is just the surface's own spelling is always
written `null`, never as a self-cross-reference. Grammar of a value:

```
entry    := value | "[" value ("," value)+ "]"    // array = ambiguous, ordered
value    := null | string
string   := "?"? reading                          // "?" alone = unconfirmed null
reading  := "=" lemma                             // identity: a lemma statement
          | spelling (" " spelling)*              // cross-reference (>1 = expansion)
```

The `?` prefix marks a machine-suggested, human-unconfirmed entry; confirming it
means deleting the prefix. There is no escaping mechanism: spellings and lemmas
must be words (letters and apostrophes), so `=`, space, `?`, and `]` can never
collide with the syntax.

The register is **closed under derivation**: every cross-referenced spelling must
itself have an entry with an identity reading (so a lemma derives in a single step
— no chains of respelling — and a typo in a value dangles instead of passing
silently), and every stated lemma must have an entry with a `null` reading (a
lemma is always a citation form). The accepted price is that the register
includes modern targets (*virtue*, *be*) even where they are never printed.
`deno task fmt` canonicalises the shards (sorting, shard placement, minimal
values, whitespace). Multi-word *keys* (`to morrow`) are deliberately
unimplemented — each half is an ordinary seen word, and `[w:to morrow=tomorrow]`
covers the important occurrences.

## The accounting rule

> Every token in every text is accounted for by **at least one** of: a dictionary
> entry for its folded surface; enclosure in person (`[p:]`) / place (`[l:]`) /
> org (`[o:]`) / citation (`[…]`) / language (`$…$`) markup; or a mechanical class
> (contains digits, or reads as a strict roman numeral — note `I` is both a
> numeral and a pronoun, which is why accounting is "at least one of").

The rule is one pure function (`accountTokens` in `src/dictionary.ts`, over the
word identity defined in `src/words.ts`: letters plus internal/leading/trailing
apostrophes, hyphens split, digit-bearing tokens are not words). It is
simultaneously the corpus's coverage check and the Compositor's live squiggle
engine. Recorded trade-off of the citation exemption: citation contents never
normalise ("A Treatise of Humane Nature" will not match a search for "human
nature") — accepted; do not "fix" it by adding citation words to the register.
Name *normalisation* (Tully = Cicero) is entity resolution, and out of scope.

## `[w:surface=value]` markup

Markit's word element disambiguates individual occurrences; the corpus defines its
semantics:

- **Single-token surface**: the entry for the folded surface must be ambiguous —
  2+ **derived** readings, so ambiguity inherited through a cross-reference counts
  — and the value must select **exactly one** of them: it matches a reading whose
  full spelling string *or* full lemma string (words joined by single spaces)
  equals the value: `[w:then=than]`, `[w:lay=lie]`, `[w:borne=born]`. Markup on an
  unambiguous surface is a validation error, keeping the texts free of noise.
  Unmarked occurrences mean the first reading — the one reading that therefore
  need not be uniquely selectable (in `"lay": [null, "=lie"]` the string "lay"
  matches both readings; only `lie` is ever needed in markup).
- **Multi-token surface** (the interim mechanism for `to morrow`): the value is a
  **cross-reference reading** — spellings only, same grammar as dictionary values:
  `[w:to morrow=tomorrow]`. No dictionary entry is required; the marked tokens are
  accounted for by the markup itself, and the value's lemmas derive from the
  register where its words are registered.

## Edition overrides (`[metadata.dictionary]`)

Orthographic conventions are properties of a *printing*, not of the language
corpus-wide: in a 1650s edition *humane* ordinarily reads "human", in a 1750s
edition it reads "humane". An edition whose conventions differ from the register's
defaults states so once, in its metadata, instead of marking every occurrence:

```
[metadata.dictionary]
humane = "human"
then = "than"
```

Each pair overrides the **default reading** of an ambiguous surface for the text's
unmarked occurrences. Values use the same selection grammar as `[w:]` markup — a
reading's full spelling string or full lemma string, selecting exactly one of the
entry's derived readings — and an override may only *select among* the register's
readings, never introduce one: there is exactly one register. The full precedence
chain for an occurrence is:

> `[w:]` markup on the occurrence → the text's override for the surface → the
> entry's first reading

implemented once as `resolveReading` (exported on `wire`, so the computer and the
Compositor share it). The map cascades per surface (a section's map merges over
its ancestors'), so a borrowed edition keeps its own conventions inside a
collection. As with `[w:]` markup, an override on an unambiguous surface is a
validation error. Selecting the entry's *current* default is legal — a **pin**,
keeping the edition's meaning stable if the register's reading order is ever
revised. One markit constraint: metadata keys are `\w+`, so a surface containing
an apostrophe or a non-ASCII letter cannot be overridden this way — per-occurrence
`[w:]` markup covers such (rare) cases.

## Validation tiers

- **Structural** (error): shards parse; keys are folded words, in the right shard,
  sorted; values are well-formed; shards are byte-for-byte canonical.
- **Referential** (error): the register is closed under derivation (above); an
  entry's derived readings are distinct and (beyond the default) uniquely
  selectable; every `[w:]` in the texts, and every `[metadata.dictionary]`
  override, obeys the semantics above.
- **Coverage** (report only): per work and corpus-wide — % tokens accounted, split
  into confirmed / unconfirmed / unaccounted. Printed by `deno task test`;
  flipping it to a hard error is the last step of backfill.

The compiled catalogue emits the dictionary **expanded** — explicit spelling and
lemma per word per reading, plus `confirmed` — as `catalogue/dictionary.json`, so
consumers never parse the micro-syntax. The computer derives its search levels
from it; it has no linguistic heuristics of its own.

The rules themselves live in `src/dictionary.ts` and `src/validate.ts` as pure
functions returning structured violations; `tests/dictionary.test.ts` and
`tests/validate.test.ts` run them over the real corpus.
