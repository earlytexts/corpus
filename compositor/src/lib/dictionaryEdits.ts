/**
 * The vscode-free core of the dictionary quick-fixes: turning a curation
 * decision about one surface into the new canonical text of its shard file.
 * The editor layer (commands/dictionaryDiagnostics.ts) reads the current shard,
 * calls one of these, and writes the result back; canonicalisation (sorting,
 * one entry per line, minimal micro-syntax) is the corpus's own
 * `shardDictionary`, so an entry added from the editor is byte-identical to one
 * `deno task fmt` would produce — it round-trips through corpus validation.
 *
 * These only *place* an entry; whether the result is coherent (its references
 * resolve, its readings are selectable) is the corpus validation's business,
 * reported live in the Problems panel after the write.
 */

import {
  type EntryValue,
  parseDictionary,
  parseEntry,
  shardDictionary,
  shardOf,
} from "@earlytexts/corpus";

/** The curation actions a squiggled (unaccounted) surface offers. */
export type EntryAction =
  | { kind: "modern" } // add `null` (a modern word, its own lemma)
  | { kind: "respell" } // add a cross-reference to modern spelling(s)
  | { kind: "lemma" }; // add `=lemma` (a modern word, lemma stated)

export const actionsFor = (): EntryAction[] => [
  { kind: "modern" },
  { kind: "respell" },
  { kind: "lemma" },
];

/**
 * The new canonical text of a surface's shard after adding (or replacing) its
 * entry with `value` — `null` (modern word), `"spelling"` (a cross-reference),
 * `"=lemma"` (a modern word with a stated lemma), or an array (ambiguous). The
 * `value` grammar and the shard are the corpus's; a malformed value throws
 * (the caller has validated its own input). `shardText` is the shard's current
 * content, or "" / "{}" for a new shard.
 */
export const upsertEntryText = (
  shardText: string,
  surface: string,
  value: EntryValue,
): string => upsertEntriesText(shardText, [{ surface, value }]);

/**
 * The new canonical text of a shard after adding (or replacing) several entries
 * at once — every `surface` must belong to this one shard (the caller groups a
 * cascade's decisions by shard). Same contract as `upsertEntryText`: a
 * malformed value throws, the result round-trips through corpus fmt.
 */
export const upsertEntriesText = (
  shardText: string,
  entries: { surface: string; value: EntryValue }[],
): string => {
  const shard = shardOf(entries[0].surface);
  const { dictionary } = parseDictionary(
    new Map([[shard, shardText.trim() === "" ? "{}" : shardText]]),
  );
  for (const { surface, value } of entries) {
    const entry = parseEntry(surface, value);
    if ("error" in entry) throw new Error(entry.error);
    dictionary[surface] = entry;
  }
  return shardDictionary(dictionary).get(shard) ?? "{}\n";
};
