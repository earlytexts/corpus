/**
 * The read-side of the dictionary: how a token's reading is *selected*. Two
 * authoring channels select a reading — Markit's per-occurrence
 * `[w:surface=value]` markup and a text's `[metadata.dictionary]` overrides —
 * and they share one selection rule (`selectionViolation`), one precedence
 * chain (`resolveReading`: markup → override → the entry's default), and the
 * reading-string helpers the whole family compares against. This is the surface
 * the wire subpath re-exports; everything here reads an already-expanded
 * `Dictionary`, never the shards.
 */

import type { Metadata } from "@earlytexts/markit";
import type { Dictionary, Entry, Reading } from "./types.ts";
import { fold, isWord } from "./words.ts";

/** A reading's full spelling string: its words' spellings joined by spaces. */
export const readingSpelling = (reading: Reading): string =>
  reading.map((word) => word.spelling).join(" ");

/** A reading's full lemma string: its words' lemmas joined by spaces. */
export const readingLemma = (reading: Reading): string =>
  reading.map((word) => word.lemma).join(" ");

/** The multi-word surfaces of a register — its keys with an internal space,
 * the fixed units the texts mark with `~` (`a~priori`). */
export const multiWordSurfaces = (
  register: Record<string, unknown>,
): Set<string> =>
  new Set(Object.keys(register).filter((key) => key.includes(" ")));

/**
 * How one `[w:surface=value]` occurrence violates the dictionary, if it does.
 * A surface is always exactly one token (Markit enforces this at compile time;
 * a multi-word unit is `~`-fused, `[w:a~priori=x]`) and must have an ambiguous
 * entry — 2+ *expanded* readings, so ambiguity inherited through a
 * cross-reference counts — whose readings the value selects exactly one of,
 * matching a reading's full spelling string or full lemma string. `surface` is
 * the token's folded text; `value` the token's `[w:]` value (markit
 * `Token.word`).
 */
export const wordMarkupViolation = (
  surface: string,
  value: string,
  dictionary: Dictionary,
): string | undefined =>
  selectionViolation(surface, value, dictionary, "[w:] markup is");

/**
 * A text's `[metadata.dictionary]` map: surface → the reading its unmarked
 * occurrences mean within that text, selected by the same value grammar as
 * `[w:]` markup. An edition whose printing conventions differ from the
 * register's defaults states so once (`humane = "human"` in a 17th-century
 * edition) instead of marking every occurrence. Like the corpus's other
 * cascading metadata the map flows down the composed tree — nearest ancestor
 * wins, per surface — and `[w:]` markup still wins per occurrence.
 */
export type Overrides = Record<string, string>;

/** The overrides map of one text's metadata ({} when none). Lenient: a
 * non-map value and non-string entries are skipped — the schema validation
 * reports them. */
export const overridesOf = (metadata: Metadata | undefined): Overrides => {
  const map = metadata?.dictionary;
  if (map === null || typeof map !== "object" || Array.isArray(map)) return {};
  return Object.fromEntries(
    Object.entries(map).filter(([, value]) => typeof value === "string"),
  ) as Overrides;
};

/**
 * How one override (surface = value) violates the dictionary, if it does: the
 * surface must be a folded word with an ambiguous entry whose expanded
 * readings the value selects exactly one of. Selecting the entry's own
 * default is legal — a *pin*, keeping the edition's meaning stable if the
 * register's readings are ever reordered.
 */
export const overrideViolation = (
  surface: string,
  value: string,
  dictionary: Dictionary,
): string | undefined => {
  if (!isWord(surface)) return `"${surface}" is not a word`;
  if (fold(surface) !== surface) {
    return `"${surface}" is not folded (lower-cased)`;
  }
  return selectionViolation(surface, value, dictionary, "overrides are");
};

/**
 * The reading of one occurrence of a surface, by the precedence chain: the
 * occurrence's own `[w:]` value, else the text's override for the surface,
 * else the entry's first reading. Total: an unresolvable selector (a
 * validation error) falls through to the next tier.
 */
export const resolveReading = (
  entry: Entry,
  override?: string,
  marked?: string,
): Reading =>
  (marked === undefined ? undefined : selectReading(entry, marked)) ??
    (override === undefined ? undefined : selectReading(entry, override)) ??
    entry.readings[0];

/** The reading of `entry` that `value` selects — matching the reading's full
 * spelling string or full lemma string — when it selects exactly one. */
export const selectReading = (
  entry: Entry,
  value: string,
): Reading | undefined => {
  const matches = entry.readings.filter((reading) =>
    readingSpelling(reading) === value || readingLemma(reading) === value
  );
  return matches.length === 1 ? matches[0] : undefined;
};

/** The selection rule shared by `[w:]` markup and edition overrides: the
 * entry for `surface` must be ambiguous, and `value` must select exactly one
 * of its expanded readings. `usage` names the caller in the ambiguity message
 * ("[w:] markup is", "overrides are"). */
const selectionViolation = (
  surface: string,
  value: string,
  dictionary: Dictionary,
  usage: string,
): string | undefined => {
  const entry = dictionary[surface];
  if (entry === undefined) return `no dictionary entry for "${surface}"`;
  if (entry.readings.length < 2) {
    return `"${surface}" is unambiguous — ${usage} only for ambiguous surfaces`;
  }
  const matches = entry.readings.filter((reading) =>
    readingSpelling(reading) === value || readingLemma(reading) === value
  );
  if (matches.length === 0) {
    return `"${value}" selects no reading of "${surface}"`;
  }
  if (matches.length > 1) {
    return `"${value}" selects more than one reading of "${surface}"`;
  }
  return undefined;
};
