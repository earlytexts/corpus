/**
 * Validating the text a curator types into the dictionary panel's add controls,
 * turning it into the single surface entry to write. Each of the three add
 * actions is one single-surface upsert: a lemma headword (`null`), an inflected
 * form (`=lemma`), or a variant cross-reference (the modern spelling(s)).
 * Folding and word-validation are the corpus's (`entryWords`, via
 * dictionaryEntryText); this layer decides how many words each field takes and
 * rejects the rest, so the write path only ever sees a well-formed surface +
 * value. vscode-free and tested; the panel surface just writes the value it
 * returns, or shows the error string.
 */

import type { EntryValue } from "@earlytexts/corpus";
import { entryWords } from "./dictionaryEntryText.ts";

/** A validated single-surface upsert, or why the input was rejected. */
export type EntryEdit =
  { surface: string; value: EntryValue } | { error: string };

/** A new lemma headword: exactly one word, its own modern entry (`null`). */
export const lemmaEntry = (input: string): EntryEdit => {
  const surface = oneWord(input);
  return surface === undefined
    ? { error: "Enter a single word for the lemma." }
    : { surface, value: null };
};

/** A new inflected form of `lemma`: one word, distinct from the lemma, written
 * as `=lemma`. `lemma` comes from an existing row, so it is only re-folded. */
export const formEntry = (lemma: string, input: string): EntryEdit => {
  const surface = oneWord(input);
  if (surface === undefined)
    return { error: "Enter a single word for the form." };
  const folded = entryWords(lemma).join(" ");
  if (surface === folded)
    return { error: "A form must differ from its lemma." };
  return { surface, value: `=${folded}` };
};

/** A variant cross-reference: an archaic `surface` (one word) mapped to the
 * modern `spelling` (one or more words — more for a contraction, `'tis` →
 * "it is"), written as the spelling value. The two must differ. */
export const variantEntry = (
  surfaceInput: string,
  spellingInput: string,
): EntryEdit => {
  const surface = oneWord(surfaceInput);
  if (surface === undefined) {
    return { error: "Enter a single word for the variant spelling." };
  }
  const spellings = entryWords(spellingInput);
  if (spellings.length === 0) {
    return { error: "Enter the modern spelling (one or more words)." };
  }
  if (spellings.length === 1 && spellings[0] === surface) {
    return { error: "A variant must point at a different spelling." };
  }
  return { surface, value: spellings.join(" ") };
};

/** The one folded word of `input`, or undefined when it is not exactly one. */
const oneWord = (input: string): string | undefined => {
  const words = entryWords(input);
  return words.length === 1 ? words[0] : undefined;
};
