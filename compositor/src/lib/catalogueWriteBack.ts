/**
 * The catalogue write-back drainer — a small latest-wins state machine that
 * refreshes the compiled `catalogue/` in the background after each load (next
 * startup's instant tree, and the computer's dev input).
 *
 * One writer drains at a time. A newer generation *replaces* the pending one
 * rather than queuing behind it, so a burst of edits can never pin more than the
 * one in flight plus the latest — the write-back used to stack a full ~60MB
 * `catalogue/` rewrite per edit, which is what ran the extension host out of
 * memory. Each generation carries the *scope* of what its load changed — the
 * whole corpus (`full`), a set of document sources (`docs`), or only the
 * dictionary — and a superseding generation merges its predecessor's scope so a
 * cheaper load can replace a costlier one's content but never drop its
 * obligations (the documents it superseded still need writing). Until a full
 * write has landed this session `catalogue/` may be a previous session's (or
 * missing), so any scope is promoted to a full write until then.
 */

import type { Catalogue } from "@earlytexts/corpus";

/** What a load changed, and so what its write-back must cover: the whole
 * catalogue, a set of changed document sources (root-relative `.mit` paths), or
 * only the dictionary (leaving `documents/` untouched). */
export type WriteScope =
  | { kind: "full" }
  | { kind: "docs"; paths: ReadonlySet<string> }
  | { kind: "dictionary" };

export type CatalogueWriteBack = {
  /**
   * Queue a catalogue generation for background write-back under `scope`. A
   * still-pending generation's scope is merged in, so a later cheaper load can
   * replace but never demote a pending costlier one (a `full` is never lost, a
   * `docs` set only grows).
   */
  enqueue: (
    catalogue: Catalogue,
    warnings: string[],
    scope: WriteScope,
  ) => void;
};

/**
 * Build a drainer over the three write operations — `writeFull` rewrites the
 * whole `catalogue/`, `writeDocs` rewrites `catalogue.json`/`dictionary.json`
 * plus only the given documents, `writeDictionary` refreshes just
 * `catalogue.json` and `dictionary.json` (documents already current). A failed
 * write only costs the cache; the next load refreshes it.
 */
export const createCatalogueWriteBack = (
  writeFull: (catalogue: Catalogue, warnings: string[]) => Promise<void>,
  writeDictionary: (catalogue: Catalogue, warnings: string[]) => Promise<void>,
  writeDocs: (
    catalogue: Catalogue,
    warnings: string[],
    paths: ReadonlySet<string>,
  ) => Promise<void>,
): CatalogueWriteBack => {
  let pending:
    { catalogue: Catalogue; warnings: string[]; scope: WriteScope } | undefined;
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
          // Until a full write lands, catalogue/ may be stale or missing, so a
          // partial write would leave gaps — promote to a full one.
          if (!fullWritten || next.scope.kind === "full") {
            await writeFull(next.catalogue, next.warnings);
            fullWritten = true;
          } else if (next.scope.kind === "docs") {
            await writeDocs(next.catalogue, next.warnings, next.scope.paths);
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
    enqueue: (catalogue, warnings, scope) => {
      pending = {
        catalogue,
        warnings,
        scope:
          pending === undefined ? scope : mergeScopes(pending.scope, scope),
      };
      void drain();
    },
  };
};

/** The obligation covering both a superseded scope and its replacement: `full`
 * dominates; otherwise any `docs` obligations union (a `dictionary` adds none,
 * since a docs write already refreshes the dictionary too). */
const mergeScopes = (a: WriteScope, b: WriteScope): WriteScope => {
  if (a.kind === "full" || b.kind === "full") return { kind: "full" };
  if (a.kind === "docs" || b.kind === "docs") {
    return {
      kind: "docs",
      paths: new Set([
        ...(a.kind === "docs" ? a.paths : []),
        ...(b.kind === "docs" ? b.paths : []),
      ]),
    };
  }
  return { kind: "dictionary" };
};
