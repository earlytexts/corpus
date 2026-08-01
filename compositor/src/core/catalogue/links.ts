/**
 * The external authority records a corpus entity links to: VIAF and Wikidata for
 * an author, ESTC and TCP for an edition (see the corpus README's "External
 * identifiers"). The corpus stores bare identifiers, so the URL is built here —
 * one place to change if a provider moves, as ESTC did when it left the British
 * Library for CERL.
 *
 * Pure — corpus types only, no VSCode — so the tree can ask which links an entity
 * has (to decide what its context menu offers) and the commands can ask for the
 * URL, without either depending on the other.
 */

import type { Author, Edition } from "@earlytexts/corpus";
import type { TreeNode } from "./nodes.ts";

/** The authorities an entity can be linked to; also the command suffix and the
 * `viewItem` token the tree marks a node with (see `linkTokens`). */
export type LinkKind = "viaf" | "wikidata" | "estc" | "tcp";

/** A resolved link: where it goes, and what to call it in the UI. */
export type Link = { kind: LinkKind; id: string; label: string; url: string };

const AUTHORITIES: Record<
  LinkKind,
  { label: string; url: (id: string) => string }
> = {
  viaf: {
    label: "VIAF",
    url: (id) => `https://viaf.org/viaf/${id}`,
  },
  wikidata: {
    label: "Wikidata",
    url: (id) => `https://www.wikidata.org/wiki/${id}`,
  },
  estc: {
    // ESTC is served by CERL since it moved from the British Library; the old
    // estc.bl.uk/<id> URLs redirect to the catalogue's front page, not the record.
    label: "ESTC",
    url: (id) => `https://datb.cerl.org/estc/${id}`,
  },
  tcp: {
    // The TCP text's own repository — the project's distribution point for every
    // phase (EEBO, ECCO, Evans). Where the corpus read the text through a
    // reading interface over TCP, that URL is the edition's `sourceUrl` instead.
    label: "TCP text",
    url: (id) => `https://github.com/textcreationpartnership/${id}`,
  },
};

/** An author's external links, in menu order; empty when it records none. */
export const authorLinks = (author: Author): Link[] =>
  links([
    ["viaf", author.viaf],
    ["wikidata", author.wikidata],
  ]);

/** An edition's external links, in menu order; empty when it records none. */
export const editionLinks = (edition: Edition): Link[] =>
  links([
    ["estc", edition.estc],
    ["tcp", edition.tcp],
  ]);

const links = (entries: [LinkKind, string | undefined][]): Link[] =>
  entries.flatMap(([kind, id]) =>
    id === undefined || id === ""
      ? []
      : [
          {
            kind,
            id,
            label: AUTHORITIES[kind].label,
            url: AUTHORITIES[kind].url(id),
          },
        ],
  );

/**
 * The links a tree node's entity records: an author's for an author node, an
 * edition's for an edition or borrowed node (a borrowed child *is* an edition),
 * and none for a letter or a work — a work is abstracted from any printing, and
 * its authority record is its author's.
 */
export const nodeLinks = (node: TreeNode | undefined): Link[] =>
  node === undefined
    ? []
    : node.kind === "author"
      ? authorLinks(node.author)
      : node.kind === "edition" || node.kind === "borrowed"
        ? editionLinks(node.edition)
        : [];

/** The URL for one kind of link on an entity, or undefined if it has none. */
export const linkUrl = (links: Link[], kind: LinkKind): string | undefined =>
  links.find((link) => link.kind === kind)?.url;

/**
 * The link kinds as `viewItem` tokens, dot-joined for a tree item's
 * `contextValue` (e.g. "author.viaf.wikidata"). VSCode `when` clauses can only
 * regex-match that one string, so a menu item shows for a node only when the
 * node's own identifiers put its token in there.
 */
export const linkTokens = (links: Link[]): string =>
  links.map((link) => `.${link.kind}`).join("");
