/**
 * Word identity, defined once for every consumer: which character runs in a
 * text are words (segmentation), what makes two printed tokens the same
 * surface (identity folding — Unicode lower-casing only), which letter-runs
 * are roman numerals (a mechanical class), and a tokenizer over compiled
 * Markit block content that reports each token with its enclosing exempting
 * markup (person / place / org / citation / language) and `[w:…]` element.
 *
 * This module is exported on the `wire` subpath so the computer and the
 * Compositor share one definition of "a word"; everything editorial about a
 * word (readings, lemmas) lives in dictionary.ts. Search-time folding and
 * expansion remain the computer's own business.
 */

import type {
  Block,
  BlockElement,
  InlineElement,
  List,
  NestableBlockElement,
  Word as WordElement,
} from "@earlytexts/markit";

/** The markup kinds whose contents are exempt from the dictionary register. */
export const exemptions = [
  "person",
  "place",
  "org",
  "citation",
  "language",
] as const;

export type Exemption = (typeof exemptions)[number];

/** One token of a block, in reading order. */
export type Token = {
  /** The token as printed. */
  text: string;
  /** The folded form — the dictionary key. */
  folded: string;
  /** The nearest enclosing exempting markup, if any. */
  exemption?: Exemption;
  /** The enclosing `[w:surface=value]` element, if any. */
  word?: WordElement;
  /** The block the token sits in (anchors diagnostics to a line). */
  block: Block;
};

/** A `[w:…]` element of a block, with the tokens of its printed surface. */
export type WordOccurrence = {
  element: WordElement;
  tokens: Token[];
};

export type BlockScan = {
  tokens: Token[];
  /** Every `[w:…]` element, in order (its tokens also appear in `tokens`). */
  words: WordOccurrence[];
};

/**
 * The word alphabet: a token is a run of letters, digits, and apostrophes
 * containing at least one letter or digit — internal, leading, and trailing
 * apostrophes are all part of the token (`'tis`, `o'clock`, `lookin'`).
 * Hyphens split; anything else separates. Tokens containing digits are not
 * words (they fall to the mechanical class of the accounting rule).
 */
export const wordPattern = /['’]*[\p{L}\p{N}][\p{L}\p{N}'’]*/gu;

/** Segment a string into its tokens, in order. */
export const words = (text: string): string[] =>
  [...text.matchAll(wordPattern)].map((match) => match[0]);

/** Identity folding: what makes two printed tokens the same surface. Lower-
 * casing is the only mechanical normalisation — everything else (u/v,
 * ligatures, …) is an ordinary dictionary entry — with one exception: the bare
 * pronoun `I`. Case-folding exists to erase *positional* capitalisation (a
 * sentence-initial `The` is the word `the`); `I` is the one English word whose
 * capital is *lexical*, so there is no lower-case pronoun to fold it onto, and
 * folding it would collide with the roman numeral `i`. Only the bare token is
 * preserved; contractions (`I'll`) fold as usual and reach the pronoun through
 * their reading. */
export const fold = (text: string): string =>
  text === "I" ? "I" : text.toLowerCase();

/** Whether a string is exactly one word: a single token of letters and
 * apostrophes (no digits). Dictionary keys, spellings, and lemmas are words. */
export const isWord = (text: string): boolean =>
  /^['’]*\p{L}['’\p{L}]*$/u.test(text);

/** Whether a token reads as a strict roman numeral (case-insensitive) — a
 * mechanical class of the accounting rule. Short numerals are also ordinary
 * words (`I`, `mix`), which is why accounting is "at least one of". Lower-cases
 * on its own rather than through `fold`, so a capital `I` (which `fold`
 * preserves as the pronoun) is still recognised as the numeral. */
export const isRomanNumeral = (token: string): boolean =>
  token !== "" &&
  /^m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/
    .test(token.toLowerCase());

/**
 * Tokenize a compiled block: every token of its inline content (headings,
 * paragraphs, quotations, stage directions, lists, tables), each tagged with
 * its nearest enclosing exempting markup and enclosing `[w:…]` element, plus
 * the `[w:…]` elements themselves with their surface tokens.
 */
export const scanBlock = (block: Block): BlockScan => {
  const tokens: Token[] = [];
  const wordMarkup: WordOccurrence[] = [];

  const walkInline = (
    elements: InlineElement[],
    exemption: Exemption | undefined,
    word: WordElement | undefined,
  ): void => {
    for (const element of elements) {
      if (element.type === "plainText") {
        for (const text of words(element.content)) {
          tokens.push({
            text,
            folded: fold(text),
            ...(exemption !== undefined ? { exemption } : {}),
            ...(word !== undefined ? { word } : {}),
            block,
          });
        }
        continue;
      }
      if (element.type === "word") {
        const start = tokens.length;
        walkInline(element.content, exemption, element);
        wordMarkup.push({ element, tokens: tokens.slice(start) });
        continue;
      }
      // Everything else with inline content — wrappers, language, raw
      // elements, highlights — recurses; exempting kinds mark their contents.
      if (!("content" in element)) continue;
      walkInline(element.content, exemptionOf(element.type) ?? exemption, word);
    }
  };

  const walkBlockElements = (
    elements: (BlockElement | NestableBlockElement)[],
  ): void => {
    for (const element of elements) {
      switch (element.type) {
        case "heading":
          for (const line of element.content) {
            walkInline(line.content, undefined, undefined);
          }
          break;
        case "paragraph":
          walkInline(element.content, undefined, undefined);
          break;
        case "blockquote":
        case "stageDirection":
          walkBlockElements(element.content);
          break;
        case "list":
          walkList(element);
          break;
        case "table":
          for (const row of element.rows) {
            for (const cell of row.cells) {
              walkInline(cell.content, undefined, undefined);
            }
          }
          break;
      }
    }
  };

  const walkList = (list: List): void => {
    for (const item of list.items) {
      walkInline(item.content, undefined, undefined);
      if (item.nestedList !== undefined) walkList(item.nestedList);
    }
  };

  walkBlockElements(block.content);
  return { tokens, words: wordMarkup };
};

const exemptionOf = (type: string): Exemption | undefined =>
  (exemptions as readonly string[]).includes(type)
    ? (type as Exemption)
    : undefined;
