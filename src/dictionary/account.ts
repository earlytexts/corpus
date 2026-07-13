/**
 * The accounting rule: given a document and the register (any dictionary shape —
 * only membership is read), classify every token of every text as accounted for
 * by at least one of a dictionary entry, exempting markup, a mechanical class,
 * or (multi-token surfaces) `[w:]` markup — or `"unaccounted"`, the only
 * violation. This one pure function is both the corpus coverage validation and
 * the Compositor's live squiggle engine.
 */

import type { MarkitDocument, Word as WordElement } from "@earlytexts/markit";
import type { Register } from "./types.ts";
import {
  fold,
  isRomanNumeral,
  joinMultiWord,
  type JoinOps,
  multiWordSurfaces,
  scanBlock,
  type Token,
} from "../words.ts";

/**
 * How a token is accounted for — "at least one of" a dictionary entry,
 * exempting markup, a mechanical class, or (multi-token surfaces) `[w:]`
 * markup itself; "unaccounted" is the only violation. A token both mechanical
 * and registered reports its dictionary status (`I` with an entry for "i" is
 * that entry, not a numeral).
 */
export type TokenStatus =
  | "registered" // has a dictionary entry for its folded surface
  | "exempt" // inside person / place / org / citation / language markup
  | "mechanical" // contains digits, or reads as a roman numeral
  | "marked" // inside multi-token `[w:]` markup, which is its own reading
  | "unaccounted";

export type TokenAccount = Token & {
  /** The id of the text (document or section) the token appears in. */
  textId: string;
  status: TokenStatus;
};

/**
 * Apply the accounting rule to every token of a document (its own blocks and
 * its sections', recursively): every token in every text is accounted for by
 * at least one of a dictionary entry for its folded surface, enclosure in
 * exempting markup, or a mechanical class. This one pure function is both the
 * corpus coverage validation and the Compositor's live squiggle engine.
 */
export const accountTokens = (
  doc: MarkitDocument,
  register: Register,
): TokenAccount[] => {
  const keys = multiWordSurfaces(register);
  const accounts: TokenAccount[] = [];
  const walk = (text: MarkitDocument): void => {
    for (const block of text.blocks) {
      const { tokens, words } = scanBlock(block);
      const marked = new Set(
        words.filter((w) => w.tokens.length > 1).map((w) => w.element),
      );
      for (const token of joinMultiWord(tokens, keys, tokenJoin)) {
        accounts.push({
          ...token,
          textId: text.id,
          status: statusOf(token, marked, register),
        });
      }
    }
    for (const child of text.children) walk(child);
  };
  walk(doc);
  return accounts;
};

/** Fuse a run of adjacent block tokens into one multi-word surface: the printed
 * texts join with spaces and the folded key follows. The run shares one
 * enclosing context, so the first token's carries over. */
const tokenJoin: JoinOps<Token> = {
  folded: (token) => token.folded,
  joinsLeft: (token) => token.joinsLeft,
  merge: (run) => {
    const text = run.map((token) => token.text).join(" ");
    return { ...run[0], text, folded: fold(text) };
  },
};

const statusOf = (
  token: Token,
  marked: Set<WordElement>,
  register: Register,
): TokenStatus => {
  if (token.exemption !== undefined) return "exempt";
  if (token.word !== undefined && marked.has(token.word)) return "marked";
  if (token.folded in register) return "registered";
  if (/\p{N}/u.test(token.text) || isRomanNumeral(token.text)) {
    return "mechanical";
  }
  return "unaccounted";
};

export type Coverage = {
  total: number;
  /** Accounted for by any route: a dictionary entry, exempting markup, a
   * mechanical class, or `[w:]` markup. */
  accounted: number;
  unaccounted: number;
};

export const coverageOf = (accounts: TokenAccount[]): Coverage => {
  const coverage = { total: accounts.length, accounted: 0, unaccounted: 0 };
  for (const { status } of accounts) {
    if (status === "unaccounted") coverage.unaccounted++;
    else coverage.accounted++;
  }
  return coverage;
};
