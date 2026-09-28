# Markup Policy

Element-by-element policy for the semantic markers: people, places,
organisations, citations, foreign text, disambiguated words, and the multi-word
join. [The editorial policy](./EDITORIAL.md) says what a corpus text is and how faithful
to be to the page; this document says which of the things you _can_ mark you
_should_, and settles the cases where two answers look equally good.

The syntax itself is Markit's, and is not repeated here — see the
[specification](https://github.com/earlytexts/markit/blob/main/SPECIFICATION.md)
for what is legal and the
[guide](https://github.com/earlytexts/markit/blob/main/GUIDE.md) for how to type
it.

## Contents

1. [Why the markup exists](#1-why-the-markup-exists)
2. [What is never marked up](#2-what-is-never-marked-up)
3. [Span shape: the rules that apply to every marker](#3-span-shape-the-rules-that-apply-to-every-marker)
4. [People](#4-people)
5. [Places](#5-places)
6. [Peerage, sees and metonymy](#6-peerage-sees-and-metonymy)
7. [Organisations](#7-organisations)
8. [Citations](#8-citations)
9. [Foreign text](#9-foreign-text)
10. [Greek](#10-greek)
11. [Multi-word units](#11-multi-word-units)
12. [Word disambiguation](#12-word-disambiguation)
13. [Asides](#13-asides)
14. [A decision table](#14-a-decision-table)

## 1. Why the markup exists

Two reasons, and they pull in the same direction.

**The scholarly reason.** A corpus that knows which words are names, which runs
are Latin, and which brackets are references can answer questions a bag of words
cannot: who does this author cite, where does he place his examples, how much
Latin does he expect his reader to have.

**The mechanical reason.** The corpus holds itself to an **accounting rule**:

> Every token in every text is accounted for by **at least one** of: a
> dictionary entry for its folded surface; enclosure in person (`[p:]`), place
> (`[l:]`), organisation (`[o:]`), citation (`[…]`) or language (`$…$`) markup;
> or a mechanical class (it contains a digit, or reads as a strict roman
> numeral).

The rule is what lets the Compositor squiggle a word it has never seen as a
probable transcription error. That only works if the register can be trusted to
be complete, and the register can only be complete if it is not asked to hold
every proper noun and every Latin tag in the language. So the markers are not
decoration: they are how a name or a Latin phrase gets _accounted for_ without
being registered as an English word.

An unmarked Latin footnote therefore shows up as a page full of misspellings,
and an unmarked name shows up as an unknown word. When the Compositor squiggles
something that is obviously not a spelling problem, the fix is nearly always
markup, not a dictionary entry.

Coverage across the corpus currently stands at about 99% of 6.5 million tokens.
The last percent is mostly missing markup of exactly this kind.

## 2. What is never marked up

Getting this out of the way first, because the temptation runs the other way.

- **Peoples, demonyms and languages are ordinary words**, not places or
  organisations: _Gauls_, _Celts_, _Aetolians_, _Grecians_, _French_, _Roman_,
  _English_. They are registered in the dictionary, and _Aetolians_ lemmatises
  onto _Aetolian_ like any other plural. Mark `[l:Aetolia]`, never
  `[l:Aetolians]`.
- **Common nouns derived from names** — _jesuitical_, _machiavellian_,
  _epicurean_ as an adjective — are words. _Epicurean_ naming a member of the
  school is a judgement call; prefer the word.
- **Titles and offices on their own** — _the king_, _the duke_, _the bishop_ —
  are words. Only the proper name attached to them is marked
  ([§6](#6-peerage-sees-and-metonymy)).
- **Ordinary English in a foreign-looking dress.** _Etc_, _viz_, _via_,
  _alias_, _i.e_ have been in English for centuries and are dictionary words,
  not Latin.
- **Numbers**, roman or arabic, are already accounted for mechanically, and are
  marked only when they fall inside a span that is marked for another reason.

## 3. Span shape: the rules that apply to every marker

Four conventions decide where a span starts and stops. They apply to `[p:]`,
`[l:]`, `[o:]` and `[…]` alike.

**Formatting goes inside the marker.** The printer set the name in italic or
small capitals; the marker wraps the formatting, not the other way round:

```
[p:_Cicero_]      [p:*Malebranche*]      [p:Dr. *Swift*]
```

Two reasons: it keeps the semantic span whole regardless of how it was set, and
it keeps the printed appearance untouched.

**Possessives stay outside.** The clitic is grammar, not part of the name:

```
[p:Dr. _Barrow_]'s      [p:_Moses_]'s
```

The dictionary's possessive rule then accounts for the `'s` without an entry.

**Sentence punctuation stays outside.** A full stop that ends the sentence is not
part of the name, even when it abuts a regnal numeral that also wants one:

```
[p:HENRY IV].       [p:_Philip_ IV].
```

**Take the whole naming phrase, and nothing more.** Honorifics, titles of
courtesy, forenames, and regnal numerals belong inside; the article and the
surrounding grammar do not:

```
[p:Sir Thomas More]   [p:Mr. _Locke_]   [p:St. Paul]   [p:George Villiers]
```

An unbalanced formatting marker inside a span is a compile error, so a span that
would cut an italic in half has to be reshaped — see
[§8](#8-citations), where this comes up constantly.

## 4. People

`[p:…]` marks a **named individual**. Real or fictional, ancient or
contemporary, named in the text or named in a citation.

What goes in the span:

- the name itself, in whatever form the text gives it — forename, surname, both,
  or a familiar single name (`[p:Laud]`, `[p:Drake]`);
- honorifics and titles of address that form part of the naming phrase — `Sir`,
  `Lord`, `Dr.`, `Mr.`, `Mrs.`, `St.`, `Père`;
- regnal and generational numerals — `[p:HENRY IV]`, `[p:Philip II]`;
- a title of nobility used _as_ the name — `[p:Strafford]`, `[p:Bolingbroke]`.

What stays out: the definite article, the possessive clitic, sentence
punctuation, and any surrounding prose.

**A bare surname is still a person.** A chronicler cited by surname alone
(`[p:Rymer]`, `[p:Hoveden]`) is a person when the sentence is about the man and
part of a citation when it is heading a reference — see
[§8](#8-citations). If the same word is doing both, the citation wins, because
the citation span is the larger structure.

**`P.` before a name is often _Père_, not a page reference.** `_P. Malebranche_`
is `[p:_P. Malebranche_]`.

**Mythological and biblical names are people**: `[p:_Venus_]`, `[p:_Helen_]`,
`[p:_Moses_]`.

## 5. Places

`[l:…]` marks a **named place**: countries, regions, cities, rivers, mountains,
buildings with proper names, and the territories that give peers their titles.

```
[l:London]   [l:France]   [l:the Strand]   [l:Winchester]
```

Not places: peoples and demonyms ([§2](#2-what-is-never-marked-up)); compass
directions; and a place-name that has become a common noun (_china_, _madeira_).

## 6. Peerage, sees and metonymy

The hardest recurring judgement in the corpus, and it is worth stating the rule
carefully because it comes up thousands of times in Hume's _History_.

**A title naming a territory marks the territory.** The words _duke_, _earl_,
_king_, _bishop_ are ordinary nouns; the toponym inside the title is a place:

```
king of [l:France]        duke of [l:York]        bishop of [l:Canterbury]
earl of [l:Warwic]        duke of [l:Burgundy]
```

This falls out of the general rule — mark the whole naming phrase and nothing
more — applied to a phrase whose proper-noun part is a place name. It is also
the only reading that stays consistent between `king of [l:France]`, where
nobody would want to mark the whole phrase as a person, and `duke of [l:York]`,
which is the same construction.

**A bare toponym standing for the man is a person.** When the title has been
dropped and the place name alone denotes the peer, mark what it refers to:

```markit
[p:Essex] was executed the following year.
```

**A bare toponym standing for the place is a place**, and the surrounding words
usually settle it. Reliable signals that the sense is locative:

- a locative preposition immediately before — _at_, _in_, _from_, _near_,
  _towards_, _through_;
- a territory or title noun with _of_ — _the county of X_, _the duke of X_;
- motion _to_ a town or country.

**Where nothing settles it, leave it unmarked.** A residue of a few thousand
genuinely ambiguous occurrences in the _History_ — bare metonymic uses like "the
York party", of-datives like "the death of Essex", names in bare lists — is
deliberately unmarked, and is being worked through by hand. An unmarked
occurrence shows up in the coverage report, which is the right place for a
question to sit; a wrongly marked one does not show up anywhere.

**`house of X` is not marked**, because it swings between the dynasty, the
building, and the parliamentary chamber.

## 7. Organisations

`[o:…]` marks a **named institution**: the Royal Society, the East India
Company, a named college, a named religious order.

The corpus barely uses this marker yet, and that is a gap rather than a policy.
Where a named institution recurs, marking it is welcome. Where the phrase is
generic — _the church_, _the parliament_, _the university_ — it is words.

## 8. Citations

`[…]` marks a **reference to a cited work**. It renders with its brackets,
because that is usually how the reference was printed, and it is by a wide
margin the fiddliest marker in the language.

(Beware the one collision: `[...]`, three dots and nothing else, is the
illegible marker, not an empty citation.)

### What counts as a citation

A reference _to a text_: a title, an author-plus-locator, a book-and-chapter
siglum, a volume-and-page pointer, a cross-reference to another part of the same
work.

```markit
[De Rep. lib. v. p. 457.]
[*Diod. Sic.* lib. iii.]
[Metam. lib. v. l. 321.]
[VOL. I. _pag._ 285, 309, 323, &c.]
[Essay V.]
[NOTE \[YY\].]
```

The last shows the escape you will need occasionally: a literal bracket inside a
citation is `\[` / `\]`.

### The signal test

Capitalisation alone does not make a citation — that way "About 400,000 l.
Sterling." gets wrapped. A citation needs a **signal**:

- a structural siglum — `lib.`, `cap.`, `sect.`, `vol.`, `p.`, `pp.`, `pag.`,
  `l.`, `ibid.`, `id.`, `edit.`, `&c.`; or
- a work title; or
- a proper name in the citing position (an author or a chronicler heading a
  reference).

If the run has none of these, it is prose.

### Where the span starts and stops

**A footnote that is nothing but a citation is wrapped whole** — but the printed
note number, where it duplicates the block's own identifier, stays outside the
bracket:

```markit
{#n7}
7 [Diod. Sic. lib. i.]
```

**A citation embedded in a discursive footnote is bounded by sentence
punctuation on both sides.** The prose stays out:

```markit
[P. 252. M. West. p. 216.] ascribes this counsel to [p:Peter] Bishop of [l:Winchester].
```

**A parenthetical citation keeps its parentheses outside the brackets**, because
the parentheses are the printer's and the brackets are ours:

```markit
_the people_ ([_Exod_. 20. 18.])
([_vid. Corol._ 1. _Prop._ 57. _ibid._])
```

**A prose-bound name stays in the prose.** When the sentence is about the
author, only the locator is the citation:

```markit
told by [p:Tyrrel], [vol. ii. p. 145.] from the Chronicle
says _[p:Tacitus],_ [_ann_. lib. 4. cap. 27.]
```

**Never leave a dangling label at the edge of a span.** A span that ends on
`vol.` with its number outside is wrong; closers (`ibid.`, `id.`, `edit.`,
`&c.`) are the exception and may end a span.

### Italic straddling the boundary

The commonest hand-fix in the whole corpus. The printer's italic often runs
across the point where the citation begins or ends, and Markit rejects an
unbalanced formatting marker inside a span. The fix is to **split the italic at
the citation edge** — the marker positions move, the printed italics do not, and
both trees nest:

```
before   _Sterling. [p:Quintus Curtius] (lib. 5. cap_. 2.)
after    _Sterling. [p:Quintus Curtius]_ ([_lib. 5. cap_. 2.])
```

## 9. Foreign text

`$xx:…$` marks a run in another language, with an
[ISO 639](https://en.wikipedia.org/wiki/List_of_ISO_639_language_codes) code.
The codes in use are `la` (Latin), `fr` (French), `grc` (Ancient Greek) and `it`
(Italian); any valid code is legal.

```
$la:in foro humano$        $fr:Quand on le sçait c'est peu de chose$
$grc:Καλον των βλαβερων ουδεν$
```

Four conventions:

**Mark only the foreign words.** Surrounding English, and the punctuation that
belongs to the English sentence, stays outside:

```markit
contract, $la:in foro humano$, but not $la:in foro conscientiæ$, as divines…
```

**The language marker goes _inside_ the printer's delimiters.** Where the run
was set in italic or inside quotation marks, the formatting is the outer wrapper:

```markit
_$la:Rara temporum felicitas, ubi sentire, quæ velis$_
```

**Use the bare `$…$` only when you genuinely cannot tell the language.** It is
better than leaving a run unmarked, but a code is much better than neither.

**Latin and Italian are easy to confuse, and French and Italian easier still.**
Italian elisions (`l'`, `d'`) mimic French; a word that exists in two of the
three tells you nothing. When in doubt, read it.

Long foreign quotations set as their own paragraph are marked the same way, one
wrapper per paragraph — a marker cannot span a blank line, and cannot start
before a `>` block-quotation marker.

## 10. Greek

Greek is foreign text like any other and takes `$grc:…$`. Two things are
particular to it.

**Type it in Greek mode.** `{{…}}` transliterates from a Latin keyboard, so
`$grc:{{Kalon twn blaberwn ouden}}$` becomes `$grc:Καλον των βλαβερων ουδεν$`
when you format the file. The braces are an input method and disappear.

**Transcribe the accentuation the printer used.** Hand-press Greek is very often
set unaccented; do not supply breathings and accents he omitted. A loose
romanisation in a source transcription (`grafe` for γραφή) is a transcription
defect, and correcting it properly needs the page image — mark it uncertain
rather than guessing at the accents.

Where a source transcription has dropped the Greek altogether — TCP texts
routinely leave a `<gap>` or a `[greek text]` placeholder — the result is
`$grc:[...]$`, which is honest but not useful. If a sibling edition of the same
work prints the passage, take the reading from there
([editorial policy §6](./EDITORIAL.md#6-damage-illegibility-and-gaps)).

## 11. Multi-word units

A handful of lexical items are printed with a space in the middle but are one
word: the Latin tags (_a priori_, _a posteriori_, _ad infinitum_, _ipso facto_,
_in infinitum_, _à propos_) and a few archaic spellings (_to morrow_).

Join them with a non-breaking space so the corpus sees one token:

```
a~priori     ad~infinitum     to~morrow
```

The unit then carries a single dictionary entry, normalises and lemmatises like
any other word, and cannot break across a line — which is also correct
typography. A search for the phrase finds it; two separate tokens `a` and
`priori` would not.

Do not use `~` for ordinary two-word phrases. It is for items that a dictionary
would give a single headword.

## 12. Word disambiguation

Early spelling collapses distinctions modern spelling keeps. `[w:surface=word]`
records both — what is printed, and what it stands for:

```markit
but of very little use in [w:humane=human] Life
```

The surface renders; the disambiguated word never does, but it is what a search
finds.

**Use it only where the same printed form means two different things in
different places.** Ordinary archaic spellings — _vertue_, _seem'd_, _compleat_
— are handled once for the whole corpus by the dictionary and are never marked
in the text. Reaching for `[w:]` where a dictionary entry would do creates
per-occurrence labour for no gain.

**The surface must be exactly one token.** Join a multi-word unit first:
`[w:a~priori=a priori]`.

**An edition-wide default is cheaper than markup.** Where one reading of an
ambiguous surface dominates a whole edition, say so once in the edition's
metadata rather than marking every occurrence:

```
[metadata.dictionary]
lay = "lie"
```

Both forms are checked: every `[w:]` and every override must select a reading
the dictionary actually offers for that surface. Selecting the entry's own
default is not a no-op but a **pin** — it fixes this edition's meaning against a
future reordering of the register. See
[the dictionary on ambiguity](./DICTIONARY.md#ambiguity).

## 13. Asides

`#…#` marks a marginal or shoulder note — the printed aside in the outer margin,
common in seventeenth-century books. Put it at the point in the text it sits
beside:

```markit
How fallacious it is to judge of the nature of things,#_Counsell what._# by the ordinary use of words…
```

One trap: Markit treats an inline markup boundary as zero-width, so a note
abutting a word fuses the two into one token. Leave a space before the `#` when
the note follows a word directly.

An aside is preserved and rendered in the margin, but held out of the reading
text — a plain-prose rendering drops it.

## 14. A decision table

| What you are looking at                              | Marker                | Note                                       |
| ---------------------------------------------------- | --------------------- | ------------------------------------------ |
| A named individual                                   | `[p:…]`               | Honorifics in, possessive out              |
| A named place                                        | `[l:…]`               |                                            |
| A peer's territorial title                           | `duke of [l:York]`    | The toponym only                           |
| A bare toponym meaning the man                       | `[p:Essex]`           | Mark the referent                          |
| A bare toponym you cannot resolve                    | _nothing_             | Leave it for the coverage report           |
| A people or demonym                                  | _nothing_             | It is a dictionary word                    |
| A named institution                                  | `[o:…]`               |                                            |
| A reference to a text                                | `[…]`                 | Needs a signal, not just a capital         |
| A footnote that is only a reference                  | `[…]` round the whole | Printed note number outside                |
| A reference inside discursive prose                  | `[…]`                 | Sentence punctuation both sides            |
| A run in another language                            | `$xx:…$`              | Inside the printer's italic or quotes      |
| Greek                                                | `$grc:…$`             | Type it with `{{…}}`                       |
| A Latin tag printed with a space                     | `a~priori`            | One token, one entry                       |
| One printed form, two modern words                   | `[w:humane=human]`    | Only where genuinely ambiguous             |
| An archaic spelling                                  | _nothing_             | The dictionary handles it                  |
| A marginal note                                      | `#…#`                 | Leave a space before it                    |
