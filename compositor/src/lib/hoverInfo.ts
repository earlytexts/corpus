/**
 * How the corpus accounts for one hovered token — the vscode-free core of the
 * token-accounting hover. Given a printed word, the register, and the enclosing
 * text's `[metadata.dictionary]` overrides, it reports the citation lemma the
 * token resolves to, the normalised form it takes within that lemma's paradigm,
 * and (for an ambiguous surface) the other lemmas on offer, each with the `[w:]`
 * value that would pin it.
 *
 * The presentation deliberately speaks the language of the dictionary — lemma
 * and forms — not the accounting engine's internal classes: an unaccounted or
 * mechanical token yields a bare status the hover simply declines to show, so
 * every hover a contributor sees reads as one coherent lemma view rather than
 * exposing which internal route accounted for the word.
 *
 * The decisions are the corpus's, reused verbatim: the status mirrors
 * `account.ts`'s `statusOf` (exemption is handled upstream — the source-token
 * walk never yields an exempt or already-`[w:]`-marked token), the reading is
 * chosen by `resolveReading`'s precedence chain (override → default; a hovered
 * token never carries its own `[w:]`), and the possessive fallback mirrors the
 * computer's `entryFor`. Pure and vitest-tested; the editor layer
 * (surface/hover.ts) renders this and wires the pin action.
 */

import {
  type Dictionary,
  type Entry,
  fold,
  isMechanical,
  type Overrides,
  possessiveBase,
  type Reading,
  readingLemma,
  readingSpelling,
  resolveReading,
  selectReading,
} from "@earlytexts/corpus";

/** One alternative reading of an ambiguous surface: its lemma (the headword the
 * hover offers) and the pin that would select it. */
export type OtherReading = {
  /** The reading's citation lemma. */
  lemma: string;
  /** The reading's modern spelling — shown to tell two readings apart when they
   * share a lemma, otherwise redundant with it. */
  spelling: string;
  /** The `[w:surface=value]` value that uniquely selects this reading — present
   * only when the surface can carry `[w:]` markup (a real ambiguous entry, not a
   * derived possessive) and some value round-trips to exactly this reading.
   * Absent → render the lemma, but offer no pin action for it. */
  value?: string;
};

/** A token the register accounts for (a direct entry, or the possessive rule):
 * the lemma it resolves to and the form it takes within that lemma's paradigm. */
export type AccountedInfo = {
  status: "registered" | "possessive";
  /** The folded surface — the dictionary key. */
  surface: string;
  /** The word exactly as printed. */
  display: string;
  /** The citation lemma (the headword). */
  lemma: string;
  /** The lemma's normalised form this token takes — the one to highlight among
   * the lemma's forms. For a possessive it is the base's form (the clitic is
   * carried separately). */
  form: string;
  /** The possessive clitic (`'s` / `’s`) split off the base; possessive only. */
  clitic?: string;
  ambiguous: boolean;
  /** True when the resolved reading is pinned by an edition override rather than
   * the entry's own default. */
  overridden: boolean;
  /** The readings other than the resolved one (empty when unambiguous). */
  others: OtherReading[];
};

/** What the hover classifies a token as: an accounted lemma view, or a bare
 * status (a mechanical class, or an unaccounted surface) the hover won't show. */
export type HoverInfo =
  | AccountedInfo
  | { status: "mechanical" | "unaccounted"; surface: string; display: string };

/**
 * Account for one printed word against the register. `overrides` is the
 * enclosing text's merged `[metadata.dictionary]` map ({} when none). The
 * caller guarantees the token is neither exempt nor already `[w:]`-marked (the
 * source-token walk drops both), so exemption and per-occurrence markup play no
 * part here — only the override and the entry's default.
 */
export const resolveHoverInfo = (
  display: string,
  dictionary: Dictionary,
  overrides: Overrides,
): HoverInfo => {
  const surface = fold(display);
  const direct = dictionary[surface];
  const base = direct === undefined ? possessiveBase(surface) : undefined;
  const entry = direct ?? (base === undefined ? undefined : dictionary[base]);
  if (entry === undefined) {
    return {
      status: isMechanical(display) ? "mechanical" : "unaccounted",
      surface,
      display,
    };
  }
  const possessive = direct === undefined;
  const override = overrides[surface];
  const resolved = resolveReading(entry, override);
  return {
    status: possessive ? "possessive" : "registered",
    surface,
    display,
    lemma: readingLemma(resolved),
    // For a possessive this is the base's form (e.g. `bishop`), which really
    // appears in the base lemma's paradigm; the clitic is carried apart.
    form: readingSpelling(resolved),
    ...(possessive ? { clitic: surface.slice(base!.length) } : {}),
    ambiguous: entry.readings.length >= 2,
    overridden:
      override !== undefined && selectReading(entry, override) === resolved,
    others: entry.readings
      .filter((reading) => reading !== resolved)
      .map((reading) => {
        const value = possessive ? undefined : pinValue(entry, reading);
        return {
          lemma: readingLemma(reading),
          spelling: readingSpelling(reading),
          ...(value === undefined ? {} : { value }),
        };
      }),
  };
};

/**
 * The register's paradigms: every lemma mapped to the sorted, distinct modern
 * spellings that lemmatise to it, across the whole dictionary — so a hover can
 * show the token's form beside its siblings (`went` among go/goes/going/gone).
 * One pass over the register; the editor layer builds it once per catalogue and
 * caches it, since it is invariant between reloads.
 */
export const lemmaForms = (dictionary: Dictionary): Map<string, string[]> => {
  const forms = new Map<string, Set<string>>();
  for (const entry of Object.values(dictionary)) {
    for (const reading of entry.readings) {
      const lemma = readingLemma(reading);
      const set = forms.get(lemma) ?? new Set<string>();
      set.add(readingSpelling(reading));
      forms.set(lemma, set);
    }
  }
  return new Map(
    [...forms].map(([lemma, set]) => [
      lemma,
      [...set].sort((a, b) => a.localeCompare(b)),
    ]),
  );
};

/** The `[w:surface=value]` value that uniquely selects `reading` from `entry`:
 * its lemma when that round-trips through `selectReading`, else its spelling,
 * else none (the reading collides with another and cannot be pinned). Using
 * `selectReading` itself guarantees the value really selects this reading. */
const pinValue = (entry: Entry, reading: Reading): string | undefined => {
  for (const value of [readingLemma(reading), readingSpelling(reading)]) {
    if (selectReading(entry, value) === reading) return value;
  }
  return undefined;
};
