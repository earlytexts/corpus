/**
 * The pure choices behind "compare editions": which works are worth offering
 * (at least two editions, each once even when co-authored), and which edition
 * follows another chronologically. surface/commands/compareEditions.ts drives
 * the pickers and opens the diff; the selection logic is here, and tested.
 */

import type { Edition, Work } from "@earlytexts/corpus";

/** Each work once, in author order, that has enough editions to compare. A
 * work co-authored by several people lists under each author, so it is
 * deduplicated by identity. */
export const comparableWorks = (
  authors: readonly { works: Work[] }[],
): Work[] => {
  const seen = new Set<Work>();
  const works: Work[] = [];
  for (const author of authors) {
    for (const work of author.works) {
      if (seen.has(work) || work.editions.length < 2) continue;
      seen.add(work);
      works.push(work);
    }
  }
  return works;
};

/** The edition after `edition` in its work — editions are held ascending by
 * year, so its successor — or undefined if it is the latest. */
export const nextEdition = (
  work: Work,
  edition: Edition,
): Edition | undefined => work.editions[work.editions.indexOf(edition) + 1];
