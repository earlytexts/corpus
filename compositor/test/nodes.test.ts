/**
 * The node→file-path lookups shared between the corpus tree and the commands
 * (../src/lib/nodes.ts). editionPath is exercised through the replace-scope
 * planner; authorPath is only reached from the VSCode surface, so it is pinned
 * here directly, over a real catalogue author.
 */

import { expect, test } from "vitest";
import { buildCatalogue } from "@earlytexts/corpus";
import { CORPUS_ROOT, corpus, memoryCorpus } from "@earlytexts/corpus/test";
import { authorPath } from "../src/lib/nodes.ts";

test("authorPath resolves an author to its .mit file under the root", async () => {
  const files = corpus()
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
    .build();
  const { catalogue } = await buildCatalogue(memoryCorpus(files), CORPUS_ROOT);
  const author = catalogue.byAuthor.get("hume")!;
  expect(authorPath(CORPUS_ROOT, author)).toBe(
    `${CORPUS_ROOT}/data/authors/hume.mit`,
  );
});
