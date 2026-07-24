/**
 * Walking the catalogue by identity. A work co-authored by several people lists
 * once under each of them, and an edition borrowed into a collection is the same
 * object as the standalone edition — so a naive author→work→edition loop visits
 * the same `Work`/`MarkitDocument` several times. These helpers deduplicate by
 * object identity so each work (and each edition document) is seen exactly once,
 * in first-seen (author) order. Pure and vitest-tested; every catalogue walk
 * that "each work once" or "each document once" is expressed in terms of them.
 */

import type { Catalogue, Work } from "@earlytexts/corpus";
import type { MarkitDocument } from "@jsr/earlytexts__markit";

/** Each work of `authors` once, by identity, in author order. A co-authored
 * work lists under each of its authors, so a plain walk repeats it. */
export const distinctWorks = (authors: readonly { works: Work[] }[]): Work[] =>
  distinctBy(authors.flatMap((author) => author.works));

/**
 * Every edition document in the catalogue, each once by identity — editions are
 * shared across listings (borrowed into other collections, co-authored works
 * repeat under each author). With `descend`, borrowed children are included too
 * (each once), for a walk over all text the catalogue reaches.
 */
export const distinctEditionDocuments = (
  catalogue: Catalogue,
  descend = false,
): MarkitDocument[] => {
  const seen = new Set<MarkitDocument>();
  const out: MarkitDocument[] = [];
  const add = (doc: MarkitDocument): void => {
    if (seen.has(doc)) return;
    seen.add(doc);
    out.push(doc);
    if (descend) doc.children.forEach(add);
  };
  for (const work of distinctWorks(catalogue.authors)) {
    for (const edition of work.editions) add(edition.document);
  }
  return out;
};

/** Every value of `items` once, by object identity, in first-seen order. */
const distinctBy = <T>(items: Iterable<T>): T[] => {
  const seen = new Set<T>();
  const out: T[] = [];
  for (const item of items) {
    if (seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
};
