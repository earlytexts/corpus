/**
 * Word identity, defined once for every consumer: which character runs in a
 * text are words (segmentation — with an internal period joining what would
 * otherwise be separate tokens), what makes two printed tokens the same surface
 * (identity folding — Unicode lower-casing only), which letter-runs are roman
 * numerals (a mechanical class), a tokenizer over compiled Markit block content
 * that reports each token with its enclosing exempting markup (person / place /
 * org / citation / language) and `[w:…]` element, and the register-driven join
 * that fuses a run of adjacent words into one multi-word surface (`a priori`).
 *
 * This module is exported on the `wire` subpath so the computer and the
 * Compositor share one definition of "a word"; everything editorial about a
 * word (readings, lemmas) lives in the dictionary/ modules. Search-time folding and
 * expansion remain the computer's own business.
 *
 * Segmentation is single-word: a non-breaking space is ordinary whitespace, no
 * different from a plain space. Whether two adjacent words are one surface is a
 * dictionary fact, not a mark in the text — the register lists the fixed
 * multi-word units (`a priori`, `to morrow`), and `joinMultiWord` fuses a run
 * of base tokens exactly when their space-joined folded form is one. Both the
 * corpus (accounting) and the computer (indexing) run that one function over
 * their own base tokens, so they cannot disagree.
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
  /** Whether only inter-word space separates this token from the one before it
   * within the same inline run — the adjacency `joinMultiWord` fuses across. A
   * run break (punctuation, markup, a block boundary) or the first token of a
   * run is `false`. */
  joinsLeft: boolean;
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
 * that flags the probable typo. Hyphens split; anything else — a plain or
 * non-breaking space included — separates. Tokens containing digits are not
 * words (they fall to the mechanical class of the accounting rule).
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
 * their reading. A multi-word surface folds word by word (its internal spaces
 * kept), so `A Priori` folds to `a priori`. */
export const fold = (text: string): string =>
  text
    .split(" ")
    .map((word) => (word === "I" ? "I" : word.toLowerCase()))
    .join(" ");

/** Whether a string is exactly one word: letters and apostrophes (no digits),
 * with the two things a token may carry beyond that — a period before a letter
 * (`i.e`) and internal spaces (a fixed multi-word unit registered as one
 * surface, `a priori`, `to morrow`). Dictionary keys, spellings, and lemmas are
 * words. (A cross-reference *value* splits on its spaces first, so the
 * multi-word form is a single key/lemma, never a cross-reference target — see
 * dictionary/shards.ts.) */
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
 * its nearest enclosing exempting markup and enclosing `[w:…]` element and
 * whether it joins the token before it, plus the `[w:…]` elements themselves
 * with their surface tokens. Segmentation is single-word; `joinMultiWord`
 * fuses the multi-word units afterwards, once the register is known.
 */
export const scanBlock = (block: Block): BlockScan => {
  const tokens: Token[] = [];
  const wordMarkup: WordOccurrence[] = [];

  const walkInline = (
    elements: InlineElement[],
    exemption: Exemption | undefined,
    word: WordElement | undefined,
  ): void => {
    // A run stays "open" while nothing but inter-word space separates the last
    // emitted token from the current position: a plain space within a plainText
    // node, or a non-breaking / em space between two of them. Any element with
    // its own content (markup, `[w:]`, an exempting span) breaks it, so a join
    // never crosses a markup boundary.
    let openRun = false;
    for (const element of elements) {
      if (element.type === "plainText") {
        const content = element.content;
        let cursor = 0;
        let emitted = false;
        for (const match of content.matchAll(wordPattern)) {
          const gap = content.slice(cursor, match.index);
          const text = match[0];
          tokens.push({
            text,
            folded: fold(text),
            joinsLeft: (emitted || openRun) && isSpaces(gap),
            ...(exemption !== undefined ? { exemption } : {}),
            ...(word !== undefined ? { word } : {}),
            block,
          });
          cursor = match.index + text.length;
          emitted = true;
        }
        // The run continues past this node only if its tail (or, when it held
        // no token, the whole node) is space — otherwise punctuation broke it.
        openRun = (emitted || openRun) && isSpaces(content.slice(cursor));
        continue;
      }
      if (element.type === "nbSpace" || element.type === "emSpace") {
        continue; // whitespace: emits nothing, leaves the run open
      }
      openRun = false;
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

/** Whether a between-token gap is only inter-word space — the separation a
 * multi-word join is allowed to bridge. A newline or any punctuation is not. */
const isSpaces = (gap: string): boolean => /^ *$/.test(gap);

const exemptionOf = (type: string): Exemption | undefined =>
  (exemptions as readonly string[]).includes(type)
    ? (type as Exemption)
    : undefined;

/* ---------------------------- multi-word joins -------------------------- */

/** How `joinMultiWord` reads and fuses a token type it is generic over: the
 * corpus works over `Token`s of the block tree, the computer over spans of
 * flattened text, each supplying its own folding, adjacency, and merge. */
export type JoinOps<T> = {
  /** The token's folded form — what a run's join is matched against the keys. */
  folded: (token: T) => string;
  /** Whether the token joins the one before it (adjacency; see `Token.joinsLeft`). */
  joinsLeft: (token: T) => boolean;
  /** Fuse a run of adjacent tokens into the one multi-word token they form. */
  merge: (run: T[]) => T;
};

/** The multi-word surfaces of a register — its keys with an internal space, the
 * only ones `joinMultiWord` can fuse a run into. */
export const multiWordSurfaces = (
  register: Record<string, unknown>,
): Set<string> =>
  new Set(Object.keys(register).filter((key) => key.includes(" ")));

/**
 * Fuse each maximal run of adjacent base tokens whose space-joined folded form
 * is a registered multi-word surface into one token, greedily longest-first
 * (so a three-word unit wins over a two-word prefix). Adjacency is the caller's
 * `joinsLeft`; the run must be unbroken. Tokens not part of any unit pass
 * through untouched. One definition, run by the corpus over the block tree and
 * by the computer over flattened text, so the two tokenizations of a unit agree.
 */
export const joinMultiWord = <T>(
  tokens: T[],
  keys: ReadonlySet<string>,
  ops: JoinOps<T>,
): T[] => {
  if (keys.size === 0) return tokens;
  let maxLen = 2;
  for (const key of keys) {
    const length = key.split(" ").length;
    if (length > maxLen) maxLen = length;
  }
  const out: T[] = [];
  let index = 0;
  while (index < tokens.length) {
    let span = 1;
    for (
      let length = Math.min(maxLen, tokens.length - index);
      length >= 2;
      length--
    ) {
      const run = tokens.slice(index, index + length);
      if (!run.slice(1).every((token) => ops.joinsLeft(token))) continue;
      if (keys.has(run.map(ops.folded).join(" "))) {
        out.push(ops.merge(run));
        span = length;
        break;
      }
    }
    if (span === 1) out.push(tokens[index]);
    index += span;
  }
  return out;
};
