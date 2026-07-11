/**
 * Word identity, defined once for every consumer: which character runs in a
 * text are words (segmentation — with an internal period and a non-breaking
 * space joining what would otherwise be separate tokens), what makes two
 * printed tokens the same surface (identity folding — Unicode lower-casing
 * only), which letter-runs are roman numerals (a mechanical class), and a
 * tokenizer over compiled Markit block content that reports each token with its
 * enclosing exempting markup (person / place / org / citation / language) and
 * `[w:…]` element.
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
 * apostrophes are all part of the token (`'tis`, `o'clock`, `lookin'`). One
 * further character *joins* what would otherwise be two tokens: an **internal
 * period**, one that falls between a letter/digit and a letter (`i.e`, `N.B`).
 * A trailing period drops (`i.e.` → `i.e`) but a period with no following space
 * — a missing sentence break, `end.The` — joins, yielding one unaccounted token
 * that flags the probable typo. (The other joiner, the non-breaking space
 * `a~priori`, is not a character in the run but a Markit element bridged in
 * `scanBlock`.) Hyphens split; anything else separates. Tokens containing
 * digits are not words (they fall to the mechanical class of the accounting
 * rule).
 */
export const wordPattern = /['’]*[\p{L}\p{N}](?:[\p{L}\p{N}'’]|\.(?=\p{L}))*/gu;

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

/** Whether a string is exactly one word: letters and apostrophes (no digits),
 * with the two internal joiners a token may carry — a period before a letter
 * (`i.e`) and a non-breaking space joining a fixed multi-word unit (`a priori`,
 * `to morrow`). Dictionary keys, spellings, and lemmas are words. (A cross-
 * reference *value* splits on its spaces first, so the multi-word form is a
 * single key/lemma, never a cross-reference target — see dictionary.ts.) */
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
    // A non-breaking space (`~`) between two plainText runs bridges the last
    // token of the left run into the first of the right, one surface with an
    // internal space (`a~priori` → `"a priori"`). It joins only plainText to
    // plainText within one run, so it never crosses an exempting-markup or
    // `[w:]` boundary — the joined pair share this call's exemption and word.
    let lastWasWord = false; // the tail token came from the preceding plainText
    let pendingJoin = false; // an nbSpace is bridging that tail into the next
    for (let i = 0; i < elements.length; i++) {
      const element = elements[i];
      if (element.type === "nbSpace") {
        pendingJoin = lastWasWord && elements[i + 1]?.type === "plainText";
        continue; // emits nothing; leaves lastWasWord for a following plainText
      }
      if (element.type === "plainText") {
        const segments = words(element.content);
        segments.forEach((text, index) => {
          if (pendingJoin && index === 0) {
            const tail = tokens[tokens.length - 1];
            tail.text += ` ${text}`;
            tail.folded = fold(tail.text);
          } else {
            tokens.push({
              text,
              folded: fold(text),
              ...(exemption !== undefined ? { exemption } : {}),
              ...(word !== undefined ? { word } : {}),
              block,
            });
          }
        });
        pendingJoin = false;
        lastWasWord = segments.length > 0;
        continue;
      }
      pendingJoin = false;
      lastWasWord = false;
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
