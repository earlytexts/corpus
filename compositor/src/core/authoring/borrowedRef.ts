/**
 * The pure half of the "insert a borrowed-child reference" command: the set of
 * editions the contributor can borrow, and the reference line that borrows
 * one. A borrowed child (`## <Author.Work.Edition>`) splices another edition's
 * text in place — how collections (ETSS, FD, HE) share text with the works
 * they gather. The editor layer
 * (adapters/vscode/commands/insertBorrowedRef.ts) turns these into a
 * quick-pick and inserts the chosen line at the cursor.
 */

import type { Catalogue, Work } from "@earlytexts/corpus";

/** A borrow target as the picker shows it: its document ID and title. */
export type BorrowChoice = { id: string; title: string };

/** Every edition in the catalogue, once. Works appear under each of their
 * authors, so each work (and its editions) is collected a single time. */
export const borrowableEditions = (catalogue: Catalogue): BorrowChoice[] => {
  const seen = new Set<Work>();
  const choices: BorrowChoice[] = [];
  for (const author of catalogue.authors) {
    for (const work of author.works) {
      if (seen.has(work)) continue;
      seen.add(work);
      for (const edition of work.editions) {
        choices.push({ id: edition.document.id, title: edition.title });
      }
    }
  }
  return choices;
};

/** The reference line that borrows an edition, inserted at the cursor. */
export const borrowedRefSnippet = (id: string): string => `## <${id}>\n`;
