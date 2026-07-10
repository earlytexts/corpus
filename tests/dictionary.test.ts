/**
 * The dictionary: word segmentation and folding (../src/words.ts), the entry
 * micro-syntax and shard files, expansion (lemma derivation through
 * cross-references), the accounting rule (../src/dictionary.ts), the
 * dictionary validation rules and coverage report (../src/validate.ts), and
 * the catalogue emission of the expanded dictionary. Fixtures are in-memory
 * corpora (../src/harness.ts); no files on disk.
 */

import { expect } from "@std/expect";
import { test } from "@std/testing/bdd";
import { type Block, compile } from "@earlytexts/markit";
import {
  fold,
  isRomanNumeral,
  isWord,
  scanBlock,
  words,
} from "../src/words.ts";
import {
  accountTokens,
  coverageOf,
  type Dictionary,
  dictionaryViolations,
  type Entry,
  expandDictionary,
  overridesOf,
  parseDictionary,
  parseEntry,
  type RawDictionary,
  type RawEntry,
  readDictionaryShards,
  resolveReading,
  selectReading,
  serializeEntry,
  shardDictionary,
  shardOf,
} from "../src/dictionary.ts";
import {
  dictionaryCoverage,
  loadCorpus,
  type RuleContext,
  rules,
  violationText,
} from "../src/validate.ts";
import { corpus, CORPUS_ROOT, memoryCorpus } from "../src/harness.ts";
import { buildCatalogue } from "../src/catalogue.ts";
import { writeCatalogue } from "../src/catalogue-output.ts";
import { catalogueReader, loadCatalogue } from "../src/deserialize.ts";
import { normalizePath } from "../src/paths.ts";
import type { CorpusFsWrite } from "../src/types.ts";

/* -------------------------------- words -------------------------------- */

test("words: segmentation keeps apostrophes, splits hyphens, takes digit runs", () => {
  expect(words("'Tis a fine-day at o'clock, lookin' on 1739 &c MDCCXL x=y"))
    .toEqual([
      "'Tis",
      "a",
      "fine",
      "day",
      "at",
      "o'clock",
      "lookin'",
      "on",
      "1739",
      "c",
      "MDCCXL",
      "x",
      "y",
    ]);
  expect(words("… '' — !")).toEqual([]); // no letters or digits, no tokens
});

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
  expect(isWord("")).toBe(false);
  expect(isWord("it is")).toBe(false); // two tokens
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

/** The first block of a compiled one-block document. */
const block = (line: string): Block => {
  const [doc, errors] = compile(`# t\n\n{#1}\n${line}\n`);
  expect(errors).toEqual([]);
  return doc.blocks[0];
};

test("words: scanBlock reports tokens with their exempting markup and [w:] elements", () => {
  const scan = scanBlock(block(
    '\'Tis _writ_ by [p:*Will* Shake] in ["A Treatise"] at $la:cogito ergo$ ' +
      "on MDCCXL-1739, [w:then=than] [w:to morrow=tomorrow].",
  ));
  expect(
    scan.tokens.map((t) =>
      `${t.text}${t.exemption === undefined ? "" : `/${t.exemption}`}`
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
    "1739",
    "then",
    "to",
    "morrow",
  ]);
  expect(scan.tokens.map((t) => t.folded).slice(0, 2)).toEqual([
    "'tis",
    "writ",
  ]);
  expect(scan.words.map((w) => ({
    value: w.element.word,
    tokens: w.tokens.map((t) => t.text),
  }))).toEqual([
    { value: "than", tokens: ["then"] },
    { value: "tomorrow", tokens: ["to", "morrow"] },
  ]);
  // Each [w:] token points back at its element.
  expect(scan.words[0].tokens[0].word).toBe(scan.words[0].element);
});

test("words: scanBlock descends into quotes, lists, and tables", () => {
  const [doc, errors] = compile(
    "# t\n\n{#1}\n> Quoted words.\n\n{#2}\n- one item\n- two\n\n{#3}\n| a cell | more |\n",
  );
  expect(errors).toEqual([]);
  const texts = doc.blocks.map((b) => scanBlock(b).tokens.map((t) => t.text));
  expect(texts).toEqual([
    ["Quoted", "words"],
    ["one", "item", "two"],
    ["a", "cell", "more"],
  ]);
});

/* ----------------------------- micro-syntax ---------------------------- */

/** An identity reading: the surface is a modern word with this lemma. */
const id = (lemma: string) => ({ lemma });

/** A cross-reference reading: see those entries for the lemmas. */
const see = (...spellings: string[]) => ({ spellings });

const raw = (
  confirmed: boolean,
  ...readings: RawEntry["readings"]
): RawEntry => ({
  readings,
  confirmed,
});

/** An expanded dictionary word, defaulting the lemma to the spelling. */
const w = (spelling: string, lemma = spelling) => ({ spelling, lemma });

const entry = (confirmed: boolean, ...readings: Entry["readings"]): Entry => ({
  readings,
  confirmed,
});

/** The worked examples from DICTIONARY.md's on-disk format, all real seed
 * entries. */
const examples: [string, unknown, RawEntry][] = [
  ["the", null, raw(true, id("the"))],
  ["increases", "=increase", raw(true, id("increase"))],
  ["vertue", "virtue", raw(true, see("virtue"))],
  ["vertues", "virtues", raw(true, see("virtues"))],
  ["'tis", "it is", raw(true, see("it", "is"))],
  ["then", [null, "than"], raw(true, id("then"), see("than"))],
  ["lay", [null, "=lie"], raw(true, id("lay"), id("lie"))],
  ["borne", ["=bear", "born"], raw(true, id("bear"), see("born"))],
  ["compleat", "?complete", raw(false, see("complete"))],
];

test("dictionary: the micro-syntax parses and round-trips", () => {
  for (const [surface, value, expected] of examples) {
    expect(parseEntry(surface, value)).toEqual(expected);
    expect(serializeEntry(surface, expected)).toEqual(value);
  }
  // "?" alone is an unconfirmed identity entry.
  expect(parseEntry("agreable", "?")).toEqual(raw(false, id("agreable")));
  expect(serializeEntry("agreable", raw(false, id("agreable")))).toBe("?");
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
  expect(error("x", "=it is")).toContain("not a word");
  expect(error("x", "=")).toContain("not a word");
  expect(error("x", "1st")).toContain("not a word");
  expect(error("x", "x")).toContain("null"); // the surface itself is null
  expect(error("x", [null, "?than"])).toContain("first");
});

/* ------------------------------ expansion ------------------------------ */

test("dictionary: expansion derives lemmas through cross-references", () => {
  const dictionary: RawDictionary = {
    "'tis": raw(true, see("it", "is")),
    is: raw(true, id("be")),
    it: raw(true, id("it")),
    vertues: raw(false, see("virtues")),
    virtue: raw(true, id("virtue")),
    virtues: raw(true, id("virtue")),
  };
  expect(expandDictionary(dictionary)).toEqual({
    // A contraction: each word's lemma comes from that word's own entry.
    "'tis": entry(true, [w("it"), w("is", "be")]),
    is: entry(true, [w("is", "be")]),
    it: entry(true, [w("it")]),
    // The lemma of "vertues" is stated nowhere near it: it derives via the
    // cross-referenced "virtues". `confirmed` carries over unchanged.
    vertues: entry(false, [w("virtues", "virtue")]),
    virtue: entry(true, [w("virtue")]),
    virtues: entry(true, [w("virtues", "virtue")]),
  });
});

test("dictionary: lemma ambiguity inherits through a cross-reference", () => {
  // "laie" respells to "lay"; "lay" is lemma-ambiguous; so "laie" is too —
  // in the target's order, so unmarked occurrences agree with unmarked "lay".
  const dictionary: RawDictionary = {
    laie: raw(true, see("lay")),
    lay: raw(true, id("lay"), id("lie")),
    lie: raw(true, id("lie")),
  };
  expect(expandDictionary(dictionary).laie).toEqual(
    entry(true, [w("lay")], [w("lay", "lie")]),
  );
});

test("dictionary: multi-word cross-references expand as a cross product", () => {
  const dictionary: RawDictionary = {
    a: raw(true, id("a"), id("q")),
    b: raw(true, id("b")),
    q: raw(true, id("q")),
    x: raw(true, see("a", "b")),
  };
  // The leftmost word is most significant; each word's lemmas keep their
  // entry's order.
  expect(expandDictionary(dictionary).x).toEqual(
    entry(true, [w("a"), w("b")], [w("a", "q"), w("b")]),
  );
});

test("dictionary: expansion is best-effort where the register dangles", () => {
  const dictionary: RawDictionary = {
    olde: raw(true, see("vertue")), // target has no identity reading
    vertue: raw(true, see("virtue")), // target has no entry at all
  };
  // Both fall back to lemma = spelling; dictionaryViolations flags them.
  expect(expandDictionary(dictionary)).toEqual({
    olde: entry(true, [w("vertue")]),
    vertue: entry(true, [w("virtue")]),
  });
});

/* ------------------------- register violations ------------------------- */

test("dictionary: a closed register has no violations", () => {
  expect(dictionaryViolations({
    "'tis": raw(true, see("it", "is")),
    be: raw(true, id("be")),
    is: raw(true, id("be")),
    it: raw(true, id("it")),
    laie: raw(true, see("lay")),
    lay: raw(true, id("lay"), id("lie")),
    lie: raw(true, id("lie")),
    vertue: raw(true, see("virtue")),
    virtue: raw(true, id("virtue")),
  })).toEqual([]);
});

test("dictionary: cross-references resolve in one step or dangle", () => {
  // A missing target — or just a typo — is caught.
  expect(dictionaryViolations({ vertue: raw(true, see("virtue")) })).toEqual([
    { key: "vertue", message: '"virtue" has no entry' },
  ]);
  // A target that is itself only a cross-reference cannot supply a lemma:
  // normalisation is single-step, so chains (and cycles) are violations.
  expect(dictionaryViolations({
    olde: raw(true, see("vertue")),
    vertue: raw(true, see("virtue")),
    virtue: raw(true, id("virtue")),
  })).toEqual([{
    key: "olde",
    message:
      'the entry for "vertue" has no identity reading (nothing to derive a lemma from)',
  }]);
  expect(
    dictionaryViolations({
      vertue: raw(true, see("virtue")),
      virtue: raw(true, see("vertue")),
    }).map(({ key }) => key),
  ).toEqual(["vertue", "virtue"]);
});

test("dictionary: stated lemmas are registered citation forms", () => {
  // A lemma dangles independently of any spelling.
  expect(dictionaryViolations({ increases: raw(true, id("increase")) }))
    .toEqual([{ key: "increases", message: '"increase" has no entry' }]);
  // A lemma's own entry must contain a null reading (lemma = itself).
  expect(dictionaryViolations({
    them: raw(true, id("they")),
    they: raw(true, id("them")),
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
      x: raw(true, see("y"), see("y")),
      y: raw(true, id("y")),
    }).map(({ message }) => message),
  ).toEqual(['duplicate reading "y"']);
  // A non-default reading must be uniquely selectable by its spelling or
  // lemma string: here every string of r2 (x=y) and r3 (y=y) also matches
  // another reading, so neither can ever be chosen by [w:] markup.
  expect(
    dictionaryViolations({
      x: raw(true, id("x"), id("y"), see("y")),
      y: raw(true, id("y")),
    }).map(({ message }) => message),
  ).toEqual([
    'reading "x" is not uniquely selectable by its spelling or lemma',
    'reading "y" is not uniquely selectable by its spelling or lemma',
  ]);
  // Entries whose references dangle skip these checks (no cascading noise).
  expect(
    dictionaryViolations({ x: raw(true, see("y"), see("y")) })
      .map(({ message }) => message),
  ).toEqual(['"y" has no entry']);
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
    then: raw(true, id("then"), see("than")),
    "'tis": raw(true, see("it", "is")),
    the: raw(true, id("the")),
    compleat: raw(false, see("complete")),
  };
  expect(shardDictionary(dictionary)).toEqual(
    new Map([
      ["c.json", '{\n  "compleat": "?complete"\n}\n'],
      [
        "t.json",
        '{\n  "\'tis": "it is",\n  "the": null,\n  "then": [null, "than"]\n}\n',
      ],
    ]),
  );
});

test('dictionary: the pronoun "I" shards and sorts ahead of the i-words', () => {
  const dictionary: RawDictionary = {
    into: raw(true, id("into")),
    I: raw(true, id("I")),
    if: raw(true, id("if")),
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
  expect(problemsOf({ "t.json": '{"to morrow": "tomorrow"}' })[0].message)
    .toContain("not a word");
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
  expect(dup.dictionary.the).toEqual(raw(true, id("the")));
});

/* ------------------------------ accounting ----------------------------- */

const register: RawDictionary = {
  "'tis": raw(true, see("it", "is")),
  then: raw(true, id("then"), see("than")),
  vertue: raw(true, see("virtue")),
  compleat: raw(false, see("complete")),
};

test("dictionary: accountTokens applies the accounting rule to every token", () => {
  const [doc, errors] = compile(
    "# t\n\n{#1}\n'Tis [p:Will] writing then vertue compleat MDCCXL 1739 zzz " +
      "[w:to morrow=tomorrow].\n",
  );
  expect(errors).toEqual([]);
  const accounts = accountTokens(doc, register);
  expect(accounts.map((a) => `${a.text}:${a.status}`)).toEqual([
    "'Tis:confirmed",
    "Will:exempt",
    "writing:unaccounted",
    "then:confirmed",
    "vertue:confirmed",
    "compleat:unconfirmed",
    "MDCCXL:mechanical",
    "1739:mechanical",
    "zzz:unaccounted",
    "to:marked",
    "morrow:marked",
  ]);
  expect(accounts[0].textId).toBe("t");
  expect(coverageOf(accounts)).toEqual({
    total: 11,
    confirmed: 8, // exempt, mechanical, and marked tokens count as confirmed
    unconfirmed: 1,
    unaccounted: 2,
  });
});

test("dictionary: accountTokens covers a document's sections too", () => {
  const [doc, errors] = compile(
    "# t\n\n{#1}\nvertue.\n\n## s\n\n{#1}\nzzz.\n",
  );
  expect(errors).toEqual([]);
  expect(accountTokens(doc, register).map((a) => `${a.textId}:${a.status}`))
    .toEqual(["t:confirmed", "t.s:unaccounted"]);
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

test("validate: word markup must select exactly one reading of an ambiguous entry", async () => {
  const name = "word markup selects a dictionary reading";
  const files = (body: string) =>
    fixture(body, {
      "data/dictionary/b.json":
        '{\n  "bear": null,\n  "born": "=bear",\n  "borne": ["=bear", "born"]\n}\n',
      "data/dictionary/l.json":
        '{\n  "laie": "lay",\n  "lay": [null, "=lie"],\n  "lie": null\n}\n',
      "data/dictionary/t.json":
        '{\n  "than": null,\n  "the": null,\n  "then": [null, "than"]\n}\n',
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
  // A multi-token surface needs no entry: the markup is the reading.
  expect(await violationsOf(name, files("Until [w:to morrow=tomorrow] then.")))
    .toEqual([]);

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
  expect(await single("So [w:to morrow==x] said.")).toContain("spellings only");
  expect(await single("So [w:=than] said.")).toContain("no words");
});

/* --------------------------- edition overrides ------------------------- */

test("dictionary: overridesOf reads a text's [metadata.dictionary] map", () => {
  const [doc, errors] = compile(
    '# t\n\n[metadata]\ntitle = "T"\n\n[metadata.dictionary]\nhumane = "human"\nthen = "than"\n\n{#1}\nText.\n',
  );
  expect(errors).toEqual([]);
  expect(overridesOf(doc.metadata)).toEqual({ humane: "human", then: "than" });
  expect(overridesOf(undefined)).toEqual({});
  // `dictionary` as a plain [metadata] scalar is not a map (the schema rule
  // reports it); non-string values inside the map are skipped likewise.
  const [scalar] = compile('# t\n\n[metadata]\ndictionary = "x"\n\n{#1}\nT.\n');
  expect(overridesOf(scalar.metadata)).toEqual({});
  const [mixed] = compile(
    '# t\n\n[metadata]\ntitle = "T"\n\n[metadata.dictionary]\na = "x"\nb = 7\n\n{#1}\nT.\n',
  );
  expect(overridesOf(mixed.metadata)).toEqual({ a: "x" });
});

test("dictionary: resolveReading follows [w:] markup → override → default", () => {
  const then = entry(true, [w("then")], [w("than")]);
  expect(selectReading(then, "than")).toEqual([w("than")]);
  expect(selectReading(then, "then")).toEqual([w("then")]); // a pin
  expect(selectReading(then, "nan")).toBeUndefined();
  // Selection by lemma string; a value matching two readings selects neither.
  const lay = entry(true, [w("lay")], [w("lay", "lie")]);
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
      `## 1\n\n[metadata]\ntitle = "S"\nbreadcrumb = "S"\n\n{#1}\nthe vertue compleat zzz`,
    )
    .file("data/dictionary/c.json", '{\n  "compleat": "?complete"\n}\n')
    .file(
      "data/dictionary/t.json",
      '{\n  "the": null\n}\n',
    )
    .file("data/dictionary/v.json", '{\n  "vertue": "virtue"\n}\n')
    .build();
  const lines = await dictionaryCoverage(await contextFor(files));
  expect(lines[0]).toBe(
    "corpus: 75.0% of 4 tokens accounted (50.0% confirmed, 25.0% unconfirmed)",
  );
  expect(lines[1]).toBe(
    "  a/w: 75.0% of 4 tokens accounted (50.0% confirmed, 25.0% unconfirmed)",
  );
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
  expect(catalogue.dictionary).toEqual({ the: entry(true, [w("the")]) });
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
      "'tis": entry(true, [w("it"), w("is", "be")]),
      is: entry(true, [w("is", "be")]),
      it: entry(true, [w("it")]),
      than: entry(true, [w("than")]),
      then: entry(true, [w("then")], [w("than")]),
    } satisfies Dictionary,
  );

  // A catalogue compiled before the dictionary existed loads as empty.
  delete files[`${CORPUS_ROOT}/catalogue/dictionary.json`];
  const older = await loadCatalogue(catalogueReader(fs), CORPUS_ROOT);
  expect(older.catalogue.dictionary).toEqual({});
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
