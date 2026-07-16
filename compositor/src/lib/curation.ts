/**
 * The curation worklist: every surface the dictionary does not yet account for
 * (no entry), corpus-wide, ranked so a contributor can burn the backlog down
 * highest-impact first. The decision is the corpus's `accountTokens` rule (the
 * same one the editor squiggles use); this tallies its verdict over the whole
 * catalogue and attaches, for each surface, one place it is attested so the
 * curator can see it in context before deciding.
 *
 * Counting walks each edition's document once. A borrowed edition is the very
 * same document object wherever it is spliced in (the catalogue build shares,
 * not copies), so keying by document dedupes it; its blocks are counted under
 * its own edition (its own file), and only a collection's *inline* sections —
 * children that are not themselves editions — are folded into the collection.
 * Vscode-free, so it is unit-tested against a built catalogue directly.
 */

import type { MarkitDocument } from "@jsr/earlytexts__markit";
import { accountTokens, type Catalogue } from "@earlytexts/corpus";

export type CurationEntry = {
  /** The folded surface — the dictionary key it is (or would be) filed under. */
  surface: string;
  /** Occurrences corpus-wide. */
  count: number;
  /** One attested occurrence, to open in context: source path and 0-based line. */
  example?: { path: string; line: number };
};

export const curationList = (catalogue: Catalogue): CurationEntry[] => {
  // Every edition document → its source path (borrowed children share the key).
  const editions = new Map<MarkitDocument, string | undefined>();
  for (const author of catalogue.authors) {
    for (const work of author.works) {
      for (const edition of work.editions) {
        editions.set(edition.document, catalogue.sources.get(edition.document));
      }
    }
  }

  type Tally = { count: number; example?: { path: string; line: number } };
  const tallies = new Map<string, Tally>();
  for (const [document, path] of editions) {
    // Count this edition's own text: its blocks and its inline sections, but
    // not the editions it borrows (each is counted under its own key).
    const own: MarkitDocument = {
      ...document,
      children: document.children.filter((child) => !editions.has(child)),
    };
    for (const token of accountTokens(own, catalogue.dictionary)) {
      if (token.status !== "unaccounted") continue;
      const tally = tallies.get(token.folded) ?? { count: 0 };
      tally.count++;
      if (tally.example === undefined && path !== undefined) {
        tally.example = { path, line: token.block.source?.start.line ?? 0 };
      }
      tallies.set(token.folded, tally);
    }
  }

  return [...tallies.entries()]
    .map(([surface, tally]) => ({
      surface,
      count: tally.count,
      ...(tally.example !== undefined ? { example: tally.example } : {}),
    }))
    .sort(
      (a, b) =>
        // Most frequent first, then alphabetical — the order to curate in.
        b.count - a.count || a.surface.localeCompare(b.surface),
    );
};
