/**
 * The dictionary panel's view-model: the data it posts to the webview and the
 * cache transitions behind its optimistic edits. The surface (adapter) gathers
 * the I/O — reading the shards, the model's token index and readiness — and
 * this module turns it into the `data` message and keeps the `PanelCache` a full
 * refresh, an optimistic patch, and a re-read produce. The two data patches it
 * composes (`replaceShardEntries`, `dropCuratedRows`) live in
 * dictionaryPanelData.ts; the two views (`dictionaryViews`) and the ranking
 * (`curationRows`) are their own modules. vscode-free and tested.
 */

import { parseDictionary, type RawDictionary } from "@earlytexts/corpus";
import {
  dictionaryViews,
  type LemmaRow,
  type VariantRow,
} from "./dictionaryViews.ts";
import { type CurationRow, curationRows, type TokenIndex } from "./curation.ts";
import { dropCuratedRows, replaceShardEntries } from "./dictionaryPanelData.ts";

/** How many unaccounted surfaces the Curation tab carries — the most frequent,
 * the ones worth curating first (paged client-side). Until the register is
 * backfilled the backlog is most of the vocabulary, so it is capped to keep the
 * posted payload small; the true total travels alongside for the tab's note. */
export const MAX_CURATION = 2000;

/** The panel's cached derivation, kept so a single-surface edit can patch just
 * its shard instead of re-reading all of them and re-ranking the whole backlog.
 * The variant/lemma views are re-derived from `dictionary` on each post (a cheap
 * in-memory pass); the curation backlog is held ranked so an edit only drops the
 * rows it accounts for, deferring the corpus-wide re-rank to the reload. */
export type PanelCache = {
  dictionary: RawDictionary;
  curation: CurationRow[];
  curationTotal: number;
};

/** The `data` message the webview renders. `ready` carries the two derived views
 * and the curation backlog; `no-corpus`/`loading` are the empty states (no root
 * yet). `stale` flags an optimistic patch the reload has yet to confirm. */
export type PanelDataMessage = {
  type: "data";
  status: "ready" | "no-corpus" | "loading";
  variants: VariantRow[];
  lemmas: LemmaRow[];
  curation: CurationRow[];
  curationTotal: number;
  curationReady: boolean;
  stale: boolean;
};

/** Parse the shard map and rank the backlog into a full cache — the
 * authoritative refresh (open, external change, settled reload). */
export const buildCache = (
  shards: Map<string, string>,
  tokenIndex: TokenIndex,
  max = MAX_CURATION,
): PanelCache => {
  const { dictionary } = parseDictionary(shards);
  const { rows, total } = curationRows(tokenIndex, dictionary, max);
  return { dictionary, curation: rows, curationTotal: total };
};

/** Patch the written shards into the cache: swap each shard's entries for its
 * freshly re-read text (byte-identical to a full re-read for those entries) and
 * drop the curation rows the `surfaces` account for. The corpus-wide re-rank is
 * left to the reload that follows; the result is marked `stale` when posted. A
 * fresh cache — the caller's is not mutated. */
export const patchCache = (
  cache: PanelCache,
  shardTexts: Map<string, string>,
  surfaces: string[],
): PanelCache => {
  let dictionary = cache.dictionary;
  for (const [shard, text] of shardTexts) {
    const { dictionary: entries } = parseDictionary(
      new Map([[shard, text.trim() === "" ? "{}" : text]]),
    );
    dictionary = replaceShardEntries(dictionary, shard, entries);
  }
  return {
    dictionary,
    curation: dropCuratedRows(cache.curation, new Set(surfaces)),
    curationTotal: cache.curationTotal,
  };
};

/** The `data` message for a cache: derive both views and tag with readiness and
 * staleness (the webview shows an "Updating…" hint while `stale`). */
export const dataMessage = (
  cache: PanelCache,
  { curationReady, stale }: { curationReady: boolean; stale: boolean },
): PanelDataMessage => {
  const { variants, lemmas } = dictionaryViews(cache.dictionary);
  return {
    type: "data",
    status: "ready",
    variants,
    lemmas,
    curation: cache.curation,
    curationTotal: cache.curationTotal,
    curationReady,
    stale,
  };
};

/** The empty `data` message while there is no corpus root: a definitive
 * `no-corpus` once the first search has settled, else a `loading` spinner. */
export const emptyMessage = (settled: boolean): PanelDataMessage => ({
  type: "data",
  status: settled ? "no-corpus" : "loading",
  variants: [],
  lemmas: [],
  curation: [],
  curationTotal: 0,
  curationReady: false,
  stale: false,
});
