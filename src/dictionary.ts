/**
 * The dictionary: the corpus's curated register of surface forms. Every
 * surface (word as printed, folded) maps to one or more *readings* — the ways
 * it can be read, first reading the default. On disk each editorial fact has
 * exactly one home: an archaic surface *cross-references* its modern
 * spelling(s) (`"vertues": "virtues"` — read "vertues: see *virtues*"), and a
 * modern word states its lemma on its own entry (`"virtues": "=virtue"`).
 * Expansion composes the two, deriving every surface's explicit (spelling,
 * lemma) readings; ambiguity (2+ expanded readings) is disambiguated per
 * occurrence with Markit's `[w:surface=value]` markup.
 *
 * On disk the dictionary lives in `data/dictionary/<a–z|other>.json` shards,
 * each value a micro-syntax string mirroring the `[w:]` markup (see
 * ../README.md); in the compiled catalogue it is emitted *expanded* as
 * `catalogue/dictionary.json`, so consumers never parse the micro-syntax.
 *
 * Reads top-down: the types, then the accounting rule (the coverage engine
 * shared by corpus validation and the Compositor's diagnostics), then the
 * `[w:]` semantics and the edition overrides (`[metadata.dictionary]`) that
 * share their selection rule, then loading and parsing the shards, then the
 * entry micro-syntax (both directions), then expansion and the register-level
 * violations, then canonical shard formatting.
 */

import type {
  MarkitDocument,
  Metadata,
  Word as WordElement,
} from "@earlytexts/markit";
import type { CorpusFs, DirEntry } from "./types.ts";
import {
  fold,
  isRomanNumeral,
  isWord,
  scanBlock,
  type Token,
} from "./words.ts";

/* -------------------------------- types -------------------------------- */

/** Expanded: surface (folded: as printed, lower-cased) → readings, first =
 * default. This is the catalogue (wire) shape — an explicit spelling + lemma
 * per word per reading, nothing left to derive. */
export type Dictionary = Record<string, Entry>;

export type Entry = {
  readings: Reading[]; // length 1 = unambiguous; 2+ = ambiguous
  confirmed: boolean; // false = machine-suggested (`?` on disk)
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
  confirmed: boolean;
};

/** An identity reading — the surface is a modern word, with this lemma (on
 * disk `null` or `"=lemma"`) — or a cross-reference to modern spellings whose
 * own entries supply the lemmas (on disk `"spelling"` or `"it is"`). */
export type RawReading = { lemma: string } | { spellings: string[] };

/** What the accounting rule needs to know about the register: which surfaces
 * have entries, and whether they are confirmed. Both dictionary shapes
 * qualify. */
export type Register = Record<string, { confirmed: boolean }>;

/* --------------------------- the accounting rule ------------------------ */

/**
 * How a token is accounted for — "at least one of" a dictionary entry,
 * exempting markup, a mechanical class, or (multi-token surfaces) `[w:]`
 * markup itself; "unaccounted" is the only violation. A token both mechanical
 * and registered reports its dictionary status (`I` with an entry for "i" is
 * that entry, not a numeral).
 */
export type TokenStatus =
  | "confirmed" // a confirmed dictionary entry
  | "unconfirmed" // a machine-suggested (`?`) dictionary entry
  | "exempt" // inside person / place / org / citation / language markup
  | "mechanical" // contains digits, or reads as a roman numeral
  | "marked" // inside multi-token `[w:]` markup, which is its own reading
  | "unaccounted";

export type TokenAccount = Token & {
  /** The id of the text (document or section) the token appears in. */
  textId: string;
  status: TokenStatus;
};

/**
 * Apply the accounting rule to every token of a document (its own blocks and
 * its sections', recursively): every token in every text is accounted for by
 * at least one of a dictionary entry for its folded surface, enclosure in
 * exempting markup, or a mechanical class. This one pure function is both the
 * corpus coverage validation and the Compositor's live squiggle engine.
 */
export const accountTokens = (
  doc: MarkitDocument,
  register: Register,
): TokenAccount[] => {
  const accounts: TokenAccount[] = [];
  const walk = (text: MarkitDocument): void => {
    for (const block of text.blocks) {
      const { tokens, words } = scanBlock(block);
      const marked = new Set(
        words.filter((w) => w.tokens.length > 1).map((w) => w.element),
      );
      for (const token of tokens) {
        accounts.push({
          ...token,
          textId: text.id,
          status: statusOf(token, marked, register),
        });
      }
    }
    for (const child of text.children) walk(child);
  };
  walk(doc);
  return accounts;
};

const statusOf = (
  token: Token,
  marked: Set<WordElement>,
  register: Register,
): TokenStatus => {
  if (token.exemption !== undefined) return "exempt";
  if (token.word !== undefined && marked.has(token.word)) return "marked";
  const entry = register[token.folded];
  if (entry !== undefined) return entry.confirmed ? "confirmed" : "unconfirmed";
  if (/\p{N}/u.test(token.text) || isRomanNumeral(token.text)) {
    return "mechanical";
  }
  return "unaccounted";
};

export type Coverage = {
  total: number;
  /** Accounted without human review pending: confirmed entries, exempt,
   * mechanical, and `[w:]`-marked tokens. */
  confirmed: number;
  /** Accounted by a machine-suggested (`?`) entry awaiting confirmation. */
  unconfirmed: number;
  unaccounted: number;
};

export const coverageOf = (accounts: TokenAccount[]): Coverage => {
  const coverage = {
    total: accounts.length,
    confirmed: 0,
    unconfirmed: 0,
    unaccounted: 0,
  };
  for (const { status } of accounts) {
    if (status === "unconfirmed") coverage.unconfirmed++;
    else if (status === "unaccounted") coverage.unaccounted++;
    else coverage.confirmed++;
  }
  return coverage;
};

/* --------------------------- [w:] semantics ----------------------------- */

/**
 * How one `[w:surface=value]` occurrence violates the dictionary, if it does.
 * A single-token surface must have an ambiguous entry — 2+ *expanded*
 * readings, so ambiguity inherited through a cross-reference counts — whose
 * readings the value selects exactly one of, matching a reading's full
 * spelling string or full lemma string. A multi-token surface (`[w:to
 * morrow=tomorrow]`) needs no entry: the value is a cross-reference reading
 * (spellings only), and the marked tokens are accounted for by the markup.
 */
export const wordMarkupViolation = (
  element: WordElement,
  tokens: Token[],
  dictionary: Dictionary,
): string | undefined => {
  const value = element.word;
  if (tokens.length === 0) return `[w:=${value}] wraps no words`;
  if (tokens.length > 1) {
    const reference = parseReference(value);
    return "error" in reference
      ? `value "${value}": ${reference.error}`
      : undefined;
  }
  const surface = tokens[0].folded;
  return selectionViolation(surface, value, dictionary, "[w:] markup is");
};

/** A reading's full spelling string: its words' spellings joined by spaces. */
export const readingSpelling = (reading: Reading): string =>
  reading.map((word) => word.spelling).join(" ");

/** A reading's full lemma string: its words' lemmas joined by spaces. */
export const readingLemma = (reading: Reading): string =>
  reading.map((word) => word.lemma).join(" ");

/* --------------------------- edition overrides -------------------------- */

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

/* ----------------------------- shard loading ---------------------------- */

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

/* ---------------------------- entry micro-syntax ------------------------ */

/** An entry's raw on-disk value: null, a reading string, or an ordered array
 * of them (= ambiguous). See ../README.md for the grammar. */
export type EntryValue = null | string | (null | string)[];

/**
 * Parse one raw entry value for `surface`. `null` (or a bare `?`) is the
 * doubly-identity reading — the surface is a modern word, lemma = itself;
 * `"=lemma"` states the lemma; anything else is a cross-reference. A `?`
 * prefix on the first reading marks the whole entry machine-suggested
 * (unconfirmed).
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
  let confirmed = true;
  const readings: RawReading[] = [];
  for (const [index, item] of values.entries()) {
    if (item === null) {
      readings.push({ lemma: surface });
      continue;
    }
    if (typeof item !== "string") {
      return { error: "a reading is null or a string" };
    }
    let text = item;
    if (text.startsWith("?")) {
      if (index > 0) {
        return { error: `"?" (unconfirmed) belongs on the first reading only` };
      }
      confirmed = false;
      text = text.slice(1);
      if (text === "") {
        readings.push({ lemma: surface });
        continue;
      }
    } else if (text === "") {
      return { error: "an empty reading (write null instead)" };
    }
    const reading = parseReading(surface, text);
    if ("error" in reading) return reading;
    readings.push(reading);
  }
  return { readings, confirmed };
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
  if (!entry.confirmed) values[0] = `?${values[0] ?? ""}`;
  return values.length === 1 ? values[0] : values;
};

const serializeReading = (
  surface: string,
  reading: RawReading,
): null | string =>
  "lemma" in reading
    ? (reading.lemma === surface ? null : `=${reading.lemma}`)
    : reading.spellings.join(" ");

/* ------------------------------- expansion ------------------------------ */

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

export const expandEntry = (
  surface: string,
  entry: RawEntry,
  raw: RawDictionary,
): Entry => ({
  readings: entry.readings.flatMap((reading) =>
    expandReading(surface, reading, raw)
  ),
  confirmed: entry.confirmed,
});

const expandReading = (
  surface: string,
  reading: RawReading,
  raw: RawDictionary,
): Reading[] => {
  if ("lemma" in reading) {
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

/* ------------------------- register violations -------------------------- */

/**
 * The register-level violations of a parsed dictionary — the register is
 * closed under derivation:
 * - every cross-referenced spelling has an entry with an identity reading, so
 *   lemmas derive in a single step (no respelling chains or cycles) and a
 *   typo in a value dangles instead of passing silently — the accepted price
 *   is that the register includes modern targets even where never printed;
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

/* --------------------------- canonical shards --------------------------- */

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
