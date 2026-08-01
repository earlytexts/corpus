/**
 * The corpus-wide markup lexicons held as a **fold over per-file contributions**
 * rather than a walk re-run over every source. A save replaces one file's
 * contribution — the previous one is subtracted first, so a re-save is exactly a
 * delta — and the classified `Hints` are re-derived from the aggregate. That
 * turns the suggestion overlay's response to a save from a whole-corpus mine
 * (every `works/**` source compiled and walked, tens of seconds) into a single
 * file's walk plus a classification pass over the accumulated vocabulary.
 *
 * Phrases are **refcounted by contributing file**, not by occurrence: a name two
 * editions attest survives either one being edited away, and a name one edition
 * repeats does not survive that edition losing it. The contribution is already
 * deduped per file (see `hintContribution`), so the count is exactly "how many
 * files attest this phrase".
 *
 * The unmarked-word frequencies are deliberately *not* folded per file. They are
 * a corpus-scale English frequency estimate feeding two thresholds (the
 * singleton pruning and the strong/weak split); one file's edit moves them by
 * parts per million, while tracking them per file would cost more resident
 * memory than the body-free model saves. So they are a baseline: `rebase` sets
 * it from a full mine and it stands until the next one. Updating it additively
 * per save would be worse than stale — the edited file's own words would be
 * counted twice, and repeated saves of one file would inflate its vocabulary
 * without limit and silently demote every language suggestion in it.
 */

import {
  classifyHints,
  type HintAuthor,
  type HintContribution,
  type HintOverrides,
  type Hints,
  phraseKey,
  phraseLexiconOf,
  type WordFrequencies,
} from "./hints.ts";

export type HintIndex = {
  /** Fold in one source's markup, replacing whatever it contributed before. */
  set: (path: string, contribution: HintContribution) => void;
  /** Drop a source's contribution entirely (it was deleted). */
  remove: (path: string) => void;
  /** Replace the unmarked-word baseline — a full mine has just measured it. */
  rebase: (frequencies: WordFrequencies) => void;
  /** The classified lexicons over the current fold, memoised until it (or the
   * catalogue seeds) move. */
  hints: (
    authors: readonly HintAuthor[],
    works: readonly { title: string }[],
  ) => Hints;
};

/** One phrase in the aggregate: its folded words, and how many files attest it. */
type PhraseRefs = Map<string, { seq: string[]; refs: number }>;

export const createHintIndex = (overrides: HintOverrides = {}): HintIndex => {
  const perFile = new Map<string, HintContribution>();
  const people: PhraseRefs = new Map();
  const places: PhraseRefs = new Map();
  const orgs: PhraseRefs = new Map();
  const citations: PhraseRefs = new Map();
  /** code → word → summed occurrences across every contributing file. */
  const langCounts = new Map<string, Map<string, number>>();
  let frequencies: WordFrequencies = {
    unmarked: new Map(),
    unmarkedLower: new Map(),
  };

  let cached: Hints | undefined;
  let cachedAuthors: readonly HintAuthor[] | undefined;
  let cachedWorks: readonly { title: string }[] | undefined;

  const apply = (contribution: HintContribution, delta: 1 | -1): void => {
    addPhrases(people, contribution.people, delta);
    addPhrases(places, contribution.places, delta);
    addPhrases(orgs, contribution.orgs, delta);
    addPhrases(citations, contribution.citations, delta);
    for (const [code, counts] of contribution.langCounts) {
      const totals = langCounts.get(code) ?? new Map<string, number>();
      langCounts.set(code, totals);
      for (const [word, count] of counts) {
        const next = (totals.get(word) ?? 0) + delta * count;
        if (next > 0) totals.set(word, next);
        else totals.delete(word);
      }
      // A language nothing attests any more goes, rather than lingering empty.
      if (totals.size === 0) langCounts.delete(code);
    }
    cached = undefined;
  };

  return {
    set: (path, contribution) => {
      const previous = perFile.get(path);
      if (previous !== undefined) apply(previous, -1);
      perFile.set(path, contribution);
      apply(contribution, 1);
    },
    remove: (path) => {
      const previous = perFile.get(path);
      if (previous === undefined) return;
      perFile.delete(path);
      apply(previous, -1);
    },
    rebase: (next) => {
      frequencies = next;
      cached = undefined;
    },
    hints: (authors, works) => {
      if (
        cached !== undefined &&
        cachedAuthors === authors &&
        cachedWorks === works
      ) {
        return cached;
      }
      cached = classifyHints(
        {
          people: lexiconOf(people),
          places: lexiconOf(places),
          orgs: lexiconOf(orgs),
          citations: lexiconOf(citations),
          langCounts,
        },
        frequencies,
        authors,
        works,
        overrides,
      );
      cachedAuthors = authors;
      cachedWorks = works;
      return cached;
    },
  };
};

/** Add (or subtract) one file's phrases, dropping those nothing attests. */
const addPhrases = (
  into: PhraseRefs,
  seqs: readonly string[][],
  delta: 1 | -1,
): void => {
  for (const seq of seqs) {
    const key = phraseKey(seq);
    // `set` on a key already present keeps its position, so the aggregate stays
    // in first-attested order — which is the order a whole-corpus mine produces.
    const refs = (into.get(key)?.refs ?? 0) + delta;
    if (refs > 0) into.set(key, { seq, refs });
    else into.delete(key);
  }
};

const lexiconOf = (refs: PhraseRefs) =>
  phraseLexiconOf([...refs.values()].map((entry) => entry.seq));
