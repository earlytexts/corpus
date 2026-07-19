/**
 * The curation worklist: every surface the dictionary does not yet account for
 * (no entry), corpus-wide, ranked so a contributor can burn the backlog down
 * highest-impact first. The counting never walks a document: each file's
 * register-independent surface summary is derived once per compile (the
 * corpus's `deriveFile`) and merged here into one corpus-wide token index; the
 * register is applied at the end as a membership test, mirroring the corpus's
 * accounting rule (`statusOf` in account.ts) — a surface is accounted when it
 * or its possessive base has an entry, and its exempt/mechanical occurrences
 * were never candidates to begin with. So a dictionary edit re-ranks the
 * backlog in milliseconds, against the index the corpus model already holds.
 * Vscode-free, so it is unit-tested against loaded files directly.
 */

import {
  type CorpusFile,
  possessiveBase,
  type Register,
} from "@earlytexts/corpus";
import { letterOf } from "./dictionaryViews.ts";

export type CurationEntry = {
  /** The folded surface — the dictionary key it is (or would be) filed under. */
  surface: string;
  /** Occurrences corpus-wide. */
  count: number;
  /** One attested occurrence, to open in context: source path and 0-based line. */
  example?: { path: string; line: number };
};

/** A curation entry as the dictionary panel's third tab consumes it: the same
 * ranked surface, plus the shard letter it buckets under so the panel's shared
 * A–Z filter narrows it like the other two tabs. */
export type CurationRow = CurationEntry & { letter: string };

/** The corpus-wide tally of candidate occurrences per folded surface —
 * register-independent, so it survives every dictionary edit unchanged. */
export type TokenIndex = Map<
  string,
  { count: number; example?: { path: string; line: number } }
>;

/** Merge the files' surface summaries into one corpus-wide index. `root` is
 * the corpus root, absolutising each surface's first-attestation path so the
 * panel can open it directly. */
export const buildTokenIndex = (
  files: Iterable<CorpusFile>,
  root: string,
): TokenIndex => {
  const index: TokenIndex = new Map();
  for (const file of files) {
    for (const [surface, summary] of file.derived.surfaces) {
      const entry = index.get(surface) ?? { count: 0 };
      entry.count += summary.candidates;
      if (entry.example === undefined) {
        entry.example = {
          path: `${root}/data/${file.path}`,
          line: summary.line ?? 0,
        };
      }
      index.set(surface, entry);
    }
  }
  return index;
};

/** The curation worklist shaped for the panel: the `max` most frequent surfaces
 * as `CurationRow`s (with their letter), and the untruncated `total` so the
 * panel can say how many of the backlog it is showing. */
export const curationRows = (
  index: TokenIndex,
  register: Register,
  max: number,
): { rows: CurationRow[]; total: number } => {
  const all = curationList(index, register);
  return {
    total: all.length,
    rows: all
      .slice(0, max)
      .map((entry) => ({ ...entry, letter: letterOf(entry.surface) })),
  };
};

export const curationList = (
  index: TokenIndex,
  register: Register,
): CurationEntry[] =>
  [...index.entries()]
    .filter(([surface]) => !accounted(surface, register))
    .map(([surface, { count, example }]) => ({
      surface,
      count,
      ...(example !== undefined ? { example } : {}),
    }))
    .sort(
      (a, b) =>
        // Most frequent first, then alphabetical — the order to curate in.
        b.count - a.count || a.surface.localeCompare(b.surface),
    );

/** The register-dependent half of the accounting rule: an entry for the
 * surface, or for its possessive base (`bishop's` → `bishop`). */
const accounted = (surface: string, register: Register): boolean => {
  if (surface in register) return true;
  const base = possessiveBase(surface);
  return base !== undefined && base in register;
};
