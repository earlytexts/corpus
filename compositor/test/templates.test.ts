/**
 * The scaffold templates must produce exactly what the corpus accepts: already
 * formatted, compiling cleanly, and passing every validation rule. Each test
 * builds a tiny in-memory corpus around the scaffolded files (via the corpus's
 * own test harness) and runs the real rule set over it.
 */

import { describe, expect, it } from "vitest";
import { compile, format } from "@jsr/earlytexts__markit";
import {
  loadCorpus,
  rules,
  validateCorpus,
  type Violation,
} from "@earlytexts/corpus";
import { CORPUS_ROOT, corpus, memoryCorpus } from "@earlytexts/corpus/test";
import { authorFile, editionFile, stubFile } from "../src/lib/templates.ts";

const author = authorFile({
  slug: "hume",
  forename: "David",
  surname: "Hume",
  birth: 1711,
  death: 1776,
  nationality: "Scottish",
  sex: "Male",
});

const stub = stubFile({
  id: "Hume.EHU",
  title: "An Enquiry concerning Human Understanding",
  breadcrumb: "First Enquiry",
  authors: ["hume"],
  canonical: "1748",
});

const edition = editionFile({
  id: "Hume.EHU.1748",
  title: "Philosophical Essays concerning Human Understanding",
  breadcrumb: "1748",
  authors: ["hume"],
  published: [1748],
});

const validateFiles = async (
  files: Record<string, string>,
): Promise<Violation[]> => {
  const fs = memoryCorpus(files);
  const loaded = await loadCorpus(fs, CORPUS_ROOT);
  return validateCorpus({ files: loaded, fs, root: CORPUS_ROOT });
};

describe("scaffold templates", () => {
  it("compile without errors", () => {
    for (const text of [author, stub, edition]) {
      expect(compile(text)[1]).toEqual([]);
    }
  });

  it("are already canonically formatted", () => {
    for (const text of [author, stub, edition]) {
      expect(format(text)).toBe(text);
    }
  });

  it("pass every corpus validation rule together", async () => {
    const files = corpus().build();
    files[`${CORPUS_ROOT}/data/authors/hume.mit`] = author;
    files[`${CORPUS_ROOT}/data/works/hume/ehu/index.mit`] = stub;
    files[`${CORPUS_ROOT}/data/works/hume/ehu/1748.mit`] = edition;
    expect(await validateFiles(files)).toEqual([]);
  });

  it("violations surface when a scaffold is broken", async () => {
    const files = corpus().build();
    files[`${CORPUS_ROOT}/data/authors/hume.mit`] = author;
    files[`${CORPUS_ROOT}/data/works/hume/ehu/index.mit`] = stub;
    // No 1748 edition: the canonical pointer must dangle.
    const violations = await validateFiles(files);
    expect(violations.map((v) => v.rule)).toContain(
      "work stubs name a canonical edition that exists",
    );
  });

  it("the rule set is intact", () => {
    // The scaffolds and dictionary quick-fixes lean on these corpus rules by
    // name; assert they are present rather than pinning an exact count (which
    // breaks on every unrelated corpus rule addition).
    const names = new Set(rules.map((r) => r.name));
    for (const name of [
      "every file compiles without errors",
      "every file is formatted canonically",
      "author files match the author schema",
      "texts match the text schema",
      "work stubs name a canonical edition that exists",
      "root IDs match file paths",
      "dictionary shards are well-formed",
      "dictionary readings resolve within the register",
    ]) {
      expect(names).toContain(name);
    }
  });
});
