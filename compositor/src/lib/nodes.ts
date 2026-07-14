/**
 * The Corpus Browser's node vocabulary, and the catalogue→file-path lookups
 * that go with it. Split out from corpusTree.ts because it is the shared
 * surface between the tree (which builds and renders these nodes) and the
 * commands (which receive a node as their invocation context and resolve it to
 * a file). Pure — corpus types only, no VSCode — so it can be unit-tested and
 * so the command layer need not depend on the tree provider.
 */

import type { Author, Catalogue, Edition, Work } from "@earlytexts/corpus";

export type TreeNode =
  | { kind: "letter"; letter: string; authors: Author[] }
  | { kind: "author"; author: Author }
  | { kind: "work"; work: Work; author: Author }
  | { kind: "edition"; edition: Edition; work: Work }
  | { kind: "borrowed"; edition: Edition; work: Work };

/** The absolute path of an author's .mit file. */
export const authorPath = (root: string, author: Author): string =>
  `${root}/data/authors/${author.slug}.mit`;

/** The absolute path of an edition's source .mit file, from the catalogue. */
export const editionPath = (
  catalogue: Catalogue,
  edition: Edition,
): string | undefined => catalogue.sources.get(edition.document);
