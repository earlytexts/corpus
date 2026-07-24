/**
 * The pure data patches behind the dictionary panel's optimistic updates. An
 * edit touches one surface (so one shard) and accounts for at most a handful of
 * surfaces, but the old refresh re-read every shard and re-ranked the whole
 * corpus-wide curation backlog before the webview could show the change. These
 * two helpers let the panel apply just the delta to its cached data — swap the
 * one written shard's entries, drop the curated rows — and post it at once,
 * leaving the corpus-wide re-rank to the debounced reload that follows. Pure
 * (vscode-free), so unit-tested directly.
 */

import { type RawDictionary, shardOf } from "@earlytexts/corpus";
import type { CurationRow } from "./curation.ts";

/**
 * Replace one shard's slice of a dictionary. Every surface bucketing to `shard`
 * is dropped from `dictionary` and the freshly parsed `entries` (read back from
 * that shard file, so byte-identical to what a full re-read would yield) put in
 * their place; other shards are untouched. A fresh object — the caller's cached
 * dictionary is not mutated.
 */
export const replaceShardEntries = (
  dictionary: RawDictionary,
  shard: string,
  entries: RawDictionary,
): RawDictionary => {
  const next: RawDictionary = {};
  for (const surface of Object.keys(dictionary)) {
    if (shardOf(surface) !== shard) next[surface] = dictionary[surface];
  }
  for (const surface of Object.keys(entries)) next[surface] = entries[surface];
  return next;
};

/** Drop the curation rows a just-written entry accounts for — exact surfaces
 * only, the same contract as the overlay's optimistic squiggle clear: a
 * possessive whose base was just registered waits for the reload's re-rank. */
export const dropCuratedRows = (
  rows: CurationRow[],
  surfaces: ReadonlySet<string>,
): CurationRow[] => rows.filter((row) => !surfaces.has(row.surface));
