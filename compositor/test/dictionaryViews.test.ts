/**
 * The two cross-cut views the dictionary panel browses: variant-spelling maps
 * (cross-references) and lemmas with all their forms. Both are derived, pure,
 * from the authored (raw) dictionary; these cases pin how each entry shape —
 * headword, inflection, cross-reference, ambiguous — lands in the views.
 */

import { expect, test } from "vitest";
import { parseDictionary, type RawDictionary } from "@earlytexts/corpus";
import { dictionaryViews, letterOf } from "../src/lib/dictionaryViews.ts";

/** Parse shard text into a RawDictionary, asserting it is well-formed so a
 * test never silently feeds the view a dropped entry. */
const dictOf = (shards: Record<string, string>): RawDictionary => {
  const { dictionary, problems } = parseDictionary(
    new Map(Object.entries(shards)),
  );
  expect(problems).toEqual([]);
  return dictionary;
};

test("groups a headword with its inflected forms", () => {
  const { lemmas } = dictionaryViews(
    dictOf({
      "a.json":
        '{\n  "abandon": null,\n  "abandoned": "=abandon",\n  "abandoning": "=abandon"\n}\n',
    }),
  );
  expect(lemmas).toEqual([
    {
      lemma: "abandon",
      headword: true,
      forms: ["abandoned", "abandoning"],
      letter: "a",
    },
  ]);
});

test("lists a variant with its canonical spelling", () => {
  const { variants } = dictionaryViews(
    dictOf({ "s.json": '{\n  "shew": "show"\n}\n' }),
  );
  expect(variants).toEqual([
    { surface: "shew", spellings: ["show"], ambiguous: false, letter: "s" },
  ]);
});

test("a contraction is a multi-word variant", () => {
  const { variants } = dictionaryViews(
    dictOf({ "s.json": '{\n  "she\'s": "she is"\n}\n' }),
  );
  expect(variants).toEqual([
    {
      surface: "she's",
      spellings: ["she", "is"],
      ambiguous: false,
      letter: "s",
    },
  ]);
});

test("an ambiguous entry is both a headword and a form of another lemma", () => {
  const { lemmas } = dictionaryViews(
    dictOf({ "l.json": '{\n  "lay": [null, "=lie"]\n}\n' }),
  );
  expect(lemmas).toEqual([
    { lemma: "lay", headword: true, forms: [], letter: "l" },
    { lemma: "lie", headword: false, forms: ["lay"], letter: "l" },
  ]);
});

test("a form buckets under its lemma's letter, not its own", () => {
  const { lemmas } = dictionaryViews(
    dictOf({
      "g.json": '{\n  "go": null\n}\n',
      "w.json": '{\n  "went": "=go"\n}\n',
    }),
  );
  expect(lemmas).toEqual([
    { lemma: "go", headword: true, forms: ["went"], letter: "g" },
  ]);
});

test("a lemma referenced only by forms has no headword", () => {
  const { lemmas } = dictionaryViews(
    dictOf({ "g.json": '{\n  "gone": "=go"\n}\n' }),
  );
  expect(lemmas).toEqual([
    { lemma: "go", headword: false, forms: ["gone"], letter: "g" },
  ]);
});

test("a variant contributes no lemma (its target's entry supplies it)", () => {
  const { lemmas } = dictionaryViews(
    dictOf({ "s.json": '{\n  "shew": "show"\n}\n' }),
  );
  expect(lemmas).toEqual([]);
});

test("sorts variants by surface and lemmas by lemma, forms within a lemma", () => {
  const { variants, lemmas } = dictionaryViews(
    dictOf({
      "c.json": '{\n  "colour": "color"\n}\n',
      "a.json": '{\n  "abed": "bed"\n}\n',
      "b.json":
        '{\n  "bear": null,\n  "bearing": "=bear",\n  "bears": "=bear",\n  "bore": "=bear"\n}\n',
    }),
  );
  expect(variants.map((v) => v.surface)).toEqual(["abed", "colour"]);
  expect(lemmas.map((l) => l.lemma)).toEqual(["bear"]);
  expect(lemmas[0].forms).toEqual(["bearing", "bears", "bore"]);
});

test("letterOf maps a surface to its shard letter, non-letters to other", () => {
  expect(letterOf("abandon")).toBe("a");
  expect(letterOf("a priori")).toBe("a");
  expect(letterOf("œconomy")).toBe("other");
});
