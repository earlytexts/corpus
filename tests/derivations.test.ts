/**
 * The build's per-source derivations file (src/build/derivations.ts): the
 * Compositor's cold-start seed. These cases check the round-trip (records
 * survive serialise → parse, Map/Set intact), the freshness stamp (size, hash,
 * version), and that a compiled corpus reduces to records whose `derived` and
 * per-file violations match the ones the loaded files carry.
 */

import { expect } from "@std/expect";
import { test } from "@std/testing/bdd";
import { CORPUS_ROOT, memoryCorpus } from "./harness.ts";
import {
  type DerivationRecord,
  derivationRecord,
  DERIVATIONS_VERSION,
  deserializeDerivations,
  hashText,
  precompiledSkeletons,
  serializeDerivations,
} from "../src/build/derivations.ts";
import { loadCorpus, validateFile } from "../src/validation/rules.ts";
import { buildCatalogue } from "../src/catalogue/compile.ts";

const fixture = memoryCorpus({
  [`${CORPUS_ROOT}/data/authors/hume.mit`]:
    `# hume\n\n[metadata]\nforename = "David"\nsurname = "Hume"\nbirth = 1711\ndeath = 1776\nsex = "Male"\nnationality = "Scottish"\n`,
  [`${CORPUS_ROOT}/data/works/hume/test/index.mit`]:
    `# hume.test\n\n[metadata]\ntitle = "A Test"\nbreadcrumb = "Test"\nauthors = ["hume"]\ncanonical = "1700"\n`,
  [`${CORPUS_ROOT}/data/works/hume/test/1700.mit`]:
    `# hume.test.1700\n\n[metadata]\ntitle = "A Test"\nbreadcrumb = "Test"\nimported = true\npublished = [1700]\nauthors = ["hume"]\n\n{#1}\nThe cat sat.\n`,
});

test("derivations: records round-trip through serialise/deserialise", async () => {
  const files = await loadCorpus(fixture, CORPUS_ROOT);
  const records = await Promise.all(
    files.map(
      async (f): Promise<[string, DerivationRecord]> => [
        f.path,
        await derivationRecord(f, { fs: fixture, root: CORPUS_ROOT }),
      ],
    ),
  );
  const json = serializeDerivations(records, CORPUS_ROOT);
  const parsed = deserializeDerivations(json)!;

  expect(parsed.version).toBe(DERIVATIONS_VERSION);
  expect(parsed.root).toBe(CORPUS_ROOT);
  expect([...parsed.records.keys()].sort()).toEqual(
    files.map((f) => f.path).sort(),
  );

  const edition = parsed.records.get("works/hume/test/1700.mit")!;
  const original = files.find((f) => f.path === "works/hume/test/1700.mit")!;
  expect(edition.size).toBe(original.text.length);
  expect(edition.hash).toBe(hashText(original.text));
  // Map/Set survive the round-trip as the same live structures.
  expect(edition.derived.surfaces.get("cat")).toEqual(
    original.derived.surfaces.get("cat"),
  );
  expect(edition.derived.exemptSurfaces).toEqual(
    original.derived.exemptSurfaces,
  );
  // The persisted per-file violations equal a fresh validateFile of the source.
  expect(edition.violations).toEqual(
    await validateFile(original, { fs: fixture, root: CORPUS_ROOT }),
  );
});

test("derivations: skeletons rebuild the catalogue structure with no compile", async () => {
  const files = await loadCorpus(fixture, CORPUS_ROOT);
  const records = new Map<string, DerivationRecord>(
    await Promise.all(
      files.map(
        async (f): Promise<[string, DerivationRecord]> => [
          f.path,
          await derivationRecord(f, { fs: fixture, root: CORPUS_ROOT }),
        ],
      ),
    ),
  );
  // Round-trip through the file, then rebuild the structure from the skeletons.
  const parsed = deserializeDerivations(
    serializeDerivations(records, CORPUS_ROOT),
  )!;
  const fromSkeletons = await buildCatalogue(
    fixture,
    CORPUS_ROOT,
    precompiledSkeletons(parsed.records, CORPUS_ROOT),
  );
  const full = await buildCatalogue(fixture, CORPUS_ROOT);
  const shape = (c: Awaited<ReturnType<typeof buildCatalogue>>["catalogue"]) =>
    c.authors.map((a) => ({
      slug: a.slug,
      works: a.works.map((w) => ({
        slug: w.slug,
        title: w.title,
        canonicalSlug: w.canonicalSlug,
        editions: w.editions.map((e) => ({
          slug: e.slug,
          id: e.document.id,
          title: e.title,
          published: e.published,
        })),
      })),
    }));
  expect(shape(fromSkeletons.catalogue)).toEqual(shape(full.catalogue));
  // Bodies are empty in the skeleton-built catalogue.
  for (const work of fromSkeletons.catalogue.authors[0]!.works) {
    for (const edition of work.editions) {
      expect(edition.document.blocks).toEqual([]);
    }
  }
});

test("derivations: a version or format mismatch parses as null", () => {
  expect(deserializeDerivations("{ not json")).toBe(null);
  expect(
    deserializeDerivations(
      JSON.stringify({ version: 0, root: "/x", records: {} }),
    ),
  ).toBe(null);
});

test("hashText: stable and content-sensitive", () => {
  expect(hashText("the cat sat")).toBe(hashText("the cat sat"));
  expect(hashText("the cat sat")).not.toBe(hashText("the cat sad"));
});
