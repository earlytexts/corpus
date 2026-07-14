/**
 * The corpus-wide curation worklist: tallying the surfaces the dictionary does
 * not account for, ranked for curation. Built over a real catalogue (the
 * corpus's own harness) so the counting, ranking, and the attested-example
 * capture are all exercised against the real accounting rule.
 */

import { expect, test } from "vitest";
import { buildCatalogue } from "@earlytexts/corpus";
import { CORPUS_ROOT, corpus, memoryCorpus } from "@earlytexts/corpus/test";
import { curationList } from "../src/lib/curation.ts";

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

const list = async () => {
  const { catalogue } = await buildCatalogue(
    memoryCorpus(fixture()),
    CORPUS_ROOT,
  );
  return curationList(catalogue);
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
