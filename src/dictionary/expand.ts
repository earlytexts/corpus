/**
 * The write-side closure of the register: expanding the authored facts into the
 * catalogue's explicit `Dictionary` (`expandDictionary`), and the register-level
 * rules that keep the authored shards well-formed and honest — every reference
 * resolves in one step (`dictionaryViolations`), and each class's canonical
 * spelling is the one an external reference word list endorses
 * (`canonicalSpellingViolations`). These are the corpus's own accounting over
 * the register; the computer only reads the expanded result.
 *
 * Reads top-down: expansion first (the readings the checks weigh), then the
 * two families of register violation.
 */

import type {
  Dictionary,
  Entry,
  RawDictionary,
  RawEntry,
  RawReading,
  Reading,
} from "./types.ts";
import { readingLemma, readingSpelling } from "./resolve.ts";

/**
 * Compose the authored facts into the expanded dictionary. An identity
 * reading expands to itself; a cross-reference takes each word's lemmas from
 * the identity readings of that word's own entry — so lemma ambiguity
 * *inherits* through a cross-reference (it belongs to the modern word) while
 * spelling ambiguity does not (it belongs to the surface). Expanded readings
 * keep authored order: a cross-referenced word's lemmas in its entry's order,
 * the leftmost word of a multi-word reading most significant. Total and
 * best-effort: a missing or identity-less target falls back to lemma =
 * spelling, and `dictionaryViolations` reports the dangle.
 */
export const expandDictionary = (raw: RawDictionary): Dictionary =>
  Object.fromEntries(
    Object.entries(raw).map((
      [surface, entry],
    ) => [surface, expandEntry(surface, entry, raw)]),
  );

const expandEntry = (
  surface: string,
  entry: RawEntry,
  raw: RawDictionary,
): Entry => ({
  readings: entry.readings.flatMap((reading) =>
    expandReading(surface, reading, raw)
  ),
});

const expandReading = (
  surface: string,
  reading: RawReading,
  raw: RawDictionary,
): Reading[] => {
  if ("lemma" in reading) {
    // An identity reading of an n-word surface is n identity words: `null` on
    // `"a priori"` is the words `a` and `priori`, each spelled and lemmatised
    // as itself, so a search for either half finds the unit. Spelling and lemma
    // pair up word by word (they match for `null`, where lemma = surface).
    const spellings = surface.split(" ");
    const lemmas = reading.lemma.split(" ");
    if (spellings.length === lemmas.length) {
      return [spellings.map((spelling, index) => ({
        spelling,
        lemma: lemmas[index],
      }))];
    }
    return [[{ spelling: surface, lemma: reading.lemma }]];
  }
  return reading.spellings.reduce<Reading[]>(
    (readings, spelling) =>
      readings.flatMap((words) =>
        lemmasOf(spelling, raw).map((lemma) => [...words, { spelling, lemma }])
      ),
    [[]],
  );
};

/** The lemmas of a modern spelling: its entry's identity readings, in order;
 * the spelling itself where the register cannot say (best effort). */
const lemmasOf = (spelling: string, raw: RawDictionary): string[] => {
  const lemmas = (raw[spelling]?.readings ?? []).flatMap((reading) =>
    "lemma" in reading ? [reading.lemma] : []
  );
  return lemmas.length > 0 ? lemmas : [spelling];
};

/**
 * The register-level violations of a parsed dictionary — the register is
 * closed under derivation:
 * - every cross-referenced spelling has an entry with an identity reading, so
 *   lemmas derive in a single step (no respelling chains or cycles) and a
 *   typo in a value dangles instead of passing silently;
 * - every stated lemma has an entry with a null reading (a lemma is a
 *   citation form);
 * - an entry's expanded readings are distinct, and every non-default one is
 *   uniquely selectable by its spelling or lemma string, which `[w:]` markup
 *   needs (the default is what unmarked occurrences mean, so it alone never
 *   needs selecting — its strings may collide with another reading's, as in
 *   `lay`).
 * Violations are attributed to the referencing entry's key; an entry whose
 * references dangle skips the expansion checks (its fallback expansion would
 * only cascade noise).
 */
export const dictionaryViolations = (
  raw: RawDictionary,
): { key: string; message: string }[] => {
  const violations: { key: string; message: string }[] = [];
  for (const [key, entry] of Object.entries(raw)) {
    const messages = new Set<string>(); // dedupes repeats within one entry
    for (const reading of entry.readings) {
      if ("lemma" in reading) {
        if (reading.lemma !== key) checkLemma(reading.lemma, raw, messages);
      } else {
        for (const spelling of reading.spellings) {
          checkSpelling(spelling, raw, messages);
        }
      }
    }
    if (messages.size === 0) {
      for (
        const message of expansionViolations(expandEntry(key, entry, raw))
      ) {
        messages.add(message);
      }
    }
    for (const message of messages) violations.push({ key, message });
  }
  return violations;
};

const checkSpelling = (
  spelling: string,
  raw: RawDictionary,
  messages: Set<string>,
): void => {
  const entry = raw[spelling];
  if (entry === undefined) {
    messages.add(`"${spelling}" has no entry`);
  } else if (!entry.readings.some((reading) => "lemma" in reading)) {
    messages.add(
      `the entry for "${spelling}" has no identity reading ` +
        `(nothing to derive a lemma from)`,
    );
  }
};

const checkLemma = (
  lemma: string,
  raw: RawDictionary,
  messages: Set<string>,
): void => {
  const entry = raw[lemma];
  if (entry === undefined) {
    messages.add(`"${lemma}" has no entry`);
  } else if (
    !entry.readings.some((reading) =>
      "lemma" in reading && reading.lemma === lemma
    )
  ) {
    messages.add(
      `"${lemma}" is not a citation form (its entry has no null reading)`,
    );
  }
};

/** Duplicate expanded readings (same spelling and lemma strings), and — when
 * expansion leaves 2+ readings — a non-default reading no value selects. */
const expansionViolations = (entry: Entry): string[] => {
  const violations: string[] = [];
  const spellings = entry.readings.map(readingSpelling);
  const lemmas = entry.readings.map(readingLemma);
  const seen = new Set<string>();
  for (const [index, spelling] of spellings.entries()) {
    const identity = `${spelling}=${lemmas[index]}`;
    if (seen.has(identity)) violations.push(`duplicate reading "${spelling}"`);
    seen.add(identity);
  }
  if (violations.length > 0) return violations; // duplicates break selection anyway
  const matches = (value: string): number =>
    entry.readings.filter((_, index) =>
      spellings[index] === value || lemmas[index] === value
    ).length;
  for (let index = 1; index < entry.readings.length; index++) {
    if (matches(spellings[index]) !== 1 && matches(lemmas[index]) !== 1) {
      violations.push(
        `reading "${
          spellings[index]
        }" is not uniquely selectable by its spelling or lemma`,
      );
    }
  }
  return violations;
};

/**
 * The canonical-spelling violations of a parsed dictionary. When several
 * spellings are variants of one word, which one is canonical — the spelling the
 * others cross-reference — is decided not by taste, nor by any corpus statistic,
 * but by an **external authority**: a fixed, version-pinned modern reference
 * word list (see ../DICTIONARY.md, Principles of Normalisation). The member of a
 * normalisation class that appears in `wordlist` is canonical; where several do,
 * the alphabetically first wins; where none does, the class must name its
 * canonical in `exceptions` (which also overrides the list on the rare class it
 * gets wrong). Because the authority is external and fixed, the choice never
 * drifts as the corpus grows, and a lemma family cannot split its spelling
 * across the base and its inflections.
 *
 * A normalisation class is a canonical spelling together with every surface
 * whose *sole* reading is a single-spelling cross-reference to it
 * (`"vertue": "virtue"`); contractions (multi-spelling), lemma statements, and
 * ambiguous surfaces are not spelling variants and are never weighed. `wordlist`
 * and `exceptions` are sets of lower-cased spellings. Attributed to the current
 * canonical spelling's entry; a class whose canonical spelling has no entry (a
 * dangle `dictionaryViolations` reports) is skipped.
 */
export const canonicalSpellingViolations = (
  raw: RawDictionary,
  wordlist: ReadonlySet<string>,
  exceptions: ReadonlySet<string>,
): { key: string; message: string }[] => {
  const variants = new Map<string, string[]>(); // canonical → its variant spellings
  for (const [surface, entry] of Object.entries(raw)) {
    const canonical = respellingTarget(entry);
    if (canonical !== undefined) {
      variants.set(canonical, [...(variants.get(canonical) ?? []), surface]);
    }
  }
  const violations: { key: string; message: string }[] = [];
  for (const [canonical, spellings] of variants) {
    if (raw[canonical] === undefined) continue; // dangling; another rule reports
    const members = [canonical, ...spellings];
    const pinned = members.filter((m) => exceptions.has(m)).sort();
    const listed = members.filter((m) => wordlist.has(m)).sort();
    if (pinned.length === 0 && listed.length === 0) {
      violations.push({
        key: canonical,
        message:
          `no spelling of this class ("${
            [...members].sort().join('", "')
          }") is in the reference word list — pin the intended canonical in ` +
          "canonical-exceptions.json",
      });
      continue;
    }
    const [expected, why] = pinned.length > 0
      ? [pinned[0], "pinned in canonical-exceptions.json"]
      : [
        listed[0],
        "the reference word list's spelling is canonical, ties broken " +
        "alphabetically",
      ];
    if (expected !== canonical) {
      violations.push({
        key: canonical,
        message: `"${expected}" should be the canonical spelling, not ` +
          `"${canonical}" (${why})`,
      });
    }
  }
  return violations;
};

/** The single canonical spelling a surface purely respells — its sole reading
 * is a one-word cross-reference — or `undefined` when it is not a plain
 * respelling (a modern word, a contraction, or an ambiguous surface). */
const respellingTarget = (entry: RawEntry): string | undefined => {
  if (entry.readings.length !== 1) return undefined;
  const [reading] = entry.readings;
  return "spellings" in reading && reading.spellings.length === 1
    ? reading.spellings[0]
    : undefined;
};
