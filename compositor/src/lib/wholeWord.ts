/**
 * Whole-word, case-sensitive text replacement — the core of "Replace in Work /
 * Author". Kept free of any VSCode dependency so it can be unit-tested directly.
 *
 * Word characters are Unicode letters and digits, so a match never begins or
 * ends in the middle of an accented or Greek word (replacing "cafe" leaves
 * "café" alone; replacing "vertue" leaves "vertuous" alone).
 */

/** Escape a string so it matches literally inside a RegExp. */
const escapeRegExp = (term: string): string =>
  term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** A whole-word, case-sensitive matcher for `term`, bounded by non-word (i.e.
 * non-letter, non-digit) characters. */
export const wholeWord = (term: string): RegExp =>
  new RegExp(
    `(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`,
    "gu",
  );

/** Replace every whole-word occurrence of `search` with `replacement`,
 * reporting how many were made. */
export const replaceWholeWord = (
  text: string,
  search: string,
  replacement: string,
): { text: string; count: number } => {
  let count = 0;
  const out = text.replace(wholeWord(search), () => {
    count++;
    return replacement;
  });
  return { text: out, count };
};
