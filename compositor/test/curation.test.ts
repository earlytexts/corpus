/**
 * The corpus-wide curation worklist: tallying the surfaces the dictionary does
 * not account for, ranked for curation. Built over a real catalogue (the
 * corpus's own harness) so the counting, ranking, and the attested-example
 * capture are all exercised against the real accounting rule.
 */

import { expect, test } from "vitest";
import { buildCatalogue } from "@earlytexts/corpus";
import { CORPUS_ROOT, corpus, memoryCorpus } from "@earlytexts/corpus/test";
import { curationList, curationRows } from "../src/lib/curation.ts";

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

const built = async () =>
  (await buildCatalogue(memoryCorpus(fixture()), CORPUS_ROOT)).catalogue;

const list = async () => curationList(await built());

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

test("curationRows tags each surface with its shard letter", async () => {
  const { rows } = curationRows(await built(), 10);
  expect(rows.map((r) => [r.surface, r.letter])).toEqual([
    ["wombat", "w"],
    ["and", "a"],
    ["sleep", "s"],
  ]);
});

test("curationRows caps to the most frequent and reports the true total", async () => {
  const { rows, total } = curationRows(await built(), 1);
  expect(total).toBe(3); // wombat, and, sleep
  expect(rows.map((r) => r.surface)).toEqual(["wombat"]); // the single biggest win
});
