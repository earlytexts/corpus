/**
 * The dictionary's types — the vocabulary the rest of `dictionary/` is written
 * in. Two shapes for every entry: the *expanded* form (`Dictionary`), the
 * catalogue (wire) shape with an explicit spelling + lemma per reading and
 * nothing left to derive; and the *authored* form (`RawDictionary`), the shards
 * as parsed, before lemma derivation. The whole dictionary story — accounting,
 * `[w:]`/override resolution, shard parsing, expansion — is these types plus the
 * functions over them in the sibling modules.
 */

/** Expanded: surface (folded: as printed, lower-cased) → readings, first =
 * default. This is the catalogue (wire) shape — an explicit spelling + lemma
 * per word per reading, nothing left to derive. */
export type Dictionary = Record<string, Entry>;

export type Entry = {
  readings: Reading[]; // length 1 = unambiguous; 2+ = ambiguous
};

/** One way to read the surface: usually one word; more for contractions. */
export type Reading = Word[];

export type Word = {
  spelling: string; // modern spelling; equals the surface when already modern
  lemma: string; // citation form; equals the spelling when uninflected
};

/** Authored (on disk): readings before lemma derivation. */
export type RawDictionary = Record<string, RawEntry>;

export type RawEntry = {
  readings: RawReading[];
};

/** An identity reading — the surface is a modern word, with this lemma (on
 * disk `null` or `"=lemma"`) — or a cross-reference to modern spellings whose
 * own entries supply the lemmas (on disk `"spelling"` or `"it is"`). */
export type RawReading = { lemma: string } | { spellings: string[] };

/** What the accounting rule needs to know about the register: which surfaces
 * have an entry. Membership is all it reads, so both dictionary shapes (raw
 * and expanded) qualify. */
export type Register = Record<string, unknown>;
