/**
 * The external authority links (../../src/core/catalogue/links.ts): which
 * links an author or edition has, where each resolves to, and the `viewItem`
 * tokens the tree marks a node with so its context menu offers only the links
 * that entity records.
 *
 * Structural fixtures, as in nodes.test.ts — the logic only reads the four
 * identifier fields.
 */

import { expect, test } from "vitest";
import type { Author, Edition, Work } from "@earlytexts/corpus";
import {
  authorLinks,
  editionLinks,
  type Link,
  linkTokens,
  linkUrl,
  nodeLinks,
} from "../../src/core/catalogue/links.ts";

const author = (viaf?: string, wikidata?: string): Author =>
  ({
    slug: "hume",
    surname: "Hume",
    forename: "David",
    viaf,
    wikidata,
  }) as Author;

const edition = (estc?: string, tcp?: string): Edition =>
  ({ slug: "1748", estc, tcp }) as Edition;

const kinds = (links: Link[]): string[] => links.map((link) => link.kind);

test("an author's links resolve to VIAF and Wikidata, in menu order", () => {
  const links = authorLinks(author("49226972", "Q37160"));
  expect(kinds(links)).toEqual(["viaf", "wikidata"]);
  expect(links).toEqual([
    {
      kind: "viaf",
      id: "49226972",
      label: "VIAF",
      url: "https://viaf.org/viaf/49226972",
    },
    {
      kind: "wikidata",
      id: "Q37160",
      label: "Wikidata",
      url: "https://www.wikidata.org/wiki/Q37160",
    },
  ]);
});

test("an edition's links resolve to ESTC and the TCP text, in menu order", () => {
  const links = editionLinks(edition("T77181", "A52437"));
  expect(kinds(links)).toEqual(["estc", "tcp"]);
  // ESTC is served by CERL, not the British Library, since the catalogue moved.
  expect(linkUrl(links, "estc")).toBe("https://datb.cerl.org/estc/T77181");
  expect(linkUrl(links, "tcp")).toBe(
    "https://github.com/textcreationpartnership/A52437",
  );
});

test("an identifier the entity does not record yields no link", () => {
  expect(authorLinks(author(undefined, "Q37160")).map((l) => l.kind)).toEqual([
    "wikidata",
  ]);
  expect(authorLinks(author())).toEqual([]);
  expect(editionLinks(edition("T77181"))).toEqual([
    {
      kind: "estc",
      id: "T77181",
      label: "ESTC",
      url: "https://datb.cerl.org/estc/T77181",
    },
  ]);
  expect(editionLinks(edition())).toEqual([]);
  // An empty string is as good as absent — no link to a blank record.
  expect(authorLinks(author(""))).toEqual([]);
});

test("linkUrl finds one kind among an entity's links, or nothing", () => {
  const links = authorLinks(author("49226972"));
  expect(linkUrl(links, "viaf")).toBe("https://viaf.org/viaf/49226972");
  expect(linkUrl(links, "wikidata")).toBeUndefined();
});

test("nodeLinks reads the links off whichever entity a tree node carries", () => {
  const work = { editions: [] } as unknown as Work;
  expect(
    kinds(nodeLinks({ kind: "author", author: author("49226972") })),
  ).toEqual(["viaf"]);
  expect(
    kinds(nodeLinks({ kind: "edition", edition: edition("T77181"), work })),
  ).toEqual(["estc"]);
  // A borrowed child *is* an edition, so it links the same way.
  expect(
    kinds(
      nodeLinks({
        kind: "borrowed",
        edition: edition(undefined, "A52437"),
        work,
      }),
    ),
  ).toEqual(["tcp"]);
  // A work has no authority record of its own, nor does a letter group.
  expect(nodeLinks({ kind: "work", work, author: author() })).toEqual([]);
  expect(nodeLinks({ kind: "letter", letter: "H", authors: [] })).toEqual([]);
  expect(nodeLinks(undefined)).toEqual([]);
});

test("linkTokens marks a node with a token per link it has", () => {
  // The tree appends these to a contextValue ("author" → "author.viaf.wikidata")
  // and package.json's `when` clauses match the tokens as whole words.
  expect(linkTokens(authorLinks(author("49226972", "Q37160")))).toBe(
    ".viaf.wikidata",
  );
  expect(linkTokens(editionLinks(edition(undefined, "A52437")))).toBe(".tcp");
  expect(linkTokens(editionLinks(edition()))).toBe("");
  for (const token of [".viaf", ".wikidata", ".estc", ".tcp"]) {
    const value = `author${token}`;
    expect(new RegExp(`\\b${token.slice(1)}\\b`).test(value)).toBe(true);
  }
});
