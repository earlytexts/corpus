/**
 * The pure compare-editions choices: which works can be compared (≥2 editions,
 * deduplicated across co-authors) and the chronological successor of an edition.
 * Built over a real catalogue so the shapes are the ones the command sees.
 */

import { expect, test } from "vitest";
import { buildCatalogue } from "@earlytexts/corpus";
import { CORPUS_ROOT, corpus, memoryCorpus } from "@earlytexts/corpus/test";
import { comparableWorks, nextEdition } from "../src/lib/compareScope.ts";

// Hume: the Enquiry (two editions) and the Treatise (one edition only).
const fixture = () =>
  corpus()
    .author("hume", { forename: "David", surname: "Hume" })
    .work("hume", "enquiry", {
      title: "An Enquiry",
      breadcrumb: "Enquiry",
      canonical: "1748",
    })
    .edition("hume", "enquiry", "1748", {
      imported: false,
      title: "An Enquiry",
      breadcrumb: "Enquiry",
      published: [1748],
    })
    .edition("hume", "enquiry", "1758", {
      imported: false,
      title: "An Enquiry",
      breadcrumb: "Enquiry",
      published: [1758],
    })
    .work("hume", "treatise", {
      title: "A Treatise",
      breadcrumb: "Treatise",
      canonical: "1739",
    })
    .edition("hume", "treatise", "1739", {
      imported: false,
      title: "A Treatise",
      breadcrumb: "Treatise",
      published: [1739],
    })
    .build();

const catalogue = async () => {
  const { catalogue } = await buildCatalogue(
    memoryCorpus(fixture()),
    CORPUS_ROOT,
  );
  return catalogue;
};

test("only works with two or more editions are comparable", async () => {
  const cat = await catalogue();
  const works = comparableWorks(cat.authors);
  // The single-edition Treatise is filtered out.
  expect(works.map((w) => w.breadcrumb)).toEqual(["Enquiry"]);
});

test("a work shared across authors is offered once", async () => {
  const cat = await catalogue();
  const enquiry = cat.byAuthor
    .get("hume")!
    .works.find((w) => w.editions.length >= 2)!;
  // Simulate a co-authored work: the same Work object under two authors.
  const works = comparableWorks([{ works: [enquiry] }, { works: [enquiry] }]);
  expect(works).toEqual([enquiry]);
});

test("nextEdition returns the chronological successor, then undefined", async () => {
  const cat = await catalogue();
  const enquiry = cat.byAuthor
    .get("hume")!
    .works.find((w) => w.editions.length >= 2)!;
  const [first, second] = enquiry.editions;
  expect(first.slug).toBe("1748");
  expect(nextEdition(enquiry, first)).toBe(second);
  expect(nextEdition(enquiry, second)).toBeUndefined();
});
