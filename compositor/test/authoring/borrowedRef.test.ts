/**
 * The pure half of "insert a borrowed-child reference": the editions a
 * contributor may borrow (each work once, even when co-authored) and the
 * reference line that borrows one. Built over a real catalogue so the shapes are
 * the ones the command sees.
 */

import { expect, test } from "vitest";
import { buildCatalogue } from "@earlytexts/corpus";
import { CORPUS_ROOT, corpus, memoryCorpus } from "@earlytexts/corpus/test";
import {
  borrowableEditions,
  borrowedRefSnippet,
} from "../../src/core/authoring/borrowedRef.ts";

// A co-authored work (under the hyphenated "astell-norris" directory, so it
// lists under both authors) alongside a single-author work with two editions.
const fixture = () =>
  corpus()
    .author("astell", { forename: "Mary", surname: "Astell" })
    .author("norris", { forename: "John", surname: "Norris" })
    .work("astell-norris", "letters", {
      title: "Letters concerning the Love of God",
      breadcrumb: "Letters",
      canonical: "1695",
    })
    .edition("astell-norris", "letters", "1695", {
      imported: false,
      title: "Letters concerning the Love of God",
      breadcrumb: "1695",
      published: [1695],
    })
    .author("hume", { forename: "David", surname: "Hume" })
    .work("hume", "enquiry", {
      title: "An Enquiry",
      breadcrumb: "Enquiry",
      canonical: "1748",
    })
    .edition("hume", "enquiry", "1748", {
      imported: false,
      title: "An Enquiry",
      breadcrumb: "1748",
      published: [1748],
    })
    .edition("hume", "enquiry", "1758", {
      imported: false,
      title: "An Enquiry",
      breadcrumb: "1758",
      published: [1758],
    })
    .build();

const catalogue = async () => {
  const { catalogue } = await buildCatalogue(
    memoryCorpus(fixture()),
    CORPUS_ROOT,
  );
  return catalogue;
};

test("borrowableEditions lists every edition once, even a co-authored work", async () => {
  const choices = borrowableEditions(await catalogue());
  // The co-authored Letters lists under both Astell and Norris but is collected
  // a single time; each work contributes each of its editions once.
  expect(choices).toEqual([
    {
      id: "astell-norris.letters.1695",
      title: "Letters concerning the Love of God",
    },
    { id: "hume.enquiry.1748", title: "An Enquiry" },
    { id: "hume.enquiry.1758", title: "An Enquiry" },
  ]);
});

test("borrowedRefSnippet is the borrowed-child heading line", () => {
  expect(borrowedRefSnippet("Hume.EHU.1748")).toBe("## <Hume.EHU.1748>\n");
});
