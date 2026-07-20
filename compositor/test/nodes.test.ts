/**
 * The pure tree model shared between the corpus tree and the commands
 * (../src/lib/nodes.ts): the node→file-path lookups, author indexing, the
 * document→edition map and borrowed-child traversal, and the label helpers.
 * editionPath is exercised through the replace-scope planner; authorPath is only
 * reached from the VSCode surface, so it is pinned here directly, over a real
 * catalogue author. The rest are unit-tested over structural fixtures — the
 * logic only cares about object identity and a few fields — in the spirit of
 * catalogueWalk.test.ts.
 */

import { expect, test } from "vitest";
import { buildCatalogue } from "@earlytexts/corpus";
import type { Author, Catalogue, Edition, Work } from "@earlytexts/corpus";
import type { MarkitDocument } from "@jsr/earlytexts__markit";
import { CORPUS_ROOT, corpus, memoryCorpus } from "@earlytexts/corpus/test";
import {
  authorPath,
  borrowedChildren,
  capitalize,
  editionsByDocument,
  letterGroups,
  lifespan,
  type TreeNode,
  workDocId,
} from "../src/lib/nodes.ts";

const author = (surname: string, forename = "", slug = "x"): Author =>
  ({ slug, surname, forename }) as Author;

const doc = (id = "", children: MarkitDocument[] = []): MarkitDocument =>
  ({ id, children }) as MarkitDocument;

const edition = (document: MarkitDocument, slug = ""): Edition =>
  ({ document, slug }) as Edition;

const work = (...editions: Edition[]): Work => ({ editions }) as Work;

const letterOf = (node: TreeNode): string =>
  node.kind === "letter" ? node.letter : "";

const authorsOf = (node: TreeNode): Author[] =>
  node.kind === "letter" ? node.authors : [];

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

test("letterGroups files authors by initial, sorting the letters and each group", () => {
  const hume = author("Hume", "David");
  const hobbes = author("Hobbes", "Thomas");
  const berkeley = author("Berkeley", "George");
  // Given in a deliberately unsorted (chronological-ish) order.
  const groups = letterGroups([hume, berkeley, hobbes]);
  expect(groups.map(letterOf)).toEqual(["B", "H"]);
  // Within "H", surname order puts Hobbes before Hume.
  expect(authorsOf(groups[1])).toEqual([hobbes, hume]);
});

test("letterGroups falls back to the slug's initial when there is no surname", () => {
  const anon = author("", "", "zeno");
  expect(letterGroups([anon]).map(letterOf)).toEqual(["Z"]);
});

test("editionsByDocument keys each edition by its document, recovering its work", () => {
  const d1 = doc();
  const d2 = doc();
  const w = work(edition(d1), edition(d2));
  const catalogue = { authors: [{ works: [w] }] } as Catalogue;
  const map = editionsByDocument(catalogue);
  expect(map.get(d1)?.work).toBe(w);
  expect(map.get(d2)?.edition).toBe(w.editions[1]);
});

test("borrowedChildren returns only the children that are catalogued editions", () => {
  const borrowed = doc();
  const inlineSection = doc(); // a collection's own text, not a catalogued edition
  const collection = doc("Coll.1", [borrowed, inlineSection]);
  const borrowedWork = work(edition(borrowed));
  const catalogue = {
    authors: [{ works: [work(edition(collection)), borrowedWork] }],
  } as Catalogue;
  const refs = borrowedChildren(
    edition(collection),
    editionsByDocument(catalogue),
  );
  expect(refs.map((r) => r.work)).toEqual([borrowedWork]);
});

test("lifespan formats known, partial, and unknown year ranges", () => {
  expect(lifespan({ birth: 1711, death: 1776 } as Author)).toBe("(1711–1776)");
  expect(lifespan({ birth: 1711 } as Author)).toBe("(1711–?)");
  expect(lifespan({ death: 1776 } as Author)).toBe("(?–1776)");
  expect(lifespan({} as Author)).toBe("");
});

test("workDocId strips the year off an edition's document ID", () => {
  const w = work(edition(doc("Hume.EHU.1748")));
  expect(workDocId(w)).toBe("Hume.EHU");
});

test("workDocId falls back to the host and work slugs when there is no edition", () => {
  const w = { editions: [], hostSlug: "hume", slug: "ehu" } as unknown as Work;
  expect(workDocId(w)).toBe("Hume.EHU");
});

test("capitalize upper-cases only the first letter", () => {
  expect(capitalize("hume")).toBe("Hume");
  expect(capitalize("")).toBe("");
});
