/**
 * The Corpus Browser's pure data model: the node vocabulary the tree renders,
 * the catalogue→file-path and →document-id lookups, and the pure helpers that
 * shape the tree (author indexing, the document→edition map, borrowed-child
 * traversal) and format its labels. Split out from corpusTree.ts and the
 * scaffold commands because it is the shared surface between the tree (which
 * builds and renders these nodes) and the commands (which receive a node as
 * their invocation context and resolve it to a file). Pure — corpus types only,
 * no VSCode — so it can be unit-tested and so the command layer need not depend
 * on the tree provider.
 */

import type { Author, Catalogue, Edition, Work } from "@earlytexts/corpus";
import type { MarkitDocument } from "@jsr/earlytexts__markit";

export type TreeNode =
  | { kind: "letter"; letter: string; authors: Author[] }
  | { kind: "author"; author: Author }
  | { kind: "work"; work: Work; author: Author }
  | { kind: "edition"; edition: Edition; work: Work }
  | { kind: "borrowed"; edition: Edition; work: Work };

/**
 * An edition together with the work it belongs to, recovered from a document.
 * The value type of the document→edition map.
 */
export type EditionRef = { edition: Edition; work: Work };

/** The absolute path of an author's .mit file. */
export const authorPath = (root: string, author: Author): string =>
  `${root}/data/authors/${author.slug}.mit`;

/** The absolute path of an edition's source .mit file, from the catalogue. */
export const editionPath = (
  catalogue: Catalogue,
  edition: Edition,
): string | undefined => catalogue.sources.get(edition.document);

/**
 * Group authors under their initial letter, alphabetically, as `letter` nodes.
 * The catalogue orders authors chronologically; the tree re-sorts them by
 * surname then forename so the browser reads like an index.
 */
export const letterGroups = (authors: readonly Author[]): TreeNode[] => {
  const sorted = [...authors].sort(
    (a, b) =>
      a.surname.localeCompare(b.surname) ||
      a.forename.localeCompare(b.forename),
  );
  const groups = new Map<string, Author[]>();
  for (const author of sorted) {
    const letter = authorLetter(author);
    const group = groups.get(letter);
    if (group === undefined) groups.set(letter, [author]);
    else group.push(author);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([letter, authors]) => ({ kind: "letter", letter, authors }));
};

/** The initial letter an author is filed under (by surname, falling back to slug). */
const authorLetter = (author: Author): string =>
  (author.surname || author.slug).charAt(0).toUpperCase();

/**
 * Every edition in the catalogue, keyed by its composed document. A borrowed
 * child is the very same document object as the edition it points at (the
 * catalogue build splices in the loaded edition, not a copy), so this lets us
 * recover the edition — and its work — from a collection's spliced-in children.
 */
export const editionsByDocument = (
  catalogue: Catalogue,
): Map<MarkitDocument, EditionRef> => {
  const map = new Map<MarkitDocument, EditionRef>();
  for (const author of catalogue.authors) {
    for (const work of author.works) {
      for (const edition of work.editions) {
        map.set(edition.document, { edition, work });
      }
    }
  }
  return map;
};

/**
 * The editions an edition borrows: its document's direct children that are
 * themselves editions in the catalogue. Inline sections (a collection's own
 * text) are distinct documents and are skipped; only spliced-in editions match.
 */
export const borrowedChildren = (
  edition: Edition,
  lookup: Map<MarkitDocument, EditionRef>,
): EditionRef[] =>
  edition.document.children
    .map((child) => lookup.get(child))
    .filter((ref): ref is EditionRef => ref !== undefined);

/**
 * An author's lifespan as a display string, e.g. "(1711–1776)"; "" when neither
 * year is known, and "?" for a missing endpoint of a known one.
 */
export const lifespan = (author: Author): string =>
  author.birth !== undefined || author.death !== undefined
    ? `(${author.birth ?? "?"}–${author.death ?? "?"})`
    : "";

/** The work's document ID (e.g. "Hume.EHU"), from any edition's root ID. */
export const workDocId = (work: Work): string => {
  const id = work.editions[0]?.document.id;
  return id !== undefined && id.includes(".")
    ? id.split(".").slice(0, -1).join(".")
    : `${capitalize(work.hostSlug)}.${work.slug.toUpperCase()}`;
};

/** Capitalise a slug's first letter (e.g. "hume" → "Hume"), for composing
 * document IDs and index labels. */
export const capitalize = (slug: string): string =>
  slug.charAt(0).toUpperCase() + slug.slice(1);
