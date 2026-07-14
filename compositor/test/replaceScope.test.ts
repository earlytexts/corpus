/**
 * The pure replace-scope planner: locating the edition behind a file path, and
 * deciding which source files each scope ("this work" / "this author") covers.
 * Built over a real catalogue (the corpus's own harness) so path resolution and
 * the dedup/ordering run against real catalogue shapes.
 */

import { expect, test } from "vitest";
import { buildCatalogue } from "@earlytexts/corpus";
import { CORPUS_ROOT, corpus, memoryCorpus } from "@earlytexts/corpus/test";
import { findEdition, replaceScopes } from "../src/lib/replaceScope.ts";

// David Hume: the Enquiry (two editions) and the Treatise (one edition).
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
      "{#1}\nText.",
    )
    .edition(
      "hume",
      "enquiry",
      "1758",
      {
        imported: false,
        title: "An Enquiry",
        breadcrumb: "Enquiry",
        published: [1758],
      },
      "{#1}\nText.",
    )
    .work("hume", "treatise", {
      title: "A Treatise",
      breadcrumb: "Treatise",
      canonical: "1739",
    })
    .edition(
      "hume",
      "treatise",
      "1739",
      {
        imported: false,
        title: "A Treatise",
        breadcrumb: "Treatise",
        published: [1739],
      },
      "{#1}\nText.",
    )
    // Adam Smith: a single work, single edition — no "this author" scope.
    .author("smith", { forename: "Adam", surname: "Smith" })
    .work("smith", "wealth", {
      title: "The Wealth of Nations",
      breadcrumb: "Wealth",
      canonical: "1776",
    })
    .edition(
      "smith",
      "wealth",
      "1776",
      {
        imported: false,
        title: "The Wealth of Nations",
        breadcrumb: "Wealth",
        published: [1776],
      },
      "{#1}\nText.",
    )
    .build();

const catalogue = async () => {
  const { catalogue } = await buildCatalogue(
    memoryCorpus(fixture()),
    CORPUS_ROOT,
  );
  return catalogue;
};

const path = (work: string, year: string, host = "hume") =>
  `${CORPUS_ROOT}/data/works/${host}/${work}/${year}.mit`;

test("findEdition resolves an edition from its (unnormalised) file path", async () => {
  const cat = await catalogue();
  // A ./ segment the normaliser must fold away.
  const found = findEdition(
    cat,
    path("enquiry", "1748").replace("/works", "/./works"),
  );
  expect(found?.work.breadcrumb).toBe("Enquiry");
  expect(found?.edition.slug).toBe("1748");
});

test("findEdition returns undefined for a non-edition file", async () => {
  const cat = await catalogue();
  expect(
    findEdition(cat, `${CORPUS_ROOT}/data/authors/hume.mit`),
  ).toBeUndefined();
});

test("the work scope covers every edition of that work", async () => {
  const cat = await catalogue();
  const { work, edition } = findEdition(cat, path("enquiry", "1748"))!;
  const scopes = replaceScopes(cat, work, edition);
  const workScope = scopes.find((s) => s.label === "This work")!;
  expect(workScope.files).toEqual([
    path("enquiry", "1748"),
    path("enquiry", "1758"),
  ]);
  expect(workScope.description).toBe("Enquiry · 2 editions");
});

test("the author scope appears when it reaches beyond the work, spanning all works", async () => {
  const cat = await catalogue();
  const { work, edition } = findEdition(cat, path("enquiry", "1748"))!;
  const scopes = replaceScopes(cat, work, edition);
  const authorScope = scopes.find((s) => s.label === "This author");
  // Works come in catalogue (chronological) order: Treatise 1739 before Enquiry.
  expect(authorScope?.files).toEqual([
    path("treatise", "1739"),
    path("enquiry", "1748"),
    path("enquiry", "1758"),
  ]);
  expect(authorScope?.description).toBe("David Hume · 2 works, 3 editions");
});

test("only the work scope when the author has this one work (singular label)", async () => {
  const cat = await catalogue();
  const { work, edition } = findEdition(cat, path("wealth", "1776", "smith"))!;
  const scopes = replaceScopes(cat, work, edition);
  expect(scopes.map((s) => s.label)).toEqual(["This work"]);
  expect(scopes[0].files).toEqual([path("wealth", "1776", "smith")]);
  expect(scopes[0].description).toBe("Wealth · 1 edition");
});
