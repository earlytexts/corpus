/**
 * The accounting rule: given a document and the register (any dictionary shape —
 * only membership is read), classify every token of every text as accounted for
 * by at least one of a dictionary entry, the possessive rule (a registered base
 * plus `'s`), exempting markup, or a mechanical class — or `"unaccounted"`, the
 * only violation. Tokens come from Markit's
 * tokenizer, both versions united (`blockTokens` — a deleted word is still a
 * printed word). This one pure function is both the corpus coverage validation
 * and the Compositor's live squiggle engine.
 */

import type { Block, MarkitDocument, Token } from "@earlytexts/markit";
import type { Register } from "../dictionary/types.ts";
import {
  blockTokens,
  exemptionOf,
  fold,
  isRomanNumeral,
  possessiveBase,
} from "../dictionary/words.ts";

/**
 * How a token is accounted for — "at least one of" a dictionary entry, the
 * possessive rule, exempting markup, or a mechanical class; "unaccounted" is
 * the only violation. A token both mechanical and registered reports its
 * dictionary status (`I` with an entry for "i" is that entry, not a numeral). A
 * `~`-fused multi-word unit is one token whose folded surface is its
 * dictionary key ("a priori"); a `[w:]`-marked token is accounted like any
 * other, by its own entry (which the word-markup validation requires). A
 * possessive whose base is registered but which has no entry of its own is
 * `"possessive"`, not `"registered"` — the base carries it, not an entry.
 */
export type TokenStatus =
  | "registered" // has a dictionary entry for its folded surface
  | "possessive" // no entry, but its base has one (`bishop's` → `bishop`)
  | "exempt" // inside person / place / org / citation / language markup
  | "mechanical" // contains digits, or reads as a roman numeral
  | "unaccounted";

export type TokenAccount = {
  /** The token as printed (a fused unit with a plain space, "a priori"). */
  text: string;
  /** The folded form — the dictionary key. */
  folded: string;
  /** The id of the text (document or section) the token appears in. */
  textId: string;
  /** The block the token sits in (anchors diagnostics to a line). */
  block: Block;
  status: TokenStatus;
};

/**
 * Apply the accounting rule to every token of a document (its own blocks and
 * its sections', recursively): every token in every text is accounted for by
 * at least one of a dictionary entry for its folded surface, enclosure in
 * exempting markup, or a mechanical class.
 */
export const accountTokens = (
  doc: MarkitDocument,
  register: Register,
): TokenAccount[] => {
  const accounts: TokenAccount[] = [];
  const walk = (text: MarkitDocument): void => {
    for (const block of text.blocks) {
      for (const token of blockTokens(block)) {
        const folded = fold(token.text);
        accounts.push({
          text: token.text,
          folded,
          textId: text.id,
          block,
          status: statusOf(token, folded, register),
        });
      }
    }
    for (const child of text.children) walk(child);
  };
  walk(doc);
  return accounts;
};

const statusOf = (
  token: Token,
  folded: string,
  register: Register,
): TokenStatus => {
  if (exemptionOf(token) !== undefined) return "exempt";
  if (folded in register) return "registered";
  const base = possessiveBase(folded);
  if (base !== undefined && base in register) return "possessive";
  if (/\p{N}/u.test(token.text) || isRomanNumeral(token.text)) {
    return "mechanical";
  }
  return "unaccounted";
};

export type Coverage = {
  total: number;
  /** Accounted for by any route: a dictionary entry, the possessive rule,
   * exempting markup, or a mechanical class. */
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
