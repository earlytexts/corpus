/**
 * The on-disk shard format, both directions: reading the
 * `data/dictionary/<a–z|other>.json` shards, parsing each value's micro-syntax
 * into a `RawDictionary` (collecting every structural problem), and serialising
 * a dictionary back to its canonical shards (sorted, one entry per line, values
 * in minimal micro-syntax). The value grammar (`parseReference`) is shared with
 * `[w:]` markup, so it is imported by resolve.ts too. Register-level problems
 * (dangling references, unselectable readings) are expand.ts's business, not
 * parsing's.
 *
 * Reads top-down: loading, then parsing (`parseDictionary` and the entry
 * micro-syntax it runs on), then the inverse (`serializeEntry`), then the
 * canonical shard layout.
 */

import type { RawDictionary, RawEntry, RawReading } from "./types.ts";
import type { CorpusFs, DirEntry } from "../fs/ports.ts";
import { fold, isWord } from "./words.ts";

/** Read the dictionary shard files under `<root>/data/dictionary`, raw text
 * by file name, sorted. A corpus without the directory has an empty map. */
export const readDictionaryShards = async (
  fs: CorpusFs,
  root: string,
): Promise<Map<string, string>> => {
  const dir = `${root}/data/dictionary`;
  let entries: DirEntry[];
  try {
    entries = await fs.readDir(dir);
  } catch {
    return new Map();
  }
  const shards = new Map<string, string>();
  const names = entries
    .filter((entry) => entry.isFile && entry.name.endsWith(".json"))
    .map((entry) => entry.name)
    .sort();
  for (const name of names) {
    const text = await fs.readFile(`${dir}/${name}`);
    if (text !== null) shards.set(name, text);
  }
  return shards;
};

export type DictionaryProblem = {
  shard: string;
  key?: string;
  message: string;
  /** True when the entry (or whole shard) could not be kept — rewriting the
   * shards from the parsed dictionary would lose it. Placement and ordering
   * problems are not dropped: `deno task fmt` repairs them. */
  dropped: boolean;
};

/**
 * Parse raw shards into one RawDictionary, collecting every structural
 * problem: unparseable JSON, keys that are not folded words, misplaced or
 * unsorted keys, malformed entry values. Register-level problems (dangling
 * cross-references, duplicate or unselectable expanded readings) are
 * `dictionaryViolations`' business, not parsing's.
 */
export const parseDictionary = (
  shards: Map<string, string>,
): { dictionary: RawDictionary; problems: DictionaryProblem[] } => {
  const dictionary: RawDictionary = {};
  const problems: DictionaryProblem[] = [];
  const owners = new Map<string, string>(); // key → the shard that has it
  for (const [shard, text] of shards) {
    const problem = (message: string, dropped: boolean, key?: string) =>
      problems.push({
        shard,
        ...(key !== undefined ? { key } : {}),
        message,
        dropped,
      });
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      problem(`invalid JSON: ${(error as Error).message}`, true);
      continue;
    }
    if (
      parsed === null || typeof parsed !== "object" || Array.isArray(parsed)
    ) {
      problem("a shard is a JSON object of entries", true);
      continue;
    }
    let previous: string | undefined;
    let unsortedReported = false;
    for (const [key, value] of Object.entries(parsed)) {
      if (previous !== undefined && key < previous && !unsortedReported) {
        problem(
          `keys are not sorted ("${key}" after "${previous}")`,
          false,
          key,
        );
        unsortedReported = true;
      }
      previous = key;
      if (!isWord(key)) {
        problem("the key is not a word", true, key);
        continue;
      }
      if (fold(key) !== key) {
        problem("the key is not folded (lower-cased)", true, key);
        continue;
      }
      const owner = owners.get(key);
      if (owner !== undefined) {
        problem(`duplicate of "${key}" in ${owner}`, true, key);
        continue;
      }
      const entry = parseEntry(key, value);
      if ("error" in entry) {
        problem(entry.error, true, key);
        continue;
      }
      if (shardOf(key) !== shard) {
        problem(
          `belongs in ${shardOf(key)} (run \`deno task fmt\`)`,
          false,
          key,
        );
      }
      owners.set(key, shard);
      dictionary[key] = entry;
    }
  }
  return { dictionary, problems };
};

/** An entry's raw on-disk value: null, a reading string, or an ordered array
 * of them (= ambiguous). See ../README.md for the grammar. */
export type EntryValue = null | string | (null | string)[];

/**
 * Parse one raw entry value for `surface`. `null` is the doubly-identity
 * reading — the surface is a modern word, lemma = itself; `"=lemma"` states the
 * lemma; anything else is a cross-reference. An array is an ambiguous entry
 * (2+ readings, default first).
 */
export const parseEntry = (
  surface: string,
  value: unknown,
): RawEntry | { error: string } => {
  const ambiguous = Array.isArray(value);
  const values: unknown[] = ambiguous ? value : [value];
  if (ambiguous && values.length < 2) {
    return { error: "an array value means an ambiguous entry (2+ readings)" };
  }
  const readings: RawReading[] = [];
  for (const item of values) {
    if (item === null) {
      readings.push({ lemma: surface });
      continue;
    }
    if (typeof item !== "string") {
      return { error: "a reading is null or a string" };
    }
    if (item === "") {
      return { error: "an empty reading (write null instead)" };
    }
    const reading = parseReading(surface, item);
    if ("error" in reading) return reading;
    readings.push(reading);
  }
  return { readings };
};

/** Parse one reading string: `"=lemma"` (a lemma statement — the whole
 * reading, never part of one) or a cross-reference of spellings. */
const parseReading = (
  surface: string,
  text: string,
): RawReading | { error: string } => {
  if (text.startsWith("=")) {
    const lemma = text.slice(1);
    if (!isWord(lemma)) return { error: `"${lemma}" is not a word` };
    return { lemma };
  }
  const reference = parseReference(text);
  if ("error" in reference) return reference;
  if (reference.spellings.length === 1 && reference.spellings[0] === surface) {
    return { error: "a reading of just the surface itself is written null" };
  }
  return reference;
};

/**
 * Parse a cross-reference reading — space-separated spellings; also the
 * grammar of a multi-token `[w:]` value. Lemmas are never stated inline: each
 * spelling's own entry supplies them (which is where the old
 * `spelling=lemma` form went — the lemma belongs on the target's entry).
 */
export const parseReference = (
  text: string,
): { spellings: string[] } | { error: string } => {
  const spellings = text.split(" ");
  if (spellings.some((spelling) => spelling === "")) {
    return { error: "words are separated by single spaces" };
  }
  for (const spelling of spellings) {
    if (spelling.includes("=")) {
      return {
        error: `a cross-reference lists spellings only — ` +
          `the lemma in "${spelling}" belongs on that spelling's own entry`,
      };
    }
    if (!isWord(spelling)) return { error: `"${spelling}" is not a word` };
  }
  return { spellings };
};

/** Serialize an entry back to its canonical raw value — the exact inverse of
 * `parseEntry`, eliding every default. */
export const serializeEntry = (
  surface: string,
  entry: RawEntry,
): EntryValue => {
  const values = entry.readings.map((reading) =>
    serializeReading(surface, reading)
  );
  return values.length === 1 ? values[0] : values;
};

const serializeReading = (
  surface: string,
  reading: RawReading,
): null | string =>
  "lemma" in reading
    ? (reading.lemma === surface ? null : `=${reading.lemma}`)
    : reading.spellings.join(" ");

/** The shard file a key belongs in: its first letter (ignoring non-letters)
 * for a–z, `other.json` for anything else (`œconomy`). */
export const shardOf = (surface: string): string => {
  for (const char of surface) {
    if (!/\p{L}/u.test(char)) continue;
    const lower = char.toLowerCase();
    return lower >= "a" && lower <= "z" ? `${lower}.json` : "other.json";
  }
  return "other.json";
};

/** Split a dictionary into its canonical shard files: keys sorted, one entry
 * per line (diff- and merge-friendly), values in minimal micro-syntax. */
export const shardDictionary = (
  dictionary: RawDictionary,
): Map<string, string> => {
  const byShard = new Map<string, string[]>();
  for (const surface of Object.keys(dictionary).sort()) {
    const line = `  ${JSON.stringify(surface)}: ${
      renderValue(serializeEntry(surface, dictionary[surface]))
    }`;
    const shard = shardOf(surface);
    byShard.set(shard, [...(byShard.get(shard) ?? []), line]);
  }
  return new Map(
    [...byShard.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([shard, lines]) => [shard, `{\n${lines.join(",\n")}\n}\n`]),
  );
};

const renderValue = (value: EntryValue): string =>
  Array.isArray(value)
    ? `[${value.map((item) => JSON.stringify(item)).join(", ")}]`
    : JSON.stringify(value);
