/**
 * The doc-free validation tiers (src/validation/rules.ts): `validateCorpus`
 * runs the flat rule list over positioned documents; the Compositor instead
 * reduces each file to its `derived` + `FileProjection` and validates from
 * those, so no positioned document need stay resident. This suite is the guard
 * that the two agree — the golden equivalence the memory plan calls for — over
 * a fixture that fires every tiered rule (the real corpus is clean, so it can't
 * exercise them). Also checks `projectFile` captures what the tiers read.
 */

import { expect } from "@std/expect";
import { test } from "@std/testing/bdd";
import { CORPUS_ROOT, memoryCorpus } from "./harness.ts";
import {
  type CorpusFile,
  loadCorpus,
  projectCorpus,
  projectFile,
  validateCorpus,
  validateCrossFile,
  validateDictionary,
  validateFile,
  validateWordAndOverride,
  type Violation,
} from "../src/validation/rules.ts";
import {
  parseDictionary,
  readDictionaryShards,
} from "../src/dictionary/shards.ts";

/** Recompose the whole corpus's violations from the doc-free tiers alone. */
const validateByTiers = async (
  files: CorpusFile[],
  root: string,
): Promise<Violation[]> => {
  const fs = memoryCorpus(fixtureMap);
  const projections = projectCorpus(files);
  const raw = parseDictionary(await readDictionaryShards(fs, root)).dictionary;
  const wordEntries = files.map((f, i) => ({
    path: f.path,
    clean: f.errors.length === 0,
    marked: f.derived.marked,
    overrides: projections[i]!.overrides,
  }));
  return [
    ...(await Promise.all(files.map((f) => validateFile(f, { fs, root }))))
      .flat(),
    ...validateWordAndOverride(wordEntries, raw),
    ...(await validateCrossFile(projections, { fs, root })),
    ...(await validateDictionary({ fs, root })),
  ];
};

/** Order-independent comparison: the tiers group by tier, the flat rules by
 * rule, so the two lists carry the same violations in different orders. */
const sorted = (violations: Violation[]): string[] =>
  violations.map((v) => JSON.stringify(v)).sort();

/**
 * A fixture that trips every tiered rule at least once:
 *  - file-only: a text missing schema keys, a bad root ID, a dotted heading;
 *  - dict-dependent: an unregistered `[w:]` markup, an unfolded override;
 *  - cross-file: an unknown author, a stub naming a missing canonical, an
 *    unresolvable borrowed child, an uppercase (non-slug) directory;
 *  - dictionary: a malformed shard.
 */
const fixtureMap: Record<string, string> = {
  [`${CORPUS_ROOT}/data/authors/hume.mit`]:
    `# hume\n\n[metadata]\nforename = "David"\nsurname = "Hume"\nbirth = 1711\ndeath = 1776\nsex = "Male"\nnationality = "Scottish"\n`,
  // A work stub whose canonical names an edition that does not exist.
  [`${CORPUS_ROOT}/data/works/hume/test/index.mit`]:
    `# hume.test\n\n[metadata]\ntitle = "A Test"\nbreadcrumb = "Test"\nauthors = ["hume"]\ncanonical = "9999"\n`,
  // A clean edition that trips the dict-dependent and cross-file rules.
  [`${CORPUS_ROOT}/data/works/hume/test/1700.mit`]:
    `# Hume.test.1700\n\n[metadata]\ntitle = "A Test"\nbreadcrumb = "Test"\nimported = true\npublished = [1700]\nauthors = ["nobody"]\n\n[metadata.dictionary]\nFoo = "human"\n\n{#1}\n[w:humane=human] humane text here.\n\n## <Foo.Bar.Baz>\n`,
  // An uppercase directory name (layout: names should be lowercase slugs).
  [`${CORPUS_ROOT}/data/works/hume/Test/index.mit`]:
    `# hume.Test\n\n[metadata]\ntitle = "Bad"\nbreadcrumb = "Bad"\nauthors = ["hume"]\ncanonical = "1700"\n`,
  // A malformed dictionary shard (invalid JSON).
  [`${CORPUS_ROOT}/data/dictionary/h.json`]: `{ not json`,
};

test("tiers: the doc-free tiers recompose validateCorpus exactly", async () => {
  const fs = memoryCorpus(fixtureMap);
  const files = await loadCorpus(fs, CORPUS_ROOT);
  const flat = await validateCorpus({ files, fs, root: CORPUS_ROOT });
  const tiered = await validateByTiers(files, CORPUS_ROOT);
  expect(sorted(tiered)).toEqual(sorted(flat));
});

test("tiers: the fixture actually exercises every tiered rule", async () => {
  const fs = memoryCorpus(fixtureMap);
  const files = await loadCorpus(fs, CORPUS_ROOT);
  const names = new Set(
    (await validateCorpus({ files, fs, root: CORPUS_ROOT })).map((v) => v.rule),
  );
  for (
    const rule of [
      "every authors slug names a known author",
      "work stubs name a canonical edition that exists",
      "borrowed-child references resolve to an edition",
      "layout: lowercase names, index.mit in every directory",
      "word markup selects a dictionary reading",
      "dictionary overrides select a reading",
      "dictionary shards are well-formed",
    ]
  ) {
    expect(names.has(rule)).toBe(true);
  }
});

test("validateFile: a file's per-file violations are exactly its slice of the whole", async () => {
  const fs = memoryCorpus(fixtureMap);
  const files = await loadCorpus(fs, CORPUS_ROOT);
  const flat = await validateCorpus({ files, fs, root: CORPUS_ROOT });
  const fileOnly = new Set([
    "every file compiles without errors",
    "every file is formatted canonically",
    "author files match the author schema",
    "texts match the text schema",
    "block metadata matches the block schema",
    "root IDs match file paths",
    "section headings are bare segments",
  ]);
  for (const file of files) {
    const perFile = await validateFile(file, { fs, root: CORPUS_ROOT });
    const expected = flat.filter(
      (v) => v.path === file.path && fileOnly.has(v.rule),
    );
    expect(sorted(perFile)).toEqual(sorted(expected));
  }
});

test("projectFile: captures declared authors, overrides, borrowed refs, and the stub", async () => {
  const fs = memoryCorpus(fixtureMap);
  const files = await loadCorpus(fs, CORPUS_ROOT);
  const edition = files.find((f) => f.path === "works/hume/test/1700.mit")!;
  const projection = projectFile(edition);
  expect(projection.clean).toBe(true);
  expect(projection.declaredAuthors.map((a) => a.slug)).toContain("nobody");
  expect(projection.overrides.flatMap((o) => o.entries)).toContainEqual([
    "Foo",
    "human",
  ]);
  expect(projection.borrowedRefs.map((r) => r.ref)).toContain("Foo.Bar.Baz");

  const stub = files.find((f) => f.path === "works/hume/test/index.mit")!;
  expect(projectFile(stub).stub?.canonical).toBe("9999");
});
