/**
 * The dictionary accounting scan: the vscode-free core of the "unaccounted
 * word" diagnostic. The corpus owns the *decision* — its `accountTokens` rule
 * (the one coverage engine shared by corpus validation and this editor) says,
 * for a compiled document, which folded surfaces are unaccounted (no dictionary
 * entry). This module only *locates* those surfaces in the source, so the
 * editor can squiggle each occurrence and offer curation quick-fixes.
 *
 * Location runs Markit's own tokenizer over the positioned compile
 * (sourceTokens.ts's `blockSourceTokens`), which drops exempting markup (people,
 * places, orgs, citations, foreign spans, `[w:]`) and reads through page
 * breaks, editorial marks, and `{…}` character mode — so an exempt or
 * disambiguated occurrence is never flagged, and a word built from character
 * escapes or a ligature lines up exactly. What the scan cannot line up — an
 * occurrence whose token stream diverges from the accounting rule's (a
 * `~`-fused run with no dictionary entry reads as one unregistered token
 * here, two accounted ones there) — simply goes unflagged rather than
 * mis-flagged; the coverage *counts* (which need no ranges) stay exact.
 *
 * The scan also proposes the `~` fix: an unaccounted occurrence that, joined
 * with adjacent tokens, folds to a registered multi-word key ("a priori") is
 * one the editor should fuse in the source (`a~priori`) rather than register
 * piecemeal — the fix carries the exact whitespace gaps to replace with `~`.
 */

import type { MarkitDocument } from "@jsr/earlytexts__markit";
import {
  accountTokens,
  type Dictionary,
  fold,
  multiWordSurfaces,
} from "@earlytexts/corpus";
import {
  blockSourceTokens,
  collectBlocks,
  sliceRange,
  type SourceToken,
} from "./sourceTokens.ts";

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
  /** When the occurrence fuses with its neighbours into a registered
   * multi-word unit: the `~` quick fix. */
  fuse?: TildeFusion;
};

/** A run of adjacent tokens that folds to a registered multi-word key once
 * its inter-word gaps are replaced with `~`. */
export type TildeFusion = {
  /** The registered multi-word key the run folds to ("a priori"). */
  key: string;
  /** The run as it would read fused in the source ("a~priori"). */
  joined: string;
  /** The whitespace gaps to replace with `~`, in order (0-based columns,
   * end exclusive; a gap may cross a line break). */
  gaps: TildeGap[];
};

export type TildeGap = {
  startLine: number;
  startColumn: number;
  endLine: number;
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
 * Every source occurrence of an unaccounted surface, in reading order, each
 * carrying its `~` fusion when one applies. `document` must be the compile
 * (with positions) of `source`. Returns nothing when the register accounts
 * for everything (the common steady state), so the caller can skip the
 * source walk entirely.
 */
export const scanUnaccounted = (
  source: string,
  document: MarkitDocument,
  dictionary: Dictionary,
): UnaccountedWord[] => {
  const unaccounted = unaccountedSurfaces(document, dictionary);
  if (unaccounted.size === 0) return [];
  const lines = source.split("\n");
  const keys = multiWordSurfaces(dictionary);
  const out: UnaccountedWord[] = [];
  for (const block of collectBlocks(document)) {
    const tokens = blockSourceTokens(block, lines);
    tokens.forEach((token, index) => {
      const surface = fold(token.display);
      if (!unaccounted.has(surface)) return;
      const fuse = findFusion(tokens, index, keys, lines);
      out.push({
        surface,
        display: token.display,
        line: token.line,
        startColumn: token.start,
        endColumn: token.end,
        ...(fuse !== undefined ? { fuse } : {}),
      });
    });
  }
  return out;
};

/** The longest registered multi-word unit the token at `index` forms with its
 * adjacent neighbours (longest first, then leftmost), if any. */
const findFusion = (
  tokens: SourceToken[],
  index: number,
  keys: ReadonlySet<string>,
  lines: string[],
): TildeFusion | undefined => {
  if (keys.size === 0) return undefined;
  let maxLength = 2;
  for (const key of keys) {
    maxLength = Math.max(maxLength, key.split(" ").length);
  }
  for (let length = Math.min(maxLength, tokens.length); length >= 2; length--) {
    const first = Math.max(0, index - length + 1);
    const last = Math.min(index, tokens.length - length);
    for (let from = first; from <= last; from++) {
      const run = tokens.slice(from, from + length);
      if (!run.slice(1).every((token) => token.joinsLeft)) continue;
      const key = run.map((token) => fold(token.display)).join(" ");
      if (!keys.has(key)) continue;
      const gaps = runGaps(run, lines);
      if (gaps === undefined) continue;
      const joined = run
        .map((token) => token.display.replaceAll(" ", "~"))
        .join("~");
      return { key, joined, gaps };
    }
  }
  return undefined;
};

/** The source gaps between a run's consecutive tokens — defined only when
 * every gap is pure whitespace and every token's range really starts and
 * ends on its own characters (collapsed whitespace leaves compiled positions
 * approximate, and an edit anchored to an approximate range would corrupt
 * the text), so replacing each gap with `~` is safe. */
const runGaps = (
  run: SourceToken[],
  lines: string[],
): TildeGap[] | undefined => {
  if (!run.every((token) => anchored(token, lines))) return undefined;
  const gaps: TildeGap[] = [];
  for (let i = 1; i < run.length; i++) {
    const a = run[i - 1]!;
    const b = run[i]!;
    // Brace-widening can leave the two positions inverted; that run can't fuse.
    if (b.line < a.line || (b.line === a.line && b.start < a.end)) {
      return undefined;
    }
    const between = sliceRange(lines, a.line, a.end, b.line, b.start);
    if (!/^[ \n]+$/.test(between)) return undefined;
    gaps.push({
      startLine: a.line,
      startColumn: a.end,
      endLine: b.line,
      endColumn: b.start,
    });
  }
  return gaps;
};

/** Whether a token's range really starts and ends on its own first and last
 * characters (a brace-widened token, for one, does not). */
const anchored = (token: SourceToken, lines: string[]): boolean => {
  const line = lines[token.line] ?? "";
  return (
    line[token.start] === token.display[0] &&
    line[token.end - 1] === token.display[token.display.length - 1]
  );
};
