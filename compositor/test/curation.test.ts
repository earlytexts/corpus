/**
 * The corpus-wide curation worklist: merging the per-file surface summaries
 * into one token index, and applying the register to it as a membership test —
 * tallying, ranking, and the attested-example capture. Built over files loaded
 * by the corpus's own loadCorpus (which computes the per-file derivations), so
 * the whole derive → merge → classify path is exercised against the real
 * accounting semantics.
 */

import { expect, test } from "vitest";
import {
  loadCorpus,
  parseDictionary,
  readDictionaryShards,
} from "@earlytexts/corpus";
import { CORPUS_ROOT, corpus, memoryCorpus } from "@earlytexts/corpus/test";
import {
  buildTokenIndex,
  curationList,
  curationRows,
} from "../src/lib/curation.ts";

const fixture = () =>
  corpus()
    .author("hume", { forename: "David", surname: "Hume" })
    .work("hume", "enquiry", {
      title: "An Enquiry",
      breadcrumb: "Enquiry",
      canonical: "1748",
    })
    .edition(
      "hume",
      "enquiry",
      "1748",
      {
        imported: false,
        title: "An Enquiry",
        breadcrumb: "Enquiry",
        published: [1748],
      },
      "{#1}\nThe wombat and the wombat sleep.",
    )
    .file("data/dictionary/t.json", '{\n  "the": null\n}\n')
    .build();

const built = async () => {
  const fs = memoryCorpus(fixture());
  const files = await loadCorpus(fs, CORPUS_ROOT);
  const { dictionary } = parseDictionary(
    await readDictionaryShards(fs, CORPUS_ROOT),
  );
  return { index: buildTokenIndex(files, CORPUS_ROOT), register: dictionary };
};

const list = async () => {
  const { index, register } = await built();
  return curationList(index, register);
};

test("ranks unknown surfaces by frequency, then alphabetically", async () => {
  const entries = await list();
  expect(entries.map((e) => e.surface)).toEqual([
    "wombat", // ×2 — most frequent first
    "and", // ×1, alphabetical
    "sleep",
  ]);
  expect(entries.map((e) => e.count)).toEqual([2, 1, 1]);
});

test("attaches an attested occurrence to open in context", async () => {
  const wombat = (await list()).find((e) => e.surface === "wombat");
  expect(wombat?.example?.path).toBe(
    `${CORPUS_ROOT}/data/works/hume/enquiry/1748.mit`,
  );
  expect(typeof wombat?.example?.line).toBe("number");
});

test("accounted words never appear", async () => {
  const entries = await list();
  expect(entries.some((e) => e.surface === "the")).toBe(false);
});

test("possessives of registered bases never appear", async () => {
  const { index, register } = await built();
  index.set("the's", { count: 1 });
  index.set("wombat's", { count: 1 });
  const entries = curationList(index, register);
  expect(entries.some((e) => e.surface === "the's")).toBe(false); // base registered
  expect(entries.some((e) => e.surface === "wombat's")).toBe(true); // base is not
});

test("a register edit reclassifies the same index", async () => {
  const { index, register } = await built();
  expect(
    curationList(index, register).some((e) => e.surface === "wombat"),
  ).toBe(true);
  expect(
    curationList(index, { ...register, wombat: null }).some(
      (e) => e.surface === "wombat",
    ),
  ).toBe(false);
});

test("curationRows tags each surface with its shard letter", async () => {
  const { index, register } = await built();
  const { rows } = curationRows(index, register, 10);
  expect(rows.map((r) => [r.surface, r.letter])).toEqual([
    ["wombat", "w"],
    ["and", "a"],
    ["sleep", "s"],
  ]);
});

test("curationRows caps to the most frequent and reports the true total", async () => {
  const { index, register } = await built();
  const { rows, total } = curationRows(index, register, 1);
  expect(total).toBe(3); // wombat, and, sleep
  expect(rows.map((r) => r.surface)).toEqual(["wombat"]); // the single biggest win
});
