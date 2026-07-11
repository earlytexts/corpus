# The Dictionary

The dictionary (`data/dictionary/`) is the corpus's curated register of **surface forms**: every word as it is printed (lower-cased). It exists both to _eliminate noise_ from search and statistics downstream, and to _identify typographical errors_ in the transcribed texts.

There are two kinds of noise, and the dictionary addresses both:

1. **Spelling noise**: the same word printed in different ways, e.g. "virtue" / "vertue", "seemed" / "seem'd". The dictionary _normalises_ these to a single canonical spelling.
2. **Grammatical noise**: the same word in different grammatical forms, e.g. "walk" / "walks" / "walked" / "walking". The dictionary _lemmatises_ these onto a single form, the headword you would look it up under in an ordinary dictionary.

Lemmatisation builds on top of normalisation, so the dictionary is a two-level register: every surface has a canonical spelling, and every canonical spelling has a lemma.

## What's in Scope

The dictionary aspires to be a _complete register_ of every English dictionary surface form in the corpus, not a list of exceptions. This enables the compositor to treat a surface _without_ an entry as something unseen, and potentially a typographical error. While the register is still being filled in, however, missing coverage is reported rather than treated as an error.

The dictionary does _not_ cover foreign text (`$...$` Markit markup), proper nouns (enclosed in `[p:]` / `[l:]` / `[o:]` markup), citations (`[…]` markup), or numerals (Roman or Arabic). Numerals are excluded mechanically.

### The Accounting Rule

Another way of stating the above:

> Every token in every text is accounted for by **at least one** of: a dictionary entry for its folded surface; enclosure in person (`[p:]`) / place (`[l:]`) / org (`[o:]`) / citation (`[…]`) / language (`$…$`) markup; or a mechanical class (contains digits, or reads as a strict roman numeral).

The rule is one pure function (`accountTokens` in `src/dictionary.ts`, over the word identity defined above). It is simultaneously the corpus's coverage check and the compositor's live squiggle engine.

## What Counts as a Word

The unit the register is built from is the **token**, defined once in `src/words.ts` and shared by every consumer (the compositor, the computer). A token is a run of letters, digits, and apostrophes containing at least one letter or digit; leading, internal, and trailing apostrophes are all part of it (`'tis`, `o'clock`, `lookin'`). Two further characters _join_ what would otherwise be separate tokens — an **internal period** (`i.e`) and a **non-breaking space** (`a~priori`, `to~morrow`). **Hyphens, by contrast, split**: `self-love` is two tokens, `self` and `love`, so the register never holds a hyphenated key and each part must have its own entry. Every other character separates.

A token becomes a dictionary **surface** by _folding_ — lower-casing, with the sole exception of the bare pronoun "I" (see [Normalisation](#normalisation)). Two classes of token are then held out of the register mechanically, never expected to have an entry: any token containing a digit, and any token that reads as a strict roman numeral.

Roman-numeral exclusion is deliberately blunt, and it has one accepted cost: the occasional short word that also parses as a roman numeral (`mix`, say) is swallowed by the mechanical class, and therefore not shown as unseen in the compositor before it is entered into the dictionary. Once entered, however, it is counted as an instance of the word as normal, not as a roman numeral.

### Multi-Word Units and Abbreviations

A handful of lexical items are printed with internal spacing or punctuation that would ordinarily split them. Three cases, resolved so that each such item can carry a single entry:

- **Anglicised single-token words** — `etc`, `viz`, `via`, `alias` — need nothing special. The trailing period of `etc.` is ordinary punctuation, already stripped, so the token is just a word; include it as its own lemma where it earns a place. Which anglicised words to admit at all is an editorial judgement, not a mechanical rule.
- **Fixed multi-word units** — Latin tags like `a priori` and `ab initio`, and archaic spellings like `to morrow` — are joined by the **non-breaking space** (`~` in Markit: `a~priori`). A `~`-joined run is one surface with one entry — an own lemma (`"a priori"`) or a cross-reference (`"to morrow": "tomorrow"`) — so the unit normalises, lemmatises, and counts like any other word, and the editor marks it once in the source rather than once per occurrence. (The `~` is also correct typography: the unit should not break across a line.)
- **Internal-dot abbreviations** — `i.e`, `e.g`, and initialisms such as `N.B` — are joined by the **internal-period** rule: a period counts as part of the word when it falls between a letter/digit and a letter. So `i.e.` yields the surface `i.e` (the trailing period, followed by a space, drops), which is then a single surface with its own lemma.

The internal-period rule has a deliberate second effect. A period _without_ a following space — a missing sentence break, `end.The` — also joins into a single token, one that has no entry and so is flagged as a probable typographical error.

## Normalisation

Case normalisation is handled mechanically: every surface is folded to lower-case, with the sole exception of the pronoun "I" (left uppercase to distinguish it from the Roman numeral "i").

Spelling normalisation is handled by the dictionary: every surface has a canonical spelling, which may differ from how it is printed. For example, "vertue" and "virtue" are both printed in the corpus, but the dictionary normalises them to the canonical spelling "virtue".

Normalisation also handles contractions: "'tis" is normalised to "it is", "we'll" to "we will", and so on. Some surfaces therefore expand to multiple words.

### Principles of Normalisation

What counts as a variant spelling of the same word is presumed to be obvious and uncontroversial in almost every case. There are just two potential questions, decided here:

- Archaic spellings that are arguably distinct forms (e.g. "thou", "thy", "hath", "doth") _are_ normalised to their modern equivalents ("you", "your", "has", "does"). This is a debatable but pragmatic choice. For the most part, we are assuming scholars will not be interested in this variety; if they are, they can operate on the level of the surface without normalisation.
- Sometimes it may be unclear _which_ of two spellings should be the canonical one (e.g. "enquiry" vs "inquiry", "surprise" vs "surprize"). It makes absolutely no difference downstream - what matters is simply the equivalence class. But to prevent any wasted time agonising over the decision, a simple mechanical rule is applied, and enforced by automated tests: the canonical spelling is whichever one occurs most frequently in the corpus. In the unlikely event of a tie, the alphabetically first spelling is canonical (so the rule is fully deterministic, and a test has a single right answer).

(At some point, it might be considered preferable to weight the frequency counts chronologically, preferring the more modern spelling. But that is not the case for now.)

## Lemmatisation

The basic aim of lemmatisation is straightforward, and easily conveyed by some examples:

- "walk" (lemma); "walks", "walked", "walking" (different forms)
- "virtue" (lemma); "virtues" (different form)
- "mouse" (lemma); "mice" (different form)
- "good" (lemma); "better", "best" (different forms)
- "I" (lemma); "me", "my", "mine" (different forms)
- "you" (lemma); "your", "yours" (different forms)

But the devil is in the details: various complications and difficult cases arise, and the dictionary necessarily has to make judgements about all of these. The intention here is to document some clear principles that decide all these cases up front, and to choose deterministic principles wherever possible, so that they can be enforced programmatically.

### Principles of Lemmatisation

What collapses onto a shared lemma:

- **Plurals onto singulars**:
  - _virtues_ → **virtue**
  - _men_ → **man**
  - _children_ → **child**
  - _data_ → **datum**
  - _indices_ → **index**
- **Verb forms onto the plain form**:
  - _increases_, _increased_, _increasing_ → **increase**
  - _makes_, _made_, _making_ → **make**
  - _am_, _is_, _was_, _were_, _been_, _being_ → **be**
- **Modals onto the plain form**:
  - _can_, _could_ → **can**
  - _will_, _would_ → **will**
  - _shall_, _should_ → **shall**
  - _may_, _might_ → **may**
- **Comparisons onto the plain adjective or adverb** (_including irregular ones_):
  - _great_, _greater_, _greatest_ → **great**
  - _good_, _better_, _best_ → **good**
- **The different forms of a pronoun onto one headword**:
  - _me_, _my_, _mine_ → **I**
  - _him_, _his_ → **he**
  - _us_, _our_ → **we**
  - _them_, _their_ → **they**
- **Possessives (genitives) onto the base noun**:
  - _king's_, _kings'_ → **king**
  - _man's_, _men's_ → **man**

  (The apostrophe is part of the token, so `king's` is a surface in its own right; it lemmatises to `king`. The bare possessive `its` is a special case — see [Ambiguity](#ambiguity).)

What stays apart, with its own lemma:

- **Adverbs made from adjectives** (the "-ly" words): _quick_ and _quickly_ are two words, two lemmas. Likewise _true_ / _truly_.
- **Reflexive pronouns**: _himself_, _herself_, _themselves_ are their own headwords — **not** forms of _he_, _she_, _they_. They are compounds (_him_ + _self_) and behave as distinct words, and a reader searching for "he" would be surprised to be shown every "himself".
- **Ordinals and cardinals**: _first_ is not a form of _one_, _second_ not a form of _two_. Each keeps its own lemma.
- **Periphrastic comparison**: _more_ and _most_ are ordinary words in their own right, each its own lemma — they are not forms of anything.
- **Plurale tantum nouns**: _scissors_, _trousers_, _tidings_, _thanks_ are all plural-only words, and each keeps its own lemma. The singulars (_scissor_, _trouser_, _tiding_, _thank_) are either non-existent or belong to different lemmas (e.g. _thank_ the verb).

Two other notes worth stating explicitly:

- **A word that shifts between noun and verb keeps one lemma.** Because a lemma is a spelling and we do not record part of speech, _love_ the noun and _love_ the verb are the same lemma.
- **Words that are lexicalised keep their own lemma even if built from another.** _People_ is treated as its own headword, not as a plural of _person_; _government_ as its own word, not merely a form of _govern_.

## Ambiguity

The first complication is that a surface may be ambiguous: it may correspond to more than one lemma. For example, "lay" is the present tense of "lay" and the past tense of "lie". The dictionary affords the ability to record this ambiguity: the mapping from surface to lemma is many-to-many, not many-to-one. It is a further question _when to record ambiguity_ - see below.

Ambiguity is limited to lemmatisation only: the ambiguity inherent in the lemma "lie" itself (to recline vs to tell an untruth) is not recorded.

Ambiguity is not confined to lemma pairs of the same shape. The bare `its`, for example, is ambiguous between the possessive (default, lemma **it**) and the apostrophe-less contraction of "it is" — so its entry carries two readings, `["=it", "it is"]`, with the possessive first. (`it's`, with the apostrophe, is an unambiguous contraction of "it is".)

Downstream, an ambiguous surface is counted as an instance of the _first_ lemma in its dictionary entry by default. The dictionary _should_ therefore list the most common lemma first — but this is an advisory convention, not a checked invariant: the true reading distribution of an unmarked surface is not mechanically knowable, so no test enforces it.

The default for an edition (or section within an edition) can be overridden by `[metadata.dictionary]` markup in the edition's metadata:

```
[metadata.dictionary]
lay = "lie"
```

And the reading for an individual occurrence can be overridden by `[w:surface=value]` markup on that occurrence:

```
She [w:lay=lie] down on the bed.
```

An override may also select the entry's _own_ default reading. That is not a no-op but a **pin**: it fixes the edition's meaning against a future reordering of the register's readings, so an edition that has been checked stays correct even if the corpus-wide default later flips.

### Principles of Ambiguity

When a surface is marked as ambiguous in the dictionary, that _creates_ potential markup labour for editors (to check that the default is the most common, and to mark up the exceptions). That work never _has_ to be done - without it, downstream tools will simply assume the default reading everywhere. But merely creating the possibility is something not to be done lightly.

This leads to the core principle of ambiguity in this corpus: **assume that a surface is unambiguous unless there is clear evidence to the contrary in the corpus itself**. More precisely:

> A surface is marked as ambiguous if and only if there is a _sibling_ form in the corpus that could only have been produced by the other lemma.

For example, "understanding" is ambiguous because "understandings" exists in the corpus, and "understandings" could only have been produced by the noun lemma "understanding", not the verb lemma "understand". But "walkings" does not exist in the corpus, so "walking" is unambiguous: it is only a form of the verb lemma "walk".

Similarly, "learned" is ambiguous because "learnedly" exists in the corpus, and "learnedly" could only have been produced by the adjective lemma "learned", not the verb lemma "learn". But neither "agedly" nor "agedness" exist in the corpus, so "aged" is unambiguous: it is only a form of the verb lemma "age".

One more example: "lower" is ambiguous because "lowered" exists in the corpus, and "lowered" could only have been produced by the verb lemma "lower", not the adjective lemma "low". But "longered" does not exist in the corpus, so "longer" is unambiguous: it is only the comparative form of the adjective lemma "long".

#### What the tests enforce

"Could only have been produced by the other lemma" is not mechanically decidable in general — it needs a morphology. What _is_ mechanical is a closed set of **three inflectional patterns**, and those are the only ones the tests enforce (see `ambiguityEvidence`). For a surface treated as a form of a base lemma:

- an **`-ing`** form (noun/participle, e.g. _understanding_) is ambiguous **iff** its plural **`-ings`** is attested — only a noun pluralises;
- an **`-ed`** form (adjective/past, e.g. _learned_) is ambiguous **iff** **`-edness`** or **`-edly`** is attested — only an adjective feeds those;
- an **`-er`/`-est`** form (comparative-or-superlative/verb, e.g. _lower_, _best_) is ambiguous **iff** the verb inflection **`-ered`/`-ering`** (resp. **`-ested`/`-esting`**) is attested — only a verb takes those. (The `-er` half is the common case — _lower_/_lowered_, _better_/_bettered_; the `-est` half earns its keep on _best_, the superlative of _good_ that is also the verb _to best_: _bested_, _besting_.)

Within these three patterns the rule is an enforced biconditional: the surface must carry its own reading if and only if the evidence form is present in the register. Add the reading without the evidence, or omit it with the evidence present, and a test fails.

All _other_ ambiguities — the irregular and suppletive cases such as _lay_/_lie_ or the possessive/contraction _its_ — obey the same underlying principle ("mark ambiguous only on clear corpus evidence") but rest on editorial judgement, because no surface-shape rule can license them. They are not machine-checkable, only the disambiguation _markup_ over them is (that every override and `[w:]` selects a reading the entry actually offers — see [Automatic Validation](#automatic-validation)).

## The On-Disk Format

The dictionary is stored in JSON shards keyed by the surface's first letter (ignoring any leading non-letter), with `other.json` for anything outside a–z. Keys are sorted, one entry per line.

There are three basic kinds of entry:

```jsonc
{
  "vertues": "virtues",  // a surface that is normalised to a different spelling
  "virtues": "=virtue",  // a surface that is lemmatised to a different lemma
  "virtue": null,        // a surface that is both normalised and lemmatised to itself
}
```

A cross-reference may list more than one spelling, which is how a **contraction** is written — each spelling resolves to a lemma through its own entry:

```jsonc
{
  "'tis": "it is",   // a contraction: a cross-reference to two spellings
  "it": null,        // ...each of which has its own entry
  "is": "=be",
}
```

Every entry must "bottom out" in a `null` reading. Surfaces that require normalisation are never lemmatised directly; they are cross-referenced to their canonical spelling, which then has its own entry that states the lemma. This ensures that every lemma is stated in exactly one place, and that the register is closed under derivation.

Ambiguous surfaces are represented as arrays, with the default reading first:

```jsonc
{
  "lay": [null, "=lie"],    // one spelling, two lemmas
  "then": [null, "than"],   // spelling-ambiguous; default first
}
```

## The Wire Format

The compiler emits the dictionary _expanded_ as `catalogue/dictionary.json`, so read-side consumers (the computer, and through it the web sites and companion) never parse the on-disk micro-syntax or chase a cross-reference. Every fact the shards state once, by reference, is resolved here into explicit `(spelling, lemma)` pairs.

The shape mirrors the three levels of the register. Each surface maps to an ordered list of **readings** (default first); each reading is a list of **words** (more than one only for a contraction); each word states its modern `spelling` and its `lemma` outright:

```json
{
  "vertues": { "readings": [[{ "spelling": "virtues", "lemma": "virtue" }]] },
  "virtues": { "readings": [[{ "spelling": "virtues", "lemma": "virtue" }]] },
  "virtue":  { "readings": [[{ "spelling": "virtue",  "lemma": "virtue" }]] },
  "lay": {
    "readings": [
      [{ "spelling": "lay", "lemma": "lay" }],
      [{ "spelling": "lay", "lemma": "lie" }]
    ]
  },
  "'tis": {
    "readings": [[
      { "spelling": "it", "lemma": "it" },
      { "spelling": "is", "lemma": "be" }
    ]]
  }
}
```

The expansion is total. A normalised surface carries the _canonical_ spelling in every word (so "vertues" reads as "virtues", never "vertue"), and lemma ambiguity that belongs to the modern word is inherited through the cross-reference (if "virtues" were itself ambiguous, "vertues" would show both readings too). Nothing in the wire format is left to derive: a consumer reads a token's status by folding it, looking up the entry, and taking the reading selected by the precedence chain (`[w:]` markup → edition override → the default reading).

## Automatic Validation

Automated tests enforce various properties of the dictionary and its relationship to the corpus:

- **Internal consistency:** The register is well-formed and closed under derivation. Keys are folded words, unique across shards, sorted, and each in the shard its first letter dictates; every value is valid entry micro-syntax in minimal canonical form (an array means two or more readings; a reading of the surface itself is written `null`; a cross-reference lists spellings only). Every entry bottoms out in a `null` reading: each cross-referenced spelling has an entry with an identity reading (so a lemma derives in a single step — no respelling chains or cycles — and a typo in a value dangles rather than passing silently), and each stated lemma has an entry with a `null` reading (a lemma is a citation form). Within an entry, the expanded readings are distinct, and every non-default reading is uniquely selectable by its spelling or lemma string.
- **Consistency with the corpus:** The register's orthography is drawn from the texts, so every surface — and every cross-referenced (canonical) spelling — must occur in the corpus. The lemma is the one exception: it is a grammatical citation form, not a spelling, so an irregular base form that is never printed (`datum` for `data`, `ox` for `oxen`) is allowed. (See `attestationViolations` in `src/dictionary.ts`.)
- **Canonical spelling:** Within a normalisation class — a canonical spelling and the surfaces that cross-reference it — the canonical one must be the most frequent in the corpus, ties broken alphabetically (see [Principles of Normalisation](#principles-of-normalisation)). This is the mechanical, deterministic tie-break that keeps the choice of canonical spelling from being agonised over. (See `canonicalSpellingViolations` in `src/dictionary.ts`.)
- **Ambiguity:** Two checks. First, the systematic-ambiguity rule (see [Principles of Ambiguity](#principles-of-ambiguity)): a surface matching one of the three inflectional patterns, and treated as a form of a base lemma, carries its own reading _if and only if_ its licensing evidence form is attested in the register. Second, disambiguation within the corpus texts: every `[metadata.dictionary]` override and every `[w:]` markup must select exactly one reading that the dictionary provides for that surface.
- **Coverage:** Tests report the percentage of tokens in each work, and in the corpus as a whole, that are accounted for by the dictionary. This is reported as a warning, not an error, until the dictionary is complete.
