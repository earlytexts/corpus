/**
 * The catalogue write-back drainer — a small latest-wins state machine that
 * refreshes the compiled `catalogue/` in the background after each load (next
 * startup's instant tree, and the computer's dev input).
 *
 * One writer drains at a time. A newer generation *replaces* the pending one
 * rather than queuing behind it, so a burst of edits can never pin more than the
 * one in flight plus the latest — the write-back (a ~60MB `catalogue/` rewrite)
 * used to stack a full catalogue per edit, which is what ran the extension host
 * out of memory. The `full` flag records whether any superseded generation had
 * changed documents: a dictionary-only load may replace a pending full write,
 * but must not demote it — the documents it superseded still need writing. And
 * until a full write has landed this session, `catalogue/` may be a previous
 * session's (or missing), so a dictionary-only write — which leaves `documents/`
 * untouched — is promoted to a full one.
 */

import type { Catalogue } from "@earlytexts/corpus";

export type CatalogueWriteBack = {
  /**
   * Queue a catalogue generation for background write-back. `docsChanged` marks
   * a load that changed documents (a full or per-file reload, not a
   * dictionary-only one); it is merged into any still-pending generation's flag
   * so a dictionary-only load can replace but never demote a pending full write.
   */
  enqueue: (
    catalogue: Catalogue,
    warnings: string[],
    docsChanged: boolean,
  ) => void;
};

/**
 * Build a drainer over the two write operations — `writeFull` rewrites the whole
 * `catalogue/`, `writeDictionary` refreshes just `catalogue.json` and
 * `dictionary.json` (the documents on disk are already current, the difference
 * between a ~60MB rewrite and a sub-second one). A failed write only costs the
 * cache; the next load refreshes it.
 */
export const createCatalogueWriteBack = (
  writeFull: (catalogue: Catalogue, warnings: string[]) => Promise<void>,
  writeDictionary: (catalogue: Catalogue, warnings: string[]) => Promise<void>,
): CatalogueWriteBack => {
  let pending:
    { catalogue: Catalogue; warnings: string[]; full: boolean } | undefined;
  let draining = false;
  let fullWritten = false;

  const drain = async (): Promise<void> => {
    if (draining) return;
    draining = true;
    try {
      while (pending !== undefined) {
        const next = pending;
        pending = undefined;
        try {
          if (next.full || !fullWritten) {
            await writeFull(next.catalogue, next.warnings);
            fullWritten = true;
          } else {
            await writeDictionary(next.catalogue, next.warnings);
          }
        } catch {
          // the next load will refresh the cache
        }
      }
    } finally {
      draining = false;
    }
  };

  return {
    enqueue: (catalogue, warnings, docsChanged) => {
      pending = {
        catalogue,
        warnings,
        full: docsChanged || (pending?.full ?? false),
      };
      void drain();
    },
  };
};
