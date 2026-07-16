/**
 * Word semantics, defined once for every consumer. Word *identity* — which
 * character runs are tokens, with `~` (a non-breaking space) fusing a marked
 * multi-word unit (`a~priori`) into one token — is Markit's (`tokenize` and
 * `wordPattern`); this module owns what the corpus adds on top: identity
 * folding (what makes two printed tokens the same surface), the mechanical
 * roman-numeral class, exemption policy (which enclosing markup takes a token
 * out of the dictionary register), and the both-versions token stream of a
 * block (a deleted word is still a printed word).
 *
 * This module is exported on the `wire` subpath so the computer and the
 * Compositor share one definition; everything editorial about a word
 * (readings, lemmas) lives in the dictionary/ modules. Search-time folding and
 * expansion remain the computer's own business.
 */

import { type Block, type Token, tokenize } from "@earlytexts/markit";

/** The markup kinds whose contents are exempt from the dictionary register. */
export const exemptions = [
  "person",
  "place",
  "org",
  "citation",
  "language",
] as const;

/** One of the exempting markup kinds (see `exemptions`). */
export type Exemption = (typeof exemptions)[number];

/** The nearest enclosing exempting markup of a token, read from the wrapper
 * context Markit's tokenizer reports (innermost frame first). */
export const exemptionOf = (token: Token): Exemption | undefined => {
  for (let i = token.context.length - 1; i >= 0; i--) {
    const type = token.context[i].type;
    if ((exemptions as readonly string[]).includes(type)) {
      return type as Exemption;
    }
  }
  return undefined;
};

/**
 * The word tokens of a block, both versions united: every token of the edited
 * reading text, then the original text's surplus (the tokens editing removed —
 * a deleted word is still a printed word, so it is still accounted). The
 * surplus is a multiset difference keyed by everything accounting reads (the
 * token's text, exemption, `[w:]` value), so a block without editorial markup
 * contributes each token exactly once, and a correction contributes both its
 * sides.
 */
export const blockTokens = (block: Block): Token[] => {
  const edited = tokenize(block);
  const original = tokenize(block, { version: "original" });
  const counts = new Map<string, number>();
  for (const token of edited) {
    const key = accountKey(token);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const surplus = original.filter((token) => {
    const key = accountKey(token);
    const count = counts.get(key) ?? 0;
    if (count === 0) return true;
    counts.set(key, count - 1);
    return false;
  });
  return [...edited, ...surplus];
};

/* Newline-joined for injectivity: neither a token's text nor an inline `[w:]`
 * value can contain one. */
const accountKey = (token: Token): string =>
  [token.text, exemptionOf(token) ?? "", token.word ?? ""].join("\n");

/** Identity folding: what makes two printed tokens the same surface. Lower-
 * casing is the only mechanical normalisation — everything else (u/v,
 * ligatures, …) is an ordinary dictionary entry — with one exception: the bare
 * pronoun `I`. Case-folding exists to erase *positional* capitalisation (a
 * sentence-initial `The` is the word `the`); `I` is the one English word whose
 * capital is *lexical*, so there is no lower-case pronoun to fold it onto, and
 * folding it would collide with the roman numeral `i`. Only the bare token is
 * preserved; contractions (`I'll`) fold as usual and reach the pronoun through
 * their reading. A multi-word surface folds word by word (its internal spaces
 * kept), so `A Priori` folds to `a priori`. */
export const fold = (text: string): string =>
  text
    .split(" ")
    .map((word) => (word === "I" ? "I" : word.toLowerCase()))
    .join(" ");

/** Whether a string is exactly one word: letters and apostrophes (no digits),
 * with the two things a token may carry beyond that — a period before a letter
 * (`i.e`) and internal spaces (a fixed multi-word unit, `~`-fused in the texts
 * and registered as one surface, `a priori`). Dictionary keys, spellings, and
 * lemmas are words. (A cross-reference *value* splits on its spaces first, so
 * the multi-word form is a single key/lemma, never a cross-reference target —
 * see dictionary/shards.ts.) */
export const isWord = (text: string): boolean => wordRe.test(text);

const wordAtom = String.raw`['’]*\p{L}(?:['’\p{L}]|\.(?=\p{L}))*`;
const wordRe = new RegExp(`^${wordAtom}(?: ${wordAtom})*$`, "u");

/** Whether a token reads as a strict roman numeral (case-insensitive) — a
 * mechanical class of the accounting rule. Short numerals are also ordinary
 * words (`I`, `mix`), which is why accounting is "at least one of". Lower-cases
 * on its own rather than through `fold`, so a capital `I` (which `fold`
 * preserves as the pronoun) is still recognised as the numeral. */
export const isRomanNumeral = (token: string): boolean =>
  token !== "" &&
  /^m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/
    .test(token.toLowerCase());
