/**
 * One read of the dictionary, shared by everything a single pass needs it for.
 *
 * The register is small on disk (~27 shards, a few hundred KB) but expensive to
 * derive from: parsing it, *expanding* it into the resolved `Dictionary` the
 * markup rules select against, and re-rendering it canonically to byte-compare
 * the shards are each a pass over every entry. Left to themselves the callers
 * repeat all three — the Compositor's validation tiers, its catalogue build, and
 * its dictionary panel between them read and expanded the shards several times
 * per save. A snapshot reads once and derives each product at most once, on
 * demand, so a caller that never needs the expansion never pays for it.
 *
 * It is a *snapshot*, not a cache: it holds the shards as they were read, and
 * a later edit means reading a new one. Nothing here watches the filesystem.
 */

import type { CorpusFs } from "../fs/ports.ts";
import type { Dictionary, RawDictionary } from "./types.ts";
import { expandDictionary } from "./expand.ts";
import {
  type DictionaryProblem,
  parseDictionary,
  readDictionaryShards,
  shardDictionary,
} from "./shards.ts";

export type DictionarySnapshot = {
  /** The shard files as read, by file name — what the formatting check compares
   * the canonical rendering against. */
  shards: ReadonlyMap<string, string>;
  /** The authored register, parsed. */
  dictionary: RawDictionary;
  /** Structural problems found while parsing (see parseDictionary). */
  problems: DictionaryProblem[];
  /** The resolved register the markup and override rules select against. */
  expanded: () => Dictionary;
  /** The canonical shard rendering, for the formatting check. */
  canonical: () => ReadonlyMap<string, string>;
};

export const readDictionarySnapshot = async (
  fs: CorpusFs,
  root: string,
): Promise<DictionarySnapshot> =>
  dictionarySnapshot(await readDictionaryShards(fs, root));

/** A snapshot over shards already in hand — the same derivations, without the
 * read (the Compositor's panel holds the shard text it just wrote). */
export const dictionarySnapshot = (
  shards: ReadonlyMap<string, string>,
): DictionarySnapshot => {
  const { dictionary, problems } = parseDictionary(shards);
  let expanded: Dictionary | undefined;
  let canonical: ReadonlyMap<string, string> | undefined;
  return {
    shards,
    dictionary,
    problems,
    expanded: () => (expanded ??= expandDictionary(dictionary)),
    canonical: () => (canonical ??= shardDictionary(dictionary)),
  };
};
