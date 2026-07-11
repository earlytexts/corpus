# Reference data

External reference data the corpus validates against but does not itself author.
Unlike everything else under `data/`, these files are not corpus content; they
are a pinned, regenerable authority. They are read only by validation (write
side) and never emitted to the catalogue, so they add nothing to the wire
format the computer consumes.

## `words.txt`

The modern English reference word list used by the **canonical-spelling** rule
(`canonicalSpellingViolations`, `src/dictionary/expand.ts`): the member of a
normalisation class that appears here is the canonical spelling. See
DICTIONARY.md, _Principles of Normalisation_.

One lower-cased spelling per line, sorted, deduplicated. Generated from
[SCOWL](https://wordlist.aspell.net) (the English Speller Database) via
`app.aspell.net/create`, then folded to lower case and stripped of the
generator's header.

Pinned parameters — **British spelling (`-ise`), size 60, variant level 1**:

```sh
curl "http://app.aspell.net/create?max_size=60&spelling=GBs&diacritic=strip&download=wordlist&encoding=utf-8&format=inline" \
  | sed '1,/^---$/d' \
  | tr '[:upper:]' '[:lower:]' \
  | sort -u > words.txt
```

Size 60 is chosen deliberately: it is wide enough to contain every ordinary
modern spelling in the corpus, but tight enough to _exclude_ archaic literary
forms (size 70+ admits `compleat`, which would then wrongly beat `complete`).
If the corpus grows a genuine modern word this list omits, prefer pinning it in
`canonical-exceptions.json` over widening the size — a wider list re-admits
archaic forms.

SCOWL is Copyright 2000–2026 Kevin Atkinson and is redistributable; the full
notice ships with the generator output (stripped here for size).

## `canonical-exceptions.json`

A JSON array of spellings pinned as their class's canonical, for the two cases
the word list cannot resolve: a class no member of which is in the list, and a
class the list resolves to the wrong member. A pin overrides the list. Empty
when nothing needs pinning.
