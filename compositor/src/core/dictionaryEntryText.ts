/**
 * Pure text for the dictionary overlay: validating the words a contributor
 * types for a respelling/lemma, the squiggle message for an unaccounted
 * surface, and the quick-fix titles. surface/commands/dictionaryDiagnostics.ts
 * owns the prompts, squiggles, and code actions; the wording and the
 * input-validation rule are here, and tested.
 */

import { fold, isWord } from "@earlytexts/corpus";
import type { TildeFusion, UnaccountedWord } from "./dictionaryScan.ts";
import type { EntryAction } from "./dictionaryEdits.ts";

/** The folded words of a contributor's entry input, or [] if any token is not
 * a word (letters and apostrophes). One word, or space-separated words for an
 * expansion (`'tis` → "it is"). */
export const entryWords = (input: string): string[] => {
  const tokens = input
    .trim()
    .split(/\s+/)
    .filter((t) => t !== "");
  return tokens.every((t) => isWord(fold(t))) && tokens.length > 0
    ? tokens.map(fold)
    : [];
};

/** The Problems-panel message for an unaccounted (unknown) surface. */
export const unaccountedMessage = (
  word: Pick<UnaccountedWord, "display">,
): string => `“${word.display}” is not in the dictionary.`;

/** The prompt title when a target needs an entry of its own before the
 * referencing entry can be written (a respelling target, in the corpus but not
 * yet the register). */
export const addTargetTitle = (target: string): string =>
  `“${target}” has no entry yet — add it as`;

/** The error when a respelling target is neither registered nor attested: a
 * respelling must point to a spelling that actually appears in the texts. */
export const unattestedRejectMessage = (target: string): string =>
  `“${target}” is not in the dictionary or the corpus. A respelling must ` +
  `point to a spelling that appears in the texts (make the archaic form ` +
  `itself the modern word instead).`;

/** The confirmation when a lemma is neither registered nor attested: a citation
 * form may be unprinted (datum for data), so it is allowed on confirmation. */
export const unattestedLemmaMessage = (target: string): string =>
  `“${target}” never appears in the corpus. Add it anyway as a modern word ` +
  `(an unprinted citation form)?`;

/** The quick-fix title for fusing a run into a registered multi-word unit. */
export const fuseActionTitle = (
  fuse: Pick<TildeFusion, "key" | "joined">,
): string => `Join as ${fuse.joined} — “${fuse.key}” is in the dictionary`;

/** The quick-fix title for a curation action on `surface`. */
export const entryActionTitle = (
  surface: string,
  kind: EntryAction["kind"],
): string => {
  switch (kind) {
    case "modern":
      return `Add “${surface}” to the dictionary (modern word)`;
    case "respell":
      return `Add “${surface}” as a respelling…`;
    case "lemma":
      return `Add “${surface}” with a lemma…`;
  }
};
