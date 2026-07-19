/**
 * The dictionary: word segmentation and folding (../src/dictionary/words.ts),
 * the entry micro-syntax and shard files (../src/dictionary/shards.ts),
 * expansion (lemma derivation through cross-references,
 * ../src/dictionary/expand.ts), the accounting rule
 * (../src/validation/account.ts), the dictionary validation
 * rules and coverage report (../src/validation/rules.ts), and the catalogue
 * emission of the expanded dictionary. Fixtures are in-memory corpora
 * (./harness.ts); no files on disk.
 */

import { expect } from "@std/expect";
import { test } from "@std/testing/bdd";
import { type Block, compile } from "@earlytexts/markit";
import {
  blockTokens,
  exemptionOf,
  fold,
  isRomanNumeral,
  isWord,
  possessiveBase,
} from "../src/dictionary/words.ts";
import type {
  Dictionary,
  Entry,
  RawDictionary,
  RawEntry,
} from "../src/dictionary/types.ts";
import { accountTokens, coverageOf } from "../src/validation/account.ts";
import {
  multiWordSurfaces,
  overridesOf,
  resolveReading,
  selectReading,
} from "../src/dictionary/resolve.ts";
import {
  parseDictionary,
  parseEntry,
  readDictionaryShards,
  serializeEntry,
  shardDictionary,
  shardOf,
} from "../src/dictionary/shards.ts";
import {
  canonicalSpellingViolations,
  dictionaryViolations,
  expandDictionary,
} from "../src/dictionary/expand.ts";
import {
  dictionaryCoverage,
  loadCorpus,
  type RuleContext,
  rules,
  violationText,
} from "../src/validation/rules.ts";
import { corpus, CORPUS_ROOT, memoryCorpus } from "./harness.ts";
import { buildCatalogue } from "../src/catalogue/compile.ts";
import {
  writeCatalogue,
  writeCatalogueDictionary,
} from "../src/build/write.ts";
import {
  catalogueReader,
  loadCatalogue,
} from "../src/catalogue/deserialize.ts";
import { normalizePath } from "../src/fs/paths.ts";
import type { CorpusFsWrite } from "../src/fs/ports.ts";

/* -------------------------------- words -------------------------------- */

test('words: folding lower-cases every surface but the pronoun "I"', () => {
  expect(fold("THE")).toBe("the");
  expect(fold("Œconomy")).toBe("œconomy");
  expect(fold("'Tis")).toBe("'tis");
  // "I" is the one English word whose capital is lexical, not positional:
  // there is no lower-case pronoun to fold it onto, and lower-casing it would
  // collide with the roman numeral "i". So the bare token "I" is preserved.
  expect(fold("I")).toBe("I");
  expect(fold("i")).toBe("i"); // lower-case i is always the numeral
  expect(fold("I'll")).toBe("i'll"); // the exception is the bare token only
});

test("words: a word is one letters-and-apostrophes token", () => {
  expect(isWord("virtue")).toBe(true);
  expect(isWord("'tis")).toBe(true);
  expect(isWord("lookin'")).toBe(true);
  expect(isWord("œconomy")).toBe(true);
  // Beyond a lone word: a period before a letter, and internal spaces (a fixed
  // multi-word unit registered as one surface — a key/lemma, never a
  // cross-reference).
  expect(isWord("i.e")).toBe(true);
  expect(isWord("a priori")).toBe(true);
  expect(isWord("to morrow")).toBe(true);
  expect(isWord("i.e.")).toBe(false); // a trailing period is not internal
  expect(isWord("")).toBe(false);
  expect(isWord("1st")).toBe(false); // digits are mechanical, not words
  expect(isWord("x=y")).toBe(false);
  expect(isWord("fine-day")).toBe(false);
});

test("words: strict roman numerals", () => {
  expect(isRomanNumeral("MDCCXL")).toBe(true);
  expect(isRomanNumeral("xiv")).toBe(true);
  expect(isRomanNumeral("i")).toBe(true);
  expect(isRomanNumeral("I")).toBe(true); // detected independently of surface folding
  expect(isRomanNumeral("civil")).toBe(false);
  expect(isRomanNumeral("")).toBe(false);
  expect(isRomanNumeral("1739")).toBe(false);
});

test("words: the possessive base strips a trailing clitic", () => {
  expect(possessiveBase("bishop's")).toBe("bishop");
  expect(possessiveBase("bishop’s")).toBe("bishop"); // curly apostrophe too
  expect(possessiveBase("it's")).toBe("it");
  // Not a possessive: no `'s`, a bare plural, or nothing left once stripped.
  expect(possessiveBase("bishop")).toBeUndefined();
  expect(possessiveBase("bishops")).toBeUndefined();
  expect(possessiveBase("lookin'")).toBeUndefined();
  expect(possessiveBase("'s")).toBeUndefined();
});

/** The first block of a compiled one-block document. */
const block = (line: string): Block => {
  const { document: doc, errors } = compile(`# t\n\n{#1}\n${line}\n`);
  expect(errors).toEqual([]);
  return doc.blocks[0];
};

test("words: exemptionOf reads the nearest exempting markup off a token's context", () => {
  const tokens = blockTokens(block(
    '\'Tis _writ_ by [p:*Will* Shake] in ["A Treatise"] at $la:cogito ergo$ on MDCCXL.',
  ));
  expect(
    tokens.map((t) =>
      `${t.text}${exemptionOf(t) === undefined ? "" : `/${exemptionOf(t)}`}`
    ),
  ).toEqual([
    "'Tis",
    "writ",
    "by",
    "Will/person",
    "Shake/person",
    "in",
    "A/citation",
    "Treatise/citation",
    "at",
    "cogito/language",
    "ergo/language",
    "on",
    "MDCCXL",
  ]);
});

test("words: blockTokens segments with markit's tokenizer — `~` fuses, [w:] carries its value", () => {
  const tokens = blockTokens(block(
    "reasoning a~priori, [w:then=than] and [w:to~morrow=tomorrow].",
  ));
  expect(
    tokens.map((t) => `${t.text}${t.word === undefined ? "" : `=${t.word}`}`),
  )
    .toEqual([
      "reasoning",
      "a priori", // the `~`-fused unit is one token, its space plain
      "then=than",
      "and",
      "to morrow=tomorrow", // fused inside the [w:] surface too
    ]);
});

test("words: blockTokens unites the two versions — a deleted word is still a token", () => {
  const tokens = blockTokens(block(
    "it was a [-mistak-][+mistake+], plainly [-writ-] here.",
  ));
  // Every edited token, then the original's surplus (the deleted words).
  expect(tokens.map((t) => t.text)).toEqual([
    "it",
    "was",
    "a",
    "mistake",
    "plainly",
    "here",
    "mistak",
    "writ",
  ]);
  // Without editorial markup the two versions are one stream: no duplicates.
  expect(blockTokens(block("plain words here.")).map((t) => t.text)).toEqual([
    "plain",
    "words",
    "here",
  ]);
});

test("words: blockTokens descends into quotes, lists, and tables", () => {
  const { document: doc, errors } = compile(
    "# t\n\n{#1}\n> Quoted words.\n\n{#2}\n- one item\n- two\n\n{#3}\n| a cell | more |\n",
  );
  expect(errors).toEqual([]);
  const texts = doc.blocks.map((b) => blockTokens(b).map((t) => t.text));
  expect(texts).toEqual([
    ["Quoted", "words"],
    ["one", "item", "two"],
    ["a", "cell", "more"],
  ]);
});

test("dictionary: multiWordSurfaces are the register keys with a space", () => {
  expect(
    multiWordSurfaces({ "a priori": 0, "to morrow": 0, priori: 0, the: 0 }),
  ).toEqual(new Set(["a priori", "to morrow"]));
});

/* ----------------------------- micro-syntax ---------------------------- */

/** An identity reading: the surface is a modern word with this lemma. */
const id = (lemma: string) => ({ lemma });

/** A cross-reference reading: see those entries for the lemmas. */
const see = (...spellings: string[]) => ({ spellings });

const raw = (...readings: RawEntry["readings"]): RawEntry => ({ readings });

/** An expanded dictionary word, defaulting the lemma to the spelling. */
const w = (spelling: string, lemma = spelling) => ({ spelling, lemma });

const entry = (...readings: Entry["readings"]): Entry => ({ readings });

/** The worked examples from DICTIONARY.md's on-disk format, all real seed
 * entries. */
const examples: [string, unknown, RawEntry][] = [
  ["the", null, raw(id("the"))],
  ["increases", "=increase", raw(id("increase"))],
  ["vertue", "virtue", raw(see("virtue"))],
  ["vertues", "virtues", raw(see("virtues"))],
  ["'tis", "it is", raw(see("it", "is"))],
  ["a priori", null, raw(id("a priori"))], // a fixed multi-word unit, one key
  ["to morrow", "tomorrow", raw(see("tomorrow"))],
  ["then", [null, "than"], raw(id("then"), see("than"))],
  ["lay", [null, "=lie"], raw(id("lay"), id("lie"))],
  ["borne", ["=bear", "born"], raw(id("bear"), see("born"))],
];

test("dictionary: the micro-syntax parses and round-trips", () => {
  for (const [surface, value, expected] of examples) {
    expect(parseEntry(surface, value)).toEqual(expected);
    expect(serializeEntry(surface, expected)).toEqual(value);
  }
});

test("dictionary: malformed entry values are rejected", () => {
  const error = (surface: string, value: unknown): string => {
    const result = parseEntry(surface, value);
    expect(result).toHaveProperty("error");
    return (result as { error: string }).error;
  };
  expect(error("x", [])).toContain("ambiguous");
  expect(error("x", [null])).toContain("ambiguous"); // one reading is not ambiguous
  expect(error("x", 7)).toContain("null or a string");
  expect(error("x", [null, 7])).toContain("null or a string");
  expect(error("x", [null, ["y"]])).toContain("null or a string");
  expect(error("x", "")).toContain("empty");
  expect(error("x", "a  b")).toContain("single spaces");
  // The retired combined form: lemmas are never stated inline in a
  // cross-reference — they live on the spelling's own entry.
  expect(error("vertues", "virtues=virtue")).toContain("spellings only");
  expect(error("x", "it =be")).toContain("spellings only");
  // A hyphen is not part of a word, so it never reaches a lemma or spelling.
  expect(error("x", "=self-love")).toContain("not a word");
  expect(error("x", "=")).toContain("not a word");
  expect(error("x", "1st")).toContain("not a word");
  expect(error("x", "x")).toContain("null"); // the surface itself is null
});

/* ------------------------------ expansion ------------------------------ */

test("dictionary: expansion derives lemmas through cross-references", () => {
  const dictionary: RawDictionary = {
    "'tis": raw(see("it", "is")),
    is: raw(id("be")),
    it: raw(id("it")),
    vertues: raw(see("virtues")),
    virtue: raw(id("virtue")),
    virtues: raw(id("virtue")),
  };
  expect(expandDictionary(dictionary)).toEqual({
    // A contraction: each word's lemma comes from that word's own entry.
    "'tis": entry([w("it"), w("is", "be")]),
    is: entry([w("is", "be")]),
    it: entry([w("it")]),
    // The lemma of "vertues" is stated nowhere near it: it derives via the
    // cross-referenced "virtues".
    vertues: entry([w("virtues", "virtue")]),
    virtue: entry([w("virtue")]),
    virtues: entry([w("virtues", "virtue")]),
  });
});

test("dictionary: lemma ambiguity inherits through a cross-reference", () => {
  // "laie" respells to "lay"; "lay" is lemma-ambiguous; so "laie" is too —
  // in the target's order, so unmarked occurrences agree with unmarked "lay".
  const dictionary: RawDictionary = {
    laie: raw(see("lay")),
    lay: raw(id("lay"), id("lie")),
    lie: raw(id("lie")),
  };
  expect(expandDictionary(dictionary).laie).toEqual(
    entry([w("lay")], [w("lay", "lie")]),
  );
});

test("dictionary: multi-word cross-references expand as a cross product", () => {
  const dictionary: RawDictionary = {
    a: raw(id("a"), id("q")),
    b: raw(id("b")),
    q: raw(id("q")),
    x: raw(see("a", "b")),
  };
  // The leftmost word is most significant; each word's lemmas keep their
  // entry's order.
  expect(expandDictionary(dictionary).x).toEqual(
    entry([w("a"), w("b")], [w("a", "q"), w("b")]),
  );
});

test("dictionary: a multi-word key's identity reading is one word per part", () => {
  // `null` on an n-word surface expands to n identity words (a search for
  // either half finds the unit); an ambiguous multi-word entry pairs a
  // one-word respelling against the literal two-word reading.
  const dictionary: RawDictionary = {
    "a priori": raw(id("a priori")),
    "my self": raw(see("myself"), id("my self")),
    myself: raw(id("myself")),
    my: raw(id("my")),
    self: raw(id("self")),
  };
  const expanded = expandDictionary(dictionary);
  expect(expanded["a priori"]).toEqual(entry([w("a"), w("priori")]));
  expect(expanded["my self"]).toEqual(
    entry([w("myself")], [w("my"), w("self")]),
  );
});

test("dictionary: expansion is best-effort where the register dangles", () => {
  const dictionary: RawDictionary = {
    olde: raw(see("vertue")), // target has no identity reading
    vertue: raw(see("virtue")), // target has no entry at all
  };
  // Both fall back to lemma = spelling; dictionaryViolations flags them.
  expect(expandDictionary(dictionary)).toEqual({
    olde: entry([w("vertue")]),
    vertue: entry([w("virtue")]),
  });
});

/* ------------------------- register violations ------------------------- */

test("dictionary: a closed register has no violations", () => {
  expect(dictionaryViolations({
    "'tis": raw(see("it", "is")),
    be: raw(id("be")),
    is: raw(id("be")),
    it: raw(id("it")),
    laie: raw(see("lay")),
    lay: raw(id("lay"), id("lie")),
    lie: raw(id("lie")),
    vertue: raw(see("virtue")),
    virtue: raw(id("virtue")),
  })).toEqual([]);
});

test("dictionary: cross-references resolve in one step or dangle", () => {
  // A missing target — or just a typo — is caught.
  expect(dictionaryViolations({ vertue: raw(see("virtue")) })).toEqual([
    { key: "vertue", message: '"virtue" has no entry' },
  ]);
  // A target that is itself only a cross-reference cannot supply a lemma:
  // normalisation is single-step, so chains (and cycles) are violations.
  expect(dictionaryViolations({
    olde: raw(see("vertue")),
    vertue: raw(see("virtue")),
    virtue: raw(id("virtue")),
  })).toEqual([{
    key: "olde",
    message:
      'the entry for "vertue" has no identity reading (nothing to derive a lemma from)',
  }]);
  expect(
    dictionaryViolations({
      vertue: raw(see("virtue")),
      virtue: raw(see("vertue")),
    }).map(({ key }) => key),
  ).toEqual(["vertue", "virtue"]);
});

test("dictionary: stated lemmas are registered citation forms", () => {
  // A lemma dangles independently of any spelling.
  expect(dictionaryViolations({ increases: raw(id("increase")) }))
    .toEqual([{ key: "increases", message: '"increase" has no entry' }]);
  // A lemma's own entry must contain a null reading (lemma = itself).
  expect(dictionaryViolations({
    them: raw(id("they")),
    they: raw(id("them")),
  })).toEqual([
    {
      key: "them",
      message: '"they" is not a citation form (its entry has no null reading)',
    },
    {
      key: "they",
      message: '"them" is not a citation form (its entry has no null reading)',
    },
  ]);
});

test("dictionary: expanded readings are distinct and selectable", () => {
  // Two readings that expand identically are duplicates.
  expect(
    dictionaryViolations({
      x: raw(see("y"), see("y")),
      y: raw(id("y")),
    }).map(({ message }) => message),
  ).toEqual(['duplicate reading "y"']);
  // A non-default reading must be uniquely selectable by its spelling or
  // lemma string: here every string of r2 (x=y) and r3 (y=y) also matches
  // another reading, so neither can ever be chosen by [w:] markup.
  expect(
    dictionaryViolations({
      x: raw(id("x"), id("y"), see("y")),
      y: raw(id("y")),
    }).map(({ message }) => message),
  ).toEqual([
    'reading "x" is not uniquely selectable by its spelling or lemma',
    'reading "y" is not uniquely selectable by its spelling or lemma',
  ]);
  // Entries whose references dangle skip these checks (no cascading noise).
  expect(
    dictionaryViolations({ x: raw(see("y"), see("y")) })
      .map(({ message }) => message),
  ).toEqual(['"y" has no entry']);
});

/* ------------------------ canonical spelling --------------------------- */

const listedRule =
  "(the reference word list's spelling is canonical, ties broken alphabetically)";

test("dictionary: the class member in the reference word list is canonical", () => {
  // enquiry/inquiry and vertue/virtue are each variants of one word. The
  // canonical spelling (the one the others cross-reference) must be the member
  // the external reference list endorses — not a corpus statistic.
  const register: RawDictionary = {
    inquiry: raw(id("inquiry")), // canonical, but NOT the reference spelling
    enquiry: raw(see("inquiry")),
    virtue: raw(id("virtue")), // canonical, and the reference spelling — fine
    vertue: raw(see("virtue")),
  };
  const wordlist = new Set(["enquiry", "virtue"]); // inquiry, vertue absent
  expect(canonicalSpellingViolations(register, wordlist, new Set())).toEqual([{
    key: "inquiry",
    message:
      `"enquiry" should be the canonical spelling, not "inquiry" ${listedRule}`,
  }]);
});

test("dictionary: several members in the list break alphabetically", () => {
  const wordlist = new Set(["grey", "gray"]); // both are current modern spellings
  // "gray" sorts first among the in-list members, so "grey" canonical violates.
  expect(canonicalSpellingViolations(
    {
      grey: raw(id("grey")),
      gray: raw(see("grey")),
    },
    wordlist,
    new Set(),
  )).toEqual([{
    key: "grey",
    message:
      `"gray" should be the canonical spelling, not "grey" ${listedRule}`,
  }]);
  // With "gray" canonical the class is satisfied.
  expect(canonicalSpellingViolations(
    {
      gray: raw(id("gray")),
      grey: raw(see("gray")),
    },
    wordlist,
    new Set(),
  )).toEqual([]);
});

test("dictionary: a class with no member in the list must be pinned", () => {
  // Neither spelling is in the reference list (a list gap, or an all-archaic word).
  const register: RawDictionary = {
    foo: raw(id("foo")),
    phoo: raw(see("foo")),
  };
  expect(canonicalSpellingViolations(register, new Set(), new Set())).toEqual([{
    key: "foo",
    message: 'no spelling of this class ("foo", "phoo") is in the reference ' +
      "word list — pin the intended canonical in canonical-exceptions.json",
  }]);
  // Pinning the current canonical resolves it.
  expect(canonicalSpellingViolations(register, new Set(), new Set(["foo"])))
    .toEqual([]);
  // Pinning the variant instead demands the flip.
  expect(canonicalSpellingViolations(register, new Set(), new Set(["phoo"])))
    .toEqual([{
      key: "foo",
      message: '"phoo" should be the canonical spelling, not "foo" ' +
        "(pinned in canonical-exceptions.json)",
    }]);
});

test("dictionary: a pin overrides the reference word list", () => {
  // "gray" is in the list, but an editor pins "grey"; the pin wins outright.
  const wordlist = new Set(["grey", "gray"]);
  expect(canonicalSpellingViolations(
    {
      grey: raw(id("grey")),
      gray: raw(see("grey")),
    },
    wordlist,
    new Set(["grey"]),
  )).toEqual([]);
});

test("dictionary: only single-spelling respellings form a class", () => {
  // Contractions (multi-spelling), spelling-ambiguous surfaces, and lemma
  // statements are not spelling variants, so the rule never weighs them —
  // nothing is required of the word list for any of these.
  const register: RawDictionary = {
    it: raw(id("it")),
    is: raw(id("be")),
    "'tis": raw(see("it", "is")), // contraction: two spellings, not a respelling
    then: raw(id("then"), see("than")), // spelling-ambiguous: two readings
    than: raw(id("than")),
    increases: raw(id("increase")), // a lemma statement, not a cross-reference
    increase: raw(id("increase")),
  };
  expect(canonicalSpellingViolations(register, new Set(), new Set()))
    .toEqual([]);
  // A variant pointing at a canonical with no entry is a dangle
  // `dictionaryViolations` reports; this rule stays silent rather than pile on.
  expect(
    canonicalSpellingViolations(
      { olde: raw(see("old")) },
      new Set(),
      new Set(),
    ),
  )
    .toEqual([]);
});

/* -------------------------------- shards ------------------------------- */

test("dictionary: keys shard by their first letter, ignoring non-letters", () => {
  expect(shardOf("the")).toBe("t.json");
  expect(shardOf("'tis")).toBe("t.json");
  expect(shardOf("'em")).toBe("e.json");
  expect(shardOf("I")).toBe("i.json"); // the capitalised pronoun shards with the i-words
  expect(shardOf("œconomy")).toBe("other.json");
});

test("dictionary: shardDictionary writes canonical, sorted, one-entry-per-line shards", () => {
  const dictionary: RawDictionary = {
    then: raw(id("then"), see("than")),
    "'tis": raw(see("it", "is")),
    the: raw(id("the")),
    "a priori": raw(id("a priori")), // a multi-word key shards by its first letter
  };
  expect(shardDictionary(dictionary)).toEqual(
    new Map([
      ["a.json", '{\n  "a priori": null\n}\n'],
      [
        "t.json",
        '{\n  "\'tis": "it is",\n  "the": null,\n  "then": [null, "than"]\n}\n',
      ],
    ]),
  );
});

test('dictionary: the pronoun "I" shards and sorts ahead of the i-words', () => {
  const dictionary: RawDictionary = {
    into: raw(id("into")),
    I: raw(id("I")),
    if: raw(id("if")),
  };
  expect(shardDictionary(dictionary)).toEqual(
    new Map([[
      "i.json",
      '{\n  "I": null,\n  "if": null,\n  "into": null\n}\n',
    ]]),
  );
});

const shards = (files: Record<string, string>) =>
  new Map(
    Object.entries(files).map(([name, text]) => [name, text] as const),
  );

test('dictionary: parseDictionary keeps the capital "I" key', () => {
  const { dictionary, problems } = parseDictionary(shards({
    "i.json": '{\n  "I": null,\n  "if": null\n}\n',
  }));
  expect(problems).toEqual([]);
  expect(Object.keys(dictionary)).toEqual(["I", "if"]);
});

test("dictionary: parseDictionary reads good shards without complaint", () => {
  const { dictionary, problems } = parseDictionary(shards({
    "t.json": '{\n  "the": null,\n  "then": [null, "than"]\n}\n',
  }));
  expect(problems).toEqual([]);
  expect(Object.keys(dictionary)).toEqual(["the", "then"]);
});

test("dictionary: parseDictionary reports structural problems", () => {
  const problemsOf = (files: Record<string, string>) =>
    parseDictionary(shards(files)).problems;

  expect(problemsOf({ "a.json": "not json" })[0]).toMatchObject({
    shard: "a.json",
    dropped: true,
  });
  expect(problemsOf({ "a.json": "[]" })[0].message).toContain("object");
  expect(problemsOf({ "b.json": '{"the": null}' })[0]).toMatchObject({
    key: "the",
    dropped: false, // misplaced, but kept — fmt moves it
  });
  expect(problemsOf({ "t.json": '{"then": null, "the": null}' })[0].message)
    .toContain("sorted");
  expect(problemsOf({ "t.json": '{"The": null}' })[0]).toMatchObject({
    key: "The",
    dropped: true,
  });
  // A hyphenated key is not a word (each part needs its own entry); a
  // non-breaking-space-joined multi-word key (`to morrow`) is a word, and valid.
  expect(problemsOf({ "s.json": '{"self-love": null}' })[0].message)
    .toContain("not a word");
  expect(problemsOf({ "t.json": '{"to morrow": "tomorrow"}' })).toEqual([]);
  expect(problemsOf({ "t.json": '{"then": ["than"]}' })[0].message).toContain(
    "ambiguous",
  );
  expect(problemsOf({ "v.json": '{"vertues": "virtues=virtue"}' })[0].message)
    .toContain("spellings only");
  // The same key in two shards: the second occurrence is dropped.
  const dup = parseDictionary(shards({
    "a.json": '{"the": null}',
    "t.json": '{"the": "thee"}',
  }));
  expect(dup.problems.some((p) => p.message.includes("duplicate"))).toBe(true);
  expect(dup.dictionary.the).toEqual(raw(id("the")));
});

/* ------------------------------ accounting ----------------------------- */

const register: RawDictionary = {
  "'tis": raw(see("it", "is")),
  then: raw(id("then"), see("than")),
  vertue: raw(see("virtue")),
  "a priori": raw(id("a priori")), // a `~`-fused surface, accounted by its entry
};

test("dictionary: accountTokens applies the accounting rule to every token", () => {
  const { document: doc, errors } = compile(
    "# t\n\n{#1}\n'Tis [p:Will] writing then vertue a~priori MDCCXL 1739 zzz " +
      "[w:to~morrow=tomorrow].\n",
  );
  expect(errors).toEqual([]);
  const accounts = accountTokens(doc, register);
  expect(accounts.map((a) => `${a.text}:${a.status}`)).toEqual([
    "'Tis:registered",
    "Will:exempt",
    "writing:unaccounted",
    "then:registered",
    "vertue:registered",
    "a priori:registered", // the fused surface matches its dictionary entry
    "MDCCXL:mechanical",
    "1739:mechanical",
    "zzz:unaccounted",
    // A [w:]-marked token is accounted like any other, by its own entry —
    // which "to morrow" has not got here.
    "to morrow:unaccounted",
  ]);
  expect(accounts[0].textId).toBe("t");
  expect(coverageOf(accounts)).toEqual({
    total: 10,
    accounted: 7, // registered, exempt, and mechanical tokens
    unaccounted: 3,
  });
});

test("dictionary: accountTokens accounts both versions of a correction", () => {
  const { document: doc, errors } = compile(
    "# t\n\n{#1}\nit was a [-mistak-][+vertue+].\n",
  );
  expect(errors).toEqual([]);
  // The edited stream first, then the original's surplus: the deleted word is
  // still a printed word, and it wants its own entry.
  expect(accountTokens(doc, register).map((a) => `${a.text}:${a.status}`))
    .toEqual([
      "it:unaccounted",
      "was:unaccounted",
      "a:unaccounted",
      "vertue:registered",
      "mistak:unaccounted",
    ]);
});

test("dictionary: accountTokens covers a document's sections too", () => {
  const { document: doc, errors } = compile(
    "# t\n\n{#1}\nvertue.\n\n## s\n\n{#1}\nzzz.\n",
  );
  expect(errors).toEqual([]);
  expect(accountTokens(doc, register).map((a) => `${a.textId}:${a.status}`))
    .toEqual(["t:registered", "t.s:unaccounted"]);
});

test("dictionary: a possessive is accounted when its base is registered", () => {
  const { document: doc, errors } = compile(
    "# t\n\n{#1}\nvertue's reward and zzz's folly.\n",
  );
  expect(errors).toEqual([]);
  // "vertue" is registered, so "vertue's" accounts by the possessive rule
  // without an entry of its own; "zzz" is not, so "zzz's" is unaccounted.
  expect(accountTokens(doc, register).map((a) => `${a.text}:${a.status}`))
    .toEqual([
      "vertue's:possessive",
      "reward:unaccounted",
      "and:unaccounted",
      "zzz's:unaccounted",
      "folly:unaccounted",
    ]);
  expect(coverageOf(accountTokens(doc, register))).toEqual({
    total: 5,
    accounted: 1, // the possessive counts as accounted
    unaccounted: 4,
  });
});

/* --------------------------- validation rules -------------------------- */

const rule = (name: string) => {
  const found = rules.find((r) => r.name === name);
  expect(found).toBeDefined();
  return found!;
};

/** A minimal valid corpus whose one edition holds `body` as its section text. */
const fixture = (body: string, files: Record<string, string> = {}) => {
  const builder = corpus()
    .author("a", { forename: "Ann", surname: "Aa" })
    .work("a", "w", { title: "W", breadcrumb: "W", canonical: "1700" })
    .edition(
      "a",
      "w",
      "1700",
      { imported: true, title: "W", breadcrumb: "W", published: [1700] },
      `## 1\n\n[metadata]\ntitle = "S"\nbreadcrumb = "S"\n\n{#1}\n${body}`,
    );
  for (const [path, text] of Object.entries(files)) builder.file(path, text);
  return builder.build();
};

const contextFor = async (
  files: Record<string, string>,
): Promise<RuleContext> => {
  const fs = memoryCorpus(files);
  return { files: await loadCorpus(fs, CORPUS_ROOT), fs, root: CORPUS_ROOT };
};

const violationsOf = async (
  name: string,
  files: Record<string, string>,
): Promise<string[]> =>
  (await rule(name).check(await contextFor(files))).map(violationText);

test("validate: well-formed dictionary shards pass, structural faults fail", async () => {
  const name = "dictionary shards are well-formed";
  expect(
    await violationsOf(
      name,
      fixture("Text.", {
        "data/dictionary/t.json":
          '{\n  "the": null,\n  "then": [null, "than"]\n}\n',
      }),
    ),
  ).toEqual([]);
  // A corpus with no dictionary directory at all is fine (nothing to check).
  expect(await violationsOf(name, fixture("Text."))).toEqual([]);
  // Structural problems (here: a misplaced key) are violations.
  expect(
    await violationsOf(
      name,
      fixture("Text.", { "data/dictionary/b.json": '{\n  "the": null\n}\n' }),
    ),
  ).toEqual([
    'dictionary/b.json "the": belongs in t.json (run `deno task fmt`)',
  ]);
  // Whitespace/serialization drift is a violation too.
  const drift = await violationsOf(
    name,
    fixture("Text.", {
      "data/dictionary/t.json": '{ "the": null }',
    }),
  );
  expect(drift.length).toBe(1);
  expect(drift[0]).toContain("canonically");
  // An empty shard file should not exist.
  const empty = await violationsOf(
    name,
    fixture("Text.", {
      "data/dictionary/z.json": "{}",
    }),
  );
  expect(empty.length).toBe(1);
  expect(empty[0]).toContain("empty");
});

test("validate: dictionary readings must resolve within the register", async () => {
  const name = "dictionary readings resolve within the register";
  expect(
    await violationsOf(
      name,
      fixture("Text.", { "data/dictionary/t.json": '{\n  "the": null\n}\n' }),
    ),
  ).toEqual([]);
  expect(
    await violationsOf(
      name,
      fixture("Text.", {
        "data/dictionary/v.json": '{\n  "vertue": "virtue"\n}\n',
      }),
    ),
  ).toEqual(['dictionary/v.json "vertue": "virtue" has no entry']);
  // Shards that don't parse cleanly defer to the shards rule — dropped
  // entries would dangle spuriously here.
  expect(
    await violationsOf(
      name,
      fixture("Text.", { "data/dictionary/a.json": "not json" }),
    ),
  ).toEqual([]);
});

test("validate: the canonical spelling must match the reference word list", async () => {
  const name = "canonical spelling matches the reference word list";
  // The fixture ships a tiny reference word list; "enquiry" is in it, "inquiry"
  // is not (SCOWL's British primary), so "enquiry" must be canonical.
  const files = (
    dict: Record<string, string>,
    extra: Record<string, string> = {},
  ) =>
    fixture("Text.", {
      "data/reference/words.txt": "enquiry\nvirtue\n",
      ...dict,
      ...extra,
    });
  // The register makes "enquiry" (the list's spelling) canonical — fine.
  expect(
    await violationsOf(
      name,
      files({
        "data/dictionary/e.json": '{\n  "enquiry": null\n}\n',
        "data/dictionary/i.json": '{\n  "inquiry": "enquiry"\n}\n',
      }),
    ),
  ).toEqual([]);
  // The register made "inquiry" canonical, but only "enquiry" is in the list.
  expect(
    await violationsOf(
      name,
      files({
        "data/dictionary/e.json": '{\n  "enquiry": "inquiry"\n}\n',
        "data/dictionary/i.json": '{\n  "inquiry": null\n}\n',
      }),
    ),
  ).toEqual([
    'dictionary/i.json "inquiry": "enquiry" should be the canonical spelling, ' +
    'not "inquiry" (the reference word list\'s spelling is canonical, ties ' +
    "broken alphabetically)",
  ]);
  // A class no member of which is in the list is flagged, then pinnable.
  const gap = {
    "data/dictionary/f.json": '{\n  "foo": null\n}\n',
    "data/dictionary/p.json": '{\n  "phoo": "foo"\n}\n',
  };
  expect(await violationsOf(name, files(gap))).toEqual([
    'dictionary/f.json "foo": no spelling of this class ("foo", "phoo") is in ' +
    "the reference word list — pin the intended canonical in " +
    "canonical-exceptions.json",
  ]);
  expect(
    await violationsOf(
      name,
      files(gap, {
        "data/reference/canonical-exceptions.json": '["foo"]\n',
      }),
    ),
  ).toEqual([]);
  // Without the reference word list the rule cannot run, and defers (this dict
  // would otherwise violate).
  expect(
    await violationsOf(
      name,
      fixture("Text.", {
        "data/dictionary/e.json": '{\n  "enquiry": "inquiry"\n}\n',
        "data/dictionary/i.json": '{\n  "inquiry": null\n}\n',
      }),
    ),
  ).toEqual([]);
  // Shards that don't parse cleanly defer to the shards rule.
  expect(
    await violationsOf(name, files({ "data/dictionary/a.json": "not json" })),
  )
    .toEqual([]);
});

test("validate: word markup must select exactly one reading of an ambiguous entry", async () => {
  const name = "word markup selects a dictionary reading";
  const files = (body: string) =>
    fixture(body, {
      "data/dictionary/b.json":
        '{\n  "bear": null,\n  "born": "=bear",\n  "borne": ["=bear", "born"]\n}\n',
      "data/dictionary/l.json":
        '{\n  "laie": "lay",\n  "lay": [null, "=lie"],\n  "lie": null\n}\n',
      "data/dictionary/t.json":
        '{\n  "than": null,\n  "the": null,\n  "then": [null, "than"],\n  "to morrow": [null, "tomorrow"],\n  "tomorrow": null\n}\n',
    });

  expect(await violationsOf(name, files("Better [w:then=than] never.")))
    .toEqual([]);
  // Selecting the default reading explicitly is allowed.
  expect(await violationsOf(name, files("Better [w:then=then] never.")))
    .toEqual([]);
  // Selecting by lemma works on derived readings too: "laie" is ambiguous
  // purely by inheritance from "lay".
  expect(await violationsOf(name, files("She [w:laie=lie] down.")))
    .toEqual([]);
  // A `~`-fused multi-word unit is one token, selected like any other surface
  // (Markit rejects a multi-token surface at compile time).
  expect(await violationsOf(name, files("Until [w:to~morrow=tomorrow] then.")))
    .toEqual([]);
  // A [w:] inside a deletion is only in the original version — still checked.
  expect(
    await violationsOf(name, files("So [-[w:the=thee]-][+thee+] said.")),
  ).toEqual([
    'works/a/w/1700.mit (a.w.1700.1): "the" is unambiguous — [w:] markup is only for ambiguous surfaces',
  ]);

  const single = async (body: string): Promise<string> => {
    const violations = await violationsOf(name, files(body));
    expect(violations.length).toBe(1);
    return violations[0];
  };
  expect(await single("So [w:the=thee] said.")).toContain("unambiguous");
  expect(await single("So [w:nope=than] said.")).toContain(
    "no dictionary entry",
  );
  expect(await single("So [w:then=nan] said.")).toContain("selects no reading");
  expect(await single("So [w:borne=bear] said.")).toContain("more than one");
  // A fused surface with no entry is a violation like any other: the markup
  // is no longer its own reading.
  expect(await single("So [w:up~hill=x] said.")).toContain(
    "no dictionary entry",
  );
});

/* --------------------------- edition overrides ------------------------- */

test("dictionary: overridesOf reads a text's [metadata.dictionary] map", () => {
  const { document: doc, errors } = compile(
    '# t\n\n[metadata]\ntitle = "T"\n\n[metadata.dictionary]\nhumane = "human"\nthen = "than"\n\n{#1}\nText.\n',
  );
  expect(errors).toEqual([]);
  expect(overridesOf(doc.metadata)).toEqual({ humane: "human", then: "than" });
  expect(overridesOf(undefined)).toEqual({});
  // `dictionary` as a plain [metadata] scalar is not a map (the schema rule
  // reports it); non-string values inside the map are skipped likewise.
  const { document: scalar } = compile(
    '# t\n\n[metadata]\ndictionary = "x"\n\n{#1}\nT.\n',
  );
  expect(overridesOf(scalar.metadata)).toEqual({});
  const { document: mixed } = compile(
    '# t\n\n[metadata]\ntitle = "T"\n\n[metadata.dictionary]\na = "x"\nb = 7\n\n{#1}\nT.\n',
  );
  expect(overridesOf(mixed.metadata)).toEqual({ a: "x" });
});

test("dictionary: resolveReading follows [w:] markup → override → default", () => {
  const then = entry([w("then")], [w("than")]);
  expect(selectReading(then, "than")).toEqual([w("than")]);
  expect(selectReading(then, "then")).toEqual([w("then")]); // a pin
  expect(selectReading(then, "nan")).toBeUndefined();
  // Selection by lemma string; a value matching two readings selects neither.
  const lay = entry([w("lay")], [w("lay", "lie")]);
  expect(selectReading(lay, "lie")).toEqual([w("lay", "lie")]);
  expect(selectReading(lay, "lay")).toBeUndefined();
  expect(resolveReading(then)).toEqual([w("then")]);
  expect(resolveReading(then, "than")).toEqual([w("than")]);
  expect(resolveReading(then, "than", "then")).toEqual([w("then")]); // [w:] wins
  // An unresolvable selector (a validation error) falls through a tier.
  expect(resolveReading(then, "nan")).toEqual([w("then")]);
  expect(resolveReading(then, "than", "nan")).toEqual([w("than")]);
});

/** A one-edition corpus whose edition file continues with `tail` after its
 * root [metadata] block (room for [metadata.dictionary] and sections). */
const overrideFixture = (tail: string): Record<string, string> =>
  corpus()
    .author("a", { forename: "Ann", surname: "Aa" })
    .work("a", "w", {
      title: "W",
      breadcrumb: "W",
      authors: ["a"],
      canonical: "1700",
    })
    .file(
      "data/works/a/w/1700.mit",
      '# a.w.1700\n\n[metadata]\ntitle = "W"\nbreadcrumb = "W"\n' +
        'authors = ["a"]\nimported = true\npublished = [1700]\n\n' + tail,
    )
    .file(
      "data/dictionary/b.json",
      '{\n  "bear": null,\n  "born": "=bear",\n  "borne": ["=bear", "born"]\n}\n',
    )
    .file(
      "data/dictionary/t.json",
      '{\n  "than": null,\n  "the": null,\n  "then": [null, "than"]\n}\n',
    )
    .build();

test("validate: dictionary overrides select a reading of an ambiguous entry", async () => {
  const name = "dictionary overrides select a reading";
  // On the edition root: sets the default for its unmarked occurrences.
  expect(
    await violationsOf(
      name,
      overrideFixture('[metadata.dictionary]\nthen = "than"\n\n{#1}\nText.\n'),
    ),
  ).toEqual([]);
  // On a section, selecting by any unique string; pinning the corpus default
  // (`then = "then"`) is legal — it survives the register reordering.
  expect(
    await violationsOf(
      name,
      overrideFixture(
        '{#1}\nText.\n\n## s\n\n[metadata]\ntitle = "S"\nbreadcrumb = "S"\n\n' +
          '[metadata.dictionary]\nborne = "born"\nthen = "then"\n\n{#1}\nMore.\n',
      ),
    ),
  ).toEqual([]);

  const single = async (line: string): Promise<string> => {
    const violations = await violationsOf(
      name,
      overrideFixture(`[metadata.dictionary]\n${line}\n\n{#1}\nText.\n`),
    );
    expect(violations.length).toBe(1);
    return violations[0];
  };
  expect(await single('nope = "than"')).toContain("no dictionary entry");
  expect(await single('the = "thee"')).toContain("unambiguous");
  expect(await single('then = "nan"')).toContain("selects no reading");
  expect(await single('borne = "bear"')).toContain("more than one");
  expect(await single('The = "than"')).toContain("folded");
  expect(await single('_x = "than"')).toContain("not a word");
});

test("validate: the text schema types the dictionary key and keeps it off stubs", async () => {
  const name = "texts match the text schema";
  const stub = (extra: string) =>
    '# a.w\n\n[metadata]\ntitle = "W"\nbreadcrumb = "W"\nauthors = ["a"]\n' +
    'canonical = "1700"\n' + extra;
  const edition = (extra: string) =>
    '# a.w.1700\n\n[metadata]\ntitle = "W"\nbreadcrumb = "W"\n' +
    'authors = ["a"]\nimported = true\npublished = [1700]\n' + extra +
    "\n{#1}\nText.\n";
  const fixture = (stubExtra: string, editionExtra: string) =>
    corpus()
      .author("a", { forename: "Ann", surname: "Aa" })
      .file("data/works/a/w/index.mit", stub(stubExtra))
      .file("data/works/a/w/1700.mit", edition(editionExtra))
      .build();

  expect(
    await violationsOf(
      name,
      fixture("", '\n[metadata.dictionary]\nthen = "than"\n'),
    ),
  ).toEqual([]);
  // Mistyped: a scalar, and a map with a non-string value.
  expect(await violationsOf(name, fixture("", 'dictionary = "x"\n')))
    .toEqual(['works/a/w/1700.mit (a.w.1700): "dictionary" should be map']);
  expect(
    await violationsOf(
      name,
      fixture("", "\n[metadata.dictionary]\nthen = 7\n"),
    ),
  ).toEqual(['works/a/w/1700.mit (a.w.1700): "dictionary" should be map']);
  // A stub is metadata-only: it prints no tokens, so overrides mean nothing.
  expect(
    await violationsOf(
      name,
      fixture('\n[metadata.dictionary]\nthen = "than"\n', ""),
    ),
  ).toEqual([
    'works/a/w/index.mit (a.w): "dictionary" does not belong on a work\'s index.mit stub',
  ]);
});

test("catalogue: overrides ride each document's metadata through catalogue/", async () => {
  const files = overrideFixture(
    '[metadata.dictionary]\nthen = "than"\n\n{#1}\nText.\n',
  );
  const fs = writableCorpus(files);
  const { catalogue, warnings } = await buildCatalogue(fs, CORPUS_ROOT);
  await writeCatalogue(fs, CORPUS_ROOT, catalogue, warnings);
  const loaded = await loadCatalogue(catalogueReader(fs), CORPUS_ROOT);
  const doc = loaded.catalogue.byAuthor.get("a")!.works[0].editions[0].document;
  expect(overridesOf(doc.metadata)).toEqual({ then: "than" });
});

test("validate: the coverage report counts per work and corpus-wide", async () => {
  const files = corpus()
    .author("a", { forename: "Ann", surname: "Aa" })
    .work("a", "w", { title: "W", breadcrumb: "W", canonical: "1700" })
    .edition(
      "a",
      "w",
      "1700",
      { imported: true, title: "W", breadcrumb: "W", published: [1700] },
      `## 1\n\n[metadata]\ntitle = "S"\nbreadcrumb = "S"\n\n{#1}\nthe vertue zzz nope`,
    )
    .file(
      "data/dictionary/t.json",
      '{\n  "the": null\n}\n',
    )
    .file("data/dictionary/v.json", '{\n  "vertue": "virtue"\n}\n')
    .build();
  const lines = await dictionaryCoverage(await contextFor(files));
  expect(lines[0]).toBe("corpus: 50.0% of 4 tokens accounted");
  expect(lines[1]).toBe("  a/w: 50.0% of 4 tokens accounted");
});

/* --------------------------- catalogue emission ------------------------ */

/** Extend the in-memory corpus with the write operations writeCatalogue needs. */
const writableCorpus = (files: Record<string, string>): CorpusFsWrite => ({
  ...memoryCorpus(files),
  writeFile: (path, text) => {
    files[normalizePath(path)] = text;
    return Promise.resolve();
  },
  mkdir: () => Promise.resolve(),
  remove: (path) => {
    const prefix = normalizePath(path);
    for (const key of Object.keys(files)) {
      if (key === prefix || key.startsWith(`${prefix}/`)) delete files[key];
    }
    return Promise.resolve();
  },
});

test("catalogue: the dictionary is built into the catalogue, dropped entries warn", async () => {
  const files = fixture("Text.", {
    "data/dictionary/t.json": '{\n  "the": null\n}\n',
    "data/dictionary/x.json": '{\n  "x": "a  b"\n}\n',
  });
  const { catalogue, warnings } = await buildCatalogue(
    memoryCorpus(files),
    CORPUS_ROOT,
  );
  expect(catalogue.dictionary).toEqual({ the: entry([w("the")]) });
  expect(warnings.some((warning) => warning.includes("dropped"))).toBe(true);
});

test("catalogue: the expanded dictionary round-trips through catalogue/", async () => {
  const files = fixture("Text.", {
    "data/dictionary/i.json": '{\n  "is": "=be",\n  "it": null\n}\n',
    "data/dictionary/t.json":
      '{\n  "\'tis": "it is",\n  "than": null,\n  "then": [null, "than"]\n}\n',
  });
  const fs = writableCorpus(files);
  const { catalogue, warnings } = await buildCatalogue(fs, CORPUS_ROOT);
  await writeCatalogue(fs, CORPUS_ROOT, catalogue, warnings);
  expect(files[`${CORPUS_ROOT}/catalogue/dictionary.json`]).toBeDefined();

  const loaded = await loadCatalogue(catalogueReader(fs), CORPUS_ROOT);
  expect(loaded.catalogue.dictionary).toEqual(
    {
      // The catalogue holds the *expanded* dictionary: "'tis" carries the
      // lemma "be" that on disk is stated only on the entry for "is".
      "'tis": entry([w("it"), w("is", "be")]),
      is: entry([w("is", "be")]),
      it: entry([w("it")]),
      than: entry([w("than")]),
      then: entry([w("then")], [w("than")]),
    } satisfies Dictionary,
  );

  // A catalogue compiled before the dictionary existed loads as empty.
  delete files[`${CORPUS_ROOT}/catalogue/dictionary.json`];
  const older = await loadCatalogue(catalogueReader(fs), CORPUS_ROOT);
  expect(older.catalogue.dictionary).toEqual({});
});

test("catalogue: writeCatalogueDictionary refreshes the dictionary and warnings, nothing else", async () => {
  const files = fixture("Text.", {
    "data/dictionary/t.json": '{\n  "the": null\n}\n',
  });
  const fs = writableCorpus(files);
  const first = await buildCatalogue(fs, CORPUS_ROOT);
  await writeCatalogue(fs, CORPUS_ROOT, first.catalogue, first.warnings);
  const documentsBefore = Object.fromEntries(
    Object.entries(files).filter(([path]) =>
      path.startsWith(`${CORPUS_ROOT}/catalogue/documents/`)
    ),
  );
  expect(Object.keys(documentsBefore).length).toBeGreaterThan(0);

  // A dictionary edit: rebuild and write only the dictionary-dependent files.
  files[`${CORPUS_ROOT}/data/dictionary/t.json`] =
    '{\n  "text": null,\n  "the": null\n}\n';
  const second = await buildCatalogue(fs, CORPUS_ROOT);
  await writeCatalogueDictionary(
    fs,
    CORPUS_ROOT,
    second.catalogue,
    second.warnings,
  );
  const loaded = await loadCatalogue(catalogueReader(fs), CORPUS_ROOT);
  expect(loaded.catalogue.dictionary).toEqual({
    text: entry([w("text")]),
    the: entry([w("the")]),
  });
  // The documents were untouched — same files, byte for byte.
  expect(
    Object.fromEntries(
      Object.entries(files).filter(([path]) =>
        path.startsWith(`${CORPUS_ROOT}/catalogue/documents/`)
      ),
    ),
  ).toEqual(documentsBefore);
});

test("dictionary: readDictionaryShards reads only the shard files", async () => {
  const files = fixture("Text.", {
    "data/dictionary/t.json": '{\n  "the": null\n}\n',
    "data/dictionary/README.md": "notes",
  });
  const read = await readDictionaryShards(memoryCorpus(files), CORPUS_ROOT);
  expect([...read.keys()]).toEqual(["t.json"]);
  // No dictionary directory at all: an empty map, not an error.
  expect(
    await readDictionaryShards(memoryCorpus(fixture("Text.")), CORPUS_ROOT),
  ).toEqual(new Map());
});
