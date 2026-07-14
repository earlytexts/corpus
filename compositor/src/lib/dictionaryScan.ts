/**
 * The dictionary accounting scan: the vscode-free core of the "unaccounted
 * word" diagnostic. The corpus owns the *decision* — its `accountTokens` rule
 * (the one coverage engine shared by corpus validation and this editor) says,
 * for a compiled document, which folded surfaces are unaccounted (no dictionary
 * entry). This module only *locates* those surfaces in the source, so the
 * editor can squiggle each occurrence and offer curation quick-fixes.
 *
 * Location reuses hints.ts's block tokenizer (`documentSourceTokens`), which
 * already drops exempting markup (people, places, orgs, citations, foreign
 * spans, `[w:]`) and reads through page breaks and editorial marks — so an
 * exempt or `[w:]`-disambiguated occurrence is never flagged. Each source token
 * is re-folded with the corpus's own `fold` and matched against the decision
 * set; because both sides fold identically, matching is exact for ordinary
 * words and contractions alike. The residue it cannot line up — a word built
 * from `{…}` character escapes, split by a mid-word page break, or spelled with
 * a ligature the register keeps (`œconomy`) — simply goes unflagged rather than
 * mis-flagged; the coverage *counts* (which need no ranges) stay exact.
 */

import type { MarkitDocument } from "@jsr/earlytexts__markit";
import { accountTokens, type Dictionary, fold } from "@earlytexts/corpus";
import { documentSourceTokens } from "./hints.ts";

/** One flagged occurrence of a surface the register does not yet account for.
 * Single-line (columns 0-based, end exclusive) — the shape a VSCode Range wants. */
export type UnaccountedWord = {
  /** The folded surface — the dictionary key it is (or would be) filed under. */
  surface: string;
  /** The word exactly as printed in the source (what a quick-fix respells). */
  display: string;
  line: number;
  startColumn: number;
  endColumn: number;
};

/**
 * The folded surfaces of a compiled document the accounting rule leaves
 * unaccounted (no dictionary entry). A surface accounted at some occurrences
 * and not others (an entry-less word also seen inside markup) is included for
 * the occurrences that need it.
 */
export const unaccountedSurfaces = (
  document: MarkitDocument,
  dictionary: Dictionary,
): Set<string> => {
  const unaccounted = new Set<string>();
  for (const token of accountTokens(document, dictionary)) {
    if (token.status === "unaccounted") unaccounted.add(token.folded);
  }
  return unaccounted;
};

/**
 * Every source occurrence of an unaccounted surface, in reading order.
 * `document` must be the compile of `source`. Returns nothing when the register
 * accounts for everything (the common steady state), so the caller can skip the
 * source walk entirely.
 */
export const scanUnaccounted = (
  source: string,
  document: MarkitDocument,
  dictionary: Dictionary,
): UnaccountedWord[] => {
  const unaccounted = unaccountedSurfaces(document, dictionary);
  if (unaccounted.size === 0) return [];
  const out: UnaccountedWord[] = [];
  for (const token of documentSourceTokens(source, document)) {
    const surface = fold(token.display);
    if (!unaccounted.has(surface)) continue;
    out.push({
      surface,
      display: token.display,
      line: token.line,
      startColumn: token.start,
      endColumn: token.end,
    });
  }
  return out;
};
